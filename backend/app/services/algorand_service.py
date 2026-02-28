"""
Algorand transaction service.

Connects to Algorand nodes via AlgodClient, builds unsigned
ApplicationCreateTxn transactions, and submits signed transactions.
"""

from __future__ import annotations

import asyncio
import base64
import os
from concurrent.futures import ThreadPoolExecutor

# Fix macOS Python SSL certificate issue using certifi
try:
    import certifi
    import ssl
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
    # Patch the default SSL context for urllib (used by algosdk)
    ssl._create_default_https_context = lambda: ssl.create_default_context(
        cafile=certifi.where()
    )
except ImportError:
    pass

from algosdk import encoding, transaction
from algosdk.v2client.algod import AlgodClient

from app.config import get_settings
from app.middleware.error_handler import AppException
from app.utils.logger import get_logger

logger = get_logger(__name__)

# Timeout for Algorand node calls (seconds)
_ALGORAND_TIMEOUT = 15

# Thread pool for blocking algod calls
_executor = ThreadPoolExecutor(max_workers=4)

# Explorer URL templates
_EXPLORER_URLS = {
    "testnet": "https://testnet.explorer.perawallet.app/tx/{txid}",
    "mainnet": "https://explorer.perawallet.app/tx/{txid}",
}


class AlgorandService:
    """Builds and submits Algorand application transactions."""

    def __init__(self, network: str = "testnet") -> None:
        settings = get_settings()
        self.network = network

        if network == "mainnet":
            url = settings.ALGOD_URL_MAINNET
            token = settings.ALGOD_TOKEN_MAINNET
        else:
            url = settings.ALGOD_URL_TESTNET
            token = settings.ALGOD_TOKEN_TESTNET

        # AlgoNode doesn't require a token — pass empty string with header
        self.algod = AlgodClient(token, url)
        logger.info("AlgorandService initialised  network=%s  url=%s", network, url)

    # ── 5.2  Suggested Params ─────────────────────────────────

    async def get_suggested_params(self) -> transaction.SuggestedParams:
        """Fetch current network parameters for transaction building."""
        try:
            loop = asyncio.get_event_loop()
            sp = await asyncio.wait_for(
                loop.run_in_executor(_executor, self.algod.suggested_params),
                timeout=_ALGORAND_TIMEOUT,
            )
            logger.debug(
                "Suggested params  first=%d  last=%d  fee=%d  gh=%s",
                sp.first, sp.last, sp.fee, sp.gh[:12] if sp.gh else "?",
            )
            return sp
        except asyncio.TimeoutError:
            logger.error("Suggested params timed out after %ds", _ALGORAND_TIMEOUT)
            raise AppException(
                status_code=502,
                error_code="ALGORAND_CONNECTION_ERROR",
                message=f"Algorand {self.network} node timed out after {_ALGORAND_TIMEOUT}s.",
            )
        except AppException:
            raise
        except Exception as exc:
            logger.error("Failed to get suggested params: %s", exc)
            raise AppException(
                status_code=502,
                error_code="ALGORAND_CONNECTION_ERROR",
                message=f"Could not connect to Algorand {self.network} node.",
                details={"error": str(exc)[:300]},
            )

    # ── 5.3  Prepare deploy data ────────────────────────────────

    async def prepare_deploy_data(
        self,
        sender: str,
        approval_teal: str,
        clear_teal: str,
    ) -> dict:
        """
        Compile TEAL programs and fetch suggested params.

        Returns a dict with compiled programs (base64) and suggested params
        so the frontend can build & sign the transaction natively with the
        JS SDK (avoids cross-SDK serialisation issues).
        """
        # Validate sender address
        if not encoding.is_valid_address(sender):
            raise AppException(
                status_code=400,
                error_code="INVALID_ADDRESS",
                message=f"'{sender}' is not a valid Algorand address.",
            )

        # Compile TEAL source → AVM bytecode via the node
        approval_compiled = await self._compile_teal(approval_teal, label="approval")
        clear_compiled = await self._compile_teal(clear_teal, label="clear")

        sp = await self.get_suggested_params()

        logger.info(
            "Prepared deploy data  sender=%s…  network=%s",
            sender[:8],
            self.network,
        )

        # Calculate extra pages needed for larger programs.
        # AVM page size = 8192 bytes.  Base = 1 page, up to 3 extra pages.
        _PAGE_SIZE = 8192
        approval_size = len(approval_compiled)
        extra_pages_approval = max(0, (approval_size - 1) // _PAGE_SIZE)  # 0 if ≤8192
        clear_size = len(clear_compiled)
        extra_pages_clear = max(0, (clear_size - 1) // _PAGE_SIZE)
        extra_pages = max(extra_pages_approval, extra_pages_clear)
        if extra_pages > 3:
            raise AppException(
                status_code=400,
                error_code="PROGRAM_TOO_LARGE",
                message=f"Compiled program exceeds AVM maximum (approval={approval_size}B, clear={clear_size}B, max=32768B). Simplify the contract.",
            )
        if extra_pages > 0:
            logger.info(
                "Large program — extra_pages=%d  approval=%dB  clear=%dB",
                extra_pages, approval_size, clear_size,
            )

        return {
            "approval_compiled": base64.b64encode(approval_compiled).decode("utf-8"),
            "clear_compiled": base64.b64encode(clear_compiled).decode("utf-8"),
            "extra_pages": extra_pages,
            "suggested_params": {
                "fee": sp.fee,
                "first_round": sp.first,
                "last_round": sp.last,
                "genesis_hash": sp.gh,
                "genesis_id": sp.gen,
                "flat_fee": sp.flat_fee,
                "min_fee": sp.min_fee,
            },
        }

    # ── 5.4  Transaction Submission ───────────────────────────

    async def submit_signed_txn(self, signed_txn_b64: str) -> tuple[str, str, int, list[str]]:
        """
        Submit a signed transaction to the network.

        Returns (txid, explorer_url, app_id, logs).
        """
        try:
            loop = asyncio.get_event_loop()
            # send_raw_transaction accepts base64-encoded signed txn string
            txid = await asyncio.wait_for(
                loop.run_in_executor(
                    _executor, self.algod.send_raw_transaction, signed_txn_b64
                ),
                timeout=_ALGORAND_TIMEOUT,
            )
            logger.info("Transaction sent  txid=%s", txid)
        except asyncio.TimeoutError:
            raise AppException(
                status_code=502,
                error_code="TXN_SUBMIT_FAILED",
                message=f"Transaction submission timed out after {_ALGORAND_TIMEOUT}s.",
            )
        except AppException:
            raise
        except Exception as exc:
            err_detail = str(exc)
            logger.error("Transaction submission failed: %s", err_detail[:500])
            raise AppException(
                status_code=502,
                error_code="TXN_SUBMIT_FAILED",
                message=f"Transaction rejected: {err_detail[:300]}",
                details={"error": err_detail[:500]},
            )

        app_id = 0
        logs: list[str] = []
        try:
            loop = asyncio.get_event_loop()
            confirmed = await asyncio.wait_for(
                loop.run_in_executor(
                    _executor,
                    lambda: transaction.wait_for_confirmation(self.algod, txid, 10),
                ),
                timeout=_ALGORAND_TIMEOUT,
            )
            app_id = confirmed.get("application-index", 0) or 0
            logs = confirmed.get("logs", []) or []
            logger.info("Transaction confirmed  txid=%s  app_id=%s  logs=%d", txid, app_id, len(logs))
        except Exception as exc:
            logger.warning("Confirmation wait failed (txn may still confirm): %s", exc)

        explorer_url = self.get_explorer_url(txid, self.network)
        return txid, explorer_url, app_id, logs

    # ── Helpers ───────────────────────────────────────────────

    async def _compile_teal(self, teal_source: str, label: str = "program") -> bytes:
        """Compile TEAL source to AVM bytecode via the Algorand node."""
        try:
            loop = asyncio.get_event_loop()
            result = await asyncio.wait_for(
                loop.run_in_executor(
                    _executor, self.algod.compile, teal_source
                ),
                timeout=_ALGORAND_TIMEOUT,
            )
            compiled_b64 = result["result"]
            compiled_bytes = base64.b64decode(compiled_b64)
            logger.debug(
                "TEAL compiled via node  label=%s  size=%d bytes",
                label,
                len(compiled_bytes),
            )
            return compiled_bytes
        except asyncio.TimeoutError:
            raise AppException(
                status_code=502,
                error_code="ALGORAND_CONNECTION_ERROR",
                message=f"TEAL compilation ({label}) timed out after {_ALGORAND_TIMEOUT}s.",
            )
        except AppException:
            raise
        except Exception as exc:
            raise AppException(
                status_code=400,
                error_code="TEAL_COMPILE_ERROR",
                message=f"Algorand node rejected {label} TEAL: {exc}",
                details={"label": label, "error": str(exc)[:500]},
            )

    @staticmethod
    def get_explorer_url(txid: str, network: str) -> str:
        """Return the Pera Explorer URL for a transaction."""
        template = _EXPLORER_URLS.get(network, _EXPLORER_URLS["testnet"])
        return template.format(txid=txid)
