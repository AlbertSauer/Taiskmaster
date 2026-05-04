import uuid

from flask import Blueprint, jsonify, request
from pydantic import ValidationError

from app.auth import token_required
from app.schemas import TaskCreate, TaskUpdate

tasks_bp = Blueprint("tasks", __name__)


def get_models():
    from app.models import Task, db

    return Task, db


def parse_body(schema_cls):
    payload = request.get_json(silent=True)
    if payload is None:
        return None, (jsonify({"detail": "Request body must be valid JSON"}), 400)

    try:
        return schema_cls.model_validate(payload), None
    except ValidationError as exc:
        return None, (jsonify({"detail": "Validation failed", "errors": exc.errors()}), 400)


def serialize_task(task):
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "date": task.date,
        "time": task.time,
        "duration": task.duration,
        "location": task.location,
        "priority": task.priority,
        "tags": task.tags or [],
        "completed": task.completed,
        "created_at": task.created_at.isoformat(),
    }


@tasks_bp.route("", methods=["GET"])
@tasks_bp.route("/", methods=["GET"])
@token_required
def list_tasks():
    Task, db = get_models()
    tasks = db.session.query(Task).filter(
        Task.user_id == request.current_user.id
    ).order_by(Task.created_at.asc()).all()
    return jsonify([serialize_task(task) for task in tasks]), 200


@tasks_bp.route("", methods=["POST"])
@tasks_bp.route("/", methods=["POST"])
@token_required
def create_task():
    task_input, error_response = parse_body(TaskCreate)
    if error_response:
        return error_response

    Task, db = get_models()
    task = Task(
        id=str(uuid.uuid4()),
        user_id=request.current_user.id,
        title=task_input.title,
        description=task_input.description,
        date=task_input.date,
        time=task_input.time,
        duration=task_input.duration,
        location=task_input.location,
        priority=task_input.priority,
        tags=task_input.tags,
        completed=task_input.completed,
    )
    db.session.add(task)
    db.session.commit()
    return jsonify(serialize_task(task)), 201


@tasks_bp.patch("/<task_id>")
@token_required
def update_task(task_id):
    task_input, error_response = parse_body(TaskUpdate)
    if error_response:
        return error_response

    Task, db = get_models()
    task = db.session.query(Task).filter(
        (Task.id == task_id) & (Task.user_id == request.current_user.id)
    ).first()
    if not task:
        return jsonify({"detail": "Task not found"}), 404

    update_data = task_input.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(task, field, value)

    db.session.commit()
    return jsonify(serialize_task(task)), 200


@tasks_bp.delete("/<task_id>")
@token_required
def delete_task(task_id):
    Task, db = get_models()
    task = db.session.query(Task).filter(
        (Task.id == task_id) & (Task.user_id == request.current_user.id)
    ).first()
    if not task:
        return jsonify({"detail": "Task not found"}), 404

    db.session.delete(task)
    db.session.commit()
    return ("", 204)
