#!/bin/bash

# MVMemory Quick Start Script
# This script sets up and runs MVMemory MCP server

set -e

echo "🚀 MVMemory Quick Start"
echo "========================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Node.js
echo -e "${YELLOW}Checking Node.js...${NC}"
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✅ Node.js ${NODE_VERSION} found${NC}"
else
    echo -e "${RED}❌ Node.js not found. Please install Node.js 18+ first.${NC}"
    exit 1
fi

# Check Python
echo -e "${YELLOW}Checking Python...${NC}"
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version)
    echo -e "${GREEN}✅ ${PYTHON_VERSION} found${NC}"
elif command -v python &> /dev/null; then
    PYTHON_VERSION=$(python --version)
    echo -e "${GREEN}✅ ${PYTHON_VERSION} found${NC}"
else
    echo -e "${RED}❌ Python not found. Please install Python 3.8+ first.${NC}"
    exit 1
fi

# Install Node dependencies
echo -e "${YELLOW}Installing Node.js dependencies...${NC}"
npm install --production

# Install Python dependencies
echo -e "${YELLOW}Installing Python dependencies...${NC}"
pip install -r requirements.txt --quiet

# Build TypeScript
echo -e "${YELLOW}Building TypeScript...${NC}"
npm run build

# Create necessary directories
echo -e "${YELLOW}Creating directories...${NC}"
mkdir -p ~/.mvmemory/{db,cache,logs}

# Create default config if not exists
if [ ! -f mvmemory.config.json ]; then
    echo -e "${YELLOW}Creating default configuration...${NC}"
    cat > mvmemory.config.json << 'EOF'
{
  "indexing": {
    "extensions": [".ts", ".js", ".py", ".go", ".rs", ".java", ".cpp", ".c", ".h"],
    "ignore": ["node_modules", ".git", "dist", "build", "__pycache__"],
    "maxFileSize": 10485760,
    "chunkSize": 50
  },
  "search": {
    "maxResults": 10,
    "minRelevance": 0.3
  },
  "cache": {
    "maxSize": 1000,
    "ttl": 3600000
  }
}
EOF
fi

echo -e "${GREEN}✅ MVMemory setup complete!${NC}"
echo ""
echo "To start the MCP server:"
echo "  npm start"
echo ""
echo "To configure Claude Code CLI, add this to ~/.config/claude/claude_desktop_config.json:"
echo '
{
  "mcpServers": {
    "mvmemory": {
      "command": "node",
      "args": ["'$(pwd)'/dist/mcp/MCPServer.js"],
      "env": {
        "MVMEMORY_DB": "~/.mvmemory/db",
        "MVMEMORY_AUTO_INDEX": "true"
      }
    }
  }
}
'
echo ""
echo "Then restart Claude Code CLI to activate MVMemory."