#!/bin/bash
# MVMemory Installation Script
# Installs MVMemory MCP server for Claude Code CLI

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
MVMEMORY_DIR="$HOME/.mvmemory"
CLAUDE_CONFIG_DIR="$HOME/.config/claude"
CLAUDE_CONFIG_FILE="$CLAUDE_CONFIG_DIR/claude_desktop_config.json"

# Utility functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Detect operating system
detect_os() {
    case "$(uname -s)" in
        Linux*)     echo "linux";;
        Darwin*)    echo "macos";;
        MINGW*)     echo "windows";;
        CYGWIN*)    echo "windows";;
        *)          echo "unknown";;
    esac
}

# Install system dependencies
install_system_deps() {
    local os=$(detect_os)
    
    log_info "Installing system dependencies for $os..."
    
    case $os in
        "macos")
            if command_exists brew; then
                log_info "Updating Homebrew..."
                brew update
                
                # Install Python if not present
                if ! command_exists python3; then
                    log_info "Installing Python 3..."
                    brew install python@3.11
                fi
                
                # Install Node.js if not present
                if ! command_exists node; then
                    log_info "Installing Node.js..."
                    brew install node
                fi
            else
                log_error "Homebrew is required for macOS installation. Please install it first:"
                log_error "https://brew.sh"
                exit 1
            fi
            ;;
            
        "linux")
            # Detect package manager
            if command_exists apt-get; then
                log_info "Using apt package manager..."
                sudo apt-get update
                
                # Install Python
                if ! command_exists python3; then
                    log_info "Installing Python 3..."
                    sudo apt-get install -y python3 python3-pip python3-venv
                fi
                
                # Install Node.js
                if ! command_exists node; then
                    log_info "Installing Node.js..."
                    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
                    sudo apt-get install -y nodejs
                fi
                
                # Install build tools
                sudo apt-get install -y build-essential
                
            elif command_exists yum; then
                log_info "Using yum package manager..."
                sudo yum update -y
                
                # Install Python
                if ! command_exists python3; then
                    log_info "Installing Python 3..."
                    sudo yum install -y python3 python3-pip
                fi
                
                # Install Node.js
                if ! command_exists node; then
                    log_info "Installing Node.js..."
                    curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
                    sudo yum install -y nodejs
                fi
                
            elif command_exists pacman; then
                log_info "Using pacman package manager..."
                sudo pacman -Syu
                
                # Install Python
                if ! command_exists python3; then
                    log_info "Installing Python 3..."
                    sudo pacman -S python python-pip
                fi
                
                # Install Node.js
                if ! command_exists node; then
                    log_info "Installing Node.js..."
                    sudo pacman -S nodejs npm
                fi
                
            else
                log_error "No supported package manager found. Please install Python 3.11+ and Node.js 18+ manually."
                exit 1
            fi
            ;;
            
        "windows")
            log_info "Windows detected. Checking for chocolatey..."
            if command_exists choco; then
                # Install Python
                if ! command_exists python; then
                    log_info "Installing Python 3..."
                    choco install python -y
                fi
                
                # Install Node.js
                if ! command_exists node; then
                    log_info "Installing Node.js..."
                    choco install nodejs -y
                fi
            else
                log_warning "Chocolatey not found. Please install Python 3.11+ and Node.js 18+ manually."
                log_info "Python: https://www.python.org/downloads/"
                log_info "Node.js: https://nodejs.org/download/"
            fi
            ;;
            
        *)
            log_error "Unsupported operating system: $os"
            exit 1
            ;;
    esac
}

# Verify dependencies
verify_deps() {
    log_info "Verifying dependencies..."
    
    # Check Python
    if command_exists python3; then
        local python_version=$(python3 --version 2>&1 | grep -o '[0-9]\+\.[0-9]\+')
        log_success "Python 3 found: $(python3 --version)"
        
        # Check if version is 3.8+
        if python3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)"; then
            log_success "Python version is compatible"
        else
            log_error "Python 3.8+ is required, found: $python_version"
            exit 1
        fi
    else
        log_error "Python 3 not found"
        exit 1
    fi
    
    # Check Node.js
    if command_exists node; then
        log_success "Node.js found: $(node --version)"
        
        # Check if version is 18+
        local node_version=$(node --version | grep -o '[0-9]\+' | head -1)
        if [ "$node_version" -ge 18 ]; then
            log_success "Node.js version is compatible"
        else
            log_error "Node.js 18+ is required, found version: $node_version"
            exit 1
        fi
    else
        log_error "Node.js not found"
        exit 1
    fi
    
    # Check npm
    if command_exists npm; then
        log_success "npm found: $(npm --version)"
    else
        log_error "npm not found"
        exit 1
    fi
    
    # Check pip
    if command_exists pip3 || command_exists pip; then
        log_success "pip found"
    else
        log_error "pip not found"
        exit 1
    fi
}

# Create directory structure
create_directories() {
    log_info "Creating MVMemory directories..."
    
    mkdir -p "$MVMEMORY_DIR"/{db,cache,logs,models}
    mkdir -p "$CLAUDE_CONFIG_DIR"
    
    log_success "Directories created"
}

# Install Python dependencies
install_python_deps() {
    log_info "Installing Python dependencies..."
    
    # Create virtual environment
    if [ ! -d "$MVMEMORY_DIR/venv" ]; then
        log_info "Creating Python virtual environment..."
        python3 -m venv "$MVMEMORY_DIR/venv"
    fi
    
    # Activate virtual environment
    source "$MVMEMORY_DIR/venv/bin/activate"
    
    # Upgrade pip
    pip install --upgrade pip
    
    # Install requirements
    pip install faiss-cpu==1.7.4 \
                sentence-transformers==2.2.2 \
                numpy==1.24.3 \
                torch==2.0.1 \
                transformers==4.35.0 \
                sqlalchemy==2.0.23 \
                pandas==2.1.3 \
                psutil==5.9.6 \
                python-dotenv==1.0.0 \
                tqdm==4.66.1 \
                pydantic==2.4.2
    
    log_success "Python dependencies installed"
}

# Install Node.js dependencies
install_node_deps() {
    log_info "Installing Node.js dependencies..."
    
    # Install global dependencies
    npm install -g typescript@latest
    
    # Install project dependencies
    npm ci --production
    
    log_success "Node.js dependencies installed"
}

# Build TypeScript
build_typescript() {
    log_info "Building TypeScript..."
    
    npx tsc
    
    if [ $? -eq 0 ]; then
        log_success "TypeScript build completed"
    else
        log_error "TypeScript build failed"
        exit 1
    fi
}

# Download ML models
download_models() {
    log_info "Pre-downloading embedding models..."
    
    # Activate Python environment
    source "$MVMEMORY_DIR/venv/bin/activate"
    
    # Download the model by importing it
    python3 -c "
from sentence_transformers import SentenceTransformer
import os

cache_dir = '$MVMEMORY_DIR/models'
os.makedirs(cache_dir, exist_ok=True)

print('Downloading nomic-embed-text-v1.5...')
model = SentenceTransformer('nomic-ai/nomic-embed-text-v1.5', cache_folder=cache_dir)
print('Model downloaded successfully')
"
    
    log_success "Models downloaded"
}

# Configure Claude desktop
configure_claude() {
    log_info "Configuring Claude desktop..."
    
    local mvmemory_path="$(pwd)/dist/mcp/MCPServer.js"
    local python_path="$MVMEMORY_DIR/venv/bin/python"
    
    # Check if Claude config exists
    if [ -f "$CLAUDE_CONFIG_FILE" ]; then
        log_info "Backing up existing Claude configuration..."
        cp "$CLAUDE_CONFIG_FILE" "$CLAUDE_CONFIG_FILE.backup.$(date +%s)"
    fi
    
    # Create or update Claude configuration
    cat > "$CLAUDE_CONFIG_FILE" << EOF
{
  "mcpServers": {
    "mvmemory": {
      "command": "node",
      "args": ["$mvmemory_path"],
      "env": {
        "MVMEMORY_DB": "$MVMEMORY_DIR/db/mvmemory.db",
        "MVMEMORY_CACHE_DIR": "$MVMEMORY_DIR/cache",
        "MVMEMORY_LOG_LEVEL": "info",
        "MVMEMORY_AUTO_INDEX": "true",
        "MVMEMORY_WATCH_FILES": "true",
        "MVMEMORY_CACHE_SIZE": "1000",
        "MVMEMORY_MAX_TOKENS": "100000",
        "PYTHONPATH": "$MVMEMORY_DIR/venv/bin/python"
      }
    }
  }
}
EOF
    
    log_success "Claude configuration updated"
}

# Create startup script
create_startup_script() {
    log_info "Creating startup script..."
    
    cat > "$MVMEMORY_DIR/start.sh" << 'EOF'
#!/bin/bash
# MVMemory startup script

MVMEMORY_DIR="$HOME/.mvmemory"

# Activate Python environment
source "$MVMEMORY_DIR/venv/bin/activate"

# Set environment variables
export MVMEMORY_DB="$MVMEMORY_DIR/db/mvmemory.db"
export MVMEMORY_CACHE_DIR="$MVMEMORY_DIR/cache"
export MVMEMORY_LOG_LEVEL="${MVMEMORY_LOG_LEVEL:-info}"
export MVMEMORY_AUTO_INDEX="${MVMEMORY_AUTO_INDEX:-true}"
export MVMEMORY_WATCH_FILES="${MVMEMORY_WATCH_FILES:-true}"

# Start MVMemory MCP server
node "$(dirname "$0")/../dist/mcp/MCPServer.js" "$@"
EOF
    
    chmod +x "$MVMEMORY_DIR/start.sh"
    
    log_success "Startup script created"
}

# Create uninstall script
create_uninstall_script() {
    log_info "Creating uninstall script..."
    
    cat > "$MVMEMORY_DIR/uninstall.sh" << 'EOF'
#!/bin/bash
# MVMemory uninstall script

echo "This will remove MVMemory and all its data."
read -p "Are you sure? (y/N): " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Removing MVMemory..."
    
    # Restore Claude config backup if it exists
    CLAUDE_CONFIG="$HOME/.config/claude/claude_desktop_config.json"
    if [ -f "$CLAUDE_CONFIG.backup"* ]; then
        latest_backup=$(ls -t "$CLAUDE_CONFIG.backup"* | head -1)
        cp "$latest_backup" "$CLAUDE_CONFIG"
        echo "Claude configuration restored from backup"
    fi
    
    # Remove MVMemory directory
    rm -rf "$HOME/.mvmemory"
    
    echo "MVMemory uninstalled successfully"
else
    echo "Uninstall cancelled"
fi
EOF
    
    chmod +x "$MVMEMORY_DIR/uninstall.sh"
    
    log_success "Uninstall script created"
}

# Test installation
test_installation() {
    log_info "Testing installation..."
    
    # Test Python environment
    source "$MVMEMORY_DIR/venv/bin/activate"
    
    python3 -c "
import sys
try:
    import faiss
    import sentence_transformers
    import numpy
    import torch
    print('✓ All Python dependencies available')
except ImportError as e:
    print(f'✗ Missing Python dependency: {e}')
    sys.exit(1)
"
    
    # Test Node.js build
    if [ -f "dist/mcp/MCPServer.js" ]; then
        log_success "✓ TypeScript build successful"
    else
        log_error "✗ TypeScript build missing"
        exit 1
    fi
    
    # Test configuration
    if [ -f "$CLAUDE_CONFIG_FILE" ]; then
        log_success "✓ Claude configuration created"
    else
        log_error "✗ Claude configuration missing"
        exit 1
    fi
    
    log_success "Installation test passed"
}

# Main installation function
main() {
    echo "=============================================="
    echo "       MVMemory Installation Script"
    echo "=============================================="
    echo ""
    
    log_info "Starting MVMemory installation..."
    echo ""
    
    # Check if we're in the right directory
    if [ ! -f "package.json" ] || ! grep -q "mvmemory" package.json; then
        log_error "Please run this script from the MVMemory project directory"
        exit 1
    fi
    
    # Installation steps
    install_system_deps
    verify_deps
    create_directories
    install_python_deps
    install_node_deps
    build_typescript
    download_models
    configure_claude
    create_startup_script
    create_uninstall_script
    test_installation
    
    echo ""
    echo "=============================================="
    log_success "MVMemory installation completed successfully!"
    echo "=============================================="
    echo ""
    log_info "Next steps:"
    echo "  1. Restart Claude desktop application"
    echo "  2. In Claude, try: 'index_project /path/to/your/code'"
    echo "  3. Then search with: 'semantic_search your query here'"
    echo ""
    log_info "Useful commands:"
    echo "  • Start manually: $MVMEMORY_DIR/start.sh"
    echo "  • View logs: tail -f $MVMEMORY_DIR/logs/*.log"
    echo "  • Uninstall: $MVMEMORY_DIR/uninstall.sh"
    echo ""
    log_info "For support, visit: https://github.com/mvmemory/mvmemory"
    echo ""
}

# Handle script interruption
trap 'log_error "Installation interrupted"; exit 1' INT TERM

# Run main installation
main "$@"