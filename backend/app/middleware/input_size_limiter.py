"""
Input size limiting middleware.

Checks the Content-Length header and rejects requests whose body exceeds
MAX_INPUT_SIZE_BYTES with HTTP 413 Payload Too Large — without reading
the body.
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.utils.logger import get_logger

logger = get_logger("size_limit")


class InputSizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests whose Content-Length exceeds *max_bytes*."""

    def __init__(self, app, max_bytes: int = 50_000) -> None:  # noqa: ANN001
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        content_length = request.headers.get("content-length")

        if content_length is not None:
            try:
                length = int(content_length)
            except ValueError:
                length = 0

            if length > self.max_bytes:
                logger.warning(
                    "Payload too large: %d bytes (limit %d)  %s %s",
                    length,
                    self.max_bytes,
                    request.method,
                    request.url.path,
                )
                return JSONResponse(
                    status_code=413,
                    content={
                        "error": True,
                        "error_code": "PAYLOAD_TOO_LARGE",
                        "message": (
                            f"Request body ({length:,} bytes) exceeds the "
                            f"maximum allowed size ({self.max_bytes:,} bytes)."
                        ),
                        "details": {},
                    },
                )

        return await call_next(request)
