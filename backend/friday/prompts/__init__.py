"""
MCP Prompts — delegates to Project Friday prompts when the submodule is
populated; falls back to bundled stubs otherwise.
"""


def register_all_prompts(mcp):
    try:
        import project_friday.prompts as pf_prompts
        if hasattr(pf_prompts, "register_all_prompts"):
            pf_prompts.register_all_prompts(mcp)
            return
    except ImportError:
        pass
    from . import templates
    templates.register(mcp)
