from typing import Any, Generic, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ServiceResponse(BaseModel, Generic[T]):
    success: bool
    data: Optional[T] = None
    error: Optional[str] = None

    @classmethod
    def ok(cls, data: T) -> "ServiceResponse[T]":
        return cls(success=True, data=data)

    @classmethod
    def fail(cls, error: str) -> "ServiceResponse[Any]":
        return cls(success=False, error=error)
