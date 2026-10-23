"""Module entry point for the DQX Studio backend.

Databricks Apps injects the assigned port as ``DATABRICKS_APP_PORT`` and expects
the process to bind it on all interfaces; ``8000`` is the local-development
fallback. The previous ``uvicorn`` CLI invocation bound its ``127.0.0.1:8000``
defaults, which only worked while the runtime happened to assign port 8000.
"""

import os

import uvicorn


def main() -> None:
    """Start the DQX Studio FastAPI app under uvicorn."""
    port = int(os.environ.get("DATABRICKS_APP_PORT", "8000"))
    uvicorn.run(
        "databricks_labs_dqx_app.backend.app:app",
        host="0.0.0.0",
        port=port,
        workers=1,
    )


if __name__ == "__main__":
    main()
