# Taiskmaster

Taiskmaster is a smart calendar and task manager built with React, Vite, TypeScript, Tailwind, PostgreSQL, and a Flask API. It combines daily task management, calendar imports, routine generation, statistics, and an AI assistant that turns natural language into app actions.

## What It Does

- Manage tasks with create, edit, delete, complete, search, notes, priorities, tags, dates, times, duration, and location.
- Import calendar events and use schedule guards to avoid past dates and overlapping recommendations.
- Use the assistant to plan, summarize, optimize, create tasks, delete tasks, and open app tools.
- Save authenticated assistant conversations, messages, task history, routine profiles, activity scores, and AI usage in PostgreSQL.
- Build Smart Routine plans from a questionnaire and inspect workload/activity trends in Smart Statistics.
- Store personal OpenAI API keys per user profile; keys are tested before saving and are never returned to the frontend.

## Stack

- Frontend: React 18, Vite, TypeScript, Tailwind, Radix UI, Recharts
- Backend: Flask, Flask-CORS, Flask-SQLAlchemy, Pydantic, JWT auth
- Database: PostgreSQL 16 via Docker Compose
- Tooling: ESLint, Vitest, Vite production build

## Quick Start

For the short copy-paste startup guide, see [LETS_RUN_IT.md](./LETS_RUN_IT.md).

From the project root:

```bash
npm install
docker compose up -d postgres

cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..

printf 'VITE_API_URL=http://localhost:8000\n' > .env.local
printf 'DATABASE_URL=postgresql+psycopg2://taiskmaster:taiskmaster@localhost:5433/taiskmaster\nALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080\nOPENAI_MODEL=gpt-4.1-mini\nOPENAI_INPUT_COST_PER_1M=0.40\nOPENAI_OUTPUT_COST_PER_1M=1.60\nSECRET_KEY=change-this-in-production\n' > backend/.env

(cd backend && source .venv/bin/activate && python run.py) & npm run dev
```

Open the app:

```text
http://localhost:8080
```

Backend health check:

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{"status":"ok"}
```

## Local Database

The local app uses PostgreSQL from [docker-compose.yml](./docker-compose.yml):

```bash
docker compose up -d postgres
```

Default connection details:

```text
Host: localhost
Port: 5433
Database: taiskmaster
User: taiskmaster
Password: taiskmaster
SQLAlchemy URL: postgresql+psycopg2://taiskmaster:taiskmaster@localhost:5433/taiskmaster
JDBC URL: jdbc:postgresql://localhost:5433/taiskmaster
```

The backend reads `DATABASE_URL` from `backend/.env`. It also accepts `postgres://` and `postgresql://` URLs and normalizes them for SQLAlchemy.

SQLAlchemy creates missing tables on backend startup. The expected tables are:

- `users`
- `tasks`
- `task_history`
- `conversations`
- `messages`
- `activity_scores`
- `routine_profiles`
- `ai_usage`

### PyCharm / DataGrip

Create a PostgreSQL data source with the connection details above. This workspace also has a local PyCharm data source file at `.idea/dataSources.xml`; `.idea` is intentionally ignored by Git because JetBrains project files are machine-local.

### SQLite Legacy Data

Older local development data may exist in `backend/instance/dev.db`. That file is ignored by Git and is not used by the app when `DATABASE_URL` points to PostgreSQL.

If you need to migrate old SQLite data, back up Postgres first, then import in foreign-key order: users, tasks, conversations, messages, activity scores, task history, routine profiles, and AI usage. The current local SQLite data has already been copied into the local Postgres database.

## API Key Setup

The backend does not use an OpenAI API key from code or `.env`. Add the key inside the app:

1. Register or log in.
2. Open `Options -> Profile`.
3. Paste the key into `OpenAI API key`.
4. Use `Test API key` to verify a pasted key before saving.
5. Save. The app tests the key again before storing it.

Without a saved profile key, Lite mode still handles supported app-manager commands such as bulk delete, routine planning from calendar patterns, calendar summaries, navigation, and basic scheduling previews. Full free-form AI interpretation and feature/code explanations need a working saved key.

## Useful Commands

Start Postgres:

```bash
docker compose up -d postgres
```

Start the backend:

```bash
cd backend
source .venv/bin/activate
python run.py
```

Start the frontend:

```bash
npm run dev
```

Check Postgres health:

```bash
docker compose exec -T postgres pg_isready -U taiskmaster -d taiskmaster
```

List database tables:

```bash
docker compose exec -T postgres psql -U taiskmaster -d taiskmaster -c '\dt'
```

Run project checks:

```bash
npm run lint
npm test
npm run build
python3 -B -c 'import ast, pathlib; files=["backend/app/main.py","backend/app/auth.py","backend/app/models.py","backend/app/tasks_api.py","backend/app/chat_api.py","backend/app/conversation_api.py"]; [ast.parse(pathlib.Path(f).read_text(), filename=f) for f in files]; print("python syntax ok")'
```

Current known lint note: `src/hooks/useAuth.tsx` has the existing React Fast Refresh warning because the file exports both the provider and hook.

## Assistant Data

Authenticated assistant chats are saved in:

- `conversations`
- `messages`

Assistant metadata, including returned app actions, is stored in `messages.analysis_data`.

Useful `messages.analysis_data` fields:

- `source`: `openai`, `lite`, `missing_api_key`, `api_error`, or `frontend`
- `kind`: message type, such as `assistant_input`, `assistant_response`, or `assistant_preview_response`
- `status`: processing state, such as `received`, `ok`, `missing_api_key`, or `api_error`
- `actions`: structured app commands returned by the assistant
- `request_message_id`: links an assistant reply to the user message that caused it

## Project Map

- `src/pages/Index.tsx`: dashboard, task views, optimize previews, recommendation dialogs, activity dialogs, and frontend recommendation safety filters.
- `src/components/AssistantPanel.tsx`: assistant UI, voice controls, API command execution, local fallback.
- `src/components/Header.tsx`: section switcher, options menu, profile tools.
- `src/components/TaskDialog.tsx`: task create/edit dialog.
- `src/components/GoogleCalendarImportDialog.tsx`: `.ics` import and preview.
- `src/pages/SmartRoutine.tsx`: routine questionnaire, preview, and save flow.
- `src/pages/SmartStatistics.tsx`: statistics dashboards and AI cost views.
- `src/lib/taskStore.ts`: shared task state and task API sync.
- `src/lib/scheduleGuards.ts`: work-time and overlap protection helpers.
- `backend/app/auth.py`: auth, profile updates, password handling, and API-key save/test routes.
- `backend/app/chat_api.py`: assistant, non-overlapping recommendations, optimization, activity insights, routines, usage routes.
- `backend/app/tasks_api.py`: backend task CRUD and task history.
- `backend/app/models.py`: SQLAlchemy models.
- `backend/app/ai_usage.py`: AI token and cost tracking.
- `docker-compose.yml`: local PostgreSQL service.
