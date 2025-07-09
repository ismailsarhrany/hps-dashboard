# ========================================
# SOLUTION 1: Python 3.11 slim with fixed repositories (DEFAULT - UNCOMMENT TO USE)
# ========================================
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive

# Fix repository sources to use working mirrors (removes security repo)
RUN echo 'deb http://deb.debian.org/debian bookworm main' > /etc/apt/sources.list && \
    echo 'deb http://deb.debian.org/debian bookworm-updates main' >> /etc/apt/sources.list

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    curl \
    postgresql-client \
    cron \
    libpq-dev \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# ========================================
# SOLUTION 2: Python 3.11 slim with alternative mirrors (COMMENT OUT IF NOT USING)
# ========================================
# FROM python:3.11-slim

# # Set environment variables
# ENV PYTHONDONTWRITEBYTECODE=1 \
#     PYTHONUNBUFFERED=1 \
#     DEBIAN_FRONTEND=noninteractive

# # Replace sources with alternative mirrors
# RUN echo 'deb http://mirrors.kernel.org/debian bookworm main' > /etc/apt/sources.list && \
#     echo 'deb http://mirrors.kernel.org/debian bookworm-updates main' >> /etc/apt/sources.list

# # Alternative mirror options (uncomment if kernel.org doesn't work):
# # RUN echo 'deb http://ftp.debian.org/debian bookworm main' > /etc/apt/sources.list && \
# #     echo 'deb http://ftp.debian.org/debian bookworm-updates main' >> /etc/apt/sources.list

# # Install system dependencies
# RUN apt-get update && apt-get install -y --no-install-recommends \
#     build-essential \
#     gcc \
#     g++ \
#     curl \
#     postgresql-client \
#     cron \
#     libpq-dev \
#     supervisor \
#     && rm -rf /var/lib/apt/lists/*

# ========================================
# SOLUTION 3: Ubuntu 22.04 with working mirrors (COMMENT OUT IF NOT USING)
# ========================================
# FROM ubuntu:22.04

# # Set environment variables
# ENV PYTHONDONTWRITEBYTECODE=1 \
#     PYTHONUNBUFFERED=1 \
#     DEBIAN_FRONTEND=noninteractive

# # Use working mirrors for Ubuntu
# RUN sed -i 's|http://archive.ubuntu.com|http://mirror.rackspace.com|g' /etc/apt/sources.list && \
#     sed -i 's|http://security.ubuntu.com|http://mirror.rackspace.com|g' /etc/apt/sources.list

# # Install Python 3.11 and system dependencies
# RUN apt-get update && apt-get install -y --no-install-recommends \
#     python3.11 \
#     python3.11-venv \
#     python3.11-distutils \
#     python3.11-dev \
#     python3-pip \
#     build-essential \
#     gcc \
#     g++ \
#     curl \
#     postgresql-client \
#     cron \
#     libpq-dev \
#     supervisor \
#     && rm -rf /var/lib/apt/lists/*

# # Set Python 3.11 as default
# RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1 && \
#     update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1

# ========================================
# SOLUTION 4: Alternative registry images (COMMENT OUT IF NOT USING)
# ========================================
# Try these if all above fail:
# FROM mcr.microsoft.com/devcontainers/python:3.11
# FROM public.ecr.aws/lambda/python:3.11
# FROM gcr.io/distroless/python3-debian11

# ========================================
# COMMON SECTION - WORKS WITH ALL SOLUTIONS
# ========================================


RUN groupadd -r app_group && useradd -r -g app_group -m -d /home/app_user -s /sbin/nologin app_user

# Set working directory
WORKDIR /app

# Copy requirements file first for better caching
# Ensure ownership is set correctly if needed later, but pip runs as root here
COPY requirements.txt .

# Upgrade pip first
RUN python -m pip install --no-cache-dir --upgrade pip

# Install Python dependencies
RUN python -m pip install --no-cache-dir -r requirements.txt

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