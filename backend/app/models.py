import uuid
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

# Create the db instance (will be properly initialized in main.py)
db = SQLAlchemy()


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    username = db.Column(db.String(255), unique=True, nullable=False, index=True)
    hashed_password = db.Column(db.String(255), nullable=False)
    full_name = db.Column(db.String(255), nullable=True)
    openai_api_key = db.Column(db.Text, nullable=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    conversations = db.relationship('Conversation', back_populates='user', cascade='all, delete-orphan')
    activity_scores = db.relationship('ActivityScore', back_populates='user', cascade='all, delete-orphan')
    task_history = db.relationship('TaskHistory', back_populates='user', cascade='all, delete-orphan')
    routine_profiles = db.relationship('RoutineProfile', back_populates='user', cascade='all, delete-orphan')
    ai_usage = db.relationship('AIUsage', back_populates='user', cascade='all, delete-orphan')


class Task(db.Model):
    __tablename__ = "tasks"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    note = db.Column(db.Text, nullable=True)
    date = db.Column(db.String(255), nullable=False)
    time = db.Column(db.String(255), nullable=True)
    duration = db.Column(db.Integer, nullable=True)
    location = db.Column(db.String(255), nullable=True)
    priority = db.Column(db.String(255), nullable=False)
    tags = db.Column(db.JSON, nullable=False, default=list)
    completed = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class Conversation(db.Model):
    __tablename__ = "conversations"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    title = db.Column(db.String(255), nullable=False)
    use_case = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    user = db.relationship('User', back_populates='conversations')
    messages = db.relationship('Message', back_populates='conversation', cascade='all, delete-orphan')


class Message(db.Model):
    __tablename__ = "messages"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = db.Column(db.String(36), db.ForeignKey("conversations.id"), nullable=False, index=True)
    role = db.Column(db.String(50), nullable=False)
    content = db.Column(db.Text, nullable=False)
    analysis_data = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    conversation = db.relationship('Conversation', back_populates='messages')


class ActivityScore(db.Model):
    __tablename__ = "activity_scores"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    health_score = db.Column(db.Integer, nullable=False)
    status = db.Column(db.String(50), nullable=False)
    summary = db.Column(db.Text, nullable=False)
    guidance = db.Column(db.JSON, nullable=False, default=list)
    graphs = db.Column(db.JSON, nullable=False, default=dict)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    user = db.relationship('User', back_populates='activity_scores')


class TaskHistory(db.Model):
    __tablename__ = "task_history"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    task_id = db.Column(db.String(36), nullable=False, index=True)
    action = db.Column(db.String(20), nullable=False)  # created | updated | deleted
    title = db.Column(db.String(255), nullable=False)
    snapshot = db.Column(db.JSON, nullable=False, default=dict)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    user = db.relationship('User', back_populates='task_history')


class RoutineProfile(db.Model):
    __tablename__ = "routine_profiles"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    name = db.Column(db.String(255), nullable=False)
    end_date = db.Column(db.String(10), nullable=False)
    questionnaire = db.Column(db.JSON, nullable=False, default=dict)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    user = db.relationship('User', back_populates='routine_profiles')


class AIUsage(db.Model):
    __tablename__ = "ai_usage"

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False, index=True)
    feature = db.Column(db.String(80), nullable=False, default="assistant")
    model = db.Column(db.String(120), nullable=False)
    prompt_tokens = db.Column(db.Integer, nullable=False, default=0)
    completion_tokens = db.Column(db.Integer, nullable=False, default=0)
    total_tokens = db.Column(db.Integer, nullable=False, default=0)
    estimated_cost_usd = db.Column(db.Float, nullable=False, default=0.0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    user = db.relationship('User', back_populates='ai_usage')
