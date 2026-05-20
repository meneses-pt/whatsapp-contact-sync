#!/bin/bash

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/server"
FRONTEND_DIR="$PROJECT_ROOT/web"
PID_FILE="$PROJECT_ROOT/.pids"

# Function to kill port
kill_port() {
    local PORT=$1
    echo -e "${YELLOW}Checking for processes on port $PORT...${NC}"
    local PORT_PID=$(lsof -ti:$PORT 2>/dev/null)
    if [ -n "$PORT_PID" ]; then
        echo -e "${YELLOW}Killing process(es) on port $PORT${NC}"
        kill -9 $PORT_PID 2>/dev/null || true
        sleep 1
    fi
}

# Function to start services
start() {
    echo -e "${YELLOW}Starting backend and frontend...${NC}"
    echo ""

    # Clean up all ports
    kill_port 4000
    kill_port 4001
    kill_port 3000
    kill_port 8080

    # Start backend
    echo -e "${YELLOW}════ Backend (port 8080) ════${NC}"
    cd "$BACKEND_DIR"
    npm run dev &
    BACKEND_PID=$!
    echo $BACKEND_PID > "$PID_FILE.backend"

    echo ""

    # Start frontend
    echo -e "${YELLOW}════ Frontend (port 4000) ════${NC}"
    cd "$FRONTEND_DIR"
    npm run dev &
    FRONTEND_PID=$!
    echo $FRONTEND_PID > "$PID_FILE.frontend"

    echo ""
    echo -e "${GREEN}Both services started in console!${NC}"
    echo -e "Press Ctrl+C in the main terminal to stop both services"
    echo ""

    # Wait for both processes
    wait $BACKEND_PID $FRONTEND_PID
}

# Function to stop services
stop() {
    echo -e "${YELLOW}Stopping services...${NC}"

    # Stop backend
    if [ -f "$PID_FILE.backend" ]; then
        BACKEND_PID=$(cat "$PID_FILE.backend")
        if kill -0 "$BACKEND_PID" 2>/dev/null; then
            kill "$BACKEND_PID"
            echo -e "${GREEN}✓ Backend stopped (PID: $BACKEND_PID)${NC}"
        fi
        rm "$PID_FILE.backend"
    fi

    # Stop frontend
    if [ -f "$PID_FILE.frontend" ]; then
        FRONTEND_PID=$(cat "$PID_FILE.frontend")
        if kill -0 "$FRONTEND_PID" 2>/dev/null; then
            kill "$FRONTEND_PID"
            echo -e "${GREEN}✓ Frontend stopped (PID: $FRONTEND_PID)${NC}"
        fi
        rm "$PID_FILE.frontend"
    fi

    echo -e "${GREEN}All services stopped!${NC}"
}

# Function to restart services
restart() {
    stop
    sleep 1
    start
}

# Function to show status
status() {
    echo -e "${YELLOW}Service Status:${NC}"

    if [ -f "$PID_FILE.backend" ]; then
        BACKEND_PID=$(cat "$PID_FILE.backend")
        if kill -0 "$BACKEND_PID" 2>/dev/null; then
            echo -e "${GREEN}✓ Backend running (PID: $BACKEND_PID)${NC}"
        else
            echo -e "${RED}✗ Backend not running (stale PID: $BACKEND_PID)${NC}"
        fi
    else
        echo -e "${RED}✗ Backend not running${NC}"
    fi

    if [ -f "$PID_FILE.frontend" ]; then
        FRONTEND_PID=$(cat "$PID_FILE.frontend")
        if kill -0 "$FRONTEND_PID" 2>/dev/null; then
            echo -e "${GREEN}✓ Frontend running (PID: $FRONTEND_PID)${NC}"
        else
            echo -e "${RED}✗ Frontend not running (stale PID: $FRONTEND_PID)${NC}"
        fi
    else
        echo -e "${RED}✗ Frontend not running${NC}"
    fi
}

# Function to forcefully clean everything
clean() {
    echo -e "${RED}⚠️  Forcing cleanup of all ports and processes...${NC}"
    echo ""

    # Kill all node processes
    echo -e "${YELLOW}Killing all node processes...${NC}"
    pkill -9 node 2>/dev/null || true
    pkill -9 npm 2>/dev/null || true
    pkill -9 ts-node 2>/dev/null || true
    pkill -9 nodemon 2>/dev/null || true

    # Clean up all common ports
    kill_port 3000
    kill_port 4000
    kill_port 4001
    kill_port 8080

    # Clean up PID files
    rm -f "$PID_FILE.backend" 2>/dev/null || true
    rm -f "$PID_FILE.frontend" 2>/dev/null || true

    sleep 2
    echo -e "${GREEN}✓ All processes and ports cleaned!${NC}"
}

# Function to show usage
usage() {
    echo "WhatsApp Contact Sync - Service Manager"
    echo ""
    echo "Usage: $0 {start|stop|restart|status|clean}"
    echo ""
    echo "Commands:"
    echo "  start    - Start both backend and frontend (logs in console, Ctrl+C to stop)"
    echo "  stop     - Stop both backend and frontend"
    echo "  restart  - Restart both services"
    echo "  status   - Show service status"
    echo "  clean    - Force cleanup all ports and node processes (use if stuck)"
}

# Main
case "${1:-}" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    status)
        status
        ;;
    clean)
        clean
        ;;
    *)
        usage
        exit 1
        ;;
esac




