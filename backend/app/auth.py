from flask import Blueprint, request, jsonify
from datetime import timedelta
import uuid
from functools import wraps

auth_bp = Blueprint('auth', __name__)

def get_models():
    from app.models import User, db
    from app.security import verify_password, get_password_hash, create_access_token, decode_access_token
    return User, db, verify_password, get_password_hash, create_access_token, decode_access_token

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(" ")[1]
            except IndexError:
                return jsonify({"detail": "Invalid authorization header"}), 401

        if not token:
            return jsonify({"detail": "Token is missing"}), 401

        User, db, _, _, _, decode_access_token = get_models()
        token_data = decode_access_token(token)
        if token_data is None:
            return jsonify({"detail": "Invalid token"}), 401

        user = db.session.query(User).filter(User.username == token_data.username).first()
        if user is None:
            return jsonify({"detail": "User not found"}), 401

        request.current_user = user
        return f(*args, **kwargs)

    return decorated


@auth_bp.post('/register')
def register():
    """Register a new user."""
    data = request.get_json()
    
    if not data:
        return jsonify({"detail": "Request body is required"}), 400
    
    email = data.get('email')
    username = data.get('username')
    password = data.get('password')
    full_name = data.get('full_name')

    if not all([email, username, password]):
        return jsonify({"detail": "Email, username, and password are required"}), 400

    User, db, _, get_password_hash, create_access_token, _ = get_models()

    # Check if user already exists
    existing_user = db.session.query(User).filter(
        (User.email == email) | (User.username == username)
    ).first()

    if existing_user:
        return jsonify({"detail": "Email or username already registered"}), 400

    # Create new user
    hashed_password = get_password_hash(password)
    new_user = User(
        id=str(uuid.uuid4()),
        email=email,
        username=username,
        hashed_password=hashed_password,
        full_name=full_name,
    )

    db.session.add(new_user)
    db.session.commit()

    # Create access token
    access_token_expires = timedelta(days=7)
    access_token = create_access_token(
        data={"sub": new_user.username}, expires_delta=access_token_expires
    )

    return jsonify({"access_token": access_token, "token_type": "bearer"}), 201


@auth_bp.post('/login')
def login():
    """Login a user and return a JWT token."""
    data = request.get_json()

    if not data:
        return jsonify({"detail": "Request body is required"}), 400

    username = data.get('username')
    password = data.get('password')

    if not all([username, password]):
        return jsonify({"detail": "Username and password are required"}), 400

    User, db, verify_password, _, create_access_token, _ = get_models()

    # Find user by username
    user = db.session.query(User).filter(User.username == username).first()

    if not user or not verify_password(password, user.hashed_password):
        return jsonify({"detail": "Incorrect username or password"}), 401

    if not user.is_active:
        return jsonify({"detail": "User account is inactive"}), 403

    # Create access token
    access_token_expires = timedelta(days=7)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )

    return jsonify({"access_token": access_token, "token_type": "bearer"}), 200


@auth_bp.get('/me')
@token_required
def get_current_user():
    """Get current user information."""
    user = request.current_user
    return jsonify({
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "full_name": user.full_name,
        "is_active": user.is_active,
        "created_at": user.created_at.isoformat()
    }), 200


@auth_bp.patch('/me')
@token_required
def update_current_user():
    """Update current user profile settings."""
    data = request.get_json() or {}
    user = request.current_user

    User, db, _, get_password_hash, create_access_token, _ = get_models()

    email = data.get("email")
    username = data.get("username")
    full_name = data.get("full_name")
    password = data.get("password")

    if email is not None:
        email = str(email).strip()
        if not email:
            return jsonify({"detail": "Email cannot be empty"}), 400
        existing = db.session.query(User).filter((User.email == email) & (User.id != user.id)).first()
        if existing:
            return jsonify({"detail": "Email already in use"}), 400
        user.email = email

    if username is not None:
        username = str(username).strip()
        if len(username) < 3:
            return jsonify({"detail": "Username must be at least 3 characters"}), 400
        existing = db.session.query(User).filter((User.username == username) & (User.id != user.id)).first()
        if existing:
            return jsonify({"detail": "Username already in use"}), 400
        user.username = username

    if full_name is not None:
        cleaned_name = str(full_name).strip()
        user.full_name = cleaned_name or None

    if password is not None:
        password = str(password)
        if len(password) < 8:
            return jsonify({"detail": "Password must be at least 8 characters"}), 400
        user.hashed_password = get_password_hash(password)

    db.session.commit()

    access_token_expires = timedelta(days=7)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )

    return jsonify({
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "username": user.username,
            "full_name": user.full_name,
            "is_active": user.is_active,
            "created_at": user.created_at.isoformat(),
        }
    }), 200
