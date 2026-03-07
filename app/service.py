"""User service implementation."""

from datetime import datetime
from typing import List, Optional

from app.models import CreateUserRequest, User


class UserService:
    """Service for managing users."""

    def __init__(self) -> None:
        """Initialize with empty storage."""
        self._users: dict[int, User] = {}
        self._counter: int = 0

    def create_user(self, request: CreateUserRequest) -> User:
        """Create a new user.

        Args:
            request: The user creation request.

        Returns:
            The created user.

        Raises:
            ValueError: If email already exists.
        """
        for user in self._users.values():
            if user.email == request.email:
                raise ValueError(f"Email {request.email} already exists")

        self._counter += 1
        user = User(
            id=self._counter,
            name=request.name,
            email=request.email,
        )
        self._users[user.id] = user
        return user

    def get_user(self, user_id: int) -> Optional[User]:
        """Get user by ID.

        Args:
            user_id: The user ID.

        Returns:
            The user if found, None otherwise.
        """
        return self._users.get(user_id)

    def list_users(self) -> List[User]:
        """List all users.

        Returns:
            List of all users.
        """
        return list(self._users.values())

    def update_user(self, user_id: int, name: Optional[str] = None) -> Optional[User]:
        """Update user information.

        Args:
            user_id: The user ID to update.
            name: New name (optional).

        Returns:
            Updated user if found, None otherwise.
        """
        user = self._users.get(user_id)
        if user is None:
            return None

        if name is not None:
            user.name = name
        user.updated_at = datetime.utcnow()

        self._users[user_id] = user
        return user

    def delete_user(self, user_id: int) -> bool:
        """Delete a user.

        Args:
            user_id: The user ID to delete.

        Returns:
            True if deleted, False if not found.
        """
        if user_id in self._users:
            del self._users[user_id]
            return True
        return False
