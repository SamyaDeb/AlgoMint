"""
Chat route.

Exposes POST /chat for the AlgoMint AI Assistant chatbot.
"""

from fastapi import APIRouter

from app.models.schemas import ChatRequest, ChatResponse
from app.services.chat_service import ChatService
from app.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["chat"])

# Singleton service instance
_chat_service = ChatService()


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    """Handle a chatbot message and return the AI reply."""
    logger.info(
        "Chat request  msg_len=%d  history_len=%d  has_context=%s",
        len(request.message),
        len(request.history),
        request.context is not None,
    )
    return await _chat_service.chat(
        message=request.message,
        history=request.history,
        context=request.context,
    )
