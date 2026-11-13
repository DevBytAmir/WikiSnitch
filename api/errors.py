"""The error type and the handlers that give every error the same JSON body."""

from __future__ import annotations

import logging

from fastapi import Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class ApiError(Exception):
    """An expected failure with an HTTP status, a machine-readable code and a message."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    """Render an ``ApiError`` as ``{"error": {"code", "message"}}``."""
    return JSONResponse(
        status_code=exc.status,
        content={"error": {"code": exc.code, "message": exc.message}},
    )


async def internal_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Log an unexpected exception and answer 500 without revealing any detail."""
    logger.exception("Unhandled API exception", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "internal", "message": "Internal error."}},
    )
