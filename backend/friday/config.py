"""
Configuration — load environment variables and app-wide settings.
Delegates to project_friday.config when the submodule is populated;
falls back to the bundled stub otherwise.
"""

import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Server identity
    SERVER_NAME: str = os.getenv("SERVER_NAME", "Friday")
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"

    # External API keys
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
    SARVAM_API_KEY: str = os.getenv("SARVAM_API_KEY", "")
    DEEPGRAM_API_KEY: str = os.getenv("DEEPGRAM_API_KEY", "")
    SEARCH_API_KEY: str = os.getenv("SEARCH_API_KEY", "")

    # LiveKit (voice pipeline)
    LIVEKIT_URL: str = os.getenv("LIVEKIT_URL", "")
    LIVEKIT_API_KEY: str = os.getenv("LIVEKIT_API_KEY", "")
    LIVEKIT_API_SECRET: str = os.getenv("LIVEKIT_API_SECRET", "")

    # Bridge server port (used by Veronica Rust backend)
    BRIDGE_PORT: int = int(os.getenv("BRIDGE_PORT", "8001"))


# If Project Friday's submodule is initialised and exposes its own config,
# prefer it.  The bundled Config() above acts as a safe fallback.
try:
    from project_friday.config import config  # noqa: F401 — re-export
except ImportError:
    config = Config()
