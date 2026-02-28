from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field


class CICDProvider(str, Enum):
    """Supported CI/CD providers."""
    GITHUB_ACTIONS = "github_actions"
    GITLAB_CI = "gitlab_ci"
    JENKINS = "jenkins"
    CIRCLECI = "circleci"
    TRAVIS = "travis"
    AZURE_DEVOPS = "azure_devops"
    LOCAL = "local"


class CICDExecutionStatus(str, Enum):
    """Execution status states."""
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"


class CICDExecutionBase(BaseModel):
    """Base CI/CD execution model."""
    repository: str = Field(..., description="Repository URL or identifier")
    branch: str = Field(default="main", description="Git branch to execute on")
    command: str = Field(..., description="CI/CD command or pipeline identifier")
    provider: CICDProvider = Field(default=CICDProvider.LOCAL, description="CI/CD provider")
    environment: Dict[str, str] = Field(default_factory=dict, description="Environment variables")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")


class CICDExecutionCreate(CICDExecutionBase):
    """Model for creating a new CI/CD execution."""
    pass


class CICDExecution(CICDExecutionBase):
    """Full CI/CD execution model with runtime fields."""
    model_config = ConfigDict(from_attributes=True)
    
    id: UUID = Field(default_factory=uuid4)
    status: CICDExecutionStatus = Field(default=CICDExecutionStatus.PENDING)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    execution_logs: List[str] = Field(default_factory=list)
    exit_code: Optional[int] = None
    error_message: Optional[str] = None
    duration_seconds: Optional[float] = None


class CICDExecuteRequest(BaseModel):
    """Request model for triggering CI/CD execution."""
    repository: str = Field(..., description="Repository URL or identifier")
    branch: str = Field(default="main", description="Git branch to execute on")
    command: str = Field(..., description="CI/CD command or pipeline identifier")
    provider: CICDProvider = Field(default=CICDProvider.LOCAL, description="CI/CD provider to use")
    environment: Optional[Dict[str, str]] = Field(default=None, description="Optional environment variables")
    timeout_seconds: Optional[int] = Field(default=3600, description="Execution timeout in seconds", ge=1)


class CICDExecuteResponse(BaseModel):
    """Immediate response after triggering CI/CD execution."""
    execution_id: UUID = Field(default_factory=uuid4)
    status: CICDExecutionStatus = Field(default=CICDExecutionStatus.QUEUED)
    repository: str
    branch: str
    message: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CICDExecutionResult(BaseModel):
    """Detailed result of a CI/CD execution."""
    model_config = ConfigDict(from_attributes=True)
    
    execution_id: UUID
    status: CICDExecutionStatus
    repository: str
    branch: str
    command: str
    exit_code: Optional[int]
    stdout: str = Field(default="", description="Standard output from execution")
    stderr: str = Field(default="", description="Standard error from execution")
    duration_seconds: Optional[float]
    completed_at: Optional[datetime]
    artifacts: List[str] = Field(default_factory=list, description="List of artifact URLs or paths")


class CICDLogEntry(BaseModel):
    """Individual log entry from CI/CD execution."""
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    level: str = Field(..., description="Log level (INFO, ERROR, WARN, DEBUG)")
    message: str
    source: Optional[str] = Field(default=None, description="Source component or stage")
