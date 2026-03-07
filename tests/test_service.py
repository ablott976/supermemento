"""Tests for user service."""

import pytest

from app.models import CreateUserRequest
from app.service import UserService


class TestUserService:
    """Test suite for UserService."""

    def setup_method(self) -> None:
        """Set up fresh service for each test."""
        self.service = UserService()

    def test_create_user_success(self) -> None:
        """Test successful user creation."""
        request = CreateUserRequest(name="John Doe", email="john@example.com")
        user = self.service.create_user(request)

        assert user.id == 1
        assert user.name == "John Doe"
        assert user.email == "john@example.com"

    def test_create_user_duplicate_email(self) -> None:
        """Test that duplicate emails are rejected."""
        request = CreateUserRequest(name="John Doe", email="john@example.com")
        self.service.create_user(request)

        with pytest.raises(ValueError, match="already exists"):
            self.service.create_user(request)

    def test_get_user_found(self) -> None:
        """Test retrieving an existing user."""
        request = CreateUserRequest(name="Jane Doe", email="jane@example.com")
        created = self.service.create_user(request)

        found = self.service.get_user(created.id)

        assert found is not None
        assert found.id == created.id

    def test_get_user_not_found(self) -> None:
        """Test retrieving non-existent user."""
        result = self.service.get_user(999)
        assert result is None

    def test_list_users_empty(self) -> None:
        """Test listing with no users."""
        assert self.service.list_users() == []

    def test_list_users_with_data(self) -> None:
        """Test listing with users."""
        self.service.create_user(
            CreateUserRequest(name="User 1", email="user1@example.com")
        )
        self.service.create_user(
            CreateUserRequest(name="User 2", email="user2@example.com")
        )

        users = self.service.list_users()
        assert len(users) == 2

    def test_update_user_success(self) -> None:
        """Test successful update."""
        created = self.service.create_user(
            CreateUserRequest(name="Old Name", email="old@example.com")
        )

        updated = self.service.update_user(created.id, name="New Name")

        assert updated is not None
        assert updated.name == "New Name"
        assert updated.updated_at is not None

    def test_update_user_not_found(self) -> None:
        """Test updating non-existent user."""
        result = self.service.update_user(999, name="New Name")
        assert result is None

    def test_delete_user_success(self) -> None:
        """Test successful deletion."""
        created = self.service.create_user(
            CreateUserRequest(name="To Delete", email="delete@example.com")
        )

        result = self.service.delete_user(created.id)

        assert result is True
        assert self.service.get_user(created.id) is None

    def test_delete_user_not_found(self) -> None:
        """Test deleting non-existent user."""
        result = self.service.delete_user(999)
        assert result is False
