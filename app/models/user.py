from datetime import datetime, timezone
from pydantic import BaseModel, Field, ConfigDict


class UserBase(BaseModel):
    user_id: str


class UserCreate(UserBase):
    pass


class User(UserBase):
    model_config = ConfigDict(from_attributes=True)

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_active_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
