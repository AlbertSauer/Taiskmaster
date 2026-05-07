# Taiskmaster

Taiskmaster is a React, Vite, TypeScript, Tailwind CSS, and Flask task planner with a daily dashboard, mini calendar, AI-assisted scheduling, and local/offline fallback behavior.

## Features

- Task creation, editing, completion, deletion, filtering, and calendar clearing
- Dashboard loads with today's tasks selected
- Mini calendar and dashboard automatically refresh after task changes
- Five priority levels: `very-low`, `low`, `medium`, `high`, and `urgent`
- Sorting by priority, date/time, and location
- Google Calendar `.ics` import
- Header actions for `New task`, `Optimize`, and `Options` (profile, theme, import, done tasks, activity scores, logout)
- Rule-based + AI-backed schedule optimization
- Recommendations opened in a dedicated dialog, refreshable, and openable as prefilled draft tasks
- Floating assistant that can create tasks, recurring plans, updates, deletions, and optimized schedules
- AI-created single tasks use the backend model when configured, then open as prefilled drafts with a fitting priority and compact description
- Life window card for ongoing/upcoming plans with relative countdown (`Starts in` / `Ends in`) and next-up preview during ongoing events
- Activity insights with manual generation button, compact graphs, score `/100`, and per-user score history
- Activity score retention keeps only the newest snapshot per user per day
- JWT authentication with SQLite-backed users, tasks, conversations, and messages
- Frontend local-storage fallback when the backend is unavailable

## Run Locally

Install frontend dependencies:

```bash
npm install
```

Start the frontend:

```bash
npm run dev
```

The frontend runs on `http://localhost:8080`.

Start the backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python run.py
```

The backend runs on `http://localhost:8000`.

## Environment

Create `.env.local` in the project root:

```env
VITE_API_URL=http://localhost:8000
```

Create `backend/.env`:

```env
DATABASE_URL=sqlite:///./dev.db
ALLOWED_ORIGINS=http://localhost:8080
OPENAI_API_KEY=your-provider-api-key
OPENAI_MODEL=gpt-4.1-mini
SECRET_KEY=change-this-in-production
```

If `VITE_API_URL` is not set, the frontend uses local storage and its offline assistant fallback.

## Checks

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

## Key Files

- [src/pages/Index.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/pages/Index.tsx): dashboard, recommendations, task list, and dialogs
- [src/components/Header.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/Header.tsx): top navigation and options menu actions
- [src/lib/taskStore.ts](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/lib/taskStore.ts): task persistence, shared refresh state, sorting, and optimization
- [src/components/AssistantPanel.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/AssistantPanel.tsx): floating assistant and frontend fallback parsing
- [src/components/AppErrorBoundary.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/AppErrorBoundary.tsx): runtime crash fallback UI
- [src/components/TaskDialog.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/TaskDialog.tsx): task create/edit form
- [src/components/TaskCard.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/TaskCard.tsx): task display and actions
- [src/components/MiniCalendar.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/MiniCalendar.tsx): calendar summary and selected-day task preview
- [backend/app/chat_api.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/chat_api.py): assistant and recommendation API
- [backend/app/tasks_api.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/tasks_api.py): task CRUD API
- [backend/app/auth.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/auth.py): authentication API
- [backend/app/models.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/models.py): SQLite models
