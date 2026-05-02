# Veronica

Veronica is a floating circular AI assistant widget for macOS — the unified super-app that merges **Friday Core** (the Tauri v2 desktop shell) with **Project Friday** (the Python AI brain).

Iron Man arc-reactor aesthetic. Local-first. Always on top. Always watching.

> **Replaces** `Srimi1/Friday-core`. All future development happens here.

---

## What it does

- **Holographic widget** — radial filaments + sphere wireframe + pulsing core, drawn on Canvas 2D
- **Click → conversation** — input dialog → LLM → spoken reply (or mic if voice mode enabled)
- **Voice pipeline** — LiveKit + Sarvam STT / Gemini LLM / Deepgram TTS
- **Multi-turn memory** — keeps last 12 conversation turns in context
- **Tool calling** — AI can read/write files, run shell, open apps, search web, get time, battery, calendar, control volume
- **Smart click-through** — clicks outside the circle pass to the app below
- **Position lock** (⌘⇧L), tray menu, persistent position
- **Phase system** — Project Friday phases plug in at boot via `registerPhase()`, isolated from core

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Veronica widget (140×140 transparent, always-on-top)    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Friday Core  (stable runtime — src/)            │    │
│  │   • renderer.js   — Canvas 2D hologram           │    │
│  │   • state-machine.js  — 5 visual states          │    │
│  │   • interactions.js  — click / drag / menu       │    │
│  └──────────────────────┬───────────────────────────┘    │
│                         │ VeronicaAPI                    │
│  ┌──────────────────────▼───────────────────────────┐    │
│  │  Phase system  (src/veronica/)                   │    │
│  │   • veronica-api.js  — stable phase contract     │    │
│  │   • phase-registry.js  — phase lifecycle         │    │
│  │   • phases/friday-phase.js  — bridge health      │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────┬───────────────────────────────────┘
                       │ tauri invoke
┌──────────────────────▼───────────────────────────────────┐
│  Rust backend  (src-tauri/)                               │
│   • window management, click-through, tray, shortcuts    │
│   • chat loop (Ollama → Anthropic → Bedrock)             │
│   • tools: file / shell / web / sys                      │
└──────────────────────┬───────────────────────────────────┘
                       │ HTTP (port 8001)
┌──────────────────────▼───────────────────────────────────┐
│  Python backend  (backend/)                               │
│                                                          │
│  ┌───────────────────────────────────────────────────┐   │
│  │  bridge.py — HTTP REST adapter (port 8001)        │   │
│  │  server.py — FastMCP server (port 8000)           │   │
│  │  agent_friday.py — LiveKit voice agent            │   │
│  └────────────────────┬──────────────────────────────┘   │
│                       │ imports                          │
│  ┌────────────────────▼──────────────────────────────┐   │
│  │  backend/friday/  — shim layer                    │   │
│  │   delegates to project-friday if initialised      │   │
│  │   falls back to bundled stubs otherwise            │   │
│  └────────────────────┬──────────────────────────────┘   │
│                       │                                  │
│  ┌────────────────────▼──────────────────────────────┐   │
│  │  backend/project-friday/  ← git submodule         │   │
│  │  Srimi1/Project_Friday — the AI brain             │   │
│  │  (tools, prompts, resources, agents)              │   │
│  └───────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

---

## Repository structure

```
Veronica/
├── src/                   # JS frontend (Friday Core + phase system)
│   └── veronica/
│       └── phases/        # Project Friday phases live here
├── src-tauri/             # Rust backend (Tauri v2)
├── backend/
│   ├── bridge.py          # HTTP REST adapter for Rust → Python tool calls
│   ├── server.py          # FastMCP server (MCP SSE, port 8000)
│   ├── agent_friday.py    # LiveKit voice agent
│   ├── friday/            # Shim layer — routes to project-friday or stubs
│   └── project-friday/    # ← git submodule (Srimi1/Project_Friday)
├── package.json
├── vite.config.js
├── start-veronica.sh      # Unified launcher
└── .gitmodules
```

---

## Quick start

### 1. Clone with submodule

```bash
git clone --recurse-submodules https://github.com/Srimi1/Veronica.git
cd Veronica
```

If you already cloned without `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

### 2. Prerequisites

```bash
# Toolchain
brew install node
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
brew install sox        # voice input only

# Local LLM (optional — used by Rust chat loop)
brew install ollama
ollama pull qwen2.5:7b
ollama serve

# Python package manager
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 3. API keys (optional)

Keys live in `~/.friday/`, never in the repo.

```bash
mkdir -p ~/.friday && chmod 700 ~/.friday
echo 'YOUR_LEMONFOX_KEY'  > ~/.friday/lemonfox-key && chmod 600 ~/.friday/lemonfox-key
echo 'sk-ant-...'         > ~/.friday/anthropic-key && chmod 600 ~/.friday/anthropic-key
```

Copy and fill in `backend/.env.example` → `backend/.env` for LiveKit / Deepgram / Sarvam / Google keys.

### 4. Run

```bash
./start-veronica.sh          # dev mode — Tauri hot-reload + bridge
./start-veronica.sh build    # production build
./start-veronica.sh voice    # dev + MCP server + LiveKit voice agent
./start-veronica.sh bridge   # Python bridge only
```

---

## Working on Project Friday

`backend/project-friday/` is a git submodule pointing to `Srimi1/Project_Friday`. It is a full git repository — you can develop inside it and push independently.

```bash
# Enter the submodule
cd backend/project-friday

# Make improvements, commit
git add .
git commit -m "Add new tool: ..."
git push origin main        # pushes to Srimi1/Project_Friday

# Back in Veronica — record the new submodule pointer
cd ../..
git add backend/project-friday
git commit -m "Bump project-friday to latest"
git push
```

**Pull the latest Project Friday into Veronica:**

```bash
git submodule update --remote backend/project-friday
git add backend/project-friday
git commit -m "Update project-friday submodule"
```

**How the shim layer works:**

`backend/friday/tools/__init__.py`, `prompts/__init__.py`, and `resources/__init__.py` each try to delegate to `project_friday.*` first. If the submodule is not yet initialised, they fall back to bundled stub implementations so the app always starts cleanly.

---

## Phase system

Extend Veronica by writing a Project Friday phase — a plain JS object with `init(api)`:

```js
// src/veronica/phases/my-phase.js
import { registerPhase } from '../phase-registry.js';

registerPhase({
  name: 'my-phase',
  version: '1.0.0',

  async init(api) {
    api.onStateChange(state => console.log('[my-phase] state:', state));
    api.emit('my-phase:ready', {});
  },
});
```

Import it in `src/main.js` before `initPhases()` is called. Phases are fully isolated — a crashing phase never affects Friday Core or other phases.

---

## Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri v2 (Rust) |
| UI renderer | HTML / Canvas 2D / JS |
| LLM (chat loop) | Ollama → Anthropic → Bedrock |
| STT | Sarvam (`saaras:v3`) |
| LLM (voice) | Gemini 2.5 Flash |
| TTS | Deepgram (`aura-2-andromeda-en`) |
| Voice transport | LiveKit |
| MCP server | FastMCP (Python) |
| HTTP bridge | FastAPI / Uvicorn |

---

## Debug console (dev mode)

```js
window.VERONICA.phases()                    // list all phases + status
window.VERONICA.api.setState('ALERT')       // drive state
window.VERONICA.friday.isOnline()           // bridge health
window.VERONICA.friday.fetchNews()          // call world_news tool
window.FRIDAY.stateMachine.state            // internal state (backwards compat)
```

---

## Migrating from friday-core

`Srimi1/Friday-core` is superseded by this repo. There are no breaking changes — port numbers, window config, and API keys are identical. Just clone Veronica and run `./start-veronica.sh`.

---

## License

MIT
