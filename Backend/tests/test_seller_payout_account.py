import asyncio
import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from cryptography.fernet import Fernet
from fastapi import HTTPException
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["SESSION_SECRET"] = "seller-payout-test-secret"

from app import main as main_module
from app.database import Base
from app.models import AuditLog, PayoutProvider, SellerPaymentAccount, SellerPaymentAccountHistory, Student
from app.password_security import hash_password


class SellerPayoutAccountTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False, autocommit=False)

    @classmethod
    def tearDownClass(cls):
        cls.engine.dispose()

    def setUp(self):
        Base.metadata.drop_all(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)
        self.db = self.session_factory()
        self.student = Student(
            name="Payout Seller",
            student_id="MAU1600007",
            email="payout-seller@example.test",
            password=hash_password("payout-test-password"),
            college="Test College",
            department="Testing",
            is_verified=True,
        )
        self.provider = PayoutProvider(
            name="Test Bank",
            type="bank",
            code="123",
            is_active=True,
            integration_status="available",
        )
        self.db.add_all([self.student, self.provider])
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def payload(self, account_number="1234567890123"):
        return main_module.SellerPayoutSetupRequest(
            business_name="Test Shop",
            payout_type="bank",
            provider_id=self.provider.id,
            provider_name=self.provider.name,
            bank_code=self.provider.code,
            account_number=account_number,
            account_name="Payout Seller",
        )

    def request(self, password=None):
        headers = [(b"user-agent", b"seller-payout-tests")]
        if password is not None:
            headers.append((b"x-reauth-password", password.encode("utf-8")))
        return Request({
            "type": "http",
            "method": "PATCH",
            "headers": headers,
            "client": ("127.0.0.1", 43100),
            "server": ("testserver", 80),
        })

    def create_account(self, *, student_id=None, chapa_sub_account_id=None):
        account = SellerPaymentAccount(
            student_id=student_id or self.student.student_id,
            provider_id=self.provider.id,
            chapa_sub_account_id=chapa_sub_account_id,
            business_name="Test Shop",
            payout_type="bank",
            bank_code=self.provider.code,
            account_number="1234567890123",
            account_name="Payout Seller",
            account_status="Active",
        )
        self.db.add(account)
        self.db.commit()
        return account

    def authenticated(self, function, *args, **kwargs):
        with patch.object(main_module, "_student_from_authorization", return_value=self.student):
            return function(*args, authorization="Bearer payout-test", db=self.db, **kwargs)

    def test_setup_twice_returns_same_account_without_exposing_account_number(self):
        payload = self.payload()
        banks = AsyncMock(return_value=[{
            "code": self.provider.code,
            "name": self.provider.name,
            "method": "bank",
        }])
        create_subaccount = AsyncMock(return_value="chapa-test-subaccount")
        encryption_key = Fernet.generate_key().decode("ascii")
        with patch.object(main_module, "_student_from_authorization", return_value=self.student), \
                patch.object(main_module, "get_chapa_banks", banks), \
                patch.object(main_module, "_create_chapa_subaccount", create_subaccount), \
                patch.dict(os.environ, {
                    "PAYOUT_ACCOUNT_ENCRYPTION_KEY": encryption_key,
                    "CHAPA_TEST_SECRET_KEY": "test-secret",
                }):
            first = asyncio.run(main_module.setup_seller_payout_account(
                payload, authorization="test-token", db=self.db
            ))
            second = asyncio.run(main_module.setup_seller_payout_account(
                payload, authorization="test-token", db=self.db
            ))

        account = self.db.query(SellerPaymentAccount).one()
        self.assertEqual(first["account"]["id"], second["account"]["id"])
        self.assertTrue(second["idempotent"])
        self.assertNotIn("1234567890123", repr(first))
        self.assertNotIn("1234567890123", repr(second))
        self.assertIsNone(account.account_number)
        self.assertEqual(account.account_last4, "0123")
        with patch.dict(os.environ, {"PAYOUT_ACCOUNT_ENCRYPTION_KEY": encryption_key}):
            self.assertEqual(main_module._decrypt_payout_account_number(account), "1234567890123")
        with patch.object(main_module, "_student_from_authorization", return_value=self.student):
            stored_payload = main_module.get_seller_payout_account(
                authorization="test-token", db=self.db
            )
        self.assertEqual(stored_payload["account"]["account_number_masked"], "****0123")
        self.assertNotIn("1234567890123", repr(stored_payload))
        create_subaccount.assert_awaited_once()

    def test_setup_endpoint_limits_repeated_attempts(self):
        invalid_payload = main_module.SellerPayoutSetupRequest(
            bank_code=self.provider.code,
            account_name="",
            account_number="",
        )
        with patch.object(main_module, "_student_from_authorization", return_value=self.student):
            for _ in range(5):
                with self.assertRaises(HTTPException) as validation_error:
                    asyncio.run(main_module.setup_seller_payout_account(
                        invalid_payload, authorization="test-token", db=self.db
                    ))
                self.assertEqual(validation_error.exception.status_code, 400)

            with self.assertRaises(HTTPException) as rate_limit_error:
                asyncio.run(main_module.setup_seller_payout_account(
                    invalid_payload, authorization="test-token", db=self.db
                ))

        self.assertEqual(rate_limit_error.exception.status_code, 429)
        self.assertEqual(self.db.query(SellerPaymentAccount).count(), 0)

    def test_setup_requires_authenticated_verified_student(self):
        payload = self.payload()
        self.student.is_verified = False
        with patch.object(main_module, "_student_from_authorization", return_value=self.student):
            with self.assertRaises(HTTPException) as unverified_error:
                asyncio.run(main_module.setup_seller_payout_account(
                    payload, authorization="test-token", db=self.db
                ))
        self.assertEqual(unverified_error.exception.status_code, 403)

        self.student.is_verified = True
        with self.assertRaises(HTTPException) as unauthenticated_error:
            asyncio.run(main_module.setup_seller_payout_account(
                payload, authorization=None, db=self.db
            ))
        self.assertEqual(unauthenticated_error.exception.status_code, 401)

    def test_case_different_existing_student_id_cannot_create_duplicate(self):
        self.create_account(student_id="mau1600007")
        with patch.object(main_module, "_student_from_authorization", return_value=self.student):
            result = asyncio.run(main_module.setup_seller_payout_account(
                self.payload(), authorization="test-token", db=self.db
            ))
        self.assertTrue(result["idempotent"])
        self.assertEqual(self.db.query(SellerPaymentAccount).count(), 1)

    def test_edit_requires_reauthentication(self):
        self.create_account()
        with patch.object(main_module, "_student_from_authorization", return_value=self.student):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(main_module.update_seller_payout_account(
                    self.payload("9876543210123"), request=self.request(), authorization="Bearer payout-test", db=self.db
                ))
        self.assertEqual(error.exception.status_code, 401)
        self.assertEqual(self.db.query(SellerPaymentAccountHistory).count(), 0)

    def test_chapa_update_failure_leaves_account_and_history_unchanged(self):
        account = self.create_account(chapa_sub_account_id="chapa-test-subaccount")

        class FailingAsyncClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def post(self, *_args, **_kwargs):
                raise httpx.ConnectError("mock connection failure")

        with patch.object(main_module, "_student_from_authorization", return_value=self.student), \
                patch.object(main_module, "get_chapa_banks", new=AsyncMock(return_value=[{
                    "code": self.provider.code,
                    "name": self.provider.name,
                    "method": "bank",
                }])), \
                patch.object(main_module.httpx, "AsyncClient", return_value=FailingAsyncClient()), \
                patch.dict(os.environ, {
                    "CHAPA_MODE": "test",
                    "CHAPA_TEST_SECRET_KEY": "test-secret",
                    "PAYOUT_ACCOUNT_ENCRYPTION_KEY": Fernet.generate_key().decode("ascii"),
                }):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(main_module.update_seller_payout_account(
                    self.payload("9876543210123"),
                    request=self.request("payout-test-password"),
                    authorization="Bearer payout-test",
                    db=self.db,
                ))

        self.assertEqual(error.exception.status_code, 502)
        self.db.refresh(account)
        self.assertTrue(account.account_number.endswith("0123"))
        self.assertEqual(account.business_name, "Test Shop")
        self.assertEqual(self.db.query(SellerPaymentAccountHistory).count(), 0)

    def update_account_with_client(self, account, client, payload=None):
        encryption_key = Fernet.generate_key().decode("ascii")
        self.encryption_key = encryption_key
        with patch.object(main_module, "_student_from_authorization", return_value=self.student), \
                patch.object(main_module, "get_chapa_banks", new=AsyncMock(return_value=[{
                    "code": self.provider.code,
                    "name": self.provider.name,
                    "method": "bank",
                }])), \
                patch.object(main_module.httpx, "AsyncClient", return_value=client), \
                patch.dict(os.environ, {
                    "CHAPA_MODE": "test",
                    "CHAPA_TEST_SECRET_KEY": "test-secret",
                    "PAYOUT_ACCOUNT_ENCRYPTION_KEY": encryption_key,
                }):
            return asyncio.run(main_module.update_seller_payout_account(
                payload or self.payload("9876543210123"),
                request=self.request("payout-test-password"),
                authorization="test-token",
                db=self.db,
            ))

    def make_chapa_client(self, status_code, response_body=None, error=None):
        class MockAsyncClient:
            def __init__(self):
                self.url = None
                self.request_json = None

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return False

            async def post(self, url, **kwargs):
                self.url = url
                self.request_json = kwargs.get("json")
                if error:
                    raise error
                return httpx.Response(
                    status_code,
                    json=response_body,
                    request=httpx.Request("POST", url),
                )

        return MockAsyncClient()

    def assert_payout_account_unchanged(self, account):
        self.db.refresh(account)
        self.assertEqual(account.chapa_sub_account_id, "chapa-test-subaccount")
        self.assertEqual(account.account_number, "1234567890123")
        self.assertEqual(account.business_name, "Test Shop")
        self.assertEqual(self.db.query(SellerPaymentAccountHistory).count(), 0)
        self.assertEqual(
            self.db.query(AuditLog).filter(AuditLog.action == "Payout Account Updated").count(),
            0,
        )

    def test_chapa_subaccount_uses_documented_percentage_and_response_id(self):
        client = self.make_chapa_client(
            201,
            {"status": "success", "data": {"subaccount_id": "chapa-test-subaccount"}},
        )

        with patch.object(main_module.httpx, "AsyncClient", return_value=client), \
                patch.object(main_module, "_get_commission_settings", return_value={
                    "commission_enabled": True,
                    "commission_type": "percentage",
                    "commission_rate": "1.0",
                }):
            subaccount_id = asyncio.run(main_module._create_chapa_subaccount(
                self.db,
                {
                    "business_name": "Test Shop",
                    "bank_code": self.provider.code,
                    "account_number": "1234567890123",
                    "account_name": "Payout Seller",
                },
                "test-secret",
            ))

        self.assertEqual(subaccount_id, "chapa-test-subaccount")
        self.assertEqual(client.request_json["split_type"], "percentage")
        self.assertEqual(client.request_json["split_value"], "1.0000")

    def test_chapa_validation_error_returns_422_and_keeps_database_unchanged(self):
        account = self.create_account(chapa_sub_account_id="chapa-test-subaccount")
        client = self.make_chapa_client(
            422,
            {
                "status": "failed",
                "message": "Invalid account number 9876543210123",
                "errors": {"account_number": ["Account number 9876543210123 is invalid"]},
            },
        )

        with self.assertLogs("app.payments", level="WARNING") as captured_logs:
            with self.assertRaises(HTTPException) as error:
                self.update_account_with_client(account, client)

        self.assertEqual(error.exception.status_code, 422)
        self.assertNotIn("9876543210123", error.exception.detail)
        self.assertEqual(client.url, "https://api.chapa.co/v1/subaccount")
        diagnostic = "\n".join(captured_logs.output)
        self.assertIn("method=POST", diagnostic)
        self.assertIn("path=/v1/subaccount", diagnostic)
        self.assertIn("status=422", diagnostic)
        self.assertIn("validation_fields=['account_number']", diagnostic)
        self.assertNotIn("9876543210123", diagnostic)
        self.assertNotIn("test-secret", diagnostic)
        self.assert_payout_account_unchanged(account)

    def test_duplicate_chapa_subaccount_returns_conflict_without_echoing_details(self):
        client = self.make_chapa_client(
            400,
            {"status": "failed", "message": "This subaccount does exist"},
        )
        sensitive_account_number = "9876543210123"

        with patch.object(main_module.httpx, "AsyncClient", return_value=client), \
                patch.dict(os.environ, {"CHAPA_MODE": "test", "CHAPA_TEST_SECRET_KEY": "test-secret"}):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(main_module._create_chapa_subaccount(
                    self.db,
                    {
                        "business_name": "Test Shop",
                        "bank_code": self.provider.code,
                        "account_number": sensitive_account_number,
                        "account_name": "Payout Seller",
                    },
                    "test-secret",
                ))

        self.assertEqual(error.exception.status_code, 409)
        self.assertIn("already has a subaccount", error.exception.detail)
        self.assertNotIn(sensitive_account_number, error.exception.detail)

    def test_chapa_server_error_returns_502_and_keeps_database_unchanged(self):
        account = self.create_account(chapa_sub_account_id="chapa-test-subaccount")
        client = self.make_chapa_client(500, {"message": "Temporary provider error"})

        with self.assertRaises(HTTPException) as error:
            self.update_account_with_client(account, client)

        self.assertEqual(error.exception.status_code, 502)
        self.assert_payout_account_unchanged(account)

    def test_chapa_authentication_error_returns_503_and_keeps_database_unchanged(self):
        account = self.create_account(chapa_sub_account_id="chapa-test-subaccount")
        client = self.make_chapa_client(401, {"message": "Invalid secret key"})

        with self.assertRaises(HTTPException) as error:
            self.update_account_with_client(account, client)

        self.assertEqual(error.exception.status_code, 503)
        self.assertNotIn("Invalid secret key", error.exception.detail)
        self.assert_payout_account_unchanged(account)

    def test_chapa_timeout_returns_503_and_keeps_database_unchanged(self):
        account = self.create_account(chapa_sub_account_id="chapa-test-subaccount")
        client = self.make_chapa_client(0, error=httpx.TimeoutException("request timed out"))

        with self.assertRaises(HTTPException) as error:
            self.update_account_with_client(account, client)

        self.assertEqual(error.exception.status_code, 503)
        self.assert_payout_account_unchanged(account)

    def test_chapa_success_replaces_subaccount_and_records_audited_masked_change(self):
        account = self.create_account(chapa_sub_account_id="chapa-test-subaccount")
        client = self.make_chapa_client(
            201,
            {"status": "success", "data": {"subaccount_id": "replacement-subaccount"}},
        )
        name_only_payload = main_module.SellerPayoutSetupRequest(
            business_name="Updated Shop",
            payout_type="bank",
            provider_id=self.provider.id,
            provider_name=self.provider.name,
            bank_code=self.provider.code,
            account_number="",
            account_name="Payout Seller",
        )

        result = self.update_account_with_client(account, client, name_only_payload)

        self.db.refresh(account)
        history = self.db.query(SellerPaymentAccountHistory).one()
        audit_log = self.db.query(AuditLog).filter(
            AuditLog.action == "Payout Account Updated"
        ).one()
        self.assertEqual(result["success"], True)
        self.assertEqual(client.url, "https://api.chapa.co/v1/subaccount")
        self.assertEqual(account.chapa_sub_account_id, "replacement-subaccount")
        self.assertEqual(account.business_name, "Updated Shop")
        self.assertIsNone(account.account_number)
        with patch.dict(os.environ, {"PAYOUT_ACCOUNT_ENCRYPTION_KEY": self.encryption_key}):
            self.assertEqual(main_module._decrypt_payout_account_number(account), "1234567890123")
        self.assertEqual(history.old_last4, "****0123")
        self.assertEqual(history.new_last4, "****0123")
        self.assertEqual(history.changed_fields, ["business_name"])
        self.assertNotIn("1234567890123", repr(history))
        hold_duration = account.payout_hold_until - account.updated_at
        self.assertGreater(hold_duration.total_seconds(), 23 * 60 * 60)
        self.assertLess(hold_duration.total_seconds(), 25 * 60 * 60)
        self.assertEqual(audit_log.status, "SUCCESS")
        self.assertEqual(audit_log.entity_id, account.id)
        self.assertNotIn("1234567890123", audit_log.description)

    def test_cors_preflight_allows_reauth_header_for_payout_update(self):
        client = TestClient(main_module.app)
        response = client.options(
            "/api/seller/payout-account",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "PATCH",
                "Access-Control-Request-Headers": "authorization, x-reauth-password",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "http://localhost:5173")
        self.assertIn("x-reauth-password", response.headers.get("access-control-allow-headers", "").lower())

    def test_get_returns_masked_account_values_only(self):
        self.create_account()
        with patch.object(main_module, "_student_from_authorization", return_value=self.student):
            result = main_module.get_authenticated_seller_payout_account(
                authorization="Bearer payout-test", db=self.db
            )

        self.assertEqual(result["account_number_masked"], "****0123")
        self.assertEqual(result["bank_code"], self.provider.code)
        self.assertNotIn("1234567890123", repr(result))
        self.assertNotIn("account_number\"", repr(result))


if __name__ == "__main__":
    unittest.main()