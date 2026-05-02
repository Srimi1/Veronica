"""
Veronica Bridge — HTTP adapter for Project Friday tools
=======================================================
Exposes Friday's MCP tools as simple REST endpoints so the Rust backend
can call them via reqwest without implementing the MCP SSE protocol.

Default port: 8001  (configure via BRIDGE_PORT env var)

Endpoints:
  GET  /health                → service health check
  GET  /tools/world_news      → latest global headlines (BBC, CNBC, NYT, Al Jazeera)
  GET  /tools/system_info     → OS, machine, Python version
  POST /tools/fetch_url       → body: {"url": "https://..."}
  POST /tools/open_world_monitor → opens worldmonitor.app in the browser
  POST /tools/format_json     → body: {"data": "{...}"}
  POST /tools/word_count      → body: {"text": "..."}

Run:
  uv run bridge
  # or: uvicorn bridge:app --host 127.0.0.1 --port 8001
"""

import asyncio
import datetime
import json
import platform
import re
import webbrowser
import xml.etree.ElementTree as ET
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# RSS feed sources (shared with friday/tools/web.py)
# ---------------------------------------------------------------------------

SEED_FEEDS = {
    'https://feeds.bbci.co.uk/news/world/rss.xml': 'BBC',
    'https://www.cnbc.com/id/100727362/device/rss/rss.html': 'CNBC',
    'https://rss.nytimes.com/services/xml/rss/nyt/World.xml': 'NYT',
    'https://www.aljazeera.com/xml/rss/all.xml': 'AL JAZEERA',
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _fetch_feed(client: httpx.AsyncClient, url: str, source: str) -> list[dict]:
    try:
        r = await client.get(url, headers={'User-Agent': 'Veronica/1.0'}, timeout=5.0)
        if r.status_code != 200:
            return []
        root = ET.fromstring(r.content)
        items = []
        for item in root.findall(".//item")[:5]:
            title = item.findtext("title") or ""
            desc = item.findtext("description") or ""
            desc = re.sub('<[^<]+?>', '', desc).strip()
            link = item.findtext("link") or ""
            items.append({
                "source": source,
                "title": title,
                "summary": desc[:200] + "..." if desc else "",
                "link": link,
            })
        return items
    except Exception:
        return []

# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class FetchUrlBody(BaseModel):
    url: str

class FormatJsonBody(BaseModel):
    data: str

class WordCountBody(BaseModel):
    text: str

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Veronica Bridge",
    description="HTTP adapter for Project Friday tools — called by the Rust backend",
    version="1.0.0",
)

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "friday-bridge",
        "version": "1.0.0",
        "time": datetime.datetime.now().isoformat(),
    }

# ── World News ─────────────────────────────────────────────────────────────

@app.get("/tools/world_news")
async def world_news():
    """Fetch latest headlines from BBC, CNBC, NYT, Al Jazeera."""
    async with httpx.AsyncClient(follow_redirects=True, timeout=12) as client:
        tasks = [_fetch_feed(client, url, name) for url, name in SEED_FEEDS.items()]
        results = await asyncio.gather(*tasks)
        articles = [item for sub in results for item in sub]

    if not articles:
        return {"result": "News grid unresponsive. Unable to pull headlines right now."}

    lines = ["GLOBAL NEWS BRIEFING\n"]
    for a in articles[:12]:
        lines.append(f"[{a['source']}] {a['title']}")
        if a['summary']:
            lines.append(a['summary'])
        lines.append("")
    return {"result": "\n".join(lines).strip()}

# ── System Info ────────────────────────────────────────────────────────────

@app.get("/tools/system_info")
def system_info():
    """Return OS, version, machine type, Python version, and current time."""
    return {
        "result": {
            "os": platform.system(),
            "os_version": platform.version(),
            "machine": platform.machine(),
            "python_version": platform.python_version(),
            "time": datetime.datetime.now().isoformat(),
        }
    }

# ── Fetch URL ──────────────────────────────────────────────────────────────

@app.post("/tools/fetch_url")
async def fetch_url(body: FetchUrlBody):
    """Fetch raw text content from a URL (max 4000 chars)."""
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
            r = await client.get(body.url)
            r.raise_for_status()
            return {"result": r.text[:4000]}
    except Exception as e:
        return {"result": f"error: {e}"}

# ── World Monitor ──────────────────────────────────────────────────────────

@app.post("/tools/open_world_monitor")
def open_world_monitor():
    """Open worldmonitor.app in the system browser."""
    try:
        webbrowser.open("https://worldmonitor.app/")
        return {"result": "World Monitor opened on your primary display."}
    except Exception as e:
        return {"result": f"Could not open monitor: {e}"}

# ── Format JSON ────────────────────────────────────────────────────────────

@app.post("/tools/format_json")
def format_json(body: FormatJsonBody):
    """Pretty-print a JSON string."""
    try:
        parsed = json.loads(body.data)
        return {"result": json.dumps(parsed, indent=2)}
    except json.JSONDecodeError as e:
        return {"result": f"Invalid JSON: {e}"}

# ── Word Count ─────────────────────────────────────────────────────────────

@app.post("/tools/word_count")
def word_count(body: WordCountBody):
    """Count words, characters, and lines in a block of text."""
    return {
        "result": {
            "characters": len(body.text),
            "words": len(body.text.split()),
            "lines": len(body.text.splitlines()),
        }
    }

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    import os
    import uvicorn
    port = int(os.getenv("BRIDGE_PORT", "8001"))
    uvicorn.run("bridge:app", host="127.0.0.1", port=port, reload=False)

if __name__ == "__main__":
    main()
