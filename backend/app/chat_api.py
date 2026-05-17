import json
import os
import re
import uuid
from datetime import datetime, timedelta
from random import Random
from sqlalchemy import func

from flask import Blueprint, jsonify, request
from openai import OpenAI

from app.env import load_app_env
from app.auth import token_required
from app.ai_usage import ai_usage_summary, record_ai_usage

load_app_env()

chat_bp = Blueprint("chat", __name__)


WEEKDAY_LOOKUP = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}

MONTH_LOOKUP = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}

PRIORITY_VALUES = ("very-low", "low", "medium", "high", "urgent")


def _request_openai_api_key():
    current_user = getattr(request, "current_user", None)
    if current_user is not None:
        user_key = str(getattr(current_user, "openai_api_key", "") or "").strip()
        if user_key:
            return user_key

    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            from app.models import User, db
            from app.security import decode_access_token

            token_data = decode_access_token(auth_header.split(" ", 1)[1])
            if token_data is not None:
                user = db.session.query(User).filter(User.username == token_data.username).first()
                if user is not None:
                    request.current_user = user
                    user_key = str(user.openai_api_key or "").strip()
                    if user_key:
                        return user_key
        except Exception:
            pass

    return None


def _infer_priority(text):
    lowered = text.lower()
    if re.search(r"\b(urgent|asap|immediately|critical|emergency|deadline|due today|must)\b", lowered):
        return "urgent"
    if re.search(r"\b(high|important|priority|doctor|dentist|appointment|exam|interview|flight|train|meeting)\b", lowered):
        return "high"
    if re.search(r"\b(very low|lowest|maybe|if time|if i have time)\b", lowered):
        return "very-low"
    if re.search(r"\b(low|optional|sometime|when possible|whenever|nice to have)\b", lowered):
        return "low"
    return "medium"


def _compact_description(title, text):
    cleaned = re.sub(r"^(?:please\s+)?(?:add|create|new task|schedule|plan)[:\s]+", "", text.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    if not cleaned or cleaned.lower() == title.lower():
        return f"Planned from: {title}."
    if len(cleaned) > 140:
        cleaned = cleaned[:137].rstrip() + "..."
    return cleaned[0].upper() + cleaned[1:]


def _normalize_priority(value, source_text):
    normalized = str(value or "").strip().lower().replace(" ", "-")
    if normalized in PRIORITY_VALUES:
        return normalized
    return _infer_priority(source_text)


def _normalize_iso_date(value):
    text = str(value or "").strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        return text
    if re.match(r"^\d{4}-\d{2}-\d{2}T", text):
        return text[:10]
    parsed = _parse_date_reference(text)
    if parsed:
        return parsed
    return datetime.now().strftime("%Y-%m-%d")


def _extract_requested_weekday(text):
    # Ignore recurring phrases here; this is for single task normalization.
    if re.search(r"\bevery\s+", text, re.IGNORECASE):
        return None, 0

    match = re.search(r"\b(?:(next|this)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", text, re.IGNORECASE)
    if not match:
        return None, 0

    modifier = (match.group(1) or "").lower()
    weekday = match.group(2).lower()
    week_offset = 1 if modifier == "next" else 0
    return weekday, week_offset


def _align_task_date_to_request(task, source_text):
    weekday, week_offset = _extract_requested_weekday(source_text)
    if not weekday:
        return

    target = datetime.strptime(_next_weekday_date(weekday, week_offset), "%Y-%m-%d").date()
    raw_date = str(task.get("date") or "").strip()
    if not raw_date:
        task["date"] = target.strftime("%Y-%m-%d")
        return

    try:
        current = datetime.strptime(raw_date, "%Y-%m-%d").date()
    except ValueError:
        task["date"] = target.strftime("%Y-%m-%d")
        return

    if current.weekday() != WEEKDAY_LOOKUP[weekday]:
        task["date"] = target.strftime("%Y-%m-%d")


def _normalize_task_payload(task, source_text):
    if not isinstance(task, dict):
        return task

    title = str(task.get("title") or _extract_task_subject(source_text) or "New task").strip()
    task["title"] = title
    task["description"] = str(task.get("description") or _compact_description(title, source_text)).strip()[:140]
    task["note"] = str(task.get("note") or "").strip() or None
    task["date"] = _normalize_iso_date(task.get("date"))
    task["priority"] = _normalize_priority(task.get("priority"), source_text)
    task["tags"] = task.get("tags") if isinstance(task.get("tags"), list) else []
    task["completed"] = bool(task.get("completed", False))
    _align_task_date_to_request(task, source_text)
    return task


def _normalize_actions(actions, source_text):
    if not isinstance(actions, list):
        return []

    normalized_actions = []
    for action in actions:
        if not isinstance(action, dict):
            continue
        if "type" not in action and isinstance(action.get("action"), str):
            action["type"] = action["action"]
        if action.get("type") == "create_task" and action.get("task"):
            action["task"] = _normalize_task_payload(action["task"], source_text)
        elif action.get("type") == "create_tasks" and isinstance(action.get("tasks"), list):
            action["tasks"] = [_normalize_task_payload(task, source_text) for task in action["tasks"] if isinstance(task, dict)]
        normalized_actions.append(action)
    return normalized_actions


def _should_use_rule_based_before_ai(rule_based):
    actions = rule_based.get("actions") if isinstance(rule_based, dict) else None
    if not actions:
        return False

    action_types = {action.get("type") for action in actions if isinstance(action, dict)}
    return action_types != {"create_task"}


def _parse_time(text):
    match = re.search(r"(\d{1,2})(?::(\d{2}))?\s?(am|pm)?", text, re.IGNORECASE)
    if not match:
        return None

    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    meridiem = (match.group(3) or "").lower()

    if meridiem == "pm" and hour < 12:
        hour += 12
    if meridiem == "am" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return None

    return f"{hour:02d}:{minute:02d}"


def _parse_time_range(text):
    match = re.search(
        r"(\d{1,2})(?::(\d{2}))?\s?(am|pm)?\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s?(am|pm)?",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None, None

    start_time = _parse_time(f"{match.group(1)}:{match.group(2) or '00'} {match.group(3) or ''}".strip())
    end_time = _parse_time(f"{match.group(4)}:{match.group(5) or '00'} {match.group(6) or ''}".strip())
    if not start_time or not end_time:
        return None, None

    start_hour, start_minute = map(int, start_time.split(":"))
    end_hour, end_minute = map(int, end_time.split(":"))
    duration = ((end_hour * 60 + end_minute) - (start_hour * 60 + start_minute)) % (24 * 60)
    return start_time, duration or None


def _parse_relative_date(text):
    base = datetime.now()
    lowered = text.lower().replace("tommorow", "tomorrow")
    in_days_match = re.search(r"\bin\s+(\d+)\s+days?\b", lowered)
    from_now_match = re.search(r"\b(\d+)\s+days?\s+from\s+(?:now|today)\b", lowered)

    if in_days_match:
        base += timedelta(days=int(in_days_match.group(1)))
    elif from_now_match:
        base += timedelta(days=int(from_now_match.group(1)))
    elif "today" in lowered:
        base += timedelta(days=0)

    if "tomorrow" in lowered:
        base += timedelta(days=1)

    return base.strftime("%Y-%m-%d")


def _parse_date_reference(text):
    lowered = text.lower().replace("tommorow", "tomorrow")
    iso_match = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", lowered)
    if iso_match:
        return iso_match.group(1)

    month_match = re.search(
        r"\b("
        + "|".join(MONTH_LOOKUP.keys())
        + r")\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?\b",
        lowered,
    )
    if month_match:
        month = MONTH_LOOKUP[month_match.group(1)]
        day = int(month_match.group(2))
        year = int(month_match.group(3) or datetime.now().year)
        candidate = datetime(year, month, day)
        if not month_match.group(3) and candidate.date() < datetime.now().date():
            candidate = datetime(year + 1, month, day)
        return candidate.strftime("%Y-%m-%d")

    weekday_match = re.search(r"\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", lowered)
    if weekday_match:
        return _next_weekday_date(weekday_match.group(2).lower(), 1 if weekday_match.group(1) else 0)

    if _has_explicit_date(lowered):
        return _parse_relative_date(lowered)

    return None


def _has_explicit_date(text):
    lowered = text.lower().replace("tommorow", "tomorrow")
    return bool(
        re.search(r"\b(today|tomorrow|next\s+week|this\s+week|this\s+month)\b", lowered)
        or re.search(r"\bin\s+\d+\s+days?\b", lowered)
        or re.search(r"\b\d+\s+days?\s+from\s+(?:now|today)\b", lowered)
        or re.search(r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", lowered)
        or re.search(r"\b\d{4}-\d{2}-\d{2}\b", lowered)
    )


def _task_needs_location(text):
    return bool(
        re.search(
            r"\b(meeting|appointment|doctor|dentist|lunch|dinner|coffee|class|practice|session|flight|train|pickup|dropoff)\b",
            text,
            re.IGNORECASE,
        )
    )


def _build_missing_detail_reply(title, missing_time=False, missing_date=False, missing_location=False):
    questions = []
    if missing_date:
        questions.append("what day")
    if missing_time:
        questions.append("what time")
    if missing_location:
        questions.append("where")

    if not questions:
        return None

    if len(questions) == 1:
        detail_text = questions[0]
    elif len(questions) == 2:
        detail_text = f"{questions[0]} and {questions[1]}"
    else:
        detail_text = f"{questions[0]}, {questions[1]}, and {questions[2]}"

    return f'I can add "{title}", but I need {detail_text} first.'


def _next_weekday_date(weekday_name, week_offset=0):
    base = datetime.now()
    target = WEEKDAY_LOOKUP[weekday_name]
    delta = (target - base.weekday()) % 7
    delta += week_offset * 7
    if delta == 0:
        delta = 7 * week_offset if week_offset else 0
    return (base + timedelta(days=delta)).strftime("%Y-%m-%d")


def _time_to_minutes(value):
    hour, minute = map(int, value.split(":"))
    return hour * 60 + minute


def _minutes_to_time(value):
    hour = (value // 60) % 24
    minute = value % 60
    return f"{hour:02d}:{minute:02d}"


def _suggest_time_for_date(tasks, date, duration=60, preferred_time=None, strict=False):
    duration = duration or 60
    occupied = []
    for task in tasks:
        if task.get("date") != date or not task.get("time"):
            continue
        try:
            start = _time_to_minutes(task["time"])
            task_duration = int(task.get("duration") or 60)
            occupied.append((start, start + task_duration))
        except (TypeError, ValueError):
            continue

    occupied.sort()
    day_start = 7 * 60
    day_end = 21 * 60

    if preferred_time:
        try:
            preferred_start = _time_to_minutes(preferred_time)
            if preferred_start < day_start:
                preferred_start = day_start
            if preferred_start + duration <= day_end and all(
                preferred_start + duration <= start or preferred_start >= end
                for start, end in occupied
            ):
                return _minutes_to_time(preferred_start)
        except (TypeError, ValueError):
            pass

    for candidate in range(day_start, day_end - duration + 1, 30):
        if all(candidate + duration <= start or candidate >= end for start, end in occupied):
            return _minutes_to_time(candidate)

    if strict:
        return None
    return preferred_time or "18:00"


def _parse_period_limit(text):
    lowered = text.lower()
    explicit_range = re.search(r"\bfrom\s+(.+?)\s+to\s+(.+)$", lowered)
    if explicit_range:
        start_date = _parse_date_reference(explicit_range.group(1))
        end_date = _parse_date_reference(explicit_range.group(2))
        if start_date and end_date:
            return start_date, end_date

    word_amount_match = re.search(r"\bfor\s+(a|an|one)\s+(day|week|month)\b", lowered)
    period_match = re.search(r"\bfor\s+(\d+)\s+(day|days|week|weeks|month|months)\b", lowered)
    if not period_match and word_amount_match:
        amount = 1
        unit = word_amount_match.group(2)
        start = datetime.now().date()
        if "day" in unit:
            end = start
        elif "week" in unit:
            end = start + timedelta(days=6)
        else:
            end = start + timedelta(days=29)
        return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")

    if period_match:
        amount = int(period_match.group(1))
        unit = period_match.group(2)
        start = datetime.now().date()
        if "day" in unit:
            end = start + timedelta(days=amount - 1)
        elif "week" in unit:
            end = start + timedelta(days=(amount * 7) - 1)
        else:
            end = start + timedelta(days=(amount * 30) - 1)
        return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")

    if re.search(r"\bthis\s+month\b", lowered):
        today = datetime.now().date()
        if today.month == 12:
            first_next_month = today.replace(year=today.year + 1, month=1, day=1)
        else:
            first_next_month = today.replace(month=today.month + 1, day=1)
        end = first_next_month - timedelta(days=1)
        return today.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")

    return None, None


def _task_matches_query(task, query):
    words = [
        word for word in re.sub(r"\s+", " ", query.lower()).split(" ")
        if len(word) > 1 and word not in {"task", "tasks", "calendar", "all", "every"}
    ]
    if not words:
        return True
    tags = task.get("tags") if isinstance(task.get("tags"), list) else []
    haystack = " ".join(
        str(value or "") for value in [
            task.get("title"),
            task.get("description"),
            task.get("note"),
            task.get("location"),
            " ".join(str(tag) for tag in tags),
        ]
    ).lower()
    return all(word in haystack for word in words)


def _date_range_for_flexible_plan(text):
    lowered = text.lower()
    today = datetime.now().date()

    if "next week" in lowered:
        days_until_monday = (0 - today.weekday()) % 7 or 7
        start = today + timedelta(days=days_until_monday)
        return start, start + timedelta(days=6)

    if "this week" in lowered:
        return today, today + timedelta(days=6 - today.weekday())

    start_date, end_date = _parse_period_limit(text)
    if start_date and end_date:
        return datetime.strptime(start_date, "%Y-%m-%d").date(), datetime.strptime(end_date, "%Y-%m-%d").date()

    target_date = _parse_date_reference(text)
    if target_date:
        parsed = datetime.strptime(target_date, "%Y-%m-%d").date()
        return parsed, parsed

    return today, today + timedelta(days=7)


def _activity_title_from_text(text):
    lowered = text.lower()
    if re.search(r"\b(workout|exercise|gym|training)\b", lowered):
        return "Workout session", ["personal", "health", "sports"]
    if re.search(r"\b(read|reading|book)\b", lowered):
        return "Reading time", ["personal", "reading"]
    if re.search(r"\b(meditation|mindful|mindfulness|recovery)\b", lowered):
        return "Mindfulness break", ["personal", "health", "recovery"]
    if re.search(r"\b(walk|outside)\b", lowered):
        return "Walk outside", ["personal", "health"]
    if re.search(r"\b(hobby|fun)\b", lowered):
        return "Hobby time", ["personal", "hobbies"]
    return "Personal activity", ["personal"]


def _open_activity_slot(tasks, start_date, end_date, accepted=None):
    accepted = accepted or []
    duration = 60
    preferred_starts = ["18:00", "17:30", "19:00", "12:30", "08:30", "20:00"]
    current = start_date
    while current <= end_date:
        date_value = current.strftime("%Y-%m-%d")
        blockers = [
            task for task in tasks
            if task.get("date") == date_value and not task.get("completed")
        ] + [
            task for task in accepted
            if task.get("date") == date_value
        ]
        for preferred_time in preferred_starts:
            slot = _suggest_time_for_date(blockers, date_value, duration, preferred_time=preferred_time, strict=True)
            if slot:
                return date_value, slot
        current += timedelta(days=1)
    return None, None


def _parse_flexible_activity_plan(text, tasks):
    lowered = text.lower()
    if not re.search(r"\b(plan|schedule|create|add|make)\b", lowered):
        return None
    if not re.search(r"\b(something|activity|workout|exercise|reading|mindfulness|hobby|walk|personal)\b", lowered):
        return None

    start_date, end_date = _date_range_for_flexible_plan(text)
    title, tags = _activity_title_from_text(text)
    description = _compact_description(title, text)
    priority = _infer_priority(text)
    once_weekly = bool(re.search(r"\b(once\s+a\s+week|once\s+per\s+week|weekly)\b", lowered))

    if once_weekly:
        generated = []
        cursor = start_date
        while cursor <= end_date and len(generated) < 12:
            week_end = min(cursor + timedelta(days=6), end_date)
            date_value, time_value = _open_activity_slot(tasks, cursor, week_end, generated)
            if date_value and time_value:
                generated.append({
                    "title": title,
                    "description": description,
                    "date": date_value,
                    "time": time_value,
                    "duration": 60,
                    "location": None,
                    "priority": priority,
                    "tags": list(dict.fromkeys(tags + ["weekly", "routine"])),
                    "completed": False,
                })
            cursor += timedelta(days=7)

        if not generated:
            return {"reply": "I could not find a clean weekly slot in that period without overlapping your calendar.", "actions": []}
        return {
            "reply": f'Planned "{title}" once a week from {generated[0]["date"]} to {generated[-1]["date"]}.',
            "actions": [{"type": "create_tasks", "tasks": generated}],
        }

    if not re.search(r"\b(next\s+week|this\s+week|this\s+month|some\s+day|someday|one\s+day|free\s+day|open\s+slot)\b", lowered):
        return None

    date_value, time_value = _open_activity_slot(tasks, start_date, end_date)
    if not date_value or not time_value:
        return {"reply": "I could not find a clean open slot in that period without overlapping your calendar.", "actions": []}
    return {
        "reply": f'Found an open slot for "{title}" on {date_value} at {time_value}.',
        "actions": [{
            "type": "create_task",
            "task": {
                "title": title,
                "description": description,
                "date": date_value,
                "time": time_value,
                "duration": 60,
                "location": None,
                "priority": priority,
                "tags": tags,
                "completed": False,
            },
        }],
    }


def _extract_task_subject(text):
    lowered = text.strip()
    lowered = re.sub(r"^please\s+", "", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"^(?:i\s+(?:want|need|would like)\s+to\s+|can you\s+|could you\s+|help me\s+)", "", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"^(?:add|create|schedule|plan)\s+", "", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*$", "", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"\b(everyday|every day|daily|each day)\b.*$", "", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"\b(today|tomorrow)\b.*$", "", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"\bin\s+\d+\s+days?\b.*$", "", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"\bfor\s+\d+\s+(?:day|days|week|weeks|month|months)\b.*$", "", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"\bfrom\b.*$", "", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"\bat\b.*$", "", lowered, flags=re.IGNORECASE)
    lowered = re.sub(r"\s+", " ", lowered).strip(" .")
    if not lowered:
        return "New task"
    return lowered[0].upper() + lowered[1:]


def _extract_recurring_weekdays(text):
    if not re.search(r"\bevery\b", text, re.IGNORECASE):
        return []

    # Extract weekdays only from "every ..." clauses, so unrelated text like
    # "it put them on Wednesdays" does not get interpreted as a new rule.
    clause_matches = re.finditer(
        r"\bevery\s+(.+?)(?=\b(?:for|from|at|starting|start|this month|next month|until)\b|[.,;]|$)",
        text,
        re.IGNORECASE,
    )
    seen = set()
    weekdays = []
    for clause in clause_matches:
        segment = clause.group(1)
        for day_match in re.finditer(
            r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b",
            segment,
            re.IGNORECASE,
        ):
            weekday = day_match.group(1).lower()
            if weekday not in seen:
                seen.add(weekday)
                weekdays.append(weekday)
    return weekdays


def _parse_recurring_tasks(text):
    lowered = text.lower()
    weekdays = _extract_recurring_weekdays(text)
    daily_match = re.search(r"\b(everyday|every day|daily|each day)\b", lowered)
    daily_mode = bool(daily_match)
    if not weekdays and not daily_mode:
        return None

    start_time, duration = _parse_time_range(text)
    if not start_time:
        start_time = _parse_time(text)

    title = _extract_task_subject(text)
    if not title:
        return None
    description = _compact_description(title, text)
    priority = _infer_priority(text)

    if not start_time:
        recurrence_label = "every day" if daily_mode else "every " + " and ".join(day.capitalize() for day in weekdays)
        return {
            "reply": f'I can schedule "{title}" {recurrence_label}, but what time should I put it on your calendar?',
            "actions": [],
        }

    start_date, end_date = _parse_period_limit(text)
    start_dt = datetime.strptime(start_date, "%Y-%m-%d").date() if start_date else datetime.now().date()
    end_dt = datetime.strptime(end_date, "%Y-%m-%d").date() if end_date else None

    tasks = []
    if daily_mode:
        days_to_generate = 14 if end_dt is None else max(1, (end_dt - start_dt).days + 1)
        days_to_generate = min(days_to_generate, 60)
        for day_offset in range(days_to_generate):
            current_date = (start_dt + timedelta(days=day_offset)).strftime("%Y-%m-%d")
            tasks.append({
                "title": title,
                "description": description,
                "date": current_date,
                "time": start_time,
                "duration": duration,
                "priority": priority,
                "tags": ["daily", "routine"],
                "completed": False,
            })
    else:
        occurrences = 8
        for weekday in weekdays:
            current_date = start_dt
            target_weekday = WEEKDAY_LOOKUP[weekday]
            while current_date.weekday() != target_weekday:
                current_date += timedelta(days=1)

            weekday_tasks = 0
            while weekday_tasks < occurrences:
                if end_dt and current_date > end_dt:
                    break
                tasks.append({
                    "title": title,
                    "description": description,
                    "date": current_date.strftime("%Y-%m-%d"),
                    "time": start_time,
                    "duration": duration,
                    "priority": priority,
                    "tags": [weekday, "routine"],
                    "completed": False,
                })
                weekday_tasks += 1
                current_date += timedelta(days=7)

        tasks.sort(key=lambda task: (task["date"], task["time"] or ""))

    if not tasks:
        return {
            "reply": f'I couldn’t find any dates in that period for "{title}". Try adjusting the range or recurrence.',
            "actions": [],
        }

    return {
        "reply": (
            f'Scheduled "{title}" '
            + ("every day" if daily_mode else "every " + " and ".join(day.capitalize() for day in weekdays))
            + (f" from {tasks[0]['date']} to {tasks[-1]['date']}." if len(tasks) > 1 else ".")
        ),
        "actions": [{"type": "create_tasks", "tasks": tasks}],
    }


def _parse_vacation_range(text):
    lowered = text.lower()
    if not re.search(r"\b(vacation|holiday|time off|days off|out of office|ooo)\b", lowered):
        return None

    explicit_dates = re.findall(r"\b\d{4}-\d{2}-\d{2}\b", text)
    start_date = None
    end_date = None
    if len(explicit_dates) >= 2:
        start_date, end_date = explicit_dates[0], explicit_dates[1]
    else:
        from_to_match = re.search(r"\bfrom\s+(.+?)\s+to\s+(.+?)(?:$|[.,;])", text, re.IGNORECASE)
        if from_to_match:
            start_date = _parse_date_reference(from_to_match.group(1))
            end_date = _parse_date_reference(from_to_match.group(2))
        else:
            single_date = _parse_date_reference(text)
            if single_date:
                start_date = single_date
                end_date = single_date

    if not start_date or not end_date:
        return {
            "reply": "I can add your vacation, but I need a start and end date (for example: 2026-07-10 to 2026-07-18).",
            "actions": [],
        }

    try:
        start_dt = datetime.strptime(start_date, "%Y-%m-%d").date()
        end_dt = datetime.strptime(end_date, "%Y-%m-%d").date()
    except ValueError:
        return {
            "reply": "I can add your vacation, but those dates look invalid. Please use YYYY-MM-DD.",
            "actions": [],
        }

    if end_dt < start_dt:
        start_dt, end_dt = end_dt, start_dt

    tasks = []
    current = start_dt
    while current <= end_dt and len(tasks) < 366:
        date_str = current.strftime("%Y-%m-%d")
        tasks.append({
            "title": "Vacation",
            "description": "Time off period saved from Smart Vacation.",
            "date": date_str,
            "time": None,
            "duration": None,
            "location": None,
            "priority": "low",
            "tags": ["vacation", "time-off", "locked"],
            "completed": False,
        })
        current += timedelta(days=1)

    return {
        "reply": f'Added vacation from {start_dt.strftime("%Y-%m-%d")} to {end_dt.strftime("%Y-%m-%d")} and marked it in your calendar.',
        "actions": [{"type": "create_tasks", "tasks": tasks}],
    }


def _parse_new_task(text):
    if not re.search(r"\b(add|create|new task|schedule|plan)\b", text, re.IGNORECASE):
        return None

    cleaned = re.sub(r"^(add|create|new task|schedule|plan)[:\s]+", "", text, flags=re.IGNORECASE).strip()
    if not cleaned:
        return None

    time = _parse_time(cleaned)
    title = re.sub(r"\b(today|tomorrow)\b", "", cleaned, flags=re.IGNORECASE)
    title = re.sub(r"\bin\s+\d+\s+days?\b", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\b\d+\s+days?\s+from\s+(?:now|today)\b", "", title, flags=re.IGNORECASE)
    title = re.sub(r"(\d{1,2})(?::(\d{2}))?\s?(am|pm)?", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\b(urgent|asap|immediately|critical|emergency|high|medium|low|very low|very-low|lowest|optional|maybe|if time|if i have time)\b", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\bfor\b", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\bthat\b", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\bat\b", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s+", " ", title).strip()

    missing_date = not _has_explicit_date(cleaned)
    missing_time = time is None
    missing_location = _task_needs_location(cleaned) and not re.search(r"\b(at|in)\s+[\w].+", cleaned, re.IGNORECASE)

    if missing_date or missing_time or missing_location:
        task_title = (title or "New task").title()
        reply = _build_missing_detail_reply(
            task_title,
            missing_time=missing_time,
            missing_date=missing_date,
            missing_location=missing_location,
        )
        return {"needs_clarification": True, "reply": reply}

    task_title = (title or "New task").title()
    return {
        "title": task_title,
        "description": _compact_description(task_title, cleaned),
        "date": _parse_relative_date(cleaned),
        "time": time,
        "priority": _infer_priority(cleaned),
        "tags": [],
        "completed": False,
    }


def _find_task_match(query, tasks):
    lowered = query.strip().lower()
    if not lowered:
        return None

    for task in tasks:
        if task.get("id", "").lower() == lowered:
            return task

    for task in tasks:
        if task.get("title", "").lower() == lowered:
            return task

    for task in tasks:
        if lowered in task.get("title", "").lower():
            return task

    return None


def _parse_completion(text, tasks):
    match = re.match(
        r"^(?:mark|complete|finish|done)\s+(?:task\s+)?(.+?)(?:\s+as\s+done|\s+as\s+complete|\s+done|\s+complete)?$",
        text.strip(),
        re.IGNORECASE,
    )
    if not match:
        return None

    target = _find_task_match(match.group(1), tasks)
    if not target:
        return None

    return target, f'Marked "{target.get("title", "task")}" as complete.'


def _parse_deletion(text, tasks):
    lowered = text.lower().replace("tommorow", "tomorrow")
    has_date_scope = re.search(
        r"\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2}|in\s+\d+\s+days?)\b",
        lowered,
    )
    if re.search(r"\b(delete|remove|cancel|clear)\b", lowered) and has_date_scope:
        target_date = _parse_date_reference(text) or _parse_relative_date(text)
        wants_whole_day = bool(re.search(r"\b(all|everything|every|tasks?|calendar)\b", lowered))
        query = re.sub(r"\b(delete|remove|cancel|clear)\b", "", lowered, flags=re.IGNORECASE)
        query = re.sub(
            r"\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2}|in\s+\d+\s+days?)\b",
            "",
            query,
            flags=re.IGNORECASE,
        )
        query = re.sub(r"\b(all|everything|every|tasks?|calendar|on|for|from|the|my)\b", "", query, flags=re.IGNORECASE)
        query = re.sub(r"\s+", " ", query).strip()
        matching_tasks = [
            task for task in tasks
            if task.get("date") == target_date
            and not task.get("completed")
            and (wants_whole_day or _task_matches_query(task, query))
        ]
        if not matching_tasks:
            scope = f' matching "{query}"' if query and not wants_whole_day else ""
            return {
                "reply": f"There are no open tasks{scope} planned for {target_date} to delete.",
                "actions": [],
            }
        return {
            "reply": f"Prepared deletion for {len(matching_tasks)} task{'s' if len(matching_tasks) != 1 else ''} on {target_date}.",
            "actions": [
                {"type": "delete_task", "task_id": task.get("id")}
                for task in matching_tasks
                if task.get("id")
            ],
        }

    match = re.match(
        r"^(?:delete|remove|cancel)\s+(?:task\s+)?(.+)$",
        text.strip(),
        re.IGNORECASE,
    )
    if not match:
        return None

    target = _find_task_match(match.group(1), tasks)
    if not target:
        return None

    return {
        "reply": f'I removed "{target.get("title", "task")}" from the plan.',
        "actions": [{"type": "delete_task", "task_id": target.get("id")}],
    }


def _normalized_task_title(title):
    return re.sub(r"\s+", " ", str(title or "").strip().lower())


def _is_routine_candidate(task):
    if not isinstance(task, dict) or task.get("completed"):
        return False
    title = _normalized_task_title(task.get("title"))
    if not title:
        return False
    tags = task.get("tags") if isinstance(task.get("tags"), list) else []
    tag_text = " ".join(str(tag).lower() for tag in tags)
    excluded = {"vacation", "holiday", "time off", "sick day"}
    if title in excluded or any(value in tag_text for value in excluded):
        return False
    return True


def _most_common(values, fallback=None):
    counts = {}
    for value in values:
        if value in (None, ""):
            continue
        counts[value] = counts.get(value, 0) + 1
    if not counts:
        return fallback
    return sorted(counts.items(), key=lambda item: (-item[1], str(item[0])))[0][0]


def _parse_usual_routine_plan(text, tasks):
    lowered = text.lower().replace("tommorow", "tomorrow")
    if not re.search(r"\b(plan|create|build|make|schedule)\b", lowered):
        return None
    if not (
        re.search(r"\b(normal|typical|usual|regular|average)\s+(day|routine|schedule)\b", lowered)
        or re.search(r"\b(day|routine|schedule)\s+like\s+usual\b", lowered)
    ):
        return None

    target_date = _parse_date_reference(lowered) or _parse_relative_date(lowered)
    target_dt = datetime.strptime(target_date, "%Y-%m-%d").date()
    target_weekday = target_dt.weekday()
    existing_target_tasks = [
        task for task in tasks
        if task.get("date") == target_date and not task.get("completed")
    ]
    existing_titles = {_normalized_task_title(task.get("title")) for task in existing_target_tasks}

    source_tasks = []
    for task in tasks:
        if task.get("date") == target_date or not _is_routine_candidate(task):
            continue
        try:
            datetime.strptime(str(task.get("date")), "%Y-%m-%d")
        except (TypeError, ValueError):
            continue
        source_tasks.append(task)

    same_weekday_tasks = [
        task for task in source_tasks
        if datetime.strptime(str(task.get("date")), "%Y-%m-%d").date().weekday() == target_weekday
    ]
    primary_source = same_weekday_tasks or source_tasks
    if not primary_source:
        return {
            "reply": "I need a little more calendar history before I can infer your usual routine. Add a few repeated day-to-day tasks first, then ask me again.",
            "actions": [],
        }

    grouped = {}
    for task in primary_source:
        key = _normalized_task_title(task.get("title"))
        if not key or key in existing_titles:
            continue
        grouped.setdefault(key, []).append(task)

    groups = [
        group for group in grouped.values()
        if same_weekday_tasks or len(group) >= 2
    ]
    groups.sort(
        key=lambda group: (
            _time_to_minutes(_normalize_task_time(_most_common([task.get("time") for task in group], "23:59"))) if group else 1439,
            -len(group),
        )
    )

    accepted = []
    for group in groups[:10]:
        sample = group[0]
        common_time = _normalize_task_time(_most_common([task.get("time") for task in group], sample.get("time") or "09:00"))
        common_duration = int(_most_common([task.get("duration") for task in group], sample.get("duration") or 60) or 60)
        title = str(sample.get("title") or "Routine task").strip()
        candidate = {
            "title": title,
            "description": sample.get("description") or "Part of your usual routine, based on similar calendar entries.",
            "note": sample.get("note") or "",
            "date": target_date,
            "time": common_time,
            "duration": common_duration,
            "location": _most_common([task.get("location") for task in group], sample.get("location") or ""),
            "priority": _normalize_priority(_most_common([task.get("priority") for task in group], sample.get("priority")), title),
            "tags": list(dict.fromkeys([
                str(tag)
                for task in group
                for tag in (task.get("tags") if isinstance(task.get("tags"), list) else [])
            ]))[:6],
            "completed": False,
        }
        open_time = _suggest_time_for_date(existing_target_tasks + accepted, target_date, common_duration, preferred_time=common_time, strict=True)
        if not open_time:
            continue
        candidate["time"] = open_time
        accepted.append(candidate)

    if not accepted:
        return {
            "reply": f"{target_date} already has tasks blocking the usual routine I inferred. I did not prepare overlapping tasks.",
            "actions": [],
        }

    return {
        "reply": f"I prepared your usual routine for {target_date} based on your calendar patterns. Review the task window before saving.",
        "actions": [{"type": "create_tasks", "tasks": accepted}],
    }


def _extract_priority(text):
    match = re.search(r"\b(very-low|very low|low|medium|high|urgent)\b", text, re.IGNORECASE)
    if match and match.group(1).lower() == "very low":
        return "very-low"
    return match.group(1).lower() if match else None


def _parse_task_update(text, tasks):
    stripped = text.strip()

    move_match = re.match(
        r"^(?:move|reschedule|change)\s+(.+?)\s+(?:to|for)\s+(.+)$",
        stripped,
        re.IGNORECASE,
    )
    if move_match:
        target = _find_task_match(move_match.group(1), tasks)
        update_text = move_match.group(2)
        if target:
            updates = {}
            if re.search(r"\b(today|tomorrow)\b|\bin\s+\d+\s+days?\b|\b\d+\s+days?\s+from\s+(?:now|today)\b", update_text, re.IGNORECASE):
                updates["date"] = _parse_relative_date(update_text)
            parsed_time = _parse_time(update_text)
            if parsed_time:
                updates["time"] = parsed_time
            if updates:
                return {
                    "reply": f'Updated "{target.get("title")}" with the new schedule.',
                    "actions": [{"type": "update_task", "task_id": target.get("id"), "updates": updates}],
                }

    rename_match = re.match(
        r"^(?:rename|change the name of)\s+(.+?)\s+to\s+(.+)$",
        stripped,
        re.IGNORECASE,
    )
    if rename_match:
        target = _find_task_match(rename_match.group(1), tasks)
        new_title = rename_match.group(2).strip()
        if target and new_title:
            return {
                "reply": f'Renamed "{target.get("title")}" to "{new_title}".',
                "actions": [{"type": "update_task", "task_id": target.get("id"), "updates": {"title": new_title}}],
            }

    priority_match = re.match(
        r"^(?:make|set|change)\s+(.+?)\s+(?:to\s+)?(very-low|very low|low|medium|high|urgent)\s+priority$",
        stripped,
        re.IGNORECASE,
    )
    if priority_match:
        target = _find_task_match(priority_match.group(1), tasks)
        priority = priority_match.group(2).lower().replace(" ", "-")
        if target:
            return {
                "reply": f'Set "{target.get("title")}" to {priority} priority.',
                "actions": [{"type": "update_task", "task_id": target.get("id"), "updates": {"priority": priority}}],
            }

    generic_priority_match = re.match(
        r"^(?:make|set|change)\s+(.+?)\s+(?:to\s+)?(?:priority\s+)?(very-low|very low|low|medium|high|urgent)$",
        stripped,
        re.IGNORECASE,
    )
    if generic_priority_match:
        target = _find_task_match(generic_priority_match.group(1), tasks)
        priority = generic_priority_match.group(2).lower().replace(" ", "-")
        if target:
            return {
                "reply": f'Set "{target.get("title")}" to {priority} priority.',
                "actions": [{"type": "update_task", "task_id": target.get("id"), "updates": {"priority": priority}}],
            }

    location_match = re.match(
        r"^(?:move|change)\s+(.+?)\s+to\s+location\s+(.+)$",
        stripped,
        re.IGNORECASE,
    )
    if location_match:
        target = _find_task_match(location_match.group(1), tasks)
        location = location_match.group(2).strip()
        if target and location:
            return {
                "reply": f'Updated the location for "{target.get("title")}".',
                "actions": [{"type": "update_task", "task_id": target.get("id"), "updates": {"location": location}}],
            }

    return None


def _parse_app_command(text):
    lowered = text.lower()

    if re.search(r"\b(weather|forecast|rain|temperature|snow|sunny|wind)\b", lowered):
        return {
            "reply": "Checking the forecast.",
            "actions": [{"type": "app_command", "command": "fetch_weather", "payload": {"query": text}}],
        }

    if re.search(r"\b(activity score|activity scores|act score|act scores|health score)\b", lowered):
        if re.search(r"\b(open|show|history|list)\b", lowered):
            return {
                "reply": "Opening activity scores.",
                "actions": [{"type": "app_command", "command": "open_activity_scores"}],
            }
        return {
            "reply": "Loading your latest activity score.",
            "actions": [{"type": "app_command", "command": "summarize_activity_score"}],
        }

    if re.search(r"\b(optimize|optimise|reorganize|reorganise)\b", lowered):
        target_date = _parse_date_reference(text)
        if target_date:
            return {
                "reply": f"Opening optimize for {target_date}.",
                "actions": [{"type": "app_command", "command": "optimize_date", "payload": {"date": target_date}}],
            }
        return {
            "reply": "Opening optimizer options.",
            "actions": [{"type": "app_command", "command": "open_optimize_scope"}],
        }

    if re.search(r"\b(open|show|go to|take me to)\b", lowered):
        command = None
        reply = None
        if re.search(r"\b(options|settings|profile)\b", lowered):
            command, reply = "open_profile", "Opening profile and options."
        elif re.search(r"\b(task history|history)\b", lowered):
            command, reply = "open_task_history", "Opening task history."
        elif re.search(r"\b(routines?|routine profiles?)\b", lowered):
            command, reply = "open_routines", "Opening saved routines."
        elif re.search(r"\b(import|calendar import)\b", lowered):
            command, reply = "open_import_calendar", "Opening calendar import."
        elif re.search(r"\b(statistics|stats|analytics)\b", lowered):
            command, reply = "open_statistics", "Opening Smart Statistics."
        elif re.search(r"\b(smart routine|routine builder)\b", lowered):
            command, reply = "open_smart_routine", "Opening Smart Routine."
        elif re.search(r"\b(vacation|holiday|time off)\b", lowered):
            command, reply = "open_smart_vacation", "Opening Smart Vacation."
        if command:
            return {"reply": reply, "actions": [{"type": "app_command", "command": command}]}

    if re.search(r"\b(plan|plans|planned|agenda|schedule|calendar|what.*on|what.*for)\b", lowered):
        target_date = _parse_date_reference(text)
        if target_date and _has_explicit_date(text):
            return {
                "reply": f"Checking the plan for {target_date}.",
                "actions": [{"type": "app_command", "command": "summarize_calendar_date", "payload": {"date": target_date}}],
            }

    return None


def _rule_based_response(payload):
    text = (payload.get("input") or "").strip()
    lowered = text.lower()
    tasks = payload.get("tasks", []) or []

    if not text:
        return {"reply": "Tell me what you'd like to do, and I'll help turn it into a clear plan.", "actions": []}

    usual_routine_plan = _parse_usual_routine_plan(text, tasks)
    if usual_routine_plan:
        return usual_routine_plan

    app_command = _parse_app_command(text)
    if app_command:
        return app_command

    vacation_tasks = _parse_vacation_range(text)
    if vacation_tasks:
        return vacation_tasks

    recurring_tasks = _parse_recurring_tasks(text)
    if recurring_tasks:
        return recurring_tasks

    flexible_activity_plan = _parse_flexible_activity_plan(text, tasks)
    if flexible_activity_plan:
        return flexible_activity_plan

    new_task = _parse_new_task(text)
    if new_task:
        if new_task.get("needs_clarification"):
            return {
                "reply": new_task["reply"],
                "actions": [],
            }
        return {
            "reply": f'Added "{new_task["title"]}"{f" at {new_task["time"]}" if new_task.get("time") else ""}. You are making steady progress.',
            "actions": [{"type": "create_task", "task": new_task}],
        }

    completion = _parse_completion(text, tasks)
    if completion:
        task, reply = completion
        return {
            "reply": reply,
            "actions": [{"type": "update_task", "task_id": task.get("id"), "updates": {"completed": True}}],
        }

    deletion = _parse_deletion(text, tasks)
    if deletion:
        return deletion

    task_update = _parse_task_update(text, tasks)
    if task_update:
        return task_update

    if "today" in lowered:
        today = datetime.now().strftime("%Y-%m-%d")
        today_tasks = [task for task in tasks if task.get("date") == today and not task.get("completed")]
        if not today_tasks:
            return {"reply": "Nothing is scheduled for today yet, which gives us a nice clean slate to work with.", "actions": []}

        lines = [
            f'{task.get("time")} - {task.get("title")}' if task.get("time") else task.get("title")
            for task in today_tasks
        ]
        return {
            "reply": f"You have {len(today_tasks)} task{'s' if len(today_tasks) != 1 else ''} today. Here's the plan:\n" + "\n".join(lines),
            "actions": [],
        }

    if "priority" in lowered or "important" in lowered:
        high_priority = [task for task in tasks if task.get("priority") in ("urgent", "high") and not task.get("completed")]
        if not high_priority:
            return {"reply": "You don't have any high-priority items right now, which is a great place to be.", "actions": []}

        return {
            "reply": "Here are your high-priority items:\n" + "\n".join(
                f'{task.get("title")} - {task.get("date")}' for task in high_priority
            ),
            "actions": [],
        }

    if "help" in lowered or "?" in lowered:
        return {
            "reply": (
                "I can help you stay organized and keep momentum:\n"
                "- Review what's on today\n"
                "- Add a new task\n"
                "- Optimize your schedule\n"
                "- Highlight your priorities"
            ),
            "actions": [],
        }

    return None


def _build_task_context(tasks):
    return "\n".join(
        f'- [{task.get("id", "no-id")}] {task.get("title")} on {task.get("date")}'
        f'{(" at " + task.get("time")) if task.get("time") else ""}'
        f'{(" in " + task.get("location")) if task.get("location") else ""}'
        f'{" (completed)" if task.get("completed") else ""}'
        for task in tasks
    )


def _build_history_context(messages):
    trimmed = messages[-30:]
    return "\n".join(
        f'{("User" if message.get("role") == "user" else "Assistant")}: {message.get("content", "")}'
        for message in trimmed
    )


def _is_feature_explanation_request(text):
    lowered = str(text or "").lower()
    return bool(
        re.search(r"\b(how|why|what)\b.*\b(work|works|working|built|implemented|coded|logic|code)\b", lowered)
        or re.search(r"\b(explain|describe|break down)\b.*\b(feature|logic|code|implementation|works?)\b", lowered)
        or re.search(r"\b(logic wise|code wise|technically|under the hood)\b", lowered)
    )


def _build_feature_explanation_context():
    return """
App feature map for brief user-facing explanations:
- Dashboard and task views: `src/pages/Index.tsx` owns the daily dashboard, selected date, mini calendar, recommendations, optimize previews, profile dialogs, and card/list task display. Task state comes from `src/lib/taskStore.ts`, which syncs with the Flask task API when a backend URL is configured and falls back to local storage otherwise.
- Task create/edit window: `src/components/TaskDialog.tsx` opens for new tasks, task edits, and assistant previews. Assistant actions are previewed before save; direct mutations happen only after the user confirms or saves.
- Assistant UI: `src/components/AssistantPanel.tsx` sends messages to `/api/chat`, executes returned `app_command` actions, opens app areas, and shows preview windows for create/update/create_tasks actions. It also has a local Lite fallback for supported commands if the backend is unreachable.
- Assistant backend: `backend/app/chat_api.py` saves authenticated user messages first, sends the request to OpenAI with task/history context, normalizes returned actions, saves assistant replies with structured `analysis_data`, and returns JSON `{ reply, actions }`. If the profile key is missing or fails, supported commands use Lite parsing; full free-form interpretation requires the API key.
- Chat storage: `backend/app/models.py` defines `Conversation` and `Message`. Assistant chat metadata is stored in `messages.analysis_data` with fields like `source`, `kind`, `status`, `actions`, and `request_message_id`.
- API keys and profile: `src/components/Header.tsx` contains Profile Options. `backend/app/auth.py` stores the user's OpenAI key, tests keys before saving, and exposes `/api/auth/test-openai-key` for the Test API key button.
- Tasks and history: `backend/app/tasks_api.py` handles task CRUD and writes task history. `src/lib/taskStore.ts` exposes add/update/delete/complete helpers to the UI.
- Recommendations: `backend/app/chat_api.py` `/recommendations` creates non-overlapping suggested tasks, mixing fallback ideas with AI refinement when a working key exists.
- Optimize schedule: `src/pages/Index.tsx` opens optimize scope/date flows. `backend/app/chat_api.py` `/optimize-schedule` asks AI to improve task timing and returns previewable task updates; app-side guards avoid work-time conflicts when possible.
- Smart Routine: `src/pages/SmartRoutine.tsx` collects routine preferences. `backend/app/chat_api.py` `/routine-plan` generates routine tasks, enforces work-hour rules, adds sleep blocks, prefers workout time, dedupes overlaps, and saves a routine profile.
- Smart Statistics: `src/pages/SmartStatistics.tsx` combines tasks, task history, activity scores, and AI usage. `backend/app/chat_api.py` exposes activity score and AI usage routes; `backend/app/ai_usage.py` estimates API cost.
- Calendar import and delete calendar: `src/components/GoogleCalendarImportDialog.tsx` parses calendar uploads into preview tasks. Profile tools in `src/components/Header.tsx` expose import and delete-calendar actions.
- Weather: The assistant uses an app command handled in `src/components/AssistantPanel.tsx`, calling Open-Meteo/geocoding from the browser for forecast summaries.
Explanation style rules:
- Keep answers brief: usually 3-6 short bullets or 1 short paragraph.
- Explain both user logic and code location when asked "code wise".
- Do not include long code snippets unless the user explicitly asks.
- For explanation requests, return no actions.
""".strip()


def _get_assistant_conversation():
    current_user = getattr(request, "current_user", None)
    if current_user is None:
        return None

    from app.models import Conversation, db

    conversation = (
        db.session.query(Conversation)
        .filter(
            Conversation.user_id == current_user.id,
            Conversation.use_case == "assistant",
        )
        .order_by(Conversation.updated_at.desc())
        .first()
    )
    if conversation is None:
        conversation = Conversation(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            title="Assistant Chat",
            use_case="assistant",
        )
        db.session.add(conversation)
        db.session.flush()
    return conversation


def _persist_chat_message(role, content, analysis_data=None):
    if not str(content or "").strip():
        return None

    try:
        from app.models import Message, db

        conversation = _get_assistant_conversation()
        if conversation is None:
            return None

        message = Message(
            id=str(uuid.uuid4()),
            conversation_id=conversation.id,
            role=role,
            content=str(content).strip(),
            analysis_data=analysis_data or {},
        )
        db.session.add(message)
        conversation.updated_at = datetime.utcnow()
        db.session.commit()
        return message.id
    except Exception:
        try:
            from app.models import db
            db.session.rollback()
        except Exception:
            pass
        return None


def _persist_user_input(user_input, source="assistant"):
    return _persist_chat_message(
        "user",
        user_input,
        {
            "source": source,
            "kind": "assistant_input",
            "status": "received",
        },
    )


def _persist_assistant_reply(assistant_reply, actions=None, source="assistant", request_message_id=None, status="ok", error=None):
    safe_actions = actions if isinstance(actions, list) else []
    analysis_data = {
        "source": source,
        "kind": "assistant_response",
        "status": status,
        "actions": safe_actions,
        "request_message_id": request_message_id,
    }
    if error:
        analysis_data["error"] = str(error)
    return _persist_chat_message(
        "assistant",
        str(assistant_reply or "").strip() or "No assistant reply.",
        analysis_data,
    )


def _jsonify_chat_response(reply, actions=None, source="assistant", request_message_id=None, status="ok", error=None):
    safe_actions = actions if isinstance(actions, list) else []
    _persist_assistant_reply(reply, safe_actions, source, request_message_id, status, error)
    return jsonify({"reply": reply, "actions": safe_actions}), 200


@chat_bp.post("/log")
def log_chat_messages():
    _request_openai_api_key()
    payload = request.get_json(silent=True) or {}
    messages = payload.get("messages", [])
    if not isinstance(messages, list):
        messages = []

    saved_ids = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "").strip().lower()
        if role not in {"user", "assistant"}:
            continue
        content = str(message.get("content") or "").strip()
        if not content:
            continue
        analysis_data = message.get("analysis_data")
        if not isinstance(analysis_data, dict):
            analysis_data = {}
        analysis_data = {
            **analysis_data,
            "source": analysis_data.get("source") or "frontend",
            "kind": analysis_data.get("kind") or "assistant_ui_message",
        }
        saved_id = _persist_chat_message(role, content, analysis_data)
        if saved_id:
            saved_ids.append(saved_id)

    return jsonify({"saved": len(saved_ids), "ids": saved_ids}), 200


def _has_any(tasks, keywords):
    combined = " ".join(
        " ".join(
            filter(
                None,
                [
                    task.get("title", ""),
                    task.get("description", ""),
                    " ".join(task.get("tags", []) or []),
                ],
            )
        ).lower()
        for task in tasks
    )
    return any(keyword in combined for keyword in keywords)


def _make_task(title, days_from_now, category, priority="medium", tags=None, tasks=None, duration=60, preferred_time=None, date_override=None):
    today = datetime.now().date()
    date = date_override or (today + timedelta(days=days_from_now)).strftime("%Y-%m-%d")
    try:
        if datetime.strptime(date, "%Y-%m-%d").date() < today:
            date = today.strftime("%Y-%m-%d")
    except ValueError:
        date = today.strftime("%Y-%m-%d")
    scheduled_time = _suggest_time_for_date(tasks or [], date, duration=duration, preferred_time=preferred_time)
    return {
        "title": title,
        "description": _compact_description(title, title),
        "date": date,
        "time": scheduled_time,
        "duration": duration,
        "priority": priority,
        "tags": tags or [category],
        "completed": False,
    }


def _safe_recommendation_target_date(value):
    today = datetime.now().date()
    if isinstance(value, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        try:
            parsed = datetime.strptime(value, "%Y-%m-%d").date()
            return max(parsed, today).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return today.strftime("%Y-%m-%d")


def _fit_recommendation_times(recommendations, tasks):
    synthetic_tasks = list(tasks)
    fitted_recommendations = []
    today = datetime.now().date()
    for recommendation in recommendations:
        suggested_task = recommendation.get("suggested_task")
        if not suggested_task:
            continue
        try:
            duration = int(suggested_task.get("duration") or 60)
        except (TypeError, ValueError):
            duration = 60
        current_time = suggested_task.get("time")
        original_date = suggested_task.get("date") or datetime.now().strftime("%Y-%m-%d")
        try:
            start_date = max(datetime.strptime(original_date, "%Y-%m-%d").date(), today)
        except ValueError:
            start_date = today
        scheduled_date = None
        scheduled_time = None

        for offset in range(0, 14):
            candidate_date = (start_date + timedelta(days=offset)).strftime("%Y-%m-%d")

            candidate_time = _suggest_time_for_date(
                synthetic_tasks,
                candidate_date,
                duration=duration,
                preferred_time=current_time if offset == 0 else None,
                strict=True,
            )
            if candidate_time:
                scheduled_date = candidate_date
                scheduled_time = candidate_time
                break

        if not scheduled_date or not scheduled_time:
            continue
        suggested_task["date"] = scheduled_date
        suggested_task["time"] = scheduled_time
        suggested_task["duration"] = duration
        synthetic_tasks.append(suggested_task)
        fitted_recommendations.append(recommendation)
    return fitted_recommendations


def _recommendation_has_future_task(recommendation):
    suggested = recommendation.get("suggested_task") if isinstance(recommendation, dict) else None
    if not isinstance(suggested, dict):
        return False
    try:
        return datetime.strptime(str(suggested.get("date")), "%Y-%m-%d").date() >= datetime.now().date()
    except (TypeError, ValueError):
        return False


def _normalize_recommendation_item(item, fallback_days=1, tasks=None):
    if not isinstance(item, dict):
        return None

    tasks = tasks or []
    recommendation = dict(item)
    suggested = recommendation.get("suggested_task")
    if suggested is None:
        recommendation["suggested_task"] = None
        return recommendation

    if not isinstance(suggested, dict):
        recommendation["suggested_task"] = None
        return recommendation

    fallback = _make_task(
        suggested.get("title") or recommendation.get("title") or "Suggested task",
        fallback_days,
        recommendation.get("category") or "schedule",
        tasks=tasks,
    )
    merged = {**fallback, **suggested}
    merged = _normalize_task_payload(merged, " ".join(
        str(value) for value in [
            recommendation.get("title", ""),
            recommendation.get("reason", ""),
            suggested.get("title", ""),
            suggested.get("description", ""),
            suggested.get("location", ""),
        ] if value
    ))
    recommendation["suggested_task"] = merged
    return recommendation


def _pin_recommendations_to_date(recommendations, target_date):
    pinned = []
    for recommendation in recommendations:
        if not recommendation:
            continue
        suggested = recommendation.get("suggested_task")
        if isinstance(suggested, dict):
            suggested["date"] = target_date
        pinned.append(recommendation)
    return pinned


def _normalize_optimized_task(candidate, original):
    title_original = str(original.get("title") or "").strip().lower()
    original_tags = original.get("tags") if isinstance(original.get("tags"), list) else []
    normalized_original_tags = {str(tag).strip().lower() for tag in original_tags}
    is_locked_work_task = (
        title_original == "work hours"
        or title_original.startswith("work break")
        or "work" in normalized_original_tags
        or "work-break" in normalized_original_tags
    )

    source_text = " ".join(
        part for part in [
            str(candidate.get("title") or original.get("title") or "").strip(),
            str(candidate.get("description") or original.get("description") or "").strip(),
            str(candidate.get("location") or original.get("location") or "").strip(),
        ] if part
    )

    merged = {
        "id": original.get("id"),
        "title": str(candidate.get("title") or original.get("title") or "Task").strip(),
        "description": str(candidate.get("description") or original.get("description") or "").strip() or _compact_description(
            str(candidate.get("title") or original.get("title") or "Task"),
            source_text or str(original.get("title") or "Task"),
        ),
        "note": str(candidate.get("note") or original.get("note") or "").strip() or None,
        "date": str(candidate.get("date") or original.get("date") or datetime.now().strftime("%Y-%m-%d")).strip(),
        "time": candidate.get("time") if candidate.get("time") not in ("", None) else original.get("time"),
        "duration": candidate.get("duration") if candidate.get("duration") is not None else original.get("duration"),
        "location": str(candidate.get("location") or original.get("location") or "").strip() or None,
        "priority": _normalize_priority(candidate.get("priority"), source_text),
        "tags": candidate.get("tags") if isinstance(candidate.get("tags"), list) else (original.get("tags") if isinstance(original.get("tags"), list) else []),
        "completed": bool(candidate.get("completed", original.get("completed", False))),
    }

    if is_locked_work_task:
        merged["title"] = str(original.get("title") or merged["title"]).strip()
        merged["date"] = str(original.get("date") or merged["date"]).strip()
        merged["time"] = original.get("time")
        merged["duration"] = original.get("duration")
        merged["location"] = original.get("location")
        merged["tags"] = original_tags

    _align_task_date_to_request(merged, source_text)
    return merged


def _enhance_tasks_fallback(tasks):
    enhanced = []
    for task in tasks:
        merged = _normalize_optimized_task(task, task)
        if merged.get("time"):
            try:
                scheduled = datetime.strptime(f"{merged['date']} {merged['time']}", "%Y-%m-%d %H:%M")
                now = datetime.now()
                if not merged.get("completed"):
                    if scheduled.date() == now.date() and scheduled <= now + timedelta(hours=2):
                        merged["priority"] = "urgent"
                    elif scheduled.date() <= now.date() + timedelta(days=1) and merged["priority"] in ("very-low", "low"):
                        merged["priority"] = "medium"
            except ValueError:
                pass
        enhanced.append(merged)
    return enhanced


def _to_minutes(duration):
    try:
        value = int(duration or 60)
        if value <= 0:
            return 60
        return min(value, 12 * 60)
    except Exception:
        return 60


def _category_for_task(task):
    text = " ".join([
        str(task.get("title") or ""),
        str(task.get("description") or ""),
        " ".join(task.get("tags") or []),
    ]).lower()
    if re.search(r"\b(workout|gym|run|sports|exercise|walk|training)\b", text):
        return "movement"
    if re.search(r"\b(break|rest|mindful|meditation|recovery|pause)\b", text):
        return "recovery"
    if re.search(r"\b(family|friends|social|partner|kids)\b", text):
        return "social"
    if re.search(r"\b(read|study|course|learning|practice)\b", text):
        return "learning"
    if re.search(r"\b(meeting|work|project|task|office|client)\b", text):
        return "work"
    return "personal"


def _activity_insights_fallback(tasks):
    totals = {
        "work": 0,
        "movement": 0,
        "recovery": 0,
        "social": 0,
        "learning": 0,
        "personal": 0,
    }
    per_day = {}
    for task in tasks:
        date = str(task.get("date") or datetime.now().strftime("%Y-%m-%d"))
        minutes = _to_minutes(task.get("duration"))
        category = _category_for_task(task)
        totals[category] += minutes
        per_day[date] = per_day.get(date, 0) + minutes

    total_minutes = sum(totals.values()) or 1
    busy_days = sum(1 for value in per_day.values() if value >= 8 * 60)
    avg_per_day = (sum(per_day.values()) / len(per_day)) if per_day else 0
    recovery_ratio = totals["recovery"] / total_minutes
    movement_ratio = totals["movement"] / total_minutes

    score = 70
    if recovery_ratio >= 0.12:
        score += 12
    elif recovery_ratio < 0.06:
        score -= 10
    if movement_ratio >= 0.10:
        score += 10
    elif movement_ratio < 0.05:
        score -= 8
    if avg_per_day > 9 * 60:
        score -= 10
    if busy_days >= 4:
        score -= 6
    score = max(20, min(95, score))

    status = "healthy" if score >= 75 else ("watch" if score >= 55 else "needs_changes")
    guidance = []
    if recovery_ratio < 0.08:
        guidance.append("Add one short recovery break (15-30 min) on heavier days.")
    if movement_ratio < 0.08:
        guidance.append("Add a movement block 2-3 times this week.")
    if avg_per_day > 8.5 * 60:
        guidance.append("Workload is dense. Splitting one long block could improve focus.")
    if not guidance:
        guidance.append("Your calendar balance looks strong. Keep your current rhythm.")

    graph = []
    for key, label, color in [
        ("work", "Work", "var(--chart-1)"),
        ("movement", "Movement", "var(--chart-2)"),
        ("recovery", "Breaks", "var(--chart-3)"),
        ("social", "Social", "var(--chart-4)"),
        ("learning", "Learning", "var(--chart-5)"),
        ("personal", "Personal", "var(--primary)"),
    ]:
        minutes = totals[key]
        graph.append({
            "label": label,
            "minutes": minutes,
            "percent": round((minutes / total_minutes) * 100, 1),
            "color": color,
        })

    return {
        "status": status,
        "health_score": score,
        "summary": "AI checked your calendar balance and workload pattern.",
        "guidance": guidance[:3],
        "graphs": {
            "activity_mix": graph,
            "load": {
                "avg_minutes_per_day": round(avg_per_day),
                "busy_days": busy_days,
                "scheduled_days": len(per_day),
            },
        },
    }


def _routine_start_date():
    return datetime.now().date()


def _date_for_weekday(start_date, weekday_name, week_offset):
    current = start_date + timedelta(days=week_offset * 7)
    target_weekday = WEEKDAY_LOOKUP.get(weekday_name, 0)
    while current.weekday() != target_weekday:
        current += timedelta(days=1)
    return current.strftime("%Y-%m-%d")


def _routine_task(title, date, time, duration, priority="medium", tags=None, description=None, location=None):
    return {
        "title": title,
        "description": description or f"Routine block: {title}.",
        "date": date,
        "time": time,
        "duration": int(duration),
        "location": location,
        "priority": priority,
        "tags": tags or [],
        "completed": False,
    }


def _parse_routine_end_date(end_date):
    if isinstance(end_date, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", end_date):
        try:
            return datetime.strptime(end_date, "%Y-%m-%d").date()
        except Exception:
            pass
    return (datetime.now() + timedelta(days=28)).date()


def _normalize_work_breaks(questionnaire):
    raw_work_breaks = questionnaire.get("work_breaks") if isinstance(questionnaire.get("work_breaks"), list) else []
    work_breaks = []
    for item in raw_work_breaks:
        if not isinstance(item, dict):
            continue
        time_value = _normalize_task_time(item.get("time") or "12:00")
        duration_value = max(10, min(120, int(item.get("duration") or 30)))
        work_breaks.append({"time": time_value, "duration": duration_value})
    work_breaks.sort(key=lambda b: _time_to_minutes(b["time"]))
    return work_breaks


def _build_workday_blocks(day, day_date, work_start_time, work_end_time, work_breaks):
    start_minutes = _time_to_minutes(work_start_time)
    end_minutes = _time_to_minutes(work_end_time)
    if end_minutes <= start_minutes:
        end_minutes = start_minutes + 8 * 60

    blocks = []
    cursor = start_minutes
    break_index = 1

    for br in work_breaks:
        break_start = _time_to_minutes(br["time"])
        break_duration = int(br["duration"])
        break_end = min(end_minutes, break_start + break_duration)
        if break_start <= start_minutes or break_start >= end_minutes:
            continue
        if break_start > cursor:
            blocks.append(_routine_task(
                title="Work Hours",
                date=day_date,
                time=f"{cursor // 60:02d}:{cursor % 60:02d}",
                duration=max(15, break_start - cursor),
                priority="high",
                tags=["routine", "work", day],
                description="Work block generated from your configured working hours.",
            ))
        if break_end > break_start:
            blocks.append(_routine_task(
                title=f"Work Break {break_index}",
                date=day_date,
                time=f"{break_start // 60:02d}:{break_start % 60:02d}",
                duration=max(10, break_end - break_start),
                priority="medium",
                tags=["routine", "work-break", day],
                description="Planned work break from your configured schedule.",
            ))
            break_index += 1
        cursor = max(cursor, break_end)

    if cursor < end_minutes:
        blocks.append(_routine_task(
            title="Work Hours",
            date=day_date,
            time=f"{cursor // 60:02d}:{cursor % 60:02d}",
            duration=max(15, end_minutes - cursor),
            priority="high",
            tags=["routine", "work", day],
            description="Work block generated from your configured working hours.",
        ))
    return blocks


def _sleep_duration_minutes(sleep_time, wake_time):
    sleep_minutes = _time_to_minutes(sleep_time)
    wake_minutes = _time_to_minutes(wake_time)
    if wake_minutes <= sleep_minutes:
        wake_minutes += 24 * 60
    return max(15, min(24 * 60, wake_minutes - sleep_minutes))


def _build_sleep_blocks(start_date, end_date, sleep_time, wake_time):
    sleep_time = _normalize_task_time(sleep_time or "23:00")
    wake_time = _normalize_task_time(wake_time or "07:00")
    duration = _sleep_duration_minutes(sleep_time, wake_time)
    parsed_end_date = _parse_routine_end_date(end_date)
    tasks = []
    cursor = start_date

    while cursor <= parsed_end_date and len(tasks) < 366:
        date_value = cursor.strftime("%Y-%m-%d")
        tasks.append(_routine_task(
            title="Sleep",
            date=date_value,
            time=sleep_time,
            duration=duration,
            priority="low",
            tags=["routine", "sleep", "rest"],
            description=f"Sleep block from {sleep_time} to {wake_time}.",
        ))
        cursor += timedelta(days=1)

    return tasks


def _generate_routine_fallback(end_date, questionnaire):
    working_days = questionnaire.get("working_days") or ["monday", "tuesday", "wednesday", "thursday", "friday"]
    if not isinstance(working_days, list) or not working_days:
        working_days = ["monday", "tuesday", "wednesday", "thursday", "friday"]
    working_days = [str(day).lower() for day in working_days if str(day).lower() in WEEKDAY_LOOKUP]
    if not working_days:
        working_days = ["monday", "tuesday", "wednesday", "thursday", "friday"]

    energy_peak_time = _normalize_task_time(questionnaire.get("energy_peak_time") or "10:00")
    learning_minutes_per_week = max(0, min(1200, int(questionnaire.get("learning_minutes_per_week") or 180)))
    workout_per_week = max(0, min(7, int(questionnaire.get("workout_per_week") or 3)))
    workout_duration = max(15, min(180, int(questionnaire.get("workout_duration") or 60)))
    preferred_workout_time = _normalize_task_time(questionnaire.get("preferred_workout_time") or "17:30")
    sleep_time = _normalize_task_time(questionnaire.get("sleep_time") or "23:00")
    wake_time = _normalize_task_time(questionnaire.get("wake_time") or "07:00")
    work_start_time = _normalize_task_time(questionnaire.get("work_start_time") or "09:00")
    work_end_time = _normalize_task_time(questionnaire.get("work_end_time") or "17:00")
    work_breaks = _normalize_work_breaks(questionnaire)

    per_day_learning = 0
    if len(working_days) > 0:
        per_day_learning = int(round(learning_minutes_per_week / len(working_days)))
    learning_duration = max(0, min(120, per_day_learning))
    try:
        work_start_minutes = _time_to_minutes(work_start_time)
        work_end_minutes = _time_to_minutes(work_end_time)
        if work_end_minutes <= work_start_minutes:
            work_end_minutes = work_start_minutes + 8 * 60
        work_duration = max(60, min(12 * 60, work_end_minutes - work_start_minutes))
    except Exception:
        work_duration = 8 * 60

    tasks = []
    start_date = _routine_start_date()
    weekday_order = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    sorted_workdays = sorted(working_days, key=lambda day: weekday_order.index(day))

    parsed_end_date = _parse_routine_end_date(end_date)
    max_weeks = 52
    tasks.extend(_build_sleep_blocks(start_date, end_date, sleep_time, wake_time))

    for week in range(max_weeks):
        week_has_tasks = False
        for day in sorted_workdays:
            day_date = _date_for_weekday(start_date, day, week)
            day_date_obj = datetime.strptime(day_date, "%Y-%m-%d").date()
            if day_date_obj > parsed_end_date:
                continue
            week_has_tasks = True
            tasks.extend(_build_workday_blocks(day, day_date, work_start_time, work_end_time, work_breaks))
            if learning_duration > 0:
                tasks.append(_routine_task(
                    title="Learning Session",
                    date=day_date,
                    time="19:00",
                    duration=learning_duration,
                    priority="medium",
                    tags=["routine", "learning", day],
                    description="Skill-growth block based on your target learning minutes.",
                ))

        if workout_per_week > 0:
            workout_days = sorted_workdays[:min(len(sorted_workdays), workout_per_week)]
            for day in workout_days:
                day_date = _date_for_weekday(start_date, day, week)
                day_date_obj = datetime.strptime(day_date, "%Y-%m-%d").date()
                if day_date_obj > parsed_end_date:
                    continue
                tasks.append(_routine_task(
                    title="Workout Session",
                    date=day_date,
                    time=preferred_workout_time,
                    duration=workout_duration,
                    priority="medium",
                    tags=["routine", "health", "sports", day],
                    description="Scheduled movement block at your preferred workout time.",
                ))

        planning_day = "sunday" if "sunday" in WEEKDAY_LOOKUP else "friday"
        planning_date = _date_for_weekday(start_date, planning_day, week)
        planning_date_obj = datetime.strptime(planning_date, "%Y-%m-%d").date()
        if planning_date_obj <= parsed_end_date:
            tasks.append(_routine_task(
                title="Weekly Planning Review",
                date=planning_date,
                time="18:00",
                duration=40,
                priority="high",
                tags=["routine", "planning"],
                description="Review upcoming week, adjust priorities, and prepare key tasks.",
            ))

        if not week_has_tasks:
            break

    return tasks


def _normalize_task_time(value):
    parsed = _parse_time(str(value or ""))
    return parsed or "09:00"


def _routine_signature(task):
    title = str(task.get("title") or "").strip().lower()
    date = str(task.get("date") or "").strip()
    time = _normalize_task_time(task.get("time"))
    return f"{title}|{date}|{time}"


def _ranges_overlap(start_a, duration_a, start_b, duration_b):
    a0 = _time_to_minutes(start_a)
    a1 = a0 + int(duration_a or 60)
    b0 = _time_to_minutes(start_b)
    b1 = b0 + int(duration_b or 60)
    return not (a1 <= b0 or b1 <= a0)


def _fit_and_dedupe_routine_tasks(generated_tasks, existing_tasks):
    existing = [task for task in (existing_tasks or []) if isinstance(task, dict) and task.get("date")]
    existing_signatures = {_routine_signature(task) for task in existing}
    accepted = []

    for task in generated_tasks:
        if not isinstance(task, dict):
            continue

        task["date"] = _normalize_iso_date(task.get("date"))
        task["time"] = _normalize_task_time(task.get("time"))
        task["duration"] = int(task.get("duration") or 60)

        signature = _routine_signature(task)
        if signature in existing_signatures:
            continue
        if any(_routine_signature(other) == signature for other in accepted):
            continue

        # Avoid overlapping existing tasks on the same day.
        day_existing = [item for item in existing if str(item.get("date")) == task["date"] and item.get("time")]
        day_existing += [item for item in accepted if str(item.get("date")) == task["date"] and item.get("time")]

        conflict = False
        for item in day_existing:
            existing_time = _normalize_task_time(item.get("time"))
            existing_duration = int(item.get("duration") or 60)
            if _ranges_overlap(task["time"], task["duration"], existing_time, existing_duration):
                conflict = True
                break

        if conflict:
            proposed = _suggest_time_for_date(existing + accepted, task["date"], task["duration"], preferred_time=task["time"])
            task["time"] = _normalize_task_time(proposed)
            # Re-check after shifting
            still_conflict = False
            for item in day_existing:
                existing_time = _normalize_task_time(item.get("time"))
                existing_duration = int(item.get("duration") or 60)
                if _ranges_overlap(task["time"], task["duration"], existing_time, existing_duration):
                    still_conflict = True
                    break
            if still_conflict:
                continue

        accepted.append(task)

    return accepted


def _extract_vacation_dates(tasks):
    vacation_dates = set()
    for task in tasks or []:
        if not isinstance(task, dict):
            continue
        date_value = str(task.get("date") or "").strip()
        if not date_value:
            continue
        title = str(task.get("title") or "").strip().lower()
        tags = task.get("tags") if isinstance(task.get("tags"), list) else []
        normalized_tags = {str(tag).strip().lower() for tag in tags}
        if "vacation" in normalized_tags or "time-off" in normalized_tags or title == "vacation":
            vacation_dates.add(date_value)
    return vacation_dates


def _ensure_work_blocks_for_all_workdays(current_tasks, questionnaire, end_date, existing_tasks):
    working_days = questionnaire.get("working_days") or ["monday", "tuesday", "wednesday", "thursday", "friday"]
    if not isinstance(working_days, list):
        working_days = []
    working_days = [str(day).lower() for day in working_days if str(day).lower() in WEEKDAY_LOOKUP]
    if not working_days:
        working_days = ["monday", "tuesday", "wednesday", "thursday", "friday"]

    work_start_time = _normalize_task_time(questionnaire.get("work_start_time") or "09:00")
    work_end_time = _normalize_task_time(questionnaire.get("work_end_time") or "17:00")
    work_breaks = _normalize_work_breaks(questionnaire)

    start_date = _routine_start_date()
    parsed_end_date = _parse_routine_end_date(end_date)
    working_dates = set()
    enforced_work_tasks = []
    cursor = start_date
    while cursor <= parsed_end_date:
        day_name = cursor.strftime("%A").lower()
        day_date = cursor.strftime("%Y-%m-%d")
        if day_name in working_days:
            working_dates.add(day_date)
            enforced_work_tasks.extend(_build_workday_blocks(day_name, day_date, work_start_time, work_end_time, work_breaks))
        cursor += timedelta(days=1)

    if not enforced_work_tasks:
        return current_tasks or []

    preserved_tasks = []
    for task in (current_tasks or []):
        if not isinstance(task, dict):
            continue
        date_value = _normalize_iso_date(task.get("date"))
        tags = task.get("tags") if isinstance(task.get("tags"), list) else []
        normalized_tags = {str(tag).strip().lower() for tag in tags}
        title = str(task.get("title") or "").strip().lower()
        is_work_related = (
            "work" in normalized_tags
            or "work-break" in normalized_tags
            or "focus" in normalized_tags
            or title.startswith("work break")
            or title in {"work hours", "deep work block"}
        )
        if date_value in working_dates and is_work_related:
            continue
        preserved_tasks.append(task)

    merged = preserved_tasks + enforced_work_tasks
    deduped = []
    seen = set()
    for task in merged:
        signature = _routine_signature(task)
        if signature in seen:
            continue
        seen.add(signature)
        deduped.append(task)
    return deduped


def _ensure_sleep_blocks_for_period(current_tasks, questionnaire, end_date):
    sleep_time = _normalize_task_time(questionnaire.get("sleep_time") or "23:00")
    wake_time = _normalize_task_time(questionnaire.get("wake_time") or "07:00")
    start_date = _routine_start_date()
    enforced_sleep_tasks = _build_sleep_blocks(start_date, end_date, sleep_time, wake_time)
    sleep_dates = {task["date"] for task in enforced_sleep_tasks}

    preserved_tasks = []
    for task in (current_tasks or []):
        if not isinstance(task, dict):
            continue
        date_value = _normalize_iso_date(task.get("date"))
        tags = task.get("tags") if isinstance(task.get("tags"), list) else []
        normalized_tags = {str(tag).strip().lower() for tag in tags}
        title = str(task.get("title") or "").strip().lower()
        is_sleep = "sleep" in normalized_tags or title == "sleep"
        if date_value in sleep_dates and is_sleep:
            continue
        preserved_tasks.append(task)

    return preserved_tasks + enforced_sleep_tasks


def _enforce_routine_time_relations(tasks, questionnaire):
    if not isinstance(tasks, list):
        return []
    working_days = questionnaire.get("working_days") or ["monday", "tuesday", "wednesday", "thursday", "friday"]
    if not isinstance(working_days, list):
        working_days = []
    working_days = {str(day).lower() for day in working_days if str(day).lower() in WEEKDAY_LOOKUP}
    if not working_days:
        working_days = {"monday", "tuesday", "wednesday", "thursday", "friday"}

    wake_time = _normalize_task_time(questionnaire.get("wake_time") or "07:00")
    work_start_time = _normalize_task_time(questionnaire.get("work_start_time") or "09:00")
    preferred_workout_time = _normalize_task_time(questionnaire.get("preferred_workout_time") or "17:30")
    wake_minutes = _time_to_minutes(wake_time)
    work_start_minutes = _time_to_minutes(work_start_time)
    if work_start_minutes <= wake_minutes:
        return tasks

    adjusted = []
    for task in tasks:
        if not isinstance(task, dict):
            continue
        date_value = _normalize_iso_date(task.get("date"))
        try:
            weekday = datetime.strptime(date_value, "%Y-%m-%d").strftime("%A").lower()
        except Exception:
            weekday = ""

        tags = task.get("tags") if isinstance(task.get("tags"), list) else []
        normalized_tags = {str(tag).strip().lower() for tag in tags}
        title = str(task.get("title") or "").strip().lower()
        is_work_activity = (
            "work" in normalized_tags
            or "work-break" in normalized_tags
            or "focus" in normalized_tags
            or title.startswith("work break")
            or title in {"work hours", "deep work block"}
        )
        is_workout_activity = (
            "sports" in normalized_tags
            or "health" in normalized_tags
            or title in {"workout session", "workout", "gym", "training"}
            or "workout" in title
            or "gym" in title
        )

        if is_workout_activity:
            task["time"] = preferred_workout_time

        if is_work_activity and weekday in working_days:
            current_time = _normalize_task_time(task.get("time"))
            current_minutes = _time_to_minutes(current_time)
            if wake_minutes <= current_minutes < work_start_minutes:
                task["time"] = work_start_time

        adjusted.append(task)
    return adjusted


@chat_bp.route("", methods=["POST"])
@chat_bp.route("/", methods=["POST"])
def chat():
    payload = request.get_json(silent=True) or {}
    user_input = payload.get("input", "")
    api_key = _request_openai_api_key()
    request_message_id = _persist_user_input(user_input)
    explanation_request = _is_feature_explanation_request(user_input)
    rule_based = None if explanation_request else _rule_based_response(payload)

    if not api_key:
        if explanation_request:
            reply = (
                "Feature explanations use the live AI so I can explain the app logic and code structure clearly. "
                "Please add and test your API key in Profile Options first."
            )
            return _jsonify_chat_response(
                reply,
                [],
                source="missing_api_key",
                request_message_id=request_message_id,
                status="missing_api_key",
            )
        if rule_based:
            return _jsonify_chat_response(
                rule_based.get("reply", "I prepared this in Lite mode for you to review."),
                rule_based.get("actions", []),
                source="lite",
                request_message_id=request_message_id,
                status="missing_api_key",
            )
        reply = (
            "Full AI manager needs a working API key in Profile Options. "
            "Add and test your API key there, or use Lite mode for basic planning commands."
        )
        return _jsonify_chat_response(
            reply,
            [],
            source="missing_api_key",
            request_message_id=request_message_id,
            status="missing_api_key",
        )

    tasks = payload.get("tasks", []) or []
    messages = payload.get("messages", []) or []

    client = OpenAI(api_key=api_key, timeout=12.0)
    task_context = _build_task_context(tasks)
    history_context = _build_history_context(messages)
    feature_context = _build_feature_explanation_context() if explanation_request else ""
    instructions = (
        "You are an expert scheduling assistant for a task manager app. "
        "Be excellent at prioritizing, time-blocking, sequencing work, and turning vague plans into realistic next steps. "
        "Use the provided task list and conversation history as context and answer clearly and concisely. "
        "Your tone should be warm, motivating, and practical. "
        "If the user asks how a feature works logic-wise, code-wise, technically, or under the hood, answer as a brief product-and-code explainer using the provided app feature map. "
        "For feature explanation requests, do not create, update, delete, optimize, or open anything; return an empty actions array. "
        "When the user uses relative dates like today, tomorrow, or in 3 days, calculate them exactly from the provided current date. "
        "If the user asks you to add or change a plan but key details are missing, ask a short follow-up question before taking action. "
        "Examples of missing details include date, time, and location when those details matter. "
        "For add or change requests, interpret the user's actual sentence carefully and extract the best fitting task title, date, time, duration, and location from it. "
        "Understand compact complex requests: 'delete work tomorrow' means delete open tasks on tomorrow whose title/tags/details match work; do not claim there are no tasks unless you checked that date and subject. "
        "'Tell me the plan for DATE' means summarize the calendar tasks for that date. "
        "'Plan something some day next week' means choose one realistic non-overlapping open slot next week and create a preview task. "
        "'Plan some activity once a week for a month' means create four-ish weekly tasks over the next month, choosing concrete dates/times that avoid overlaps. "
        "'Tell me about my activity score' should answer from available app data or ask the user to open/generate Activity insights; do not create calendar tasks for that phrase. "
        "Do not use generic names if the user already implied a specific task name. "
        "Rewrite task titles so they are short, clean, well-capitalized, grammatically correct, and specific to the activity. "
        "For every created task, generate a compact one-sentence description from the user's provided information. Keep it under 140 characters and do not invent sensitive details. "
        "If the user asks to take, add, attach, or save a note for an existing task, return an update_task action with the note field and do not overwrite other fields. "
        "Choose the best fitting priority from exactly these values: very-low, low, medium, high, urgent. Use urgent only for truly time-sensitive or critical items. "
        "Correct obvious spelling and grammar issues in any created or renamed task title. "
        "If the input mentions a place, preserve it in the location field. "
        "If the input implies a timed range like 16-17, set time to the start and duration to the difference in minutes. "
        "If the user asks to move or rename a task, return an update_task action instead of a create action. "
        "If the user wants to add or change a task but hasn't specified enough information (such as the exact time, date, or location), ask them for it explicitly before creating or updating the task. "
        "Return valid JSON with keys reply and actions. "
        "actions must be an array. "
        "Allowed action types are create_task, create_tasks, update_task, delete_task, optimize_schedule, and app_command. "
        "Use app_command for app navigation or app-side information retrieval. app_command must include a command string and optional payload object. "
        "Allowed app_command commands: open_profile, open_options, open_activity_scores, open_task_history, open_routines, open_import_calendar, open_statistics, open_smart_routine, open_smart_vacation, open_optimize_scope, optimize_date, fetch_weather, summarize_activity_score, summarize_calendar_date. "
        "For optimize_date and summarize_calendar_date include payload.date as YYYY-MM-DD. For fetch_weather include payload.query as the user's original weather request. "
        "Only produce a create_task action when the user clearly asks to add or create a task. "
        "For a create_task action, you MUST include a 'task' object inside the action containing the fields: title, description, note, date, time, duration, location, priority, tags, and completed. "
        "Use create_tasks when the user asks for a recurring plan like every Monday, every week, or similar repeated scheduling. "
        "For create_tasks, include a 'tasks' array of concrete task objects. "
        "Produce an update_task action when the user asks to reschedule, rename, reprioritize, complete, or otherwise modify an existing task. "
        "For an update_task action, you MUST include 'task_id' (the exact existing ID) and an 'updates' object containing the modified fields. "
        "Produce a delete_task action when the user clearly asks to remove, delete, or cancel an existing task. "
        "When returning delete_task, include the exact existing task_id from the provided task list. "
        "If you are unsure about an action, ask one concise clarification question and return no actions. "
        "If the user input is unclear or does not map cleanly to a calendar action, ask a concise follow-up question instead of guessing. "
        "If no mutation is needed, return an empty actions array."
    )
    prompt = (
        f"Current date: {datetime.now().strftime('%Y-%m-%d')}.\n"
        f"Feature explanation request: {'yes' if explanation_request else 'no'}.\n"
        f"App feature map:\n{feature_context or '- Only needed for feature explanation requests'}\n\n"
        f"Conversation history:\n{history_context or '- No previous messages'}\n\n"
        f"Current tasks:\n{task_context if task_context else '- No tasks yet'}\n\n"
            f'User: {user_input}'
    )

    try:
        completion = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": instructions},
                {"role": "user", "content": prompt},
            ],
            max_tokens=450,
            temperature=0.7,
        )
        record_ai_usage(completion, "assistant")
        
        content = completion.choices[0].message.content or "{}"
        parsed = json.loads(content)
        actions = _normalize_actions(parsed.get("actions", []), user_input)
        return _jsonify_chat_response(
            parsed.get("reply", "I couldn't form a reply right now."),
            actions,
            source="openai",
            request_message_id=request_message_id,
        )
    except Exception as e:
        if rule_based and not explanation_request:
            return _jsonify_chat_response(
                rule_based.get("reply", "I prepared this in Lite mode for you to review."),
                rule_based.get("actions", []),
                source="lite",
                request_message_id=request_message_id,
                status="api_error",
                error=e,
            )
        if explanation_request:
            reply = (
                "I need the live AI to explain feature logic and code structure. "
                "Your saved API key did not work, so please update and test it in Profile Options."
            )
        else:
            reply = (
                "The saved API key did not work for the full AI manager. "
                "Please update and test your API key in Profile Options, or use Lite mode for basic planning commands."
            )
        return _jsonify_chat_response(
            reply,
            [],
            source="api_error",
            request_message_id=request_message_id,
            status="api_error",
            error=e,
        )


@chat_bp.post("/recommendations")
def recommendations():
    payload = request.get_json(silent=True) or {}
    tasks = payload.get("tasks", []) or []
    target_date = payload.get("target_date")
    excluded_titles = {title.lower() for title in payload.get("exclude_titles", []) or []}
    refresh_token = str(payload.get("refresh_token", ""))

    target_date = _safe_recommendation_target_date(target_date)

    base_pool = [
        {
            "title": "Plan family time",
            "reason": "Your schedule does not show much intentional family time right now.",
            "category": "family",
            "suggested_task": _make_task("Family time", 2, "family", tasks=tasks, duration=90, preferred_time="18:30", date_override=target_date),
        },
        {
            "title": "Add a movement block",
            "reason": "A short workout or walk can improve energy and make the rest of the schedule feel easier.",
            "category": "sports",
            "suggested_task": _make_task("Workout session", 1, "sports", tags=["health", "sports"], tasks=tasks, duration=60, preferred_time="17:30", date_override=target_date),
        },
        {
            "title": "Reserve reading time",
            "reason": "A small reading habit can create a calmer buffer around busy work blocks.",
            "category": "reading",
            "suggested_task": _make_task("Reading time", 3, "reading", tasks=tasks, duration=45, preferred_time="20:00", date_override=target_date),
        },
        {
            "title": "Add a recovery break",
            "reason": "Your week may benefit from a short recovery or mindfulness block.",
            "category": "recovery",
            "suggested_task": _make_task("Mindfulness break", 1, "recovery", tags=["recovery", "health"], tasks=tasks, duration=30, preferred_time="12:30", date_override=target_date),
        },
        {
            "title": "Plan a study session",
            "reason": "A focused learning block is missing from the current week.",
            "category": "studying",
            "suggested_task": _make_task("Study session", 2, "studying", tags=["studying", "learning"], tasks=tasks, duration=60, preferred_time="18:00", date_override=target_date),
        },
        {
            "title": "Make time for a hobby",
            "reason": "There is room for a lower-pressure personal activity that keeps the week enjoyable.",
            "category": "hobbies",
            "suggested_task": _make_task("Hobby time", 4, "hobbies", tasks=tasks, duration=60, preferred_time="19:00", date_override=target_date),
        },
        {
            "title": "Add a planning review",
            "reason": "A short planning check-in can keep your next few days from feeling fragmented.",
            "category": "schedule",
            "suggested_task": _make_task("Planning review", 1, "schedule", priority="high", tasks=tasks, duration=30, preferred_time="08:30", date_override=target_date),
        },
        {
            "title": "Protect a fun block",
            "reason": "A dedicated fun activity can make the schedule feel more sustainable.",
            "category": "fun",
            "suggested_task": _make_task("Fun activity", 5, "fun", tasks=tasks, duration=90, preferred_time="19:30", date_override=target_date),
        },
    ]

    filtered_pool = []
    for recommendation in base_pool:
        title = recommendation["title"].lower()
        suggested_title = (recommendation.get("suggested_task", {}) or {}).get("title", "").lower()
        if title in excluded_titles or suggested_title in excluded_titles:
            continue
        if recommendation["category"] == "family" and _has_any(tasks, ["family"]):
            continue
        if recommendation["category"] == "sports" and _has_any(tasks, ["workout", "gym", "run", "sports", "exercise"]):
            continue
        if recommendation["category"] == "reading" and _has_any(tasks, ["read", "reading", "book"]):
            continue
        if recommendation["category"] == "recovery" and _has_any(tasks, ["meditation", "breathing", "mindful", "recovery"]):
            continue
        filtered_pool.append(recommendation)

    rng = Random(refresh_token or datetime.now().isoformat())
    rng.shuffle(filtered_pool)
    recommendations = filtered_pool[:3]

    if not recommendations:
        recommendations = [{
            "title": "Protect a planning block",
            "reason": "Your schedule is well-covered already, so a short review block can help keep it that way.",
            "category": "schedule",
            "suggested_task": _make_task("Weekly planning review", 1, "schedule", priority="high", tasks=tasks, duration=30, preferred_time="08:30", date_override=target_date),
        }]
    if len(recommendations) < 3:
        existing_titles = {
            str(item.get("title", "")).lower()
            for item in recommendations
            if isinstance(item, dict)
        }
        for candidate in base_pool:
            candidate_title = str(candidate.get("title", "")).lower()
            if candidate_title in existing_titles:
                continue
            recommendations.append(candidate)
            existing_titles.add(candidate_title)
            if len(recommendations) >= 3:
                break

    api_key = _request_openai_api_key()
    if api_key:
        try:
            client = OpenAI(api_key=api_key)
            prompt = (
                f"Today is {datetime.now().strftime('%Y-%m-%d')}.\n"
                f"Current tasks:\n{_build_task_context(tasks) or '- No tasks yet'}\n"
                f"Excluded recommendation titles: {', '.join(sorted(excluded_titles)) or 'None'}.\n"
                f"Refresh token: {refresh_token or 'none'}.\n"
                f"Target date for recommendations: {target_date}.\n"
                "Return JSON with a recommendations array of 3 fresh ideas. "
                "Each item must include title, reason, category, and suggested_task. "
                "Every suggested_task must include a compact description and one priority value from very-low, low, medium, high, urgent. "
                "All suggested_task dates must be exactly the target date, and the target date is guaranteed to be today or in the future. "
                "Never recommend tasks in the past. "
                "Avoid repeating excluded titles or near-duplicates. "
                "Choose suggested_task times that fit around the current task list and avoid overlapping existing tasks, plans, or other recommendations. "
                "Valid categories: schedule, family, sports, health, recovery, personal, hobbies, meditation, reading, studying, fun."
            )
            completion = client.chat.completions.create(
                model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": "You generate varied, practical schedule recommendations for a planning app."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=700,
                temperature=1.0,
            )
            record_ai_usage(completion, "recommendations")
            content = completion.choices[0].message.content or "{}"
            parsed = json.loads(content)
            model_recommendations = parsed.get("recommendations", [])
            if isinstance(model_recommendations, list) and model_recommendations:
                normalized_model_recommendations = [
                    _normalize_recommendation_item(recommendation, fallback_days=(idx % 4) + 1, tasks=tasks)
                    for idx, recommendation in enumerate(model_recommendations)
                ]
                recommendations = [
                    recommendation for recommendation in normalized_model_recommendations if recommendation
                    if recommendation.get("title", "").lower() not in excluded_titles
                    and (recommendation.get("suggested_task", {}) or {}).get("title", "").lower() not in excluded_titles
                ][:3] or recommendations
        except Exception:
            pass

    recommendations = [
        _normalize_recommendation_item(recommendation, fallback_days=(idx % 4) + 1, tasks=tasks)
        for idx, recommendation in enumerate(recommendations[:3])
    ]
    recommendations = [recommendation for recommendation in recommendations if recommendation]
    recommendations = _pin_recommendations_to_date(recommendations, target_date)
    recommendations = _fit_recommendation_times(recommendations[:3], tasks)
    recommendations = [
        recommendation for recommendation in recommendations
        if _recommendation_has_future_task(recommendation)
    ][:3]
    return jsonify({"recommendations": recommendations}), 200


@chat_bp.post("/optimize-schedule")
def optimize_schedule_ai():
    payload = request.get_json(silent=True) or {}
    tasks = payload.get("tasks", []) or []
    if not isinstance(tasks, list):
        return jsonify({"detail": "tasks must be an array"}), 400

    if len(tasks) == 0:
        return jsonify({"tasks": []}), 200

    api_key = _request_openai_api_key()
    if not api_key:
        return jsonify({"tasks": _enhance_tasks_fallback(tasks)}), 200

    try:
        client = OpenAI(api_key=api_key)
        prompt = (
            f"Current date: {datetime.now().strftime('%Y-%m-%d')}.\n"
            "Improve this task list for a scheduling app. Preserve each task id and calendar intent.\n"
            "Return JSON only: {\"tasks\": [...]}\n"
            "For every task include: id, title, description, note, date, time, duration, location, priority, tags, completed.\n"
            "Rules:\n"
            "- Keep ids exactly unchanged.\n"
            "- Keep the number of tasks unchanged.\n"
            "- Keep date/time unless clearly invalid.\n"
            "- Rewrite title/description to be concise and useful.\n"
            "- Preserve note exactly unless the input note is empty.\n"
            "- Choose priority from: very-low, low, medium, high, urgent.\n"
            "- Keep tags relevant and compact.\n\n"
            f"Input tasks JSON:\n{json.dumps(tasks, ensure_ascii=True)}"
        )

        completion = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You are a precise scheduling optimizer that returns strict JSON."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=1400,
            temperature=0.5,
        )
        record_ai_usage(completion, "optimize-schedule")

        content = completion.choices[0].message.content or "{}"
        parsed = json.loads(content)
        candidate_tasks = parsed.get("tasks", [])
        if not isinstance(candidate_tasks, list):
            return jsonify({"tasks": _enhance_tasks_fallback(tasks)}), 200

        source_by_id = {str(task.get("id")): task for task in tasks if task.get("id")}
        merged = []
        for idx, original in enumerate(tasks):
            candidate = candidate_tasks[idx] if idx < len(candidate_tasks) and isinstance(candidate_tasks[idx], dict) else {}
            candidate_id = str(candidate.get("id") or original.get("id") or "")
            if candidate_id and candidate_id in source_by_id:
                original = source_by_id[candidate_id]
            merged.append(_normalize_optimized_task(candidate, original))

        return jsonify({"tasks": merged}), 200
    except Exception:
        return jsonify({"tasks": _enhance_tasks_fallback(tasks)}), 200


@chat_bp.post("/activity-insights")
@token_required
def activity_insights():
    payload = request.get_json(silent=True) or {}
    tasks = payload.get("tasks", []) or []
    if not isinstance(tasks, list):
        return jsonify({"detail": "tasks must be an array"}), 400

    insights = _activity_insights_fallback(tasks)
    api_key = _request_openai_api_key()
    if not api_key:
        return jsonify(insights), 200

    try:
        client = OpenAI(api_key=api_key)
        prompt = (
            "You receive calendar tasks and precomputed metrics.\n"
            "Return JSON only with keys: summary (string), guidance (array of max 3 short strings), status (healthy|watch|needs_changes), health_score (0-100).\n"
            f"Current date: {datetime.now().strftime('%Y-%m-%d')}.\n"
            f"Tasks:\n{_build_task_context(tasks) or '- No tasks'}\n"
            f"Precomputed metrics:\n{json.dumps(insights['graphs'], ensure_ascii=True)}\n"
            f"Current fallback score/status: {insights['health_score']} / {insights['status']}."
        )
        completion = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You are a concise wellbeing and productivity analyst for calendar data."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=350,
            temperature=0.4,
        )
        record_ai_usage(completion, "activity-insights")
        content = completion.choices[0].message.content or "{}"
        parsed = json.loads(content)
        summary = str(parsed.get("summary") or "").strip()
        guidance = parsed.get("guidance") if isinstance(parsed.get("guidance"), list) else []
        status = str(parsed.get("status") or insights["status"]).strip().lower()
        score = int(parsed.get("health_score")) if str(parsed.get("health_score", "")).isdigit() else insights["health_score"]

        insights["summary"] = summary or insights["summary"]
        insights["guidance"] = [str(item).strip() for item in guidance if str(item).strip()][:3] or insights["guidance"]
        insights["status"] = status if status in {"healthy", "watch", "needs_changes"} else insights["status"]
        insights["health_score"] = max(0, min(100, score))
    except Exception:
        pass

    try:
        from app.models import ActivityScore, db
        score_entry = ActivityScore(
            user_id=request.current_user.id,
            health_score=int(insights.get("health_score") or 0),
            status=str(insights.get("status") or "watch"),
            summary=str(insights.get("summary") or ""),
            guidance=insights.get("guidance") if isinstance(insights.get("guidance"), list) else [],
            graphs=insights.get("graphs") if isinstance(insights.get("graphs"), dict) else {},
        )
        db.session.add(score_entry)
        db.session.commit()

        # Keep only the newest score per user for the current day.
        newest_today = (
            db.session.query(ActivityScore)
            .filter(
                ActivityScore.user_id == request.current_user.id,
                func.date(ActivityScore.created_at) == func.date(score_entry.created_at),
            )
            .order_by(ActivityScore.created_at.desc())
            .first()
        )
        if newest_today:
            (
                db.session.query(ActivityScore)
                .filter(
                    ActivityScore.user_id == request.current_user.id,
                    func.date(ActivityScore.created_at) == func.date(newest_today.created_at),
                    ActivityScore.id != newest_today.id,
                )
                .delete(synchronize_session=False)
            )
            db.session.commit()
    except Exception:
        pass

    return jsonify(insights), 200


@chat_bp.get("/activity-scores")
@token_required
def activity_scores():
    from app.models import ActivityScore, db
    scores = (
        db.session.query(ActivityScore)
        .filter(ActivityScore.user_id == request.current_user.id)
        .order_by(ActivityScore.created_at.desc())
        .all()
    )
    return jsonify({
        "scores": [
            {
                "id": score.id,
                "health_score": score.health_score,
                "status": score.status,
                "summary": score.summary,
                "guidance": score.guidance or [],
                "graphs": score.graphs or {},
                "created_at": score.created_at.isoformat(),
            }
            for score in scores
        ]
    }), 200


@chat_bp.get("/ai-usage")
@token_required
def ai_usage():
    try:
        days = int(request.args.get("days", 30))
    except (TypeError, ValueError):
        days = 30
    days = max(1, min(days, 365))
    return jsonify(ai_usage_summary(request.current_user.id, days)), 200


@chat_bp.post("/routine-plan")
@token_required
def routine_plan():
    payload = request.get_json(silent=True) or {}
    end_date = payload.get("end_date")
    questionnaire = payload.get("questionnaire") or {}
    existing_tasks = payload.get("existing_tasks") or []

    if not isinstance(questionnaire, dict):
        questionnaire = {}
    if not isinstance(existing_tasks, list):
        existing_tasks = []

    fallback_tasks = _generate_routine_fallback(end_date, questionnaire)
    generated_tasks = fallback_tasks

    api_key = _request_openai_api_key()
    if api_key:
        try:
            client = OpenAI(api_key=api_key)
            prompt = (
                f"Today: {datetime.now().strftime('%Y-%m-%d')}.\n"
                f"Questionnaire JSON:\n{json.dumps(questionnaire, ensure_ascii=True)}\n"
                f"Plan end date: {_parse_routine_end_date(end_date).strftime('%Y-%m-%d')}\n"
                f"Existing tasks:\n{_build_task_context(existing_tasks) or '- none'}\n"
                "Return strict JSON with key tasks as an array. "
                "Each task must include: title, description, date(YYYY-MM-DD), time(HH:MM), duration(minutes), location, priority, tags(array), completed(false). "
                "Do not create extra work, focus, or deep-work tasks besides the configured Work Hours and Work Break blocks because work hours already represent time at work. "
                "Create Sleep tasks from sleep_time to wake_time so sleep appears as an activity. "
                "Schedule workout or sports tasks at preferred_workout_time from the questionnaire whenever possible. "
                "Generate a realistic working routine for the full period and avoid obvious overlaps inside the generated routine."
            )
            completion = client.chat.completions.create(
                model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": "You generate practical weekly routines and return strict JSON only."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=2200,
                temperature=0.5,
            )
            record_ai_usage(completion, "routine-plan")
            content = completion.choices[0].message.content or "{}"
            parsed = json.loads(content)
            candidate_tasks = parsed.get("tasks", [])
            if isinstance(candidate_tasks, list) and candidate_tasks:
                normalized = []
                for task in candidate_tasks:
                    if not isinstance(task, dict):
                        continue
                    normalized.append({
                        "title": str(task.get("title") or "Routine task").strip(),
                        "description": str(task.get("description") or "Routine-generated task.").strip()[:140],
                        "date": _normalize_iso_date(task.get("date")),
                        "time": _parse_time(str(task.get("time") or "")) or "09:00",
                        "duration": int(task.get("duration") or 60),
                        "location": str(task.get("location") or "").strip() or None,
                        "priority": _normalize_priority(task.get("priority"), str(task.get("title") or "")),
                        "tags": task.get("tags") if isinstance(task.get("tags"), list) else ["routine"],
                        "completed": False,
                    })
                if normalized:
                    generated_tasks = normalized
        except Exception:
            pass

    final_tasks = _fit_and_dedupe_routine_tasks(generated_tasks, existing_tasks)
    if not final_tasks:
        final_tasks = _fit_and_dedupe_routine_tasks(fallback_tasks, existing_tasks)
    if not final_tasks:
        final_tasks = fallback_tasks[:40]
    final_tasks = _ensure_work_blocks_for_all_workdays(final_tasks, questionnaire, end_date, existing_tasks)
    final_tasks = _ensure_sleep_blocks_for_period(final_tasks, questionnaire, end_date)
    final_tasks = _enforce_routine_time_relations(final_tasks, questionnaire)
    final_tasks = _fit_and_dedupe_routine_tasks(final_tasks, existing_tasks)
    vacation_dates = _extract_vacation_dates(existing_tasks)
    removed_for_vacation = 0
    if vacation_dates:
        before_count = len(final_tasks)
        final_tasks = [task for task in final_tasks if str(task.get("date") or "") not in vacation_dates]
        removed_for_vacation = max(0, before_count - len(final_tasks))

    response_message = None
    if removed_for_vacation > 0:
        response_message = (
            f"{removed_for_vacation} routine task"
            f"{'' if removed_for_vacation == 1 else 's'} were skipped because they fall in your vacation period."
        )
    routine_profile_id = None
    try:
        from app.models import RoutineProfile, db
        profile = RoutineProfile(
            user_id=request.current_user.id,
            name=f"Routine until {_parse_routine_end_date(end_date).strftime('%Y-%m-%d')}",
            end_date=_parse_routine_end_date(end_date).strftime("%Y-%m-%d"),
            questionnaire=questionnaire if isinstance(questionnaire, dict) else {},
        )
        db.session.add(profile)
        db.session.commit()
        routine_profile_id = profile.id
    except Exception:
        routine_profile_id = None

    return jsonify({"tasks": final_tasks, "routine_profile_id": routine_profile_id, "message": response_message}), 200


@chat_bp.get("/routine-profiles")
@token_required
def routine_profiles():
    from app.models import RoutineProfile, db
    profiles = (
        db.session.query(RoutineProfile)
        .filter(RoutineProfile.user_id == request.current_user.id)
        .order_by(RoutineProfile.created_at.desc())
        .all()
    )
    return jsonify({
        "profiles": [
            {
                "id": profile.id,
                "name": profile.name,
                "end_date": profile.end_date,
                "questionnaire": profile.questionnaire or {},
                "created_at": profile.created_at.isoformat(),
            }
            for profile in profiles
        ]
    }), 200
