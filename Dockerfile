# Build stage
FROM python:3.12-slim as builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy pyproject.toml and source code to install dependencies
COPY pyproject.toml .
# We need to copy at least the metadata for hatchling to work if it's dynamic
# or just install the dependencies.
# A better way to install only dependencies:
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir hatchling

# Copy the rest of the application
COPY . .

# Install the project and its dependencies
RUN pip install --no-cache-dir .

# Runtime stage
FROM python:3.12-slim

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy the application code
COPY . .

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

# Default command
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
