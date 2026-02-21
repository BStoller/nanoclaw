FROM node:20-bookworm-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy all files
COPY . .

# Install TypeScript globally for all projects
RUN npm install -g typescript

RUN npm install -g pnpm
ENV CI=true
RUN npm install

# Default command is a bash shell for testing
CMD ["/bin/bash"]
