# Taiskmaster

Taiskmaster is a smart calendar and task manager built with React, Vite, TypeScript, Tailwind, and a Flask API. It combines daily task management, calendar imports, routine generation, statistics, and an AI assistant that turns natural language into app actions.

## Overview

The app is designed around a daily dashboard and an assistant-driven workflow. Users can manage tasks directly, import calendar events, generate routines, inspect statistics, and ask the assistant to plan, summarize, optimize, or open app tools.

## Core Features

- Task management:
  - Create, edit, delete, complete, and search tasks.
  - Task descriptions and notes are stored in local state and backend records.
  - Dashboard can switch between card/block view and compact list view.
  - Recommendations avoid past dates and are re-fit into open, non-overlapping calendar slots before being shown.

- Assistant:
  - Sends user input to the backend API by default.
  - Converts natural language into structured commands such as `create_task`, `create_tasks`, `update_task`, `delete_task`, and `app_command`.
  - Saves authenticated assistant chats in the backend `conversations` and `messages` tables so they can be inspected in a SQLite DB browser.
  - Saves the user message first, then saves the assistant answer with source, status, returned actions, and related metadata.
  - Supports complex phrases like "delete all tomorrow", "delete work tomorrow", "plan the usual routine for tomorrow", and "plan something some day next week".
  - Falls back to Lite mode when the live AI key is missing or fails, and still shows previewable task windows for supported planning and delete commands.
  - Uses the live AI to briefly explain how app features work logic-wise and code-wise, using a backend feature map of the main files and flows.
  - Can open profile/options, histories, routines, statistics, calendar import, Smart Routine, Smart Vacation, and optimize dialogs.
  - Uses English-only voice options and chooses the best available English browser voice for spoken replies.
  - Example prompts:
    - `Tell me what is planned tomorrow`
    - `Delete all tomorrow`
    - `Delete work tomorrow`
    - `Plan the usual routine for tomorrow`
    - `Plan something some day next week`
    - `Plan some activity once a week for a month`
    - `Tell me about my activity score`
    - `Optimize today`
    - `How does Smart Statistics work code wise?`
    - `Explain how the routine feature works logic wise`

- Smart Routine:
  - Builds routine plans from a questionnaire.
  - Keeps work blocks inside configured work hours.
  - Adds sleep blocks from sleep time to wake time.
  - Uses preferred workout time for workout tasks.
  - Saves searchable routine profiles.

- Smart Statistics:
  - Timeframes: 1 day, 1 week, 1 month, and 1 year.
  - Calendar workload and task category charts.
  - Free time appears in green; work appears in black.
  - Shows activity score history and estimated AI API cost.

- Safety and profile:
  - JWT authentication.
  - Password changes require current password, new password, and confirmation.
  - Personal OpenAI API keys are entered in Profile options, can be tested on demand, are tested before saving, and are never returned to the frontend.
  - Existing SQLite databases are migrated on startup for new task note and user API-key fields.

## Run The App

For the shortest copy-paste version, open [LETS_RUN_IT.md](/Users/albertsauer/Desktop/TaiskmasterV2/TaiskmasterVR/LETS_RUN_IT.md).

### One Terminal Fast Start

Run this from the project root:

```bash
npm install
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
printf 'VITE_API_URL=http://localhost:8000\n' > .env.local
printf 'DATABASE_URL=sqlite:///./dev.db\nALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080\nOPENAI_MODEL=gpt-4.1-mini\nOPENAI_INPUT_COST_PER_1M=0.40\nOPENAI_OUTPUT_COST_PER_1M=1.60\nSECRET_KEY=change-this-in-production\n' > backend/.env
(cd backend && source .venv/bin/activate && python run.py) & npm run dev
```

Then open:

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

## API Key Setup

The backend no longer uses an API key from code or `.env`. Add the key inside the app:

1. Register or log in.
2. Open `Options -> Profile`.
3. Paste the key into `OpenAI API key`.
4. Use `Test API key` to verify a pasted key before saving.
5. Save. The app tests the key again before storing it.

If a key is already saved, `Test API key` checks the saved key without revealing it. Without a working profile key, Lite mode still handles supported app-manager commands such as bulk delete, routine planning from calendar patterns, calendar summaries, navigation, and basic scheduling previews. Full free-form AI interpretation and feature/code explanations need a working saved key.

## Local Database

The default SQLite database is created at:

```text
backend/instance/dev.db
```

Assistant chats are saved for authenticated users in:

- `conversations`
- `messages`

Assistant message command metadata, including returned app actions, is stored in the `messages.analysis_data` column.

Useful `messages.analysis_data` fields:

- `source`: `openai`, `lite`, `missing_api_key`, `api_error`, or `frontend`.
- `kind`: message type, such as `assistant_input`, `assistant_response`, or `assistant_preview_response`.
- `status`: processing state, such as `received`, `ok`, `missing_api_key`, or `api_error`.
- `actions`: structured app commands returned by the assistant.
- `request_message_id`: links an assistant reply to the user message that caused it.

## Manual Start

Frontend:

```bash
npm install
printf 'VITE_API_URL=http://localhost:8000\n' > .env.local
npm run dev
```

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
printf 'DATABASE_URL=sqlite:///./dev.db\nALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080\nOPENAI_MODEL=gpt-4.1-mini\nOPENAI_INPUT_COST_PER_1M=0.40\nOPENAI_OUTPUT_COST_PER_1M=1.60\nSECRET_KEY=change-this-in-production\n' > .env
python run.py
```

## Checks

```bash
npm run lint
npm test
npm run build
python3 -B -c 'import ast, pathlib; files=["backend/app/main.py","backend/app/auth.py","backend/app/models.py","backend/app/tasks_api.py","backend/app/chat_api.py","backend/app/conversation_api.py"]; [ast.parse(pathlib.Path(f).read_text(), filename=f) for f in files]; print("python syntax ok")'
```

Current known lint note: `src/hooks/useAuth.tsx` has the existing React Fast Refresh warning because the file exports both the provider and hook.

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
- `backend/app/models.py`: SQLite models.
- `backend/app/ai_usage.py`: AI token and cost tracking.
