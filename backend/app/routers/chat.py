import re
from datetime import datetime, timedelta
from typing import Any, List, Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field
router = APIRouter()


class ChatTask(BaseModel):
    id: Optional[str] = None
    title: str
    description: Optional[str] = None
    date: str
    time: Optional[str] = None
    duration: Optional[int] = None
    location: Optional[str] = None
    priority: Optional[str] = "medium"
    tags: List[str] = Field(default_factory=list)
    completed: bool = False


class ChatPayload(BaseModel):
    input: str
    tasks: List[ChatTask] = Field(default_factory=list)


class ChatAction(BaseModel):
    type: Literal["create_task", "update_task", "optimize_schedule"]
    task: Optional[ChatTask] = None
    task_id: Optional[str] = None
    updates: Optional[dict[str, Any]] = None


class ChatResponse(BaseModel):
    reply: str
    actions: List[ChatAction] = Field(default_factory=list)


class Recommendation(BaseModel):
    title: str
    reason: str
    category: Literal[
        "schedule",
        "family",
        "sports",
        "health",
        "recovery",
        "personal",
        "hobbies",
        "meditation",
        "reading",
        "studying",
        "fun",
    ]
    suggested_task: Optional[ChatTask] = None


class RecommendationResponse(BaseModel):
    recommendations: List[Recommendation] = Field(default_factory=list)


def _parse_time(text: str) -> Optional[str]:
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


def _parse_relative_date(text: str) -> str:
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


def _parse_new_task(text: str) -> Optional[ChatTask]:
    if not re.match(r"^(add|create|new task|schedule|plan)\b", text, re.IGNORECASE):
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

    return ChatTask(
        title=(title or "New task").title(),
        date=_parse_relative_date(cleaned),
        time=time,
        priority="high" if re.search(r"\b(urgent|asap|high)\b", cleaned, re.IGNORECASE) else "medium",
    )


def _find_task_match(query: str, tasks: List[ChatTask]) -> Optional[ChatTask]:
    lowered = query.strip().lower()
    if not lowered:
        return None

    for task in tasks:
        if task.id and task.id.lower() == lowered:
            return task

    for task in tasks:
        if task.title.lower() == lowered:
            return task

    for task in tasks:
        if lowered in task.title.lower():
            return task

    return None


def _parse_completion(text: str, tasks: List[ChatTask]) -> Optional[tuple[ChatTask, str]]:
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

    return target, f'Marked "{target.title}" as complete.'


def _rule_based_response(payload: ChatPayload) -> Optional[ChatResponse]:
    text = payload.input.strip()
    lowered = text.lower()

    if not text:
        return ChatResponse(reply="Tell me what you'd like to do, and I'll help you turn it into a clear plan.")

    if "optimize" in lowered or "reorganize" in lowered:
        return ChatResponse(
            reply="Nice work. I optimized your schedule and kept related locations together so the day should feel smoother.",
            actions=[ChatAction(type="optimize_schedule")],
        )

    new_task = _parse_new_task(text)
    if new_task:
        return ChatResponse(
            reply=f'Added "{new_task.title}"{f" at {new_task.time}" if new_task.time else ""}. You are making steady progress.',
            actions=[ChatAction(type="create_task", task=new_task)],
        )

    completion = _parse_completion(text, payload.tasks)
    if completion:
        task, reply = completion
        return ChatResponse(
            reply=reply,
            actions=[ChatAction(type="update_task", task_id=task.id, updates={"completed": True})],
        )

    if "today" in lowered:
        today = datetime.now().strftime("%Y-%m-%d")
        today_tasks = [task for task in payload.tasks if task.date == today and not task.completed]
        if not today_tasks:
            return ChatResponse(reply="Nothing is scheduled for today yet, which gives us a nice clean slate to work with.")

        lines = [
            f"{task.time} - {task.title}" if task.time else task.title
            for task in today_tasks
        ]
        return ChatResponse(
            reply=f"You have {len(today_tasks)} task{'s' if len(today_tasks) != 1 else ''} today. Here's the plan:\n" + "\n".join(lines)
        )

    if "priority" in lowered or "important" in lowered:
        high_priority = [task for task in payload.tasks if task.priority == "high" and not task.completed]
        if not high_priority:
            return ChatResponse(reply="You don't have any high-priority items right now, which is a great place to be.")

        return ChatResponse(
            reply="Here are your high-priority items:\n" + "\n".join(
                f"{task.title} - {task.date}" for task in high_priority
            )
        )

    if "help" in lowered or "?" in lowered:
        return ChatResponse(
            reply=(
                "I can help you stay organized and keep momentum:\n"
                "- Review what's on today\n"
                "- Add a new task\n"
                "- Optimize your schedule\n"
                "- Highlight your priorities"
            )
        )

    return None


def _build_task_context(tasks: List[ChatTask]) -> str:
    return "\n".join(
        f"- [{task.id or 'no-id'}] {task.title} on {task.date}"
        f"{(' at ' + task.time) if task.time else ''}"
        f"{(' in ' + task.location) if task.location else ''}"
        f"{' (completed)' if task.completed else ''}"
        for task in tasks
    )


