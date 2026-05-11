import json
import os
import uuid
from datetime import datetime
from functools import wraps
from typing import Dict, List

from flask import Blueprint, jsonify, request
from openai import OpenAI
from pydantic import ValidationError

from app.env import load_app_env
from app.ai_usage import record_ai_usage
from app.schemas import (
    ComparativeAnalysis,
    ComparativeApproach,
    ConversationCreate,
    ConversationCreateResponse,
    ConversationDetail,
    ConversationListResponse,
    ConversationMessagesResponse,
    ConversationSummary,
    MessageCreate,
    MessageExchangeResponse,
    MessageResponse,
)

load_app_env()

conversation_bp = Blueprint("conversation", __name__)

MAX_HISTORY_MESSAGES = 10


def get_models():
    from app.models import Conversation, Message, User, db

    return Conversation, Message, User, db


def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        if "Authorization" in request.headers:
            auth_header = request.headers["Authorization"]
            try:
                token = auth_header.split(" ")[1]
            except IndexError:
                return jsonify({"detail": "Invalid authorization header"}), 401

        if not token:
            return jsonify({"detail": "Token is missing"}), 401

        from app.security import decode_access_token

        token_data = decode_access_token(token)
        if token_data is None:
            return jsonify({"detail": "Invalid token"}), 401

        _, _, User, db = get_models()
        user = db.session.query(User).filter(User.username == token_data.username).first()
        if user is None:
            return jsonify({"detail": "User not found"}), 401

        request.current_user = user
        return f(*args, **kwargs)

    return decorated


def parse_json_body(schema_cls):
    payload = request.get_json(silent=True)
    if payload is None:
        return None, (jsonify({"detail": "Request body must be valid JSON"}), 400)

    try:
        return schema_cls.model_validate(payload), None
    except ValidationError as exc:
        return None, (jsonify({"detail": "Validation failed", "errors": exc.errors()}), 400)


def format_history_for_prompt(conversation_history: List[Dict[str, str]]) -> str:
    if not conversation_history:
        return "No previous messages."

    lines = []
    for message in conversation_history[-MAX_HISTORY_MESSAGES:]:
        speaker = "User" if message["role"] == "user" else "Assistant"
        lines.append(f"{speaker}: {message['content']}")
    return "\n".join(lines)


def zero_shot_prompt(user_message: str, use_case: str, conversation_history: List[Dict[str, str]]) -> str:
    history_text = format_history_for_prompt(conversation_history)
    return f"""You are an AI analyst focused on {use_case}.

Use the retained conversation history to keep continuity:
{history_text}

Analyze the current request and produce a comparative analysis.
Current request: {user_message}

Return only valid JSON with the following shape:
{{
  "use_case": "{use_case}",
  "task_summary": "string",
  "efficiency_score": 0,
  "comparative_approaches": [
    {{
      "name": "string",
      "summary": "string",
      "pros": ["string"],
      "cons": ["string"],
      "estimated_time_savings_minutes": 0,
      "implementation_complexity": "Low"
    }}
  ],
  "recommended_approach": "string",
  "optimization_opportunities": ["string"],
  "risk_assessment": ["string"],
  "retained_context": ["string"],
  "prompt_technique": "zero-shot",
  "generated_at": "{datetime.utcnow().isoformat()}"
}}

Requirements:
- Provide exactly 3 comparative approaches.
- Keep the analysis practical and use-case specific.
- Mention how prior messages affected the recommendation in retained_context."""


def role_based_prompt(user_message: str, use_case: str, conversation_history: List[Dict[str, str]]) -> str:
    history_text = format_history_for_prompt(conversation_history)
    return f"""You are a senior productivity strategist performing {use_case}.

Role responsibilities:
- Compare multiple execution strategies.
- Balance speed, quality, and risk.
- Use historical context from the same conversation.
- Provide concrete recommendations that a product or operations team could act on.

Conversation history:
{history_text}

New user request:
{user_message}

Return only valid JSON using this exact schema:
{{
  "use_case": "{use_case}",
  "task_summary": "string",
  "efficiency_score": 0,
  "comparative_approaches": [
    {{
      "name": "string",
      "summary": "string",
      "pros": ["string"],
      "cons": ["string"],
      "estimated_time_savings_minutes": 0,
      "implementation_complexity": "Low"
    }}
  ],
  "recommended_approach": "string",
  "optimization_opportunities": ["string"],
  "risk_assessment": ["string"],
  "retained_context": ["string"],
  "prompt_technique": "role-based",
  "generated_at": "{datetime.utcnow().isoformat()}"
}}

Quality bar:
- Provide exactly 3 approaches.
- Each approach must have distinct tradeoffs.
- The recommendation must clearly identify the best option for this specific use case."""


def build_fallback_analysis(
    user_message: str,
    use_case: str,
    conversation_history: List[Dict[str, str]],
    technique: str,
) -> ComparativeAnalysis:
    recent_context = [item["content"] for item in conversation_history[-3:]]
    approaches = [
        ComparativeApproach(
            name="Fastest execution",
            summary="Minimize planning overhead and move quickly with a lightweight process.",
            pros=["Ships quickly", "Low coordination cost"],
            cons=["Can miss edge cases", "May create rework later"],
            estimated_time_savings_minutes=20,
            implementation_complexity="Low",
        ),
        ComparativeApproach(
            name="Balanced workflow",
            summary="Use a short planning step followed by focused implementation and review.",
            pros=["Good speed-to-quality tradeoff", "Works well for repeatable tasks"],
            cons=["Slightly more setup time", "Needs discipline to stay concise"],
            estimated_time_savings_minutes=35,
            implementation_complexity="Medium",
        ),
        ComparativeApproach(
            name="Deep optimization",
            summary="Invest more time upfront to maximize consistency, automation, and long-term efficiency.",
            pros=["Higher long-term payoff", "Reduces future manual effort"],
            cons=["Higher initial effort", "Longer time to first result"],
            estimated_time_savings_minutes=50,
            implementation_complexity="High",
        ),
    ]

    return ComparativeAnalysis(
        use_case=use_case,
        task_summary=user_message[:200],
        efficiency_score=78,
        comparative_approaches=approaches,
        recommended_approach="Balanced workflow",
        optimization_opportunities=[
            "Break the work into a smaller number of high-impact steps.",
            "Reuse prior context from the conversation to avoid repeating requirements.",
            "Capture a clear completion criterion before execution begins.",
        ],
        risk_assessment=[
            "Missing constraints can lead to a recommendation that is too generic.",
            "Fast execution without validation can create follow-up fixes.",
        ],
        retained_context=recent_context or ["No prior messages were available for context."],
        prompt_technique=technique,
        generated_at=datetime.utcnow(),
    )


def call_openai_for_analysis(
    user_message: str,
    use_case: str,
    conversation_history: List[Dict[str, str]],
    technique: str,
) -> ComparativeAnalysis:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return build_fallback_analysis(user_message, use_case, conversation_history, technique)

    prompt_builder = zero_shot_prompt if technique == "zero-shot" else role_based_prompt
    prompt = prompt_builder(user_message, use_case, conversation_history)

    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        response_format={"type": "json_object"},
        temperature=0.4,
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_message},
        ],
    )
    record_ai_usage(response, f"conversation-{technique}")

    raw_text = (response.choices[0].message.content or "").strip()
    if not raw_text:
        raise ValueError("OpenAI returned an empty response")
    parsed = ComparativeAnalysis.model_validate_json(raw_text)
    return parsed


def generate_ai_response(
    user_message: str,
    use_case: str,
    conversation_history: List[Dict[str, str]],
    technique: str = "role-based",
) -> Dict[str, object]:
    try:
        analysis = call_openai_for_analysis(user_message, use_case, conversation_history, technique)
        content = (
            f"Recommended approach: {analysis.recommended_approach}. "
            f"Efficiency score: {analysis.efficiency_score}/100."
        )
        return {
            "content": content,
            "analysis_data": analysis.model_dump(mode="json"),
            "prompt_technique": technique,
            "status": "success",
        }
    except Exception as exc:
        fallback = build_fallback_analysis(user_message, use_case, conversation_history, technique)
        return {
            "content": (
                f"Recommended approach: {fallback.recommended_approach}. "
                f"Efficiency score: {fallback.efficiency_score}/100."
            ),
            "analysis_data": fallback.model_dump(mode="json"),
            "prompt_technique": technique,
            "status": "fallback",
            "error": str(exc),
        }


@conversation_bp.post("/")
@token_required
def create_conversation():
    conversation_input, error_response = parse_json_body(ConversationCreate)
    if error_response:
        return error_response

    Conversation, _, _, db = get_models()
    new_conversation = Conversation(
        id=str(uuid.uuid4()),
        user_id=request.current_user.id,
        title=conversation_input.title,
        use_case=conversation_input.use_case,
    )

    db.session.add(new_conversation)
    db.session.commit()

    response = ConversationCreateResponse(
        id=new_conversation.id,
        title=new_conversation.title,
        use_case=new_conversation.use_case,
        created_at=new_conversation.created_at,
        messages=[],
    )
    return jsonify(response.model_dump(mode="json")), 201


@conversation_bp.post("/<conversation_id>/messages")
@token_required
def add_message(conversation_id):
    message_input, error_response = parse_json_body(MessageCreate)
    if error_response:
        return error_response

    Conversation, Message, _, db = get_models()
    conversation = db.session.query(Conversation).filter(
        (Conversation.id == conversation_id) & (Conversation.user_id == request.current_user.id)
    ).first()

    if not conversation:
        return jsonify({"detail": "Conversation not found"}), 404

    previous_messages = db.session.query(Message).filter(
        Message.conversation_id == conversation_id
    ).order_by(Message.created_at.asc()).all()

    conversation_history = [
        {"role": message.role, "content": message.content}
        for message in previous_messages[-MAX_HISTORY_MESSAGES:]
    ]

    user_message = Message(
        id=str(uuid.uuid4()),
        conversation_id=conversation_id,
        role="user",
        content=message_input.content,
    )
    db.session.add(user_message)
    db.session.flush()

    ai_response = generate_ai_response(
        user_message=message_input.content,
        use_case=conversation.use_case,
        conversation_history=conversation_history,
        technique=message_input.prompt_technique,
    )

    assistant_message = Message(
        id=str(uuid.uuid4()),
        conversation_id=conversation_id,
        role="assistant",
        content=ai_response["content"],
        analysis_data=ai_response["analysis_data"],
    )
    db.session.add(assistant_message)
    conversation.updated_at = datetime.utcnow()
    db.session.commit()

    response = MessageExchangeResponse(
        user_message=MessageResponse.model_validate(user_message),
        assistant_message=MessageResponse.model_validate(assistant_message),
        prompt_technique=message_input.prompt_technique,
    )
    return jsonify(response.model_dump(mode="json")), 201


@conversation_bp.get("/")
@token_required
def list_conversations():
    Conversation, _, _, db = get_models()
    conversations = db.session.query(Conversation).filter(
        Conversation.user_id == request.current_user.id
    ).order_by(Conversation.updated_at.desc()).all()

    response = ConversationListResponse(
        conversations=[
            ConversationSummary(
                id=conversation.id,
                title=conversation.title,
                use_case=conversation.use_case,
                created_at=conversation.created_at,
                updated_at=conversation.updated_at,
                message_count=len(conversation.messages),
            )
            for conversation in conversations
        ]
    )
    return jsonify(response.model_dump(mode="json")), 200


@conversation_bp.get("/<conversation_id>/messages")
@token_required
def get_conversation_messages(conversation_id):
    Conversation, Message, _, db = get_models()
    conversation = db.session.query(Conversation).filter(
        (Conversation.id == conversation_id) & (Conversation.user_id == request.current_user.id)
    ).first()

    if not conversation:
        return jsonify({"detail": "Conversation not found"}), 404

    messages = db.session.query(Message).filter(
        Message.conversation_id == conversation_id
    ).order_by(Message.created_at.asc()).all()

    response = ConversationMessagesResponse(
        conversation=ConversationDetail.model_validate(conversation),
        messages=[MessageResponse.model_validate(message) for message in messages],
    )
    return jsonify(response.model_dump(mode="json")), 200
