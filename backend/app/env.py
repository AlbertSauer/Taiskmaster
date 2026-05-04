from pathlib import Path

from dotenv import load_dotenv


def load_app_env() -> None:
    backend_env = Path(__file__).resolve().parents[1] / ".env"
    load_dotenv(backend_env)
