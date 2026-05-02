"""
Tool registry — delegates to Project Friday tools when the submodule is
populated; falls back to bundled stubs otherwise.
"""


def register_all_tools(mcp):
    """Register all tool groups onto the MCP server instance."""
    try:
        import project_friday.tools as pf_tools
        if hasattr(pf_tools, "register_all_tools"):
            pf_tools.register_all_tools(mcp)
            return
    except ImportError:
        pass
    # Submodule not yet initialised — use bundled stub implementations.
    from . import web, system, utils
    web.register(mcp)
    system.register(mcp)
    utils.register(mcp)
