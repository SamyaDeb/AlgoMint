"""
Analyze route — contract structure analysis for the visual explorer.

POST /api/v1/analyze       → single-contract analysis
POST /api/v1/analyze-multi → multi-contract analysis
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from app.models.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    MultiAnalyzeRequest,
    MultiAnalyzeResponse,
)
from app.services.contract_analyzer import analyze_contract, analyze_multi_contract
from app.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/analyze", tags=["analyze"])


@router.post("", response_model=AnalyzeResponse)
async def analyze_single(req: AnalyzeRequest, request: Request):
    """Analyze a single Algorand Python contract for visualization."""
    logger.info(
        "Analyze request — code length=%d, has_arc32=%s, has_solidity=%s",
        len(req.algorand_python_code),
        req.arc32_json is not None,
        req.solidity_code is not None,
    )
    result = analyze_contract(
        algopy_code=req.algorand_python_code,
        arc32_json=req.arc32_json,
        solidity_code=req.solidity_code,
    )
    return result


@router.post("-multi", response_model=MultiAnalyzeResponse)
async def analyze_multi(req: MultiAnalyzeRequest, request: Request):
    """Analyze multiple contracts together and detect inter-contract relationships."""
    logger.info("Multi-analyze request — %d contracts", len(req.contracts))
    contracts_data = [
        {
            "name": c.name,
            "algopy_code": c.algorand_python_code,
            "arc32_json": c.arc32_json,
            "solidity_code": c.solidity_code,
        }
        for c in req.contracts
    ]
    result = analyze_multi_contract(contracts_data)
    return result
