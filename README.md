# Taiskmaster

Taiskmaster is a task and schedule planner built with React, Vite, TypeScript, Tailwind CSS, and Flask.

## Current Status

The app currently includes:

- Task creation, editing, completion, deletion, and filtering
- Sorting by priority, date/time, and location
- Manual task dialog with date, time, duration, priority, location, and tags
- Mini calendar and daily planning layout
- Google Calendar import flow
- Rule-based schedule optimization
- Smart recommendations with categories like family, sports, hobbies, meditation, reading, studying, and fun
- Floating planning assistant with friendly scheduling-focused responses
- Online mode through the Flask backend and offline fallback mode in the frontend
- Local persistence fallback when the backend is not connected
- JWT-based authentication routes for register, login, and current-user lookup
- SQLite-backed conversation history with persisted user and assistant messages
- Structured comparative-analysis responses with prompt-technique selection

## Run Locally

### Frontend

```bash
npm install
npm run dev
```

The frontend runs on `http://localhost:8080`.

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python run.py
```

The backend runs on `http://localhost:8000`.

## Environment

Frontend:

Create `.env.local` in the project root with:

```env
VITE_API_URL=http://localhost:8000
```

Backend:

Create `backend/.env` with values like:

```env
DATABASE_URL=sqlite:///./dev.db
ALLOWED_ORIGINS=http://localhost:8080
OPENAI_API_KEY=your-provider-api-key
OPENAI_MODEL=gpt-4.1-mini
SECRET_KEY=change-this-in-production
```

If `VITE_API_URL` is not set, the frontend stays in offline mode and uses its local fallback behavior.

Example files:

- [.env.example](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/.env.example)
- [backend/.env.example](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/.env.example)

## Checks

From the project root:

```bash
npm run lint
npm test
npm run build
```

Backend health check:

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{"status":"ok"}
```

## Conversation API

The Flask backend includes a conversation-analysis API backed by SQLite. It persists data in two tables:

- `conversations`: stores the conversation title, use case, owner, and timestamps
- `messages`: stores user and assistant messages, including structured analysis output

Available endpoints:

- `POST /api/conversations/`: create a conversation
- `POST /api/conversations/<conversation_id>/messages`: add a user message, generate text, and store the assistant response
- `GET /api/conversations/`: list the current user's conversations
- `GET /api/conversations/<conversation_id>/messages`: fetch the full retained message history for one conversation

Message generation behavior:

- Supports two prompt-engineering techniques: `zero-shot` and `role-based`
- Retains the last 10 messages as conversation history for continuity
- Returns structured comparative-analysis output including efficiency score, three approaches, a recommendation, risks, and retained context
- Uses `OPENAI_API_KEY` when available and falls back to a deterministic structured response when it is not configured

Example create-conversation request:

```bash
curl -X POST http://localhost:8000/api/conversations/ \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Weekly planning","use_case":"comparative_analysis"}'
```

Example add-message request:

```bash
curl -X POST http://localhost:8000/api/conversations/CONVERSATION_ID/messages \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"Compare three ways to organize my weekly tasks.","prompt_technique":"role-based"}'
```

## Assistant Notes

- The floating assistant can add tasks, optimize the schedule, answer planning questions, and use a warmer scheduling-coach tone.
- Auth routes live at `/api/auth/register`, `/api/auth/login`, and `/api/auth/me`.
- Conversation-analysis routes live at `/api/conversations/`.
- Relative date phrases like `tomorrow` and `in 3 days` are supported in task-creation flows.

## Key Files

- [src/components/AssistantPanel.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/AssistantPanel.tsx): floating assistant UI and frontend fallback behavior
- [src/components/TaskCard.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/TaskCard.tsx): task card UI
- [src/components/TaskDialog.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/TaskDialog.tsx): task create/edit dialog
- [src/lib/taskStore.ts](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/lib/taskStore.ts): task state, persistence, sorting, and schedule optimization
- [src/pages/Index.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/pages/Index.tsx): main planner page and recommendation panel
- [backend/app/main.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/main.py): Flask app setup and route registration
- [backend/app/auth.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/auth.py): auth and JWT endpoints
- [backend/app/conversation_api.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/conversation_api.py): conversation CRUD, text generation, structured comparative analysis, and history retention
- [backend/app/models.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/models.py): SQLite models for users, tasks, conversations, and messages
