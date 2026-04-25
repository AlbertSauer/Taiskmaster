# Taiskmaster

Taiskmaster is a task and schedule planner built with React, Vite, TypeScript, Tailwind CSS, and FastAPI.

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
- Online mode through the FastAPI backend and offline fallback mode in the frontend
- Local persistence fallback when the backend is not connected

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
uvicorn app.main:app --reload --port 8000
```

The backend runs on `http://localhost:8000`.

You can view the API documentation at `http://localhost:8000/docs`.

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

## Assistant Notes

- The floating assistant can add tasks, optimize the schedule, answer planning questions, and use a warmer scheduling-coach tone.
- The backend chat route lives at `/api/chat`.
- Recommendation generation lives at `/api/chat/recommendations`.
- Relative date phrases like `tomorrow` and `in 3 days` are supported in task-creation flows.

## Key Files

- [src/components/AssistantPanel.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/AssistantPanel.tsx): floating assistant UI and frontend fallback behavior
- [src/components/TaskCard.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/TaskCard.tsx): task card UI
- [src/components/TaskDialog.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/TaskDialog.tsx): task create/edit dialog
- [src/lib/taskStore.ts](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/lib/taskStore.ts): task state, persistence, sorting, and schedule optimization
- [src/pages/Index.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/pages/Index.tsx): main planner page and recommendation panel
- [backend/app/main.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/main.py): FastAPI app setup
- [backend/app/routers/tasks.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/routers/tasks.py): task CRUD API
- [backend/app/routers/chat.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/routers/chat.py): chat and recommendation endpoints
