#!/usr/bin/env bash
# start-veronica.sh — Launch the Veronica super-app (Friday bridge + widget)
#
# Usage:
#   ./start-veronica.sh          — dev mode (Tauri hot-reload + bridge)
#   ./start-veronica.sh build    — build the app, then start bridge
#   ./start-veronica.sh bridge   — start only the Friday bridge
#   ./start-veronica.sh voice    — start bridge + MCP server + LiveKit voice agent

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
BRIDGE_PORT="${BRIDGE_PORT:-8001}"
MCP_PORT="${MCP_PORT:-8000}"

# ── Colour helpers ──────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[Veronica]${NC} $*"; }
warn() { echo -e "${YELLOW}[Veronica]${NC} $*"; }
die()  { echo -e "${RED}[Veronica]${NC} $*" >&2; exit 1; }

# ── Cleanup on exit ─────────────────────────────────────────────────────────
PIDS=()
cleanup() {
    log "Shutting down..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
}
trap cleanup EXIT INT TERM

# ── Project Friday submodule init ───────────────────────────────────────────
init_submodule() {
    local pf_dir="$SCRIPT_DIR/backend/project-friday"
    if [ -f "$pf_dir/.git" ] || { [ -d "$pf_dir/.git" ] && [ -n "$(ls -A "$pf_dir" 2>/dev/null)" ]; }; then
        return 0  # already initialised
    fi
    log "Initialising Project Friday submodule..."
    if git -C "$SCRIPT_DIR" submodule update --init --recursive backend/project-friday 2>/dev/null; then
        log "Project Friday submodule ready"
    else
        warn "Could not initialise Project Friday submodule — check credentials."
        warn "Run: git submodule update --init backend/project-friday"
        warn "Continuing with bundled stub tools."
    fi
}

# ── Pre-flight checks ───────────────────────────────────────────────────────
check_deps() {
    command -v uv   >/dev/null 2>&1 || die "uv not found. Install: curl -LsSf https://astral.sh/uv/install.sh | sh"
    command -v npm  >/dev/null 2>&1 || die "npm not found. Install Node.js from https://nodejs.org"
}

# ── Start Friday bridge ─────────────────────────────────────────────────────
start_bridge() {
    log "Starting Friday bridge on port $BRIDGE_PORT..."
    if ! [ -f "$BACKEND_DIR/.env" ]; then
        warn "No .env found in backend/ — copy backend/.env.example to backend/.env and fill in API keys"
    fi
    BRIDGE_PORT="$BRIDGE_PORT" uv run --project "$BACKEND_DIR" bridge &
    PIDS+=($!)
    log "Bridge PID: ${PIDS[-1]}"

    # Wait up to 5s for bridge to become ready
    for i in $(seq 1 10); do
        sleep 0.5
        if curl -sf "http://127.0.0.1:$BRIDGE_PORT/health" >/dev/null 2>&1; then
            log "Bridge ready at http://127.0.0.1:$BRIDGE_PORT"
            return 0
        fi
    done
    warn "Bridge did not respond in time — continuing anyway (it may still be starting)"
}

# ── Start Friday MCP server ─────────────────────────────────────────────────
start_mcp() {
    log "Starting Friday MCP server on port $MCP_PORT..."
    uv run --project "$BACKEND_DIR" friday &
    PIDS+=($!)
    log "MCP PID: ${PIDS[-1]}"
}

# ── Start voice agent ───────────────────────────────────────────────────────
start_voice() {
    log "Starting Veronica voice agent (LiveKit)..."
    uv run --project "$BACKEND_DIR" friday_voice dev &
    PIDS+=($!)
    log "Voice PID: ${PIDS[-1]}"
}

# ── Main ────────────────────────────────────────────────────────────────────
MODE="${1:-dev}"
check_deps
init_submodule

case "$MODE" in
    bridge)
        start_bridge
        log "Bridge running. Press Ctrl+C to stop."
        wait
        ;;
    voice)
        start_bridge
        start_mcp
        start_voice
        log "Bridge + MCP + voice agent running. Press Ctrl+C to stop."
        wait
        ;;
    build)
        start_bridge
        log "Building Veronica widget..."
        cd "$SCRIPT_DIR" && npm run tauri build
        ;;
    dev|*)
        start_bridge
        log "Starting Veronica widget in dev mode..."
        cd "$SCRIPT_DIR" && npm run tauri dev
        ;;
esac
