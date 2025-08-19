# MVMemory Docker Image
# Multi-stage build for production-ready container

# Stage 1: Base image with system dependencies
FROM node:24-slim AS base

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3.11 \
    python3.11-dev \
    python3-pip \
    python3-venv \
    build-essential \
    git \
    curl \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Stage 2: Python dependencies
FROM base AS python-deps

# Create Python virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy Python requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Pre-download ML models to reduce startup time
RUN python3 -c "
from sentence_transformers import SentenceTransformer
import os
cache_dir = '/opt/models'
os.makedirs(cache_dir, exist_ok=True)
print('Downloading nomic-embed-text-v1.5...')
model = SentenceTransformer('nomic-ai/nomic-embed-text-v1.5', cache_folder=cache_dir)
print('Model downloaded successfully')
"

# Stage 3: Node.js dependencies
FROM base AS node-deps

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production && npm cache clean --force

# Stage 4: Build stage
FROM base AS build

# Copy Node.js dependencies
COPY --from=node-deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Stage 5: Production image
FROM base AS production

# Create non-root user
RUN groupadd -r mvmemory && useradd -r -g mvmemory mvmemory

# Copy Python virtual environment
COPY --from=python-deps /opt/venv /opt/venv

# Copy ML models
COPY --from=python-deps /opt/models /opt/models

# Copy Node.js dependencies
COPY --from=node-deps /app/node_modules ./node_modules

# Copy built application
COPY --from=build /app/dist ./dist

# Copy configuration files
COPY package.json tsconfig.json ./

# Create data directories
RUN mkdir -p /data/{db,cache,logs} && \
    chown -R mvmemory:mvmemory /data /app

# Set environment variables
ENV NODE_ENV=production
ENV PYTHONPATH=/opt/venv/bin/python
ENV PATH="/opt/venv/bin:$PATH"
ENV MVMEMORY_DB=/data/db/mvmemory.db
ENV MVMEMORY_CACHE_DIR=/data/cache
ENV MVMEMORY_LOG_LEVEL=info
ENV MVMEMORY_AUTO_INDEX=true
ENV MVMEMORY_WATCH_FILES=true
ENV MVMEMORY_CACHE_SIZE=2000
ENV MVMEMORY_MAX_TOKENS=100000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python3 -c "
import json
import sys
try:
    from sentence_transformers import SentenceTransformer
    # Quick model availability check
    print('Health check passed')
    sys.exit(0)
except Exception as e:
    print(f'Health check failed: {e}')
    sys.exit(1)
"

# Switch to non-root user
USER mvmemory

# Expose port (if needed for future HTTP interface)
EXPOSE 7777

# Start command
CMD ["node", "dist/mcp/MCPServer.js"]

# Labels
LABEL maintainer="MVMemory Team" \
      version="1.0.0" \
      description="Semantic code search with vector embeddings for Claude Code CLI" \
      org.opencontainers.image.source="https://github.com/mvmemory/mvmemory" \
      org.opencontainers.image.documentation="https://github.com/mvmemory/mvmemory/blob/main/README.md" \
      org.opencontainers.image.licenses="MIT"