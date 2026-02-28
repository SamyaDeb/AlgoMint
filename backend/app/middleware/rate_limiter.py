"""
Rate limiting middleware.

Uses slowapi to enforce per-IP request rate limits on API endpoints.
Exports a Limiter instance for use by route decorators.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.utils.logger import get_logger

logger = get_logger(__name__)

# ── Limiter instance (used by routes via @limiter.limit()) ────────────
limiter = Limiter(key_func=get_remote_address, default_limits=["30/minute"])

# Stricter limit string for AI-powered endpoints
AI_RATE_LIMIT = "10/minute"


def setup_rate_limiter(app: FastAPI) -> None:
    """Register the slowapi limiter and its error handler on the app."""
    app.state.limiter = limiter

    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_handler(_request: Request, exc: RateLimitExceeded) -> JSONResponse:
        logger.warning("Rate limit exceeded: %s", exc.detail)
        return JSONResponse(
            status_code=429,
            content={
                "error": True,
                "error_code": "RATE_LIMIT_EXCEEDED",
                "message": f"Too many requests. {exc.detail}",
                "details": {},
            },
        )
