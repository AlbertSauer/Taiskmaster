# Taiskmaster

Taiskmaster is a React + Vite + TypeScript + Tailwind frontend with a Flask backend for AI-assisted planning, routine building, and calendar-based task management.

## Current Features

- Daily dashboard with:
  - today-focused task view (default),
  - date picker filter + text search,
  - task cards showing time ranges (`from - to`),
  - live window (ongoing/upcoming + countdown + next-up preview),
  - compact `Act score` with hover explanation and score-based color.
- Direct task interactions:
  - click a task block to edit,
  - one-click icon delete,
  - quick complete toggle.
- Smart assistant + recommendations:
  - AI/logic-assisted create/update/delete/recurring plans,
  - preview-before-save flows.
- Smart Routine:
  - work + personal routine questionnaire,
  - preview and edit before save,
  - saved routine profiles reusable from `Options -> Profile -> Profile tools`.
- Smart Statistics:
  - calendar workload and category charts,
  - free time shown in the category pie,
  - activity score trend,
  - grouped calendar movement showing how many times the same task was added,
  - AI API cost totals, daily cost chart, and cost by feature.
- Work schedule protections:
  - routine generation enforces work coverage for selected workdays,
  - work segments split around breaks (e.g. `09:00-12:00`, break, `12:30-17:00`),
  - optimize cannot move locked `Work Hours` / `Work Break` entries.
- Activity insights:
  - score out of `100`,
  - daily retention keeps only newest score per day,
  - score history in Profile tools.
- Header UX:
  - top-left icon opens section switcher:
    `Dashboard`, `Smart Routine`, `Smart Vacation`, `Smart Statistics`,
  - top nav buttons removed,
  - Profile tools group calendar import, calendar deletion, activity scores, task history, and routines.
- Interface options:
  - dark/light mode,
  - color styles grouped under `Interface -> Colors`,
  - phone-safe options menu layout.
- Data and auth:
  - JWT auth,
  - SQLite models for users/tasks/messages/activity scores/routine profiles/history/AI usage.
- AI usage tracking:
  - authenticated OpenAI calls record prompt/completion tokens when the provider returns usage,
  - estimated costs are based on built-in model pricing,
  - override pricing with `OPENAI_INPUT_COST_PER_1M` and `OPENAI_OUTPUT_COST_PER_1M` when needed.

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
OPENAI_INPUT_COST_PER_1M=0.40
OPENAI_OUTPUT_COST_PER_1M=1.60
SECRET_KEY=change-this-in-production
```

If `VITE_API_URL` is not set, the frontend falls back to local storage.
The cost override variables are optional; omit them to use the built-in pricing table.

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

- [src/pages/Index.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/pages/Index.tsx): dashboard, optimize preview, recommendations dialog, activity dialogs
- [src/pages/SmartRoutine.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/pages/SmartRoutine.tsx): routine questionnaire + preview/save flow
- [src/pages/SmartStatistics.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/pages/SmartStatistics.tsx): calendar/task/activity/AI cost statistics
- [src/components/Header.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/Header.tsx): icon-based section switcher + options menu
- [src/components/MiniCalendar.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/MiniCalendar.tsx): dashboard mini-calendar and compact selected-day task summary
- [src/components/TaskCard.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/TaskCard.tsx): clickable task blocks, time ranges, direct delete
- [src/lib/taskStore.ts](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/lib/taskStore.ts): shared task state, auto-tags, local optimization rules
- [backend/app/ai_usage.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/ai_usage.py): token usage capture and estimated API cost summaries
- [backend/app/chat_api.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/chat_api.py): AI endpoints (assistant/recommendations/optimize/routine/insights) and guard rails
- [backend/app/tasks_api.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/tasks_api.py): task CRUD + history
- [backend/app/models.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/models.py): DB models (`Task`, `TaskHistory`, `ActivityScore`, `RoutineProfile`, `AIUsage`, etc.)