def _recommendation_fallback(tasks: List[ChatTask]) -> RecommendationResponse:
    recommendations: List[Recommendation] = []
    lowered_tags = {tag.lower() for task in tasks for tag in (task.tags or [])}
    lowered_titles = " ".join(task.title.lower() for task in tasks)
    lowered_descriptions = " ".join((task.description or "").lower() for task in tasks)
    combined_text = f"{lowered_titles} {lowered_descriptions}".strip()
    today = datetime.now()

    def has_any(keywords: List[str]) -> bool:
        return any(keyword in lowered_tags or keyword in combined_text for keyword in keywords)

    if "family" not in lowered_tags and "family" not in lowered_titles:
        recommendations.append(
            Recommendation(
                title="Plan family time this week",
                reason="Your current calendar looks light on intentional family plans, which can get crowded out by work and errands.",
                category="family",
                suggested_task=ChatTask(
                    title="Family time",
                    date=(today + timedelta(days=2)).strftime("%Y-%m-%d"),
                    time="18:30",
                    priority="medium",
                    tags=["family"],
                ),
            )
        )

    if not any(word in combined_text for word in ["sport", "gym", "run", "workout", "training", "football", "tennis", "swim", "bike"]):
        recommendations.append(
            Recommendation(
                title="Add a sports or movement session",
                reason="There is no obvious exercise block in the current schedule, so adding one can help energy and consistency.",
                category="sports",
                suggested_task=ChatTask(
                    title="Workout or sports session",
                    date=(today + timedelta(days=1)).strftime("%Y-%m-%d"),
                    time="19:00",
                    priority="medium",
                    tags=["sports", "health"],
                ),
            )
        )

    if len(recommendations) < 4 and not has_any(["hobby", "hobbies", "craft", "music", "art", "photography", "gaming", "creative"]):
        recommendations.append(
            Recommendation(
                title="Make space for a hobby",
                reason="Your schedule looks practical, but it could use a dedicated block for something you enjoy doing just for yourself.",
                category="hobbies",
                suggested_task=ChatTask(
                    title="Hobby time",
                    date=(today + timedelta(days=3)).strftime("%Y-%m-%d"),
                    time="18:00",
                    priority="low",
                    tags=["hobbies", "personal"],
                ),
            )
        )

    if len(recommendations) < 4 and not has_any(["meditation", "mindfulness", "breathing", "journal", "journaling"]):
        recommendations.append(
            Recommendation(
                title="Add a short meditation break",
                reason="A brief mindfulness block can create a cleaner reset point between busy parts of the day.",
                category="meditation",
                suggested_task=ChatTask(
                    title="Meditation break",
                    date=(today + timedelta(days=1)).strftime("%Y-%m-%d"),
                    time="07:30",
                    duration=15,
                    priority="low",
                    tags=["meditation", "health"],
                ),
            )
        )

    if len(recommendations) < 4 and not has_any(["read", "reading", "book", "novel"]):
        recommendations.append(
            Recommendation(
                title="Reserve some reading time",
                reason="There is room to add a calmer activity that helps you slow down and recharge without more screen time.",
                category="reading",
                suggested_task=ChatTask(
                    title="Reading session",
                    date=(today + timedelta(days=2)).strftime("%Y-%m-%d"),
                    time="20:30",
                    duration=30,
                    priority="low",
                    tags=["reading", "recovery"],
                ),
            )
        )

    if len(recommendations) < 4 and not has_any(["study", "studying", "course", "lesson", "learning", "practice"]):
        recommendations.append(
            Recommendation(
                title="Set aside focused study time",
                reason="A recurring learning block can help you make progress on skills that usually get postponed.",
                category="studying",
                suggested_task=ChatTask(
                    title="Study session",
                    date=(today + timedelta(days=2)).strftime("%Y-%m-%d"),
                    time="17:30",
                    duration=45,
                    priority="medium",
                    tags=["studying", "learning"],
                ),
            )
        )

    if len(recommendations) < 4 and not has_any(["fun", "friends", "social", "movie", "game", "concert", "outing"]):
        recommendations.append(
            Recommendation(
                title="Plan one fun activity",
                reason="Your calendar covers responsibilities, but adding something purely enjoyable can make the week feel more sustainable.",
                category="fun",
                suggested_task=ChatTask(
                    title="Fun activity",
                    date=(today + timedelta(days=4)).strftime("%Y-%m-%d"),
                    time="19:30",
                    priority="low",
                    tags=["fun", "personal"],
                ),
            )
        )

    if not recommendations:
        recommendations.append(
            Recommendation(
                title="Protect a recovery block",
                reason="Your schedule already covers core commitments, so the best next recommendation is a small buffer for rest or unplanned work.",
                category="recovery",
                suggested_task=ChatTask(
                    title="Recovery buffer",
                    date=(today + timedelta(days=1)).strftime("%Y-%m-%d"),
                    time="20:00",
                    priority="low",
                    tags=["recovery"],
                ),
            )
        )

    return RecommendationResponse(recommendations=recommendations[:4])


@router.post("/", response_model=ChatResponse)
def chat(payload: ChatPayload):
    rule_based = _rule_based_response(payload)
    if rule_based:
        return rule_based

    return ChatResponse(
        reply="Add an API key in Profile options to enable live AI. I can still help with planning, adding tasks, and basic schedule questions."
    )


@router.post("/recommendations", response_model=RecommendationResponse)
def recommendations(payload: ChatPayload):
    return _recommendation_fallback(payload.tasks)
