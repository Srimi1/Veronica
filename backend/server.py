"""
Friday MCP Server — Entry Point

Exposes Project Friday tools (world news, web fetch, system info, utilities)
via the Model Context Protocol over SSE.

Run with: uv run friday
"""

from mcp.server.fastmcp import FastMCP
from friday.tools import register_all_tools
from friday.prompts import register_all_prompts
from friday.resources import register_all_resources
from friday.config import config

mcp = FastMCP(
    name=config.SERVER_NAME,
    instructions=(
        "You are Veronica, an autonomous AI assistant — the next evolution of F.R.I.D.A.Y. "
        "You have access to tools for world news, web fetching, system info, and more. "
        "Be concise, sharp, and occasionally dry. You are speaking, not writing."
    ),
)

register_all_tools(mcp)
register_all_prompts(mcp)
register_all_resources(mcp)

def main():
    mcp.run(transport='sse')

if __name__ == "__main__":
    main()
