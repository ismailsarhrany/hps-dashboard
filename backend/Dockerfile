# Dockerfile for Backend using Python slim image
FROM python:3.11-slim

# Set environment variables early
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install system dependencies including supervisor
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    curl \
    postgresql-client \
    cron \
    python3.11-dev \
    libpq-dev \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user and group first
RUN groupadd -r app_group && useradd -r -g app_group -m -d /home/app_user -s /sbin/nologin app_user

# Set working directory
WORKDIR /app

# Copy requirements file first for better caching
# Ensure ownership is set correctly if needed later, but pip runs as root here
COPY requirements.txt .

# Upgrade pip first
RUN pip install --no-cache-dir --upgrade pip

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code, set ownership later
COPY . .

# Copy supervisord configuration (will be read by root)
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Create supervisor log directory and set permissions for the app_user
# Although logs are redirected to stdout/stderr in conf, create dir just in case
RUN mkdir -p /var/log/supervisor && chown -R app_user:app_group /var/log/supervisor

# Change ownership of the app directory to the non-root user
RUN chown -R app_user:app_group /app

# Switch to non-root user (optional, as supervisord runs as root but manages processes as app_user)
# USER app_user

# Expose the application port
EXPOSE 8000

# Run supervisord as the default command.
# Supervisord needs to run as root to manage processes properly,
# the managed processes will run as 'app_user' as defined in supervisord.conf.
# Use -n flag to run in the foreground.
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/conf.d/supervisord.conf"]

