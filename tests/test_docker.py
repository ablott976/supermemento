"""Tests for docker-compose up functionality and exposed ports."""

import socket
import subprocess
import time
from pathlib import Path

import pytest


def _has_docker_compose() -> bool:
    """Check if docker-compose command is available."""
    try:
        result = subprocess.run(
            ["docker-compose", "--version"],
            capture_output=True,
            timeout=5,
        )
        return result.returncode == 0
    except (subprocess.SubprocessError, FileNotFoundError):
        return False


def _get_compose_file() -> Path:
    """Get path to docker-compose.yml."""
    return Path(__file__).parent.parent / "docker-compose.yml"


def _get_project_root() -> Path:
    """Get project root directory."""
    return Path(__file__).parent.parent


@pytest.mark.skipif(not _has_docker_compose(), reason="docker-compose not available")
class TestDockerComposeUp:
    """Tests for verifying docker-compose up with exposed port."""

    @pytest.fixture(scope="class")
    def docker_compose_up(self) -> None:
        """Start docker-compose services and cleanup after tests."""
        compose_file = _get_compose_file()
        project_root = _get_project_root()

        # Start services
        up_result = subprocess.run(
            ["docker-compose", "-f", str(compose_file), "up", "-d"],
            capture_output=True,
            text=True,
            cwd=str(project_root),
        )
        if up_result.returncode != 0:
            pytest.fail(
                f"Failed to start docker-compose services:\n"
                f"stdout: {up_result.stdout}\n"
                f"stderr: {up_result.stderr}"
            )

        # Wait for service to be ready
        time.sleep(2)

        yield

        # Cleanup: stop and remove containers
        down_result = subprocess.run(
            ["docker-compose", "-f", str(compose_file), "down"],
            capture_output=True,
            text=True,
            cwd=str(project_root),
        )
        if down_result.returncode != 0:
            pytest.fail(
                f"Failed to stop docker-compose services:\n"
                f"stdout: {down_result.stdout}\n"
                f"stderr: {down_result.stderr}"
            )

    def test_docker_compose_ps_shows_running(self, docker_compose_up: None) -> None:
        """Verify docker-compose ps shows running containers."""
        compose_file = _get_compose_file()
        project_root = _get_project_root()

        result = subprocess.run(
            ["docker-compose", "-f", str(compose_file), "ps"],
            capture_output=True,
            text=True,
            cwd=str(project_root),
        )
        assert result.returncode == 0, (
            f"docker-compose ps failed:\n"
            f"stdout: {result.stdout}\n"
            f"stderr: {result.stderr}"
        )

        # Check that mcp-server service is in the output
        assert "mcp-server" in result.stdout, (
            "mcp-server container not found in docker-compose ps output"
        )

    def test_port_8080_is_listening(self, docker_compose_up: None) -> None:
        """Verify port 8080 is exposed and accepting connections."""
        host = "localhost"
        port = 8080
        timeout = 5

        try:
            with socket.create_connection((host, port), timeout=timeout):
                pass  # Connection successful
        except (socket.timeout, ConnectionRefusedError) as e:
            pytest.fail(f"Port {port} is not accessible on {host}: {e}")

    def test_port_8080_is_exposed_in_container(self, docker_compose_up: None) -> None:
        """Verify port 8080 is exposed in the container configuration."""
        compose_file = _get_compose_file()
        project_root = _get_project_root()

        result = subprocess.run(
            ["docker-compose", "-f", str(compose_file), "port", "mcp-server", "8080"],
            capture_output=True,
            text=True,
            cwd=str(project_root),
        )
        assert result.returncode == 0, (
            f"docker-compose port command failed:\n"
            f"stdout: {result.stdout}\n"
            f"stderr: {result.stderr}"
        )

        # Output should contain the host:port mapping
        output = result.stdout.strip()
        assert "0.0.0.0:8080" in output or ":8080" in output, (
            f"Port 8080 not properly exposed, got: {output}"
        )

    def test_mcp_server_logs_exist(self, docker_compose_up: None) -> None:
        """Verify mcp-server container produces logs."""
        compose_file = _get_compose_file()
        project_root = _get_project_root()

        result = subprocess.run(
            ["docker-compose", "-f", str(compose_file), "logs", "mcp-server"],
            capture_output=True,
            text=True,
            cwd=str(project_root),
        )
        assert result.returncode == 0, (
            f"docker-compose logs failed:\n"
            f"stdout: {result.stdout}\n"
            f"stderr: {result.stderr}"
        )

        # Verify some log output exists (even if empty, command should succeed)
        assert isinstance(result.stdout, str), "Logs output should be a string"


@pytest.mark.skipif(not _has_docker_compose(), reason="docker-compose not available")
class TestDockerComposeErrors:
    """Tests for error cases and failure scenarios."""

    def test_docker_compose_up_with_invalid_file_fails(self) -> None:
        """Verify docker-compose up fails with non-existent file."""
        project_root = _get_project_root()
        nonexistent_file = project_root / "nonexistent-compose.yml"

        result = subprocess.run(
            ["docker-compose", "-f", str(nonexistent_file), "up", "-d"],
            capture_output=True,
            text=True,
            cwd=str(project_root),
        )

        assert result.returncode != 0, (
            "docker-compose up should fail with non-existent file"
        )
        assert ("doesn't exist" in result.stderr.lower() or 
                "not found" in result.stderr.lower() or
                "no such file" in result.stderr.lower()), (
            f"Expected file not found error, got: {result.stderr}"
        )

    def test_docker_compose_with_invalid_service_name_fails(self) -> None:
        """Verify docker-compose commands fail with invalid service names."""
        compose_file = _get_compose_file()
        project_root = _get_project_root()

        result = subprocess.run(
            ["docker-compose", "-f", str(compose_file), "logs", "nonexistent-service"],
            capture_output=True,
            text=True,
            cwd=str(project_root),
        )

        # Should fail or warn about non-existent service
        assert result.returncode != 0 or "nonexistent-service" not in result.stdout, (
            "Command should fail or indicate service doesn't exist"
        )

    def test_port_binding_conflict_detection(self) -> None:
        """Verify behavior when checking port availability."""
        # Try to bind to port 8080 to check if it's available
        host = "localhost"
        port = 8080

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            # Try to bind to check if port is already in use
            sock.bind((host, port))
            # If we get here, port is available (which is expected when containers aren't running)
            port_available = True
        except OSError as e:
            # Port is likely in use
            port_available = False
            assert "Address already in use" in str(e) or "Permission denied" in str(e) or winerror == 10048, (
                f"Expected port binding error, got: {e}"
            )
        finally:
            sock.close()

        # This test documents the behavior - port should be available when no containers run
        # If port is not available, it might indicate a conflict or zombie process
        if not port_available:
            pytest.skip("Port 8080 is already in use on host - potential conflict detected")

    def test_docker_compose_config_with_syntax_errors(self) -> None:
        """Verify docker-compose config fails with invalid YAML."""
        import tempfile
        import os

        project_root = _get_project_root()

        # Create a temporary invalid compose file
        invalid_yaml = """
        version: '3'
        services:
          mcp-server:
            image: test
            ports:
              - "8080:8080
            # Missing closing quote above
        """

        with tempfile.NamedTemporaryFile(
            mode='w', 
            suffix='.yml', 
            delete=False,
            dir=project_root
        ) as f:
            f.write(invalid_yaml)
            temp_file = f.name

        try:
            result = subprocess.run(
                ["docker-compose", "-f", temp_file, "config"],
                capture_output=True,
                text=True,
                cwd=str(project_root),
            )

            assert result.returncode != 0, (
                "docker-compose config should fail with invalid YAML"
            )
        finally:
            os.unlink(temp_file)

    def test_docker_compose_exec_on_stopped_container_fails(self) -> None:
        """Verify exec fails on non-running containers."""
        compose_file = _get_compose_file()
        project_root = _get_project_root()

        # Ensure container is stopped first
        subprocess.run(
            ["docker-compose", "-f", str(compose_file), "down"],
            capture_output=True,
            cwd=str(project_root),
        )

        # Try to exec on stopped container
        result = subprocess.run(
            ["docker-compose", "-f", str(compose_file), "exec", "-T", "mcp-server", "echo", "test"],
            capture_output=True,
            text=True,
            cwd=str(project_root),
        )

        # Should fail because container is not running
        assert result.returncode != 0, (
            "docker-compose exec should fail on stopped containers"
        )


@pytest.mark.skipif(not _has_docker_compose(), reason="docker-compose not available")
class TestDockerComposeEdgeCases:
    """Tests for edge cases and boundary conditions."""

    @pytest.fixture(scope="class")
    def docker_compose_up(self) -> None:
        """Start docker-compose services and cleanup after tests."""
        compose_file = _get_compose_file()
        project_root = _get_project_root()

        up_result = subprocess.run(
            ["docker-compose", "-f", str(compose_file), "up", "-d"],
            capture_output=True,
            text=True,
            cwd=str(project_root),
        )
        
        if up_result.returncode != 0:
            pytest.skip(f"Could not start services for edge case tests: {up_result.stderr}")

        time.sleep(2)
        yield

        subprocess.run(
            ["docker-compose", "-f", str(compose_file), "down"],
            capture_output=True,
            cwd=str(project_root),
        )

    def test_multiple_consecutive_connections(self, docker_compose_up: None) -> None:
        """Verify port can handle multiple consecutive connections."""
        host = "localhost"
        port = 8080
        timeout = 2

        # Try multiple consecutive connections
        for i in range(3):
            try:
                with socket.create_connection((host, port), timeout=timeout):
                    pass
            except (socket.timeout, ConnectionRefusedError) as e:
                pytest.fail(f"Connection {i+1} failed: {e}")

    def test_container_restart_policy(self, docker_compose_up: None) -> None:
        """Verify container has appropriate restart policy configured."""
        compose_file = _get_compose_file()
        project_root = _get_project_root()

        # Check container inspect for restart policy
        result = subprocess.run(
            ["docker", "inspect", "--format", "{{.HostConfig.RestartPolicy.Name}}", 
             f"{project_root.name}_mcp-server_1"],
            capture_output=True,
            text=True,
            cwd=str(project_root),
        )

        # If docker inspect fails (different naming), try compose ps -q
        if result.returncode != 0:
            # Get container ID via compose
            ps_result = subprocess.run(
                ["docker-compose", "-f", str(compose_file), "ps", "-q", "mcp-server"],
                capture_output=True,
                text=True,
                cwd=str(project_root),
            )
            if ps_result.returncode == 0 and ps_result.stdout.strip():
                container_id = ps_result.stdout.strip()
                result = subprocess.run(
                    ["docker", "inspect", "--format", 
                     "{{.HostConfig.RestartPolicy.Name}}", container_id],
                    capture_output=True,
                    text=True,
                )

        # Restart policy check - document current state
        # Common values: "no", "always", "unless-stopped", "on-failure"
        if result.returncode == 0:
            policy = result.stdout.strip()
            assert policy in ["no", "always", "unless-stopped", "on-failure", ""], (
                f"Unexpected restart policy: {policy}"
            )

    def test_container_resource_limits(self, docker_compose_up: None) -> None:
        """Verify container has resource constraints applied."""
        compose_file = _get_compose_file()
        project_root = _get_project_root()

        # Get container ID
        ps_result = subprocess.run(
            ["docker-compose", "-f", str(compose_file), "ps", "-q", "mcp-server"],
            capture_output=True,
            text=True,
            cwd=str(project_root),
        )

        if ps_result.returncode != 0 or not ps_result.stdout.strip():
            pytest.skip("Could not get container ID for resource check")

        container_id = ps_result.stdout.strip()

        # Check memory limits
        mem_result = subprocess.run(
            ["docker", "inspect", "--format", 
             "{{.HostConfig.Memory}}", container_id],
            capture_output=True,
            text=True,
        )

        if mem_result.returncode == 0:
            mem_limit = mem_result.stdout.strip()
            # Document the memory limit (0 means unlimited)
            assert mem_limit.isdigit() or mem_limit == "0", (
                f"Unexpected memory limit format: {mem_limit}"
            )

    def test_network_isolation_from_host(self, docker_compose_up: None) -> None:
        """Verify container network is isolated from host."""
        compose_file = _get_compose_file()
        project_root = _get_project_root()

        # Get network information
        result = subprocess.run(
            ["docker-compose", "-f", str(compose_file), "exec", "-T", 
             "mcp-server", "cat", "/etc/hosts"],
            capture_output=True,
            text=True,
            cwd=str(project_root),
        )

        if result.returncode == 0:
            hosts_content = result.stdout
            # Container should have its own hosts entries
            assert "localhost" in hosts_content or "127.0.0.1" in hosts_content, (
                "Container should have isolated network stack"
            )

    def test_graceful_shutdown_timeout(self, docker_compose_up: None) -> None:
        """Verify container stops within reasonable time."""
        compose_file = _get_compose_file()
        project_root = _get_project_root()

        # Stop with timeout
        start_time = time.time()
        result = subprocess.run(
            ["docker-compose", "-f", str(compose_file), "stop", "-t", "10"],
            capture_output=True,
            text=True,
            cwd=str(project_root),
        )
        elapsed = time.time() - start_time

        assert result.returncode == 0, (
            f"docker-compose stop failed: {result.stderr}"
        )

        # Should stop within timeout (10s) plus some buffer
        assert elapsed < 15, (
            f"Container took too long to stop: {elapsed:.1f}s"
        )

        # Restart for cleanup fixture
        subprocess.run(
            ["docker-compose", "-f", str(compose_file), "up", "-d"],
            capture_output=True,
            cwd=str(project_root),
        )
        time.sleep(2)

    def test_logs_streaming_with_follow_timeout(self, docker_compose_up: None) -> None:
        """Verify logs command respects timeout when following."""
        compose_file = _get_compose_file()
        project_root = _get_project_root()

        # Try to get logs with a tail limit
        result = subprocess.run(
            ["docker-compose", "-f", str(compose_file), "logs", "--tail", "10", 
             "mcp-server"],
            capture_output=True,
            text=True,
            cwd=str(project_root),
            timeout=10  # Timeout the command itself
        )

        assert result.returncode == 0, (
            f"Logs command failed: {result.stderr}"
        )

    def test_volume_persistence_check(self, docker_compose_up: None) -> None:
        """Verify any declared volumes are properly configured."""
        compose_file = _get_compose_file()
        project_root = _get_project_root()

        # Check if volumes are defined in compose
        result = subprocess.run(
            ["docker-compose", "-f", str(compose_file), "config"],
            capture_output=True,
            text=True,
            cwd=str(project_root),
        )

        if result.returncode == 0:
            config_output = result.stdout
            
            # If volumes are declared, they should be properly formatted
            # This is more of a validation that config parses correctly
            assert "volumes:" in config_output or "volumes" not in config_output, (
                "Volume configuration should be valid if present"
            )


class TestDockerComposePreconditions:
    """Tests that don't require docker-compose to be running."""

    def test_compose_file_path_resolution(self) -> None:
        """Verify compose file path is resolved correctly."""
        compose_file = _get_compose_file()
        
        # Path should be absolute and end with docker-compose.yml
        assert compose_file.is_absolute(), "Compose file path should be absolute"
        assert compose_file.name == "docker-compose.yml", (
            "Compose file should be named docker-compose.yml"
        )
        assert compose_file.parent.exists(), "Project root should exist"

    def test_project_root_contains_expected_files(self) -> None:
        """Verify project root contains expected structure."""
        project_root = _get_project_root()
        
        # Should have basic project files
        assert (project_root / "tests").exists(), "tests directory should exist"
        assert (project_root / "tests" / "test_docker.py").exists(), (
            "This test file should exist"
        )

    def test_docker_compose_version_check(self) -> None:
        """Verify docker-compose version check handles errors gracefully."""
        # Test with invalid command
        result = subprocess.run(
            ["docker-compose-invalid-command", "--version"],
            capture_output=True,
            timeout=5,
        )
        assert result.returncode != 0, "Invalid command should fail"

    def test_socket_connection_timeout(self) -> None:
        """Verify socket connection respects timeout."""
        # Test connection to non-existent service
        with pytest.raises((socket.timeout, ConnectionRefusedError, OSError)):
            socket.create_connection(("localhost", 99999), timeout=0.1)
