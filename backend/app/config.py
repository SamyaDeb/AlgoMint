"""
Configuration loader.

Uses pydantic-settings to read environment variables from .env and expose
them as a typed Settings object. Provides a cached get_settings() accessor.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables / .env file."""

    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parent.parent / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Required ──────────────────────────────────────────────
    GEMINI_API_KEY: str

    # ── Algorand – Testnet (required) ─────────────────────────
    ALGOD_URL_TESTNET: str = "https://testnet-api.algonode.cloud"
    ALGOD_TOKEN_TESTNET: str = ""

    # ── Algorand – Mainnet (optional) ─────────────────────────
    ALGOD_URL_MAINNET: str = "https://mainnet-api.algonode.cloud"
    ALGOD_TOKEN_MAINNET: str = ""

    # ── CORS ──────────────────────────────────────────────────
    ALLOWED_ORIGINS: str = "http://localhost:3000"

    # ── Limits ────────────────────────────────────────────────
    MAX_INPUT_SIZE_BYTES: int = 50_000
    AI_MAX_RETRIES: int = 5

    # ── Environment ───────────────────────────────────────────
    ENVIRONMENT: str = "development"

    # ── Chatbot ───────────────────────────────────────────────
    GEMINI_CHATBOT_API_KEY: str = ""
    GEMINI_CHATBOT_MODEL: str = "gemini-2.5-flash"

    @property
    def allowed_origins_list(self) -> list[str]:
        """Return ALLOWED_ORIGINS as a list split on commas."""
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def is_development(self) -> bool:
        return self.ENVIRONMENT.lower() == "development"


@lru_cache()
def get_settings() -> Settings:
    """Return a cached Settings instance. Raises on missing required vars."""
    return Settings()  # type: ignore[call-arg]
