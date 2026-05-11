import os
from flask import Flask
from flask_cors import CORS

from app.env import load_app_env

load_app_env()

# Initialize Flask app
app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv("DATABASE_URL", "sqlite:///./dev.db")
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Initialize database
from app.models import db
db.init_app(app)

def get_allowed_origins():
    origins = {
        origin.strip()
        for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080").split(",")
        if origin.strip()
    }
    if "http://localhost:8080" in origins:
        origins.add("http://127.0.0.1:8080")
    if "http://127.0.0.1:8080" in origins:
        origins.add("http://localhost:8080")
    return sorted(origins)

# Configure CORS
CORS(app, resources={
    r"/api/*": {
        "origins": get_allowed_origins(),
        "methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

# Import models to ensure they are registered
from app.models import User, Task, Conversation, Message, ActivityScore, TaskHistory, RoutineProfile, AIUsage

# Create all tables
with app.app_context():
    db.create_all()

# Import and register blueprints
from app.auth import auth_bp
from app.chat_api import chat_bp
from app.conversation_api import conversation_bp
from app.tasks_api import tasks_bp

app.register_blueprint(auth_bp, url_prefix="/api/auth")
app.register_blueprint(chat_bp, url_prefix="/api/chat")
app.register_blueprint(conversation_bp, url_prefix="/api/conversations")
app.register_blueprint(tasks_bp, url_prefix="/api/tasks")


@app.get("/")
def root():
    return {"message": "Welcome to Taiskmaster API. Efficient task management powered by AI."}


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8000)
