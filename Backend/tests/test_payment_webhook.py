import asyncio
import json
import os
import unittest
from decimal import Decimal
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from starlette.requests import Request

from app import main as main_module
from app.database import Base, SessionLocal
from app.models import Student, Transaction
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


class PaymentWebhookTests(unittest.TestCase):
    def test_get_callback_passes_authorization_and_database_by_keyword(self):
        database = object()
        with patch.object(main_module, "verify_payment_with_chapa", return_value={"success": True}) as verify:
            result = asyncio.run(
                main_module.acknowledge_chapa_get_callback(
                    tx_ref="TX-CALLBACK",
                    authorization="Bearer callback-token",
                    db=database,
                )
            )

        self.assertEqual(result, {"success": True})
        verify.assert_called_once_with(
            "TX-CALLBACK",
            authorization="Bearer callback-token",
            db=database,
        )

    def test_signed_pending_callback_is_acknowledged_without_settlement(self):
        secret = "webhook-test-secret"
        body = json.dumps({"status": "pending", "tx_ref": "TX-PENDING"}).encode()
        signature = main_module._compute_chapa_body_signature(secret, body)

        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}

        request = Request(
            {
                "type": "http",
                "method": "POST",
                "path": "/api/payment/webhook",
                "headers": [(b"x-chapa-signature", signature.encode())],
            },
            receive,
        )

        with patch.dict(os.environ, {"CHAPA_WEBHOOK_SECRET": secret}):
            result = asyncio.run(
                main_module.simulate_chapa_webhook(
                    payload=main_module.ChapaWebhookPayload(status="pending", tx_ref="TX-PENDING"),
                    request=request,
                    db=None,
                    authorization=None,
                )
            )

        self.assertEqual(result["status"], "pending")
        self.assertTrue(result["verified"])
        self.assertFalse(result["settled"])