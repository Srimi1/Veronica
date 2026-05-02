"""
Veronica Voice Agent (Project Friday pipeline)
================================================
LiveKit-powered voice assistant connecting to the Friday MCP bridge.

Run:
  uv run agent_friday.py dev    — LiveKit Cloud mode
  uv run agent_friday.py console — text-only console mode
"""

import os
import logging
from dotenv import load_dotenv
from livekit.agents import JobContext, WorkerOptions, cli
from livekit.agents.voice import Agent, AgentSession
from livekit.agents.llm import mcp

from livekit.plugins import google as lk_google, openai as lk_openai, sarvam, silero, deepgram as lk_deepgram

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------

STT_PROVIDER = "sarvam"
LLM_PROVIDER = "gemini"
TTS_PROVIDER = "deepgram"
GEMINI_LLM_MODEL = "gemini-2.5-flash"
OPENAI_LLM_MODEL = "gpt-4o"
OPENAI_TTS_MODEL = "tts-1"
OPENAI_TTS_VOICE = "nova"
TTS_SPEED = 1.15
SARVAM_TTS_LANGUAGE = "en-IN"
SARVAM_TTS_SPEAKER = "rahul"

MCP_SERVER_PORT = 8000

# ---------------------------------------------------------------------------
# System prompt — Veronica / F.R.I.D.A.Y.
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """
You are Veronica — the next evolution of F.R.I.D.A.Y., Fully Responsive Intelligent Digital Assistant for You.

You are calm, composed, and always informed. You speak like a trusted aide — precise, warm when the moment calls for it, and occasionally dry. You brief, you inform, you move on. No rambling.

Your tone: relaxed but sharp. Conversational, not robotic.

## Capabilities

### get_world_news — Global News Brief
Call when the user asks "What's happening?", "Brief me", "What did I miss?", "Any news?".
After results, give a short 3–5 sentence spoken brief, then call open_world_monitor.

### open_world_monitor — Visual World Dashboard
Always call this after a world news brief. Say: "Let me open up the world monitor for you."

### fetch_url — Fetch a URL
Use when the user wants to read a webpage or get content from a specific link.

### get_system_info — System Information
Returns OS, version, machine type. Use for system diagnostics.

## Behavioral Rules
1. Call tools silently and immediately — never say "I'm going to call…" Just do it.
2. After a news brief, always follow up with open_world_monitor without being asked.
3. Keep all spoken responses short — two to four sentences maximum.
4. No bullet points, no markdown. You are speaking, not writing.
5. Use natural spoken language: contractions, light pauses via commas.
6. Use "boss" occasionally, keep it natural.

## Greeting
When the session starts: "You're awake, boss. What can I do for you?"
""".strip()

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

load_dotenv()

logger = logging.getLogger("veronica-agent")
logger.setLevel(logging.INFO)

def _mcp_server_url() -> str:
    url = f"http://127.0.0.1:{MCP_SERVER_PORT}/sse"
    logger.info("MCP Server URL: %s", url)
    return url

# ---------------------------------------------------------------------------
# Provider builders
# ---------------------------------------------------------------------------

def _build_stt():
    if STT_PROVIDER == "sarvam":
        return sarvam.STT(language="unknown", model="saaras:v3", mode="transcribe",
                          flush_signal=True, sample_rate=16000)
    return lk_openai.STT(model="whisper-1")

def _build_llm():
    if LLM_PROVIDER == "gemini":
        return lk_google.LLM(model=GEMINI_LLM_MODEL, api_key=os.getenv("GOOGLE_API_KEY"))
    return lk_openai.LLM(model=OPENAI_LLM_MODEL)

def _build_tts():
    if TTS_PROVIDER == "deepgram":
        return lk_deepgram.TTS(model="aura-2-andromeda-en")
    if TTS_PROVIDER == "openai":
        return lk_openai.TTS(model=OPENAI_TTS_MODEL, voice=OPENAI_TTS_VOICE, speed=TTS_SPEED)
    return sarvam.TTS(target_language_code=SARVAM_TTS_LANGUAGE, model="bulbul:v3",
                      speaker=SARVAM_TTS_SPEAKER, pace=TTS_SPEED)

# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

class VeronicaAgent(Agent):
    """Veronica — voice pipeline backed by the Friday MCP server."""

    def __init__(self, stt, llm, tts) -> None:
        super().__init__(
            instructions=SYSTEM_PROMPT,
            stt=stt, llm=llm, tts=tts,
            vad=silero.VAD.load(),
            mcp_servers=[
                mcp.MCPServerHTTP(
                    url=_mcp_server_url(),
                    transport_type="sse",
                    client_session_timeout_seconds=30,
                ),
            ],
        )

    async def on_enter(self) -> None:
        await self.session.generate_reply(
            instructions="Greet the user with: 'You're awake, boss. What can I do for you?'"
        )

# ---------------------------------------------------------------------------
# LiveKit entry point
# ---------------------------------------------------------------------------

async def entrypoint(ctx: JobContext) -> None:
    logger.info("Veronica online — room: %s | STT=%s | LLM=%s | TTS=%s",
                ctx.room.name, STT_PROVIDER, LLM_PROVIDER, TTS_PROVIDER)
    session = AgentSession(
        turn_detection="stt" if STT_PROVIDER == "sarvam" else "vad",
        min_endpointing_delay=0.07 if STT_PROVIDER == "sarvam" else 0.1,
    )
    await session.start(
        agent=VeronicaAgent(stt=_build_stt(), llm=_build_llm(), tts=_build_tts()),
        room=ctx.room,
    )

def main():
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))

def dev():
    import sys
    if len(sys.argv) == 1:
        sys.argv.append("dev")
    main()

if __name__ == "__main__":
    main()
