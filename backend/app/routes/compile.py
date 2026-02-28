"""
Compile route.

POST /api/v1/compile — accepts Algorand Python code and returns compiled TEAL assembly,
ARC-32, and ARC-56 JSON specs via the compiler service (PuyaPy).
"""

from fastapi import APIRouter, Request

from app.middleware.rate_limiter import limiter
from app.models.schemas import CompileRequest, CompileResponse, ErrorResponse
from app.services.compiler_service import CompilerService
from app.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/compile", tags=["compile"])

_compiler = CompilerService()


@router.post(
    "",
    response_model=CompileResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Compilation error"},
        429: {"model": ErrorResponse, "description": "Rate limit exceeded"},
    },
    summary="Compile Algorand Python to TEAL assembly + ARC-32/ARC-56",
)
@limiter.limit("20/minute")
async def compile_algorand_python(request: Request, body: CompileRequest) -> CompileResponse:
    """Accept Algorand Python source code and return compiled TEAL + ARC-32/56 specs."""
    result = _compiler.compile_algorand_python(body.algorand_python_code)
    return result