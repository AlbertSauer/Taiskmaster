import json
import os
import re
from datetime import datetime, timedelta
from random import Random

from flask import Blueprint, jsonify, request
from openai import OpenAI

from app.auth import token_required
from app.env import load_app_env

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
    lowered = text.lower()
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
    lowered = text.lower()
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
    lowered = text.lower()
    return bool(
        re.search(r"\b(today|tomorrow)\b", lowered)
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


def _suggest_time_for_date(tasks, date, duration=60, preferred_time=None):
    duration = duration or 60
    occupied = []
    for task in tasks:
        if task.get("date") != date or not task.get("time"):
            continue
        start = _time_to_minutes(task["time"])
        task_duration = int(task.get("duration") or 60)
        occupied.append((start, start + task_duration))

    occupied.sort()
    day_start = 7 * 60
    day_end = 21 * 60

    if preferred_time:
        preferred_start = _time_to_minutes(preferred_time)
        if preferred_start < day_start:
            preferred_start = day_start
        if preferred_start + duration <= day_end and all(
            preferred_start + duration <= start or preferred_start >= end
            for start, end in occupied
        ):
            return preferred_time

    for candidate in range(day_start, day_end - duration + 1, 30):
        if all(candidate + duration <= start or candidate >= end for start, end in occupied):
            return _minutes_to_time(candidate)

    return preferred_time or "18:00"


def _parse_period_limit(text):
    lowered = text.lower()
    explicit_range = re.search(r"\bfrom\s+(.+?)\s+to\s+(.+)$", lowered)
    if explicit_range:
        start_date = _parse_date_reference(explicit_range.group(1))
        end_date = _parse_date_reference(explicit_range.group(2))
        if start_date and end_date:
            return start_date, end_date

    period_match = re.search(r"\bfor\s+(\d+)\s+(day|days|week|weeks|month|months)\b", lowered)
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

    return None, None


def _extract_task_subject(text):
    lowered = text.strip()
    lowered = re.sub(r"^(?:please\s+)?(?:i\s+(?:want|need|would like)\s+to\s+|can you\s+|could you\s+|help me\s+)", "", lowered, flags=re.IGNORECASE)
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


def _parse_recurring_tasks(text, existing_tasks=None):
    existing_tasks = existing_tasks or []
    lowered = text.lower()
    weekday_match = re.search(
        r"\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
        text,
        re.IGNORECASE,
    )
    daily_match = re.search(r"\b(everyday|every day|daily|each day)\b", lowered)
    weekday_mode = weekday_match.group(1).lower() if weekday_match else None
    daily_mode = bool(daily_match)
    if not weekday_mode and not daily_mode:
        return None

    start_time, duration = _parse_time_range(text)
    if not start_time:
        start_time = _parse_time(text)

    title = _extract_task_subject(text)
    if not title:
        return None

    if not start_time:
        recurrence_label = "every day" if daily_mode else f"every {weekday_mode.capitalize()}"
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
                "date": current_date,
                "time": start_time,
                "duration": duration,
                "priority": "medium",
                "tags": ["daily", "routine"],
                "completed": False,
            })
    else:
        occurrences = 8
        current_date = start_dt
        target_weekday = WEEKDAY_LOOKUP[weekday_mode]
        while current_date.weekday() != target_weekday:
            current_date += timedelta(days=1)

        while len(tasks) < occurrences:
            if end_dt and current_date > end_dt:
                break
            tasks.append({
                "title": title,
                "date": current_date.strftime("%Y-%m-%d"),
                "time": start_time,
                "duration": duration,
                "priority": "medium",
                "tags": [weekday_mode, "routine"],
                "completed": False,
            })
            current_date += timedelta(days=7)

    if not tasks:
        return {
            "reply": f'I couldn’t find any dates in that period for "{title}". Try adjusting the range or recurrence.',
            "actions": [],
        }

    return {
        "reply": (
            f'Scheduled "{title}" '
            + ("every day" if daily_mode else f'every {weekday_mode.capitalize()}')
            + (f" from {tasks[0]['date']} to {tasks[-1]['date']}." if len(tasks) > 1 else ".")
        ),
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
    title = re.sub(r"\bfor\b", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\bthat\b", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s+at\s+$", "", title, flags=re.IGNORECASE)
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

    return {
        "title": (title or "New task").title(),
        "date": _parse_relative_date(cleaned),
        "time": time,
        "priority": "high" if re.search(r"\b(urgent|asap|high)\b", cleaned, re.IGNORECASE) else "medium",
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


def _extract_priority(text):
    match = re.search(r"\b(low|medium|high)\b", text, re.IGNORECASE)
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
        r"^(?:make|set|change)\s+(.+?)\s+(?:to\s+)?(low|medium|high)\s+priority$",
        stripped,
        re.IGNORECASE,
    )
    if priority_match:
        target = _find_task_match(priority_match.group(1), tasks)
        priority = priority_match.group(2).lower()
        if target:
            return {
                "reply": f'Set "{target.get("title")}" to {priority} priority.',
                "actions": [{"type": "update_task", "task_id": target.get("id"), "updates": {"priority": priority}}],
            }

    generic_priority_match = re.match(
        r"^(?:make|set|change)\s+(.+?)\s+(?:to\s+)?(?:priority\s+)?(low|medium|high)$",
        stripped,
        re.IGNORECASE,
    )
    if generic_priority_match:
        target = _find_task_match(generic_priority_match.group(1), tasks)
        priority = generic_priority_match.group(2).lower()
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


def _rule_based_response(payload):
    text = (payload.get("input") or "").strip()
    lowered = text.lower()
    tasks = payload.get("tasks", []) or []

    if not text:
        return {"reply": "Tell me what you'd like to do, and I'll help turn it into a clear plan.", "actions": []}

    if "optimize" in lowered or "reorganize" in lowered:
        return {
            "reply": "Nice work. I optimized your schedule and kept related locations together so the day should feel smoother.",
            "actions": [{"type": "optimize_schedule"}],
        }

    recurring_tasks = _parse_recurring_tasks(text, tasks)
    if recurring_tasks:
        return recurring_tasks

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
        high_priority = [task for task in tasks if task.get("priority") == "high" and not task.get("completed")]
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


def _safe_rule_based_response(payload):
    raw_text = (payload.get("input") or "").strip()
    text = raw_text.lower()
    tasks = payload.get("tasks", []) or []

    if not text:
        return {"reply": "Tell me what you'd like to do, and I'll help turn it into a clear plan.", "actions": []}

    recurring_tasks = _parse_recurring_tasks(raw_text, tasks)
    if recurring_tasks:
        return recurring_tasks

    if "today" in text or "priority" in text or "important" in text or "help" in text or "?" in text:
        return _rule_based_response(payload)

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


def _make_task(title, days_from_now, category, priority="medium", tags=None, tasks=None, duration=60, preferred_time=None):
    date = (datetime.now() + timedelta(days=days_from_now)).strftime("%Y-%m-%d")
    scheduled_time = _suggest_time_for_date(tasks or [], date, duration=duration, preferred_time=preferred_time)
    return {
        "title": title,
        "date": date,
        "time": scheduled_time,
        "duration": duration,
        "priority": priority,
        "tags": tags or [category],
        "completed": False,
    }


def _fit_recommendation_times(recommendations, tasks):
    synthetic_tasks = list(tasks)
    for recommendation in recommendations:
        suggested_task = recommendation.get("suggested_task")
        if not suggested_task:
            continue
        duration = suggested_task.get("duration") or 60
        current_time = suggested_task.get("time")
        suggested_task["time"] = _suggest_time_for_date(
            synthetic_tasks,
            suggested_task["date"],
            duration=duration,
            preferred_time=current_time,
        )
        synthetic_tasks.append(suggested_task)
    return recommendations


@chat_bp.route("", methods=["POST"])
@chat_bp.route("/", methods=["POST"])
@token_required
def chat():
    payload = request.get_json(silent=True) or {}
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        rule_based = _rule_based_response(payload)
        if rule_based:
            return jsonify(rule_based), 200
        return jsonify({
            "reply": "I'm having trouble reaching the live AI right now, but I can still help with planning, adding tasks, and basic schedule questions.",
            "actions": [],
        }), 200

    rule_based = _safe_rule_based_response(payload)
    if rule_based:
        return jsonify(rule_based), 200

    tasks = payload.get("tasks", []) or []
    messages = payload.get("messages", []) or []

    client = OpenAI(api_key=api_key)
    task_context = _build_task_context(tasks)
    history_context = _build_history_context(messages)
    instructions = (
        "You are an expert scheduling assistant for a task manager app. "
        "Be excellent at prioritizing, time-blocking, sequencing work, and turning vague plans into realistic next steps. "
        "Use the provided task list and conversation history as context and answer clearly and concisely. "
        "Your tone should be warm, motivating, and practical. "
        "When the user uses relative dates like today, tomorrow, or in 3 days, calculate them exactly from the provided current date. "
        "If the user asks you to add or change a plan but key details are missing, ask a short follow-up question before taking action. "
        "Examples of missing details include date, time, and location when those details matter. "
        "For add or change requests, interpret the user's actual sentence carefully and extract the best fitting task title, date, time, duration, and location from it. "
        "Do not use generic names if the user already implied a specific task name. "
        "Rewrite task titles so they are short, clean, well-capitalized, grammatically correct, and specific to the activity. "
        "Correct obvious spelling and grammar issues in any created or renamed task title. "
        "If the input mentions a place, preserve it in the location field. "
        "If the input implies a timed range like 16-17, set time to the start and duration to the difference in minutes. "
        "If the user asks to move or rename a task, return an update_task action instead of a create action. "
        "Return valid JSON with keys reply and actions. "
        "actions must be an array. "
        "Allowed action types are create_task, create_tasks, update_task, delete_task, and optimize_schedule. "
        "Only produce a create_task action when the user clearly asks to add or create a task. "
        "Use create_tasks when the user asks for a recurring plan like every Monday, every week, or similar repeated scheduling. "
        "For create_tasks, include a tasks array of concrete task objects with title, description, date, time, duration, location, priority, tags, and completed. "
        "Produce an update_task action when the user asks to reschedule, rename, reprioritize, complete, or otherwise modify an existing task. "
        "Produce a delete_task action when the user clearly asks to remove, delete, or cancel an existing task. "
        "When returning update_task, include the exact existing task_id from the provided task list. "
        "Valid update fields include title, description, date, time, duration, location, priority, tags, and completed. "
        "When returning delete_task, include the exact existing task_id from the provided task list. "
        "If you are unsure about an action, ask one concise clarification question and return no actions. "
        "If the user input is unclear or does not map cleanly to a calendar action, ask a concise follow-up question instead of guessing. "
        "If no mutation is needed, return an empty actions array."
    )
    prompt = (
        f"Current date: {datetime.now().strftime('%Y-%m-%d')}.\n"
        f"Conversation history:\n{history_context or '- No previous messages'}\n\n"
        f"Current tasks:\n{task_context if task_context else '- No tasks yet'}\n\n"
        f'User: {payload.get("input", "")}'
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
        content = completion.choices[0].message.content or "{}"
        parsed = json.loads(content)
        return jsonify({
            "reply": parsed.get("reply", "I couldn't form a reply right now."),
            "actions": parsed.get("actions", []),
        }), 200
    except Exception:
        return jsonify({
            "reply": "I'm having trouble reaching the live AI right now, but I can still help with planning, adding tasks, and basic schedule questions.",
            "actions": [],
        }), 200


@chat_bp.post("/recommendations")
@token_required
def recommendations():
    payload = request.get_json(silent=True) or {}
    tasks = payload.get("tasks", []) or []
    excluded_titles = {title.lower() for title in payload.get("exclude_titles", []) or []}
    refresh_token = str(payload.get("refresh_token", ""))

    base_pool = [
        {
            "title": "Plan family time",
            "reason": "Your schedule does not show much intentional family time right now.",
            "category": "family",
            "suggested_task": _make_task("Family time", 2, "family", tasks=tasks, duration=90, preferred_time="18:30"),
        },
        {
            "title": "Add a movement block",
            "reason": "A short workout or walk can improve energy and make the rest of the schedule feel easier.",
            "category": "sports",
            "suggested_task": _make_task("Workout session", 1, "sports", tags=["health", "sports"], tasks=tasks, duration=60, preferred_time="17:30"),
        },
        {
            "title": "Reserve reading time",
            "reason": "A small reading habit can create a calmer buffer around busy work blocks.",
            "category": "reading",
            "suggested_task": _make_task("Reading time", 3, "reading", tasks=tasks, duration=45, preferred_time="20:00"),
        },
        {
            "title": "Add a recovery break",
            "reason": "Your week may benefit from a short recovery or mindfulness block.",
            "category": "recovery",
            "suggested_task": _make_task("Mindfulness break", 1, "recovery", tags=["recovery", "health"], tasks=tasks, duration=30, preferred_time="12:30"),
        },
        {
            "title": "Plan a study session",
            "reason": "A focused learning block is missing from the current week.",
            "category": "studying",
            "suggested_task": _make_task("Study session", 2, "studying", tags=["studying", "learning"], tasks=tasks, duration=60, preferred_time="18:00"),
        },
        {
            "title": "Make time for a hobby",
            "reason": "There is room for a lower-pressure personal activity that keeps the week enjoyable.",
            "category": "hobbies",
            "suggested_task": _make_task("Hobby time", 4, "hobbies", tasks=tasks, duration=60, preferred_time="19:00"),
        },
        {
            "title": "Add a planning review",
            "reason": "A short planning check-in can keep your next few days from feeling fragmented.",
            "category": "schedule",
            "suggested_task": _make_task("Planning review", 1, "schedule", priority="high", tasks=tasks, duration=30, preferred_time="08:30"),
        },
        {
            "title": "Protect a fun block",
            "reason": "A dedicated fun activity can make the schedule feel more sustainable.",
            "category": "fun",
            "suggested_task": _make_task("Fun activity", 5, "fun", tasks=tasks, duration=90, preferred_time="19:30"),
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
    recommendations = filtered_pool[:4]

    if not recommendations:
        recommendations = [{
            "title": "Protect a planning block",
            "reason": "Your schedule is well-covered already, so a short review block can help keep it that way.",
            "category": "schedule",
            "suggested_task": _make_task("Weekly planning review", 1, "schedule", priority="high", tasks=tasks, duration=30, preferred_time="08:30"),
        }]

    api_key = os.getenv("OPENAI_API_KEY")
    if api_key:
        try:
            client = OpenAI(api_key=api_key)
            prompt = (
                f"Today is {datetime.now().strftime('%Y-%m-%d')}.\n"
                f"Current tasks:\n{_build_task_context(tasks) or '- No tasks yet'}\n"
                f"Excluded recommendation titles: {', '.join(sorted(excluded_titles)) or 'None'}.\n"
                f"Refresh token: {refresh_token or 'none'}.\n"
                "Return JSON with a recommendations array of 4 fresh ideas. "
                "Each item must include title, reason, category, and suggested_task. "
                "Avoid repeating excluded titles or near-duplicates. "
                "Choose suggested_task times that fit around the current task list when possible. "
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
            content = completion.choices[0].message.content or "{}"
            parsed = json.loads(content)
            model_recommendations = parsed.get("recommendations", [])
            if isinstance(model_recommendations, list) and model_recommendations:
                recommendations = [
                    recommendation for recommendation in model_recommendations
                    if recommendation.get("title", "").lower() not in excluded_titles
                    and (recommendation.get("suggested_task", {}) or {}).get("title", "").lower() not in excluded_titles
                ][:4] or recommendations
        except Exception:
            pass

    recommendations = _fit_recommendation_times(recommendations[:4], tasks)
    return jsonify({"recommendations": recommendations}), 200
