from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

load_dotenv()

from app.database import Base, engine
from app.routers import tasks
from app.routers import chat

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Taiskmaster API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:8080").split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tasks.router, prefix="/api/tasks", tags=["tasks"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])

@app.get("/")
def root():
    return {"message": "Welcome to Taiskmaster API. Visit /docs for API documentation."}
