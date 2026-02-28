"""
FastAPI application entry point.

Creates the FastAPI app instance, registers middleware (CORS, rate limiting,
error handling), mounts route routers, and defines the health-check endpoint.
"""

import subprocess
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from app.config import get_settings
from app.middleware.cors import setup_cors
from app.middleware.error_handler import setup_error_handlers
from app.middleware.input_size_limiter import InputSizeLimitMiddleware
from app.middleware.rate_limiter import setup_rate_limiter
from app.middleware.request_logger import RequestLoggerMiddleware
from app.routes.chat import router as chat_router
from app.routes.compile import router as compile_router
from app.routes.convert import router as convert_router
from app.routes.deploy import router as deploy_router
from app.utils.logger import get_logger

logger = get_logger(__name__)


def _verify_dependencies() -> None:
    """Check that AlgoKit / PuyaPy are available on the system."""
    # Check AlgoKit CLI (used to invoke Puya with proper project context)
    try:
        result = subprocess.run(
            ["algokit", "--version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            version = result.stdout.strip() or result.stderr.strip()
            logger.info("✅ AlgoKit CLI ready: %s", version)
        else:
            logger.warning(
                "⚠️  AlgoKit returned non-zero exit code. "
                "Compilation may fail. Install with: pipx install algokit"
            )
    except FileNotFoundError:
        logger.warning(
            "⚠️  AlgoKit CLI not found on PATH. "
            "Compilation will fail. Install with: pipx install algokit"
        )
    except Exception as exc:
        logger.warning("⚠️  AlgoKit check failed: %s", exc)

    # Also check PuyaPy is installed (AlgoKit delegates to it)
    try:
        result = subprocess.run(
            ["puyapy", "--version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            version = result.stdout.strip() or result.stderr.strip()
            logger.info("✅ PuyaPy compiler ready: %s", version)
        else:
            logger.warning(
                "⚠️  PuyaPy returned non-zero exit code. "
                "Install with: pip install puyapy"
            )
    except FileNotFoundError:
        logger.warning(
            "⚠️  PuyaPy compiler not found on PATH. "
            "Install with: pip install puyapy"
        )
    except Exception as exc:
        logger.warning("⚠️  PuyaPy check failed: %s", exc)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan: runs on startup and shutdown."""
    settings = get_settings()
    logger.info(
        "AlgoMint API started  env=%s  origins=%s",
        settings.ENVIRONMENT,
        settings.allowed_origins_list,
    )
    _verify_dependencies()
    yield
    logger.info("AlgoMint API shutting down")


app = FastAPI(
    title="AlgoMint API",
    version="1.0.0",
    description="Solidity → PyTeal → TEAL conversion and Algorand deployment API",
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────
setup_cors(app)
setup_error_handlers(app)
setup_rate_limiter(app)

# Request logging (logs method, path, status, duration, IP)
app.add_middleware(RequestLoggerMiddleware)

# Input size limiting (rejects bodies > limit with 413)
# Allow up to 200KB to accommodate Solidity code + AST analysis payload
settings = get_settings()
app.add_middleware(InputSizeLimitMiddleware, max_bytes=200_000)

# ── Routes ────────────────────────────────────────────────────
app.include_router(convert_router, prefix="/api/v1")
app.include_router(compile_router, prefix="/api/v1")
app.include_router(deploy_router, prefix="/api/v1")
app.include_router(chat_router, prefix="/api/v1")


# ── Health Check ──────────────────────────────────────────────
@app.get("/health", tags=["system"])
async def health_check() -> dict:
    """Return API health status."""
    return {"status": "ok", "version": "1.0.0"}
