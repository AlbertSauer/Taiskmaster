# Taiskmaster

Taiskmaster is a React + Vite + TypeScript + Tailwind frontend with a Flask backend for AI-assisted planning, routine building, and calendar-based task management.

## Current Features

- Daily dashboard with:
  - today-focused task view (default),
  - date picker filter + broad text search across title, description, notes, tags, date, priority, status, time, and location,
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
  - preview and edit before save,
  - saved routine profiles reusable from `Options -> Profile -> Profile tools`,
  - searchable saved routine list.
- Smart Statistics:
  - calendar workload and category charts,
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
  - SQLite models for users/tasks/messages/activity scores/routine profiles/history/AI usage,
  - `Task.note` is stored in local storage and backend task records,
  - startup migration adds the `tasks.note` column for existing SQLite databases when needed.
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
- [src/components/TaskDialog.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/TaskDialog.tsx): create/edit task dialog with description and note fields
- [src/components/GoogleCalendarImportDialog.tsx](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/components/GoogleCalendarImportDialog.tsx): `.ics` upload/paste flow with searchable event preview
- [src/lib/scheduleGuards.ts](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/lib/scheduleGuards.ts): protected work-time detection, conflict checks, and safe rescheduling helpers
- [src/lib/taskStore.ts](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/src/lib/taskStore.ts): shared task state, auto-tags, local optimization rules
- [backend/app/ai_usage.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/ai_usage.py): token usage capture and estimated API cost summaries
- [backend/app/chat_api.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/chat_api.py): AI endpoints (assistant/recommendations/optimize/routine/insights) and guard rails
- [backend/app/tasks_api.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/tasks_api.py): task CRUD + history
- [backend/app/models.py](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/backend/app/models.py): DB models (`Task`, `TaskHistory`, `ActivityScore`, `RoutineProfile`, `AIUsage`, etc.)
