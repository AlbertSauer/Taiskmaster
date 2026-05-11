import os
import uuid
from datetime import datetime, timedelta

from flask import request


DEFAULT_PRICING_PER_1M = {
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (5.00, 15.00),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1": (2.00, 8.00),
}


def _read_usage_value(usage, key):
    if usage is None:
        return 0
    if isinstance(usage, dict):
        return int(usage.get(key) or 0)
    return int(getattr(usage, key, 0) or 0)


def _model_rates(model):
    input_override = os.getenv("OPENAI_INPUT_COST_PER_1M")
    output_override = os.getenv("OPENAI_OUTPUT_COST_PER_1M")
    if input_override and output_override:
        try:
            return float(input_override), float(output_override)
        except ValueError:
            pass

    normalized = (model or "").lower()
    for name, rates in DEFAULT_PRICING_PER_1M.items():
        if normalized.startswith(name):
            return rates
    return 0.0, 0.0


def estimate_cost_usd(model, prompt_tokens, completion_tokens):
    input_rate, output_rate = _model_rates(model)
    return (prompt_tokens / 1_000_000 * input_rate) + (completion_tokens / 1_000_000 * output_rate)


def _current_user_id_from_request():
    current_user = getattr(request, "current_user", None)
    if current_user is not None:
        return current_user.id

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None

    try:
        from app.models import User, db
        from app.security import decode_access_token

        token_data = decode_access_token(auth_header.split(" ", 1)[1])
        if token_data is None:
            return None
        user = db.session.query(User).filter(User.username == token_data.username).first()
        return user.id if user else None
    except Exception:
        return None


def record_ai_usage(completion, feature):
    user_id = _current_user_id_from_request()
    if not user_id:
        return

    usage = getattr(completion, "usage", None)
    prompt_tokens = _read_usage_value(usage, "prompt_tokens")
    completion_tokens = _read_usage_value(usage, "completion_tokens")
    total_tokens = _read_usage_value(usage, "total_tokens") or prompt_tokens + completion_tokens
    if total_tokens <= 0:
        return

    model = getattr(completion, "model", None) or os.getenv("OPENAI_MODEL", "unknown")
    cost = estimate_cost_usd(model, prompt_tokens, completion_tokens)

    from app.models import AIUsage, db

    try:
        db.session.add(AIUsage(
            id=str(uuid.uuid4()),
            user_id=user_id,
            feature=feature,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            estimated_cost_usd=cost,
        ))
        db.session.commit()
    except Exception:
        db.session.rollback()


def ai_usage_summary(user_id, days=30):
    from app.models import AIUsage, db

    since = datetime.utcnow() - timedelta(days=days)
    entries = (
        db.session.query(AIUsage)
        .filter(AIUsage.user_id == user_id, AIUsage.created_at >= since)
        .order_by(AIUsage.created_at.desc())
        .all()
    )

    by_feature = {}
    by_day = {}
    for entry in entries:
        feature = entry.feature or "assistant"
        by_feature.setdefault(feature, {"calls": 0, "tokens": 0, "cost_usd": 0.0})
        by_feature[feature]["calls"] += 1
        by_feature[feature]["tokens"] += entry.total_tokens or 0
        by_feature[feature]["cost_usd"] += entry.estimated_cost_usd or 0.0

        day = entry.created_at.strftime("%Y-%m-%d")
        by_day.setdefault(day, {"calls": 0, "tokens": 0, "cost_usd": 0.0})
        by_day[day]["calls"] += 1
        by_day[day]["tokens"] += entry.total_tokens or 0
        by_day[day]["cost_usd"] += entry.estimated_cost_usd or 0.0

    total_cost = sum(entry.estimated_cost_usd or 0.0 for entry in entries)
    total_tokens = sum(entry.total_tokens or 0 for entry in entries)

    return {
        "days": days,
        "totals": {
            "calls": len(entries),
            "prompt_tokens": sum(entry.prompt_tokens or 0 for entry in entries),
            "completion_tokens": sum(entry.completion_tokens or 0 for entry in entries),
            "total_tokens": total_tokens,
            "estimated_cost_usd": total_cost,
        },
        "by_feature": [
            {"feature": key, **value}
            for key, value in sorted(by_feature.items(), key=lambda item: item[1]["cost_usd"], reverse=True)
        ],
        "by_day": [
            {"date": key, **value}
            for key, value in sorted(by_day.items())
        ],
        "recent": [
            {
                "id": entry.id,
                "feature": entry.feature,
                "model": entry.model,
                "prompt_tokens": entry.prompt_tokens,
                "completion_tokens": entry.completion_tokens,
                "total_tokens": entry.total_tokens,
                "estimated_cost_usd": entry.estimated_cost_usd,
                "created_at": entry.created_at.isoformat(),
            }
            for entry in entries[:20]
        ],
    }
