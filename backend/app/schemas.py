from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, EmailStr


# Auth schemas
class UserRegister(BaseModel):
    email: EmailStr
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=8)
    full_name: Optional[str] = None


class UserLogin(BaseModel):
    username: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    username: Optional[str] = None


class UserInDB(BaseModel):
    id: str
    email: str
    username: str
    full_name: Optional[str] = None
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# Task schemas
class TaskBase(BaseModel):
    title: str
    description: Optional[str] = None
    date: str
    time: Optional[str] = None
    duration: Optional[int] = None
    location: Optional[str] = None
    priority: str = Field(..., pattern="^(low|medium|high)$")
    tags: List[str] = Field(default_factory=list)
    completed: bool = False


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    date: Optional[str] = None
    time: Optional[str] = None
    duration: Optional[int] = None
    location: Optional[str] = None
    priority: Optional[str] = Field(None, pattern="^(low|medium|high)$")
    tags: Optional[List[str]] = None
    completed: Optional[bool] = None


class TaskInDB(TaskBase):
    id: str
    createdAt: datetime = Field(..., alias="created_at")

    class Config:
        from_attributes = True
        populate_by_name = True


# Conversation schemas
PromptTechnique = Literal["zero-shot", "role-based"]
MessageRole = Literal["user", "assistant"]


class ComparativeApproach(BaseModel):
    name: str
    summary: str
    pros: List[str] = Field(default_factory=list)
    cons: List[str] = Field(default_factory=list)
    estimated_time_savings_minutes: int = Field(ge=0, default=0)
    implementation_complexity: Literal["Low", "Medium", "High"]


class ComparativeAnalysis(BaseModel):
    use_case: str
    task_summary: str
    efficiency_score: int = Field(ge=0, le=100)
    comparative_approaches: List[ComparativeApproach] = Field(min_length=2, max_length=3)
    recommended_approach: str
    optimization_opportunities: List[str] = Field(default_factory=list)
    risk_assessment: List[str] = Field(default_factory=list)
    retained_context: List[str] = Field(default_factory=list)
    prompt_technique: PromptTechnique
    generated_at: datetime


class ConversationCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    use_case: str = Field(default="comparative_analysis", min_length=1, max_length=255)


class ConversationSummary(BaseModel):
    id: str
    title: str
    use_case: str
    created_at: datetime
    updated_at: datetime
    message_count: int

    class Config:
        from_attributes = True


class ConversationDetail(BaseModel):
    id: str
    title: str
    use_case: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MessageCreate(BaseModel):
    content: str = Field(..., min_length=1)
    prompt_technique: PromptTechnique = "role-based"


class MessageResponse(BaseModel):
    id: str
    role: MessageRole
    content: str
    analysis_data: Optional[Dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ConversationCreateResponse(BaseModel):
    id: str
    title: str
    use_case: str
    created_at: datetime
    messages: List[MessageResponse] = Field(default_factory=list)


class MessageExchangeResponse(BaseModel):
    user_message: MessageResponse
    assistant_message: MessageResponse
    prompt_technique: PromptTechnique


class ConversationListResponse(BaseModel):
    conversations: List[ConversationSummary]


class ConversationMessagesResponse(BaseModel):
    conversation: ConversationDetail
    messages: List[MessageResponse]
