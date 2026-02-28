"""
Deploy routes.

POST /api/v1/deploy/prepare — builds an unsigned ApplicationCreateTxn.
POST /api/v1/deploy/submit  — submits a signed transaction to the Algorand network.
"""

from fastapi import APIRouter, Request

from app.middleware.rate_limiter import limiter
from app.models.schemas import (
    DeployRequest,
    DeployResponse,
    ErrorResponse,
    SubmitRequest,
    SubmitResponse,
)
from app.services.algorand_service import AlgorandService
from app.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/deploy", tags=["deploy"])


@router.post(
    "/prepare",
    response_model=DeployResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Validation / compile error"},
        429: {"model": ErrorResponse, "description": "Rate limit exceeded"},
        502: {"model": ErrorResponse, "description": "Algorand node error"},
    },
    summary="Prepare an unsigned application-create transaction",
)
@limiter.limit("10/minute")
async def deploy_prepare(request: Request, body: DeployRequest) -> DeployResponse:
    """Compile TEAL and return data for client-side transaction building."""
    svc = AlgorandService(network=body.network)

    data = await svc.prepare_deploy_data(
        sender=body.sender,
        approval_teal=body.approval_teal,
        clear_teal=body.clear_teal,
    )

    return DeployResponse(**data)


@router.post(
    "/submit",
    response_model=SubmitResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid signed transaction"},
        429: {"model": ErrorResponse, "description": "Rate limit exceeded"},
        502: {"model": ErrorResponse, "description": "Submission failed"},
    },
    summary="Submit a signed transaction to the Algorand network",
)
@limiter.limit("5/minute")
async def deploy_submit(request: Request, body: SubmitRequest) -> SubmitResponse:
    """Submit a wallet-signed transaction and wait for confirmation."""
    svc = AlgorandService(network=body.network)

    txid, explorer_url, app_id = await svc.submit_signed_txn(body.signed_txn)

    return SubmitResponse(txid=txid, explorer_url=explorer_url, app_id=app_id)