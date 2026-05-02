"""
MCP Resources — delegates to Project Friday resources when the submodule is
populated; falls back to bundled stubs otherwise.
"""


def register_all_resources(mcp):
    try:
        import project_friday.resources as pf_resources
        if hasattr(pf_resources, "register_all_resources"):
            pf_resources.register_all_resources(mcp)
            return
    except ImportError:
        pass
    from . import data
    data.register(mcp)
