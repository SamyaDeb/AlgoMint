"""
Convert route.

POST /api/v1/convert — accepts Solidity code and returns converted Algorand Python
via the AI service.
"""

from fastapi import APIRouter, Request

from app.middleware.rate_limiter import AI_RATE_LIMIT, limiter
from app.models.schemas import ConvertRequest, ConvertResponse, ErrorResponse, FixRequest
from app.services.ai_service import AIService
from app.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/convert", tags=["convert"])

_ai_service = AIService()


@router.post(
    "",
    response_model=ConvertResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Validation error"},
        429: {"model": ErrorResponse, "description": "Rate limit exceeded"},
        502: {"model": ErrorResponse, "description": "AI service error"},
    },
    summary="Convert Solidity to Algorand Python",
)
@limiter.limit(AI_RATE_LIMIT)
async def convert_solidity(request: Request, body: ConvertRequest) -> ConvertResponse:
    """Accept Solidity source code and return the AI-converted Algorand Python code."""
    result = await _ai_service.convert_solidity_to_algorand_python(
        body.solidity_code,
        ast_analysis=body.ast_analysis,
    )

    return result


@router.post(
    "/fix",
    response_model=ConvertResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Validation error"},
        429: {"model": ErrorResponse, "description": "Rate limit exceeded"},
        502: {"model": ErrorResponse, "description": "AI service error"},
    },
    summary="Fix broken Algorand Python using AI",
)
@limiter.limit(AI_RATE_LIMIT)
async def fix_algorand_python(request: Request, body: FixRequest) -> ConvertResponse:
    """Accept broken Algorand Python + error and return AI-fixed code."""
    result = await _ai_service.fix_algorand_python(
        solidity_code=body.solidity_code,
        algorand_python_code=body.algorand_python_code,
        error_message=body.error_message,
    )
    return result