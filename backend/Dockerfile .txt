# Dockerfile for Backend using Python slim image
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    curl \
    postgresql-client \
    cron \
    python3.11-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements file first for better caching
COPY requirements.txt .

# Upgrade pip first
RUN pip install --no-cache-dir --upgrade pip

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Create a non-root user to run the application
RUN useradd -m app_user
RUN chown -R app_user:app_user /app
USER app_user

# Expose the application port
EXPOSE 8000

# Run the application
# Note: We'll override this in docker-compose.yml depending on the service role
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "config.wsgi:application"]