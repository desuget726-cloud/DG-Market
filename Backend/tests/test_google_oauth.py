import asyncio
import logging
import os
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
from urllib.parse import parse_qs, urlparse

import httpx

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import main as main_module
from app.models import GoogleOAuthState, Notification, Student, UserSession, Wallet


class GoogleOAuthTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Student.__table__.create(bind=self.engine)
        Wallet.__table__.create(bind=self.engine)
        GoogleOAuthState.__table__.create(bind=self.engine)
        UserSession.__table__.create(bind=self.engine)
        Notification.__table__.create(bind=self.engine)
        self.db = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def _environment(self, frontend_url="https://frontend.example.test"):
        return {
            "GOOGLE_CLIENT_ID": "oauth-test.apps.googleusercontent.com",
            "GOOGLE_CLIENT_SECRET": "oauth-test-secret",
            "GOOGLE_REDIRECT_URI": "https://api.example.test/auth/google/callback",
            "FRONTEND_URL": frontend_url,
        }

    def _run_callback(self, profile, settings=None, exchange_error=None):
        environment = self._environment()
        self.db.add(GoogleOAuthState(
            state="callback-state",
            verifier="test-verifier",
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        ))
        self.db.commit()

        identity_response = Mock(is_success=True)
        identity_response.json.return_value = profile
        google_client = Mock()
        google_client.get = AsyncMock(return_value=identity_response)
        http_client_context = Mock()
        http_client_context.__aenter__ = AsyncMock(return_value=google_client)
        http_client_context.__aexit__ = AsyncMock(return_value=None)
        policy = {
            "require_university_email": True,
            "allowed_email_domain": "university.edu.et",
            "auto_approve_students": True,
            "require_student_verification": True,
            **(settings or {}),
        }
        setting_values = {
            ("studentVerification", "requireUniversityEmail"): policy["require_university_email"],
            ("studentVerification", "allowedEmailDomain"): policy["allowed_email_domain"],
            ("studentVerification", "autoApproveStudents"): policy["auto_approve_students"],
        }
        oauth_exchange = AsyncMock(side_effect=exchange_error) if exchange_error else AsyncMock(
            return_value={"access_token": "mock-google-token"}
        )

        with patch.dict(os.environ, environment, clear=True), patch.object(
            main_module, "_exchange_oauth_code", oauth_exchange
        ), patch.object(
            main_module.httpx, "AsyncClient", return_value=http_client_context
        ), patch.object(
            main_module,
            "get_security_settings",
            return_value=SimpleNamespace(
                require_student_verification=policy["require_student_verification"],
                session_timeout=30,
            ),
        ), patch.object(
            main_module,
            "_get_setting_value",
            side_effect=lambda _db, block, key, default=None: setting_values.get((block, key), default),
        ), patch.object(
            main_module, "_audit_logging_enabled", return_value=False
        ), patch.object(
            main_module, "_get_session_secret", return_value="test-session-secret"
        ), patch.object(
            main_module, "_create_session_token", return_value="mock-session-token"
        ), patch.object(
            main_module, "_get_avatar_url", return_value=""
        ):
            response = asyncio.run(main_module.google_callback(
                code="test-code",
                state="callback-state",
                db=self.db,
            ))
        return response, oauth_exchange

    def _assert_state_rejected(self, supplied_state, stored_state, reason, used=False, created_at=None):
        if stored_state is not None:
            self.db.add(GoogleOAuthState(
                state=stored_state,
                verifier="test-verifier",
                used=used,
                created_at=created_at or datetime.now(timezone.utc).replace(tzinfo=None),
            ))
            self.db.commit()

        with patch.dict(os.environ, self._environment(), clear=True), patch.object(
            main_module,
            "_exchange_oauth_code",
            new_callable=AsyncMock,
        ) as exchange_code, self.assertLogs("app.auth", level="WARNING") as logs:
            response = asyncio.run(main_module.google_callback(
                code="test-code",
                state=supplied_state,
                db=self.db,
            ))

        self.assertEqual(
            response.headers["location"],
            "https://frontend.example.test/login?error=google_state_invalid",
        )
        self.assertIn(f"reason={reason}", " ".join(logs.output))
        exchange_code.assert_not_awaited()

    def test_valid_state_is_consumed_once_and_exchange_is_mocked(self):
        environment = self._environment()
        environment["GOOGLE_REDIRECT_URI"] += "/"
        with patch.dict(os.environ, environment, clear=True), patch.object(
            main_module.secrets,
            "token_urlsafe",
            side_effect=["test-state", "test-verifier"],
        ):
            authorization_response = main_module.google_login(db=self.db)
            authorization_query = parse_qs(urlparse(authorization_response.headers["location"]).query)
            self.assertEqual(authorization_query["redirect_uri"], [environment["GOOGLE_REDIRECT_URI"]])
            state_record = self.db.query(GoogleOAuthState).filter_by(state="test-state").one()
            self.assertFalse(state_record.used)
            self.assertNotIn("set-cookie", authorization_response.headers)

            identity_response = Mock(is_success=True)
            identity_response.json.return_value = {
                "email": "student@example.test",
                "email_verified": True,
                "name": "Test Student",
            }
            google_client = Mock()
            google_client.get = AsyncMock(return_value=identity_response)
            http_client_context = Mock()
            http_client_context.__aenter__ = AsyncMock(return_value=google_client)
            http_client_context.__aexit__ = AsyncMock(return_value=None)

            with patch.object(
                main_module,
                "_exchange_oauth_code",
                new_callable=AsyncMock,
                return_value={"access_token": "mock-access-token"},
            ) as exchange_code, patch.object(
                main_module.httpx,
                "AsyncClient",
                return_value=http_client_context,
            ), patch.object(
                main_module,
                "_get_or_create_oauth_student",
                return_value=object(),
            ), patch.object(
                main_module,
                "_create_secure_session_for_student",
                return_value={"access_token": "mock-session-token"},
            ):
                response = asyncio.run(main_module.google_callback(
                    code="test-code",
                    state="test-state",
                    db=self.db,
                ))

        self.db.refresh(state_record)
        self.assertTrue(state_record.used)
        exchanged_payload = exchange_code.await_args.args[1]
        self.assertEqual(exchanged_payload["redirect_uri"], environment["GOOGLE_REDIRECT_URI"])
        self.assertEqual(exchanged_payload["code_verifier"], "test-verifier")
        self.assertEqual(
            response.headers["location"],
            f"{environment['FRONTEND_URL']}/login?oauth=success#access_token=mock-session-token",
        )

    def test_expired_state_redirects_to_frontend(self):
        created_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=11)
        self._assert_state_rejected("expired-state", "expired-state", "expired", created_at=created_at)

    def test_tampered_state_redirects_to_frontend(self):
        self._assert_state_rejected("tampered-state", "original-state", "unknown")

    def test_reused_state_redirects_to_frontend(self):
        self._assert_state_rejected("used-state", "used-state", "reused", used=True)

    def test_existing_user_is_logged_in_with_cross_site_session_cookie(self):
        student = Student(
            name="Existing Student",
            student_id="EXISTING-1",
            email="student@university.edu.et",
            password="hashed-password",
            college="College",
            department="Department",
            is_verified=True,
        )
        self.db.add(student)
        self.db.commit()

        response, _ = self._run_callback({
            "email": student.email,
            "email_verified": True,
            "name": student.name,
        })

        self.assertEqual(
            response.headers["location"],
            "https://frontend.example.test/login?oauth=success#access_token=mock-session-token",
        )
        self.assertIn("session_token=mock-session-token", response.headers["set-cookie"])
        self.assertIn("SameSite=none", response.headers["set-cookie"])
        self.assertIn("; Secure", response.headers["set-cookie"])
        self.assertEqual(
            self.db.query(UserSession).filter_by(user_id=student.student_id).count(),
            1,
        )

    def test_local_http_oauth_cookie_is_not_forced_secure(self):
        for frontend_url in ("http://localhost:5173", "http://127.0.0.1:5173"):
            with self.subTest(frontend_url=frontend_url), patch.dict(
                os.environ,
                {"FRONTEND_URL": frontend_url, "COOKIE_SECURE": "true"},
                clear=True,
            ):
                self.assertFalse(main_module._oauth_cookie_secure())

    def test_new_allowed_user_is_created_using_auto_approval_setting(self):
        response, _ = self._run_callback({
            "email": "new@university.edu.et",
            "email_verified": True,
            "name": "New Student",
        })

        student = self.db.query(Student).filter_by(email="new@university.edu.et").one()
        self.assertTrue(student.is_verified)
        self.assertEqual(student.status, "Pending Verification")
        self.assertEqual(
            response.headers["location"],
            "https://frontend.example.test/login?oauth=success#access_token=mock-session-token",
        )
        self.assertEqual(self.db.query(Wallet).filter_by(student_id=student.student_id).count(), 1)
        self.assertEqual(self.db.query(UserSession).filter_by(user_id=student.student_id).count(), 1)

    def test_blocked_gmail_domain_redirects_with_domain_and_logs_reason(self):
        with self.assertLogs("app.auth", level="WARNING") as logs:
            response, _ = self._run_callback({
                "email": "student@gmail.com",
                "email_verified": True,
                "name": "Gmail Student",
            })

        self.assertEqual(
            response.headers["location"],
            "https://frontend.example.test/login?error=domain_not_allowed&domain=university.edu.et",
        )
        self.assertIn("reason=domain_not_allowed", " ".join(logs.output))
        self.assertEqual(self.db.query(Student).count(), 0)

    def test_unverified_google_email_redirects_with_clear_error(self):
        with self.assertLogs("app.auth", level="WARNING") as logs:
            response, _ = self._run_callback({
                "email": "student@university.edu.et",
                "email_verified": False,
                "name": "Student",
            })

        self.assertEqual(
            response.headers["location"],
            "https://frontend.example.test/login?error=email_not_verified",
        )
        self.assertIn("reason=email_not_verified", " ".join(logs.output))
        self.assertEqual(self.db.query(Student).count(), 0)

    def test_pending_new_user_is_created_but_not_logged_in(self):
        with self.assertLogs("app.auth", level="WARNING") as logs:
            response, _ = self._run_callback({
                "email": "pending@university.edu.et",
                "email_verified": True,
                "name": "Pending Student",
            }, settings={"auto_approve_students": False})

        student = self.db.query(Student).filter_by(email="pending@university.edu.et").one()
        self.assertFalse(student.is_verified)
        self.assertEqual(response.headers["location"], "https://frontend.example.test/login?error=account_pending")
        self.assertIn("reason=account_pending", " ".join(logs.output))

    def test_bad_code_redirects_to_frontend_without_exposing_provider_error(self):
        invalid_code = main_module.HTTPException(status_code=400, detail="provider secret detail")
        with self.assertLogs("app.auth", level="WARNING") as logs:
            response, exchange_code = self._run_callback({
                "email": "student@university.edu.et",
                "email_verified": True,
                "name": "Student",
            }, exchange_error=invalid_code)

        self.assertEqual(
            response.headers["location"],
            "https://frontend.example.test/login?error=google_token_exchange_failed",
        )
        self.assertIn("reason=google_token_exchange_failed", " ".join(logs.output))
        self.assertNotIn("provider secret detail", response.headers["location"])
        exchange_code.assert_awaited_once()

    def test_google_provider_errors_map_to_specific_frontend_codes(self):
        provider_error_codes = {
            "invalid_grant": "google_invalid_grant",
            "redirect_uri_mismatch": "google_redirect_mismatch",
            "invalid_client": "google_invalid_client",
        }
        for google_error, frontend_code in provider_error_codes.items():
            with self.subTest(google_error=google_error):
                self.db.query(GoogleOAuthState).delete()
                self.db.commit()
                error = main_module.OAuthTokenExchangeError(
                    status_code=400,
                    provider_error=google_error,
                    error_description="safe diagnostic",
                    detail="internal provider detail",
                )
                response, exchange_code = self._run_callback(
                    {
                        "email": "student@university.edu.et",
                        "email_verified": True,
                        "name": "Student",
                    },
                    exchange_error=error,
                )
                self.assertEqual(
                    response.headers["location"],
                    f"https://frontend.example.test/login?error={frontend_code}",
                )
                exchange_code.assert_awaited_once()

    def test_duplicate_callback_rejects_consumed_state_without_exchanging_again(self):
        self._assert_state_rejected(
            supplied_state="callback-state",
            stored_state="callback-state",
            reason="reused",
            used=True,
        )

    def test_token_exchange_logs_provider_error_and_redacts_credentials(self):
        redirect_uri = "https://api.example.test/auth/google/callback"
        payload = {
            "code": "never-log-code",
            "state": "never-log-state",
            "client_secret": "never-log-secret",
            "access_token": "never-log-token",
            "redirect_uri": redirect_uri,
        }
        response = Mock(
            headers={"content-type": "application/json"},
            is_success=False,
            status_code=400,
        )
        response.json.return_value = {
            "error": "invalid_grant",
            "error_description": (
                "authorization code rejected never-log-code "
                "state=never-log-state client secret never-log-secret"
            ),
        }
        google_client = Mock()
        google_client.post = AsyncMock(return_value=response)
        client_context = Mock()
        client_context.__aenter__ = AsyncMock(return_value=google_client)
        client_context.__aexit__ = AsyncMock(return_value=None)

        with patch.object(
            main_module.httpx,
            "AsyncClient",
            return_value=client_context,
        ), self.assertLogs("app.auth", level="WARNING") as logs:
            with self.assertRaises(main_module.OAuthTokenExchangeError) as raised:
                asyncio.run(main_module._exchange_oauth_code(
                    "https://oauth2.googleapis.com/token",
                    payload,
                    provider="Google",
                    redirect_uri=redirect_uri,
                ))

        self.assertEqual(raised.exception.provider_error, "invalid_grant")
        self.assertEqual(raised.exception.error_description, response.json.return_value["error_description"])
        log_text = " ".join(logs.output)
        self.assertIn("status=400", log_text)
        self.assertIn("error=invalid_grant", log_text)
        self.assertIn("error_description=", log_text)
        self.assertIn(f"redirect_uri={redirect_uri}", log_text)
        for secret in ("never-log-code", "never-log-state", "never-log-secret", "never-log-token"):
            self.assertNotIn(secret, log_text)

    def test_access_log_filter_redacts_code_and_state_query_values(self):
        record = logging.LogRecord(
            "uvicorn.access",
            logging.INFO,
            __file__,
            1,
            '%s - "%s %s HTTP/%s" %d',
            ("127.0.0.1", "GET", "/auth/google/callback?code=private-code&state=private-state", "1.1", 303),
            None,
        )

        main_module.OAuthAccessLogRedactionFilter().filter(record)
        formatted = record.getMessage()

        self.assertIn("code=[REDACTED]", formatted)
        self.assertIn("state=[REDACTED]", formatted)
        self.assertNotIn("private-code", formatted)
        self.assertNotIn("private-state", formatted)

    def test_cookie_session_endpoint_returns_validated_bearer_token(self):
        student = SimpleNamespace(
            name="Cookie Student",
            student_id="COOKIE-1",
            email="cookie@university.edu.et",
            is_verified=True,
            two_factor_enabled=False,
        )
        request = SimpleNamespace(cookies={"session_token": "cookie-session-token"})
        with patch.object(main_module, "_student_from_authorization", return_value=student) as validate:
            session_data = main_module.get_oauth_session(request, authorization=None, db=self.db)

        validate.assert_called_once_with("Bearer cookie-session-token", self.db)
        self.assertEqual(session_data["access_token"], "cookie-session-token")
        self.assertEqual(session_data["user"]["studentId"], "COOKIE-1")


if __name__ == "__main__":
    unittest.main()
