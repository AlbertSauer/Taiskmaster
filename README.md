# Taiskmaster

Taiskmaster is a React + Vite + TypeScript + Tailwind frontend with a Flask backend for AI-assisted planning, routine building, and calendar-based task management.

## Current Features

- Daily dashboard with:
  - today-focused task view (default),
  - date picker filter + broad text search across title, description, notes, tags, date, priority, status, time, and location,
  - switchable task display: card/block view or compact list view,
  - task cards showing time ranges (`from - to`),
  - separate task notes below descriptions,
  - live window (ongoing/upcoming + countdown + next-up preview),
  - selected-day summary under the mini calendar,
  - one-click `Mark day done` for already-past selected days,
  - compact `Act score` with hover explanation and score-based color.
- Direct task interactions:
  - click a task block to edit,
  - description + note fields in task creation/editing,
  - one-click icon delete,
  - quick complete toggle.
- Smart assistant + recommendations:
  - AI/logic-assisted create/update/delete/recurring plans,
  - preview-before-save flows,
  - manager-style commands for opening profile/options, histories, routines, calendar import, and smart pages,
  - scoped optimize commands (`optimize today`, `optimize Friday`, or choose a timeframe from the optimize dialog),
  - normal-day planning based on recurring calendar patterns, with preview before save,
  - note-taking commands that find the best matching task and open a preview before saving the note,
  - calendar Q&A for day agendas, workload summaries, overdue/open/completed counts, and free-time checks,
  - bulk date actions such as deleting all tasks for a date,
  - weather forecast answers by city or browser location using Open-Meteo,
  - recommendation filtering that avoids overlapping existing calendar tasks.
- Smart Routine:
  - work + personal routine questionnaire,
  - preferred workout time for generated workout sessions,
  - work hours are represented only by configured `Work Hours` / `Work Break` blocks,
  - overnight `Sleep` tasks are generated from sleep time to wake time so sleep appears in activity views,
  - preview and edit before save,
  - saved routine profiles reusable from `Options -> Profile -> Profile tools`,
  - searchable saved routine list.
- Smart Statistics:
  - selectable timeframe: 1 day, 1 week, 1 month, or 1 year,
  - calendar workload and category charts,
  - category chart includes a side legend showing which color represents each task category,
  - free time shown in the category pie (green) and work shown in black,
  - activity score trend,
  - grouped calendar movement showing how many times the same task was added,
  - AI API cost totals, daily cost chart, and cost by feature.
- Work schedule protections:
  - routine generation enforces work coverage for selected workdays,
  - work segments split around breaks (e.g. `09:00-12:00`, break, `12:30-17:00`),
  - optimize cannot move locked `Work Hours` / `Work Break` entries,
  - task creation, assistant plans, imported events, recommendations, routine generation, and optimize all avoid protected work time when possible,
  - if no safe non-work slot exists, the app warns before saving.
- Smart schedule optimization:
  - asks which day or timeframe to optimize before running from the main button,
  - supports today, tomorrow, selected day, custom day, next 7 days, custom range, or whole calendar,
  - intelligently reschedules future and today's tasks to minimize travel time,
  - preserves all past tasks and their original scheduling,
  - groups tasks by location and optimizes within each group,
  - prioritizes high-priority tasks in the morning,
  - detects and warns about potential time conflicts.
- Activity insights:
  - score out of `100`,
  - daily retention keeps only newest score per day,
  - searchable score history in Profile tools.
- Calendar import:
  - paste or upload Google Calendar `.ics` exports,
  - searchable parsed event preview before importing,
  - imported events are checked against protected work time before being saved.
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
  - profile password changes require current password, new password, and confirmation,
  - Profile options include a personal OpenAI API key field; keys are tested before saving, used for that user's AI requests, and secrets are never echoed back to the frontend,
  - SQLite models for users/tasks/messages/activity scores/routine profiles/history/AI usage,
  - `Task.note` is stored in local storage and backend task records,
  - startup migration adds the `tasks.note` and `users.openai_api_key` columns for existing SQLite databases when needed.
- AI usage tracking:
  - authenticated OpenAI calls record prompt/completion tokens when the provider returns usage,
  - estimated costs are based on built-in model pricing,
  - override pricing with `OPENAI_INPUT_COST_PER_1M` and `OPENAI_OUTPUT_COST_PER_1M` when needed.

## Run Locally

### Fast Start

Copy and paste this into a terminal from the project root to install dependencies, prepare the backend virtual environment, and start both servers:

```bash
npm install
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
(cd backend && source .venv/bin/activate && python run.py) & npm run dev
```

The backend runs on `http://localhost:8000`. The frontend starts on `http://localhost:8080`; if that port is busy, Vite will print the next available localhost URL.

### Manual Start

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
OPENAI_MODEL=gpt-4.1-mini
OPENAI_INPUT_COST_PER_1M=0.40
OPENAI_OUTPUT_COST_PER_1M=1.60
SECRET_KEY=change-this-in-production
```

If `VITE_API_URL` is not set, the frontend falls back to local storage.
AI features use the API key saved in `Profile -> OpenAI API key`; personal keys are tested before saving, and the saved secret is not returned to the frontend.
The cost override variables are optional; omit them to use the built-in pricing table.

## Checks

```bash
npm run lint
npm test
npm run build
```

Backend syntax check without writing Python bytecode:

```bash
python3 -B -c 'import ast, pathlib; files=["backend/app/main.py","backend/app/auth.py","backend/app/models.py","backend/app/schemas.py","backend/app/tasks_api.py","backend/app/chat_api.py"]; [ast.parse(pathlib.Path(f).read_text(), filename=f) for f in files]; print("python syntax ok")'
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
- [src/components/TaskDialog.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/TaskDialog.tsx): create/edit task dialog with description and note fields
- [src/components/GoogleCalendarImportDialog.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/GoogleCalendarImportDialog.tsx): `.ics` upload/paste flow with searchable event preview
- [src/lib/scheduleGuards.ts](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/lib/scheduleGuards.ts): protected work-time detection, conflict checks, and safe rescheduling helpers
- [src/lib/taskStore.ts](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/lib/taskStore.ts): shared task state, auto-tags, local optimization rules
- [backend/app/ai_usage.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/ai_usage.py): token usage capture and estimated API cost summaries
- [backend/app/auth.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/auth.py): JWT auth, profile updates, current-password verification for password changes
- [backend/app/chat_api.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/chat_api.py): AI endpoints (assistant/recommendations/optimize/routine/insights) and guard rails
- [backend/app/tasks_api.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/tasks_api.py): task CRUD + history
- [backend/app/models.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/models.py): DB models (`Task`, `TaskHistory`, `ActivityScore`, `RoutineProfile`, `AIUsage`, etc.)
