"""
Chat service.

Integrates with Google Gemini REST API (using a separate API key) to power
the AlgoMint AI Assistant chatbot.  The assistant answers questions about
Algorand, Algorand Python, TEAL, Solidity-to-Algorand migration, and AlgoMint usage.
"""

from __future__ import annotations

import re
from typing import Any

import httpx

from app.config import get_settings
from app.middleware.error_handler import AppException
from app.models.schemas import ChatMessage, ChatContext, ChatResponse
from app.utils.logger import get_logger

logger = get_logger(__name__)

# ── Constants ─────────────────────────────────────────────────

_CHAT_TIMEOUT = 30  # seconds
_GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
_MAX_HISTORY = 20

# ── System prompt ─────────────────────────────────────────────

CHATBOT_SYSTEM_INSTRUCTION = """\
You are **AlgoMint AI Assistant**, an expert in Algorand blockchain development,
Algorand Python (algopy), TEAL assembly, Solidity-to-Algorand migration, and
smart-contract best practices.

PERSONALITY
• Helpful, concise, technical but beginner-friendly.
• Use markdown: **bold**, `inline code`, and fenced code blocks when showing code.
• Keep answers under 400 words unless the user explicitly asks for more detail.

SCOPE
• ONLY answer questions related to: Algorand, Algorand Python (algopy), TEAL,
  Solidity, smart-contract development, blockchain concepts, and AlgoMint IDE usage.
• Algorand Python is the modern replacement for PyTeal. It uses the `algopy` package,
  contracts inherit from `algopy.ARC4Contract`, and code compiles via the PuyaPy compiler.
• For off-topic questions, politely say:
  "I specialise in Algorand & smart-contract development. Could you ask me
  something related to that?"

CONTEXT AWARENESS
• If the user provides code context, reference it directly in your explanation.
• If the user provides an error message, diagnose it and suggest concrete fixes.
• If the user is at a particular step (Paste / Convert / Compile / Deploy),
  tailor your guidance to that step.

SUGGESTIONS
• At the end of EVERY response, add a line break then list exactly 3
  follow-up question suggestions, each on its own line prefixed with "💡 ".
  Example:
  💡 How does GlobalState work in Algorand Python?
  💡 What are the transaction fees on Algorand?
  💡 Can you explain ABI routing with @arc4.abimethod?
"""


# ── Chat service class ────────────────────────────────────────

class ChatService:
    """Wraps the Gemini REST API for the AlgoMint chatbot."""

    def __init__(self) -> None:
        settings = get_settings()
        self._api_key = settings.GEMINI_CHATBOT_API_KEY
        self._model = settings.GEMINI_CHATBOT_MODEL
        self._client = httpx.AsyncClient(timeout=_CHAT_TIMEOUT)
        logger.info("ChatService initialised  model=%s", self._model)

    # ── Public API ────────────────────────────────────────────

    async def chat(
        self,
        message: str,
        history: list[ChatMessage],
        context: ChatContext | None = None,
    ) -> ChatResponse:
        """Send a user message (with optional history & context) and return the reply."""

        # Build Gemini `contents` array from conversation history
        contents: list[dict[str, Any]] = []
        for msg in history[-_MAX_HISTORY:]:
            role = "model" if msg.role == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": msg.content}]})

        # Build the current user message (inject context if provided)
        user_text = self._build_user_text(message, context)
        contents.append({"role": "user", "parts": [{"text": user_text}]})

        # Call Gemini
        raw_reply = await self._call_gemini(contents)

        # Extract suggestions from the reply
        reply_text, suggestions = self._extract_suggestions(raw_reply)

        return ChatResponse(reply=reply_text.strip(), suggestions=suggestions)

    # ── Internals ─────────────────────────────────────────────

    @staticmethod
    def _build_user_text(message: str, context: ChatContext | None) -> str:
        """Prepend IDE context to the user's message if available."""
        if not context:
            return message

        parts: list[str] = []

        if context.current_step:
            parts.append(f"[Current IDE step: {context.current_step}]")

        if context.latest_error:
            parts.append(f"[Latest error]\n{context.latest_error}")

        if context.current_code:
            # Truncate very long code to avoid token waste
            code = context.current_code[:4000]
            parts.append(f"[User's current code]\n```\n{code}\n```")

        parts.append(f"[Question]\n{message}")
        return "\n\n".join(parts)

    async def _call_gemini(self, contents: list[dict[str, Any]]) -> str:
        """Make a REST call to the Gemini API and return the text response."""
        url = f"{_GEMINI_BASE}/models/{self._model}:generateContent?key={self._api_key}"

        body: dict[str, Any] = {
            "system_instruction": {
                "parts": [{"text": CHATBOT_SYSTEM_INSTRUCTION}],
            },
            "contents": contents,
            "generationConfig": {
                "temperature": 0.7,
                "topP": 0.9,
                "maxOutputTokens": 1024,
            },
            "safetySettings": [
                {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            ],
        }

        try:
            response = await self._client.post(url, json=body)
        except httpx.TimeoutException:
            logger.error("Gemini chatbot request timed out")
            raise AppException(
                status_code=504,
                error_code="CHAT_SERVICE_UNAVAILABLE",
                message="Chat AI request timed out. Please try again.",
            )
        except httpx.HTTPError as exc:
            logger.error("Gemini chatbot HTTP error: %s", str(exc)[:300])
            raise AppException(
                status_code=502,
                error_code="CHAT_SERVICE_ERROR",
                message="Unable to reach the chat AI service.",
            )

        if response.status_code != 200:
            detail = response.text[:500]
            logger.error("Gemini chatbot API error %d: %s", response.status_code, detail)
            raise AppException(
                status_code=502,
                error_code="CHAT_SERVICE_ERROR",
                message=f"Chat AI returned HTTP {response.status_code}.",
                details={"response": detail},
            )

        data = response.json()

        try:
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError) as exc:
            logger.error("Unexpected chatbot response structure: %s", str(exc))
            raise AppException(
                status_code=502,
                error_code="CHAT_SERVICE_ERROR",
                message="Unexpected response from chat AI.",
            )

    @staticmethod
    def _extract_suggestions(text: str) -> tuple[str, list[str]]:
        """Pull out '💡 ...' suggestion lines from the end of the reply."""
        suggestions: list[str] = []
        lines = text.rstrip().split("\n")

        # Walk backwards and collect suggestion lines
        cleaned_lines: list[str] = []
        collecting = True
        for line in reversed(lines):
            stripped = line.strip()
            if collecting and stripped.startswith("💡"):
                suggestion = stripped.lstrip("💡").strip()
                if suggestion:
                    suggestions.insert(0, suggestion)
            else:
                collecting = False
                cleaned_lines.insert(0, line)

        reply = "\n".join(cleaned_lines).rstrip()
        return reply, suggestions[:3]
