"""
Request logging middleware.

Logs HTTP method, path, response status code, response time (ms),
and client IP for every request. Never logs request bodies.
"""

from __future__ import annotations

import time

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.utils.logger import get_logger

logger = get_logger("request")


class RequestLoggerMiddleware(BaseHTTPMiddleware):
    """Logs method, path, status, duration, and client IP for each request."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        start = time.perf_counter()

        # Process the request
        response = await call_next(request)

        duration_ms = (time.perf_counter() - start) * 1000
        client_ip = request.client.host if request.client else "unknown"

        logger.info(
            "%s %s → %d  %.1fms  ip=%s",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            client_ip,
        )

        return response
