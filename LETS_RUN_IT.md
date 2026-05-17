# LETS RUN IT

Fast startup instructions for the Taiskmaster presentation version.

## One Terminal Fast Start

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

## Backend Health Check

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{"status":"ok"}
```

## API Key Setup

The backend does not use an API key from code or `.env`. Add the key inside the app:

1. Register or log in.
2. Open `Options -> Profile`.
3. Paste the key into `OpenAI API key`.
4. Save. The app tests the key before storing it.

Without a saved profile key, local and rule-based assistant features still work, but live AI interpretation needs the saved key.

## Demo Prompts

Try these after the app is running:

```text
Tell me what is planned tomorrow
Delete work tomorrow
Plan something some day next week
Plan some activity once a week for a month
Tell me about my activity score
Optimize today
Open task history
How will the weather be in Berlin tomorrow?
```
