# Authentication API Documentation

## Overview
The Taiskmaster application now includes JWT-based authentication with user registration and login capabilities.

## Endpoints

### Register a New User
**POST** `/api/auth/register`

Request body:
```json
{
  "email": "user@example.com",
  "username": "username",
  "password": "securepassword123",
  "full_name": "John Doe"  // optional
}
```

Response (200 OK):
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer"
}
```

### Login
**POST** `/api/auth/login`

Request body:
```json
{
  "username": "username",
  "password": "securepassword123"
}
```

Response (200 OK):
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer"
}
```

### Get Current User Info
**GET** `/api/auth/me`

Headers:
```
Authorization: Bearer {access_token}
```

Response (200 OK):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "username": "username",
  "full_name": "John Doe",
  "is_active": true,
  "created_at": "2026-05-03T12:00:00"
}
```

## Frontend Usage

### Using the Auth Hook
```tsx
import { useAuth } from "@/hooks/useAuth";

function MyComponent() {
  const { user, login, register, logout, isAuthenticated, isLoading } = useAuth();

  const handleLogin = async () => {
    try {
      await login("username", "password");
      // User is now logged in
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleRegister = async () => {
    try {
      await register("email@example.com", "username", "password", "Full Name");
      // User is now registered and logged in
    } catch (error) {
      console.error("Registration failed:", error);
    }
  };

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      {isAuthenticated ? (
        <div>
          <p>Welcome, {user?.username}!</p>
          <button onClick={logout}>Logout</button>
        </div>
      ) : (
        <p>Please log in</p>
      )}
    </div>
  );
}
```

### Protected Routes
Routes are automatically protected by the `ProtectedRoute` component. Unauthenticated users are redirected to the login page.

## Configuration

### Backend
- **SECRET_KEY**: Set in `.env` file (used for JWT signing)
- **ACCESS_TOKEN_EXPIRE_MINUTES**: Set to 30 minutes (configurable in `app/security.py`)

### Frontend
- **VITE_API_URL**: Set in `.env.local` (default: http://localhost:8000)

## Token Storage
- Access tokens are stored in browser localStorage under the key `authToken`
- Tokens are automatically included in API requests via the `Authorization` header
- Tokens are cleared on logout

## Password Requirements
- Minimum 8 characters
- Hashed with bcrypt before storage
- Never stored in plain text

## Security Considerations
- Always use HTTPS in production
- Rotate SECRET_KEY periodically
- Consider implementing token refresh mechanism for long-lived sessions
- Implement rate limiting on auth endpoints to prevent brute force attacks
