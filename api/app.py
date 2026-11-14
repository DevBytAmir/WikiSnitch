"""The HTTP application: error handling, CORS and the routers."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.errors import ApiError, api_error_handler, internal_error_handler
from api.routes.articles import router as articles_router
from api.routes.ask import router as ask_router
from api.routes.health import router as health_router
from api.routes.paragraphs import router as paragraphs_router
from core.config import load_settings
from core.embedder import EmbedderUnavailable

logger = logging.getLogger(__name__)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[load_settings().web_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_exception_handler(ApiError, api_error_handler)


@app.exception_handler(EmbedderUnavailable)
async def embedder_error_handler(request: Request, exc: EmbedderUnavailable) -> JSONResponse:
    """The embedding service is down, so a question cannot be turned into a vector."""
    return JSONResponse(
        status_code=503,
        content={"error": {"code": "embedder_unavailable", "message": "Embedder unavailable."}},
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Invalid parameters get the same error body as every other error."""
    return JSONResponse(
        status_code=400,
        content={"error": {"code": "bad_request", "message": "Invalid request."}},
    )


@app.exception_handler(404)
async def not_found_handler(request: Request, exc) -> JSONResponse:
    """Unknown routes use the common error body too."""
    return JSONResponse(
        status_code=404,
        content={"error": {"code": "not_found", "message": "Not found."}},
    )


app.add_exception_handler(Exception, internal_error_handler)


app.include_router(health_router)
app.include_router(articles_router)
app.include_router(paragraphs_router)
app.include_router(ask_router)
