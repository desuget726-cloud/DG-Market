import os
import unittest
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import Response
from fastapi import HTTPException
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["SESSION_SECRET"] = "student-session-test-secret"

from app import main as main_module
from app.database import Base
from app.models import AuditLog, LoginAttempt, Notification, PasswordReset, Student, StudentSession, SystemSetting, UserSession
from app.password_security import hash_password


class StudentSessionTests(unittest.TestCase):
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
            name="Session User",
            student_id="MAU1600001",
            email="session-user@example.test",
            password=hash_password("SessionPass123!"),
            college="Test College",
            department="Testing",
            is_verified=True,
        )
        self.db.add(self.student)
        self.db.commit()
        self.resolved_ips = []

        async def resolve_location(ip_address):
            self.resolved_ips.append(ip_address)
            return "Addis Ababa, Ethiopia"

        self.location_patch = patch.object(
            main_module, "resolve_ip_location", new=resolve_location
        )
        self.location_patch.start()

    def tearDown(self):
        self.location_patch.stop()
        self.db.close()

    def test_cors_allows_local_vite_credentials_methods_and_headers(self):
        cors = next(item for item in main_module.app.user_middleware if item.cls is CORSMiddleware)
        self.assertIn("http://localhost:5173", cors.kwargs["allow_origins"])
        self.assertIn("http://127.0.0.1:5173", cors.kwargs["allow_origins"])
        for origin in ("http://localhost:5174", "http://127.0.0.1:5174"):
            self.assertRegex(origin, cors.kwargs["allow_origin_regex"])
        self.assertTrue(cors.kwargs["allow_credentials"])
        self.assertEqual(cors.kwargs["allow_methods"], ["*"])
        self.assertEqual(cors.kwargs["allow_headers"], ["*"])

    @staticmethod
    def _request(ip_address, user_agent, forwarded_for=None, cookie_token=None):
        headers = [(b"user-agent", user_agent.encode("ascii"))]
        if forwarded_for:
            headers.append((b"x-forwarded-for", forwarded_for.encode("ascii")))
        if cookie_token:
            headers.append((b"cookie", f"session_token={cookie_token}".encode("ascii")))
        return Request({
            "type": "http",
            "method": "POST",
            "scheme": "https",
            "path": "/api/login",
            "query_string": b"",
            "headers": headers,
            "client": (ip_address, 12345),
            "server": ("testserver", 443),
        })

    def _login(self, ip_address="8.8.8.8", user_agent=None):
        request = self._request(
            ip_address,
            user_agent or (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        return main_module.login_user(
            main_module.LoginRequest(
                id_or_email=self.student.student_id,
                password="SessionPass123!",
            ),
            request,
            self.db,
        )

    @staticmethod
    def _session_id(token):
        return main_module._decode_student_jwt(token)["session_id"]

    def test_two_successful_logins_create_two_uuid_sessions(self):
        first = self._login("8.8.8.8")
        second = self._login(
            "1.1.1.1",
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
            "Mobile/15E148 Safari/604.1",
        )

        sessions = self.db.query(UserSession).filter(
            UserSession.user_id == self.student.student_id
        ).all()
        self.assertEqual(len(sessions), 2)
        self.assertNotEqual(self._session_id(first["access_token"]), self._session_id(second["access_token"]))
        self.assertEqual({session.device_name for session in sessions}, {"Windows / Chrome", "iOS / Mobile Safari"})
        self.assertTrue(all(session.revoked_at is None for session in sessions))
        notifications = self.db.query(Notification).filter_by(student_id=self.student.student_id).all()
        self.assertEqual(len(notifications), 2)
        self.assertTrue(all(notification.message.startswith("New login from ") for notification in notifications))

    def test_login_persists_forwarded_client_ip_and_resolved_location(self):
        request = self._request(
            "10.0.0.5",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
            forwarded_for="197.156.0.25, 10.0.0.1",
        )

        result = main_module.login_user(
            main_module.LoginRequest(
                id_or_email=self.student.student_id,
                password="SessionPass123!",
            ),
            request,
            self.db,
        )

        session = self.db.query(UserSession).filter_by(
            id=self._session_id(result["access_token"])
        ).one()
        self.assertEqual(session.ip_address, "197.156.0.25")
        self.assertEqual(session.location, "Addis Ababa, Ethiopia")
        self.assertEqual(self.resolved_ips[-1], "197.156.0.25")
        serialized = main_module.get_student_sessions(
            authorization=f"Bearer {result['access_token']}",
            db=self.db,
        )
        current_session = next(item for item in serialized if item["is_current"])
        self.assertEqual(current_session["location"], "Addis Ababa, Ethiopia")

    def test_successful_login_records_auth_audit_event(self):
        self._login()

        audit_log = self.db.query(AuditLog).filter_by(action="USER_LOGIN_SUCCESS").one()
        self.assertEqual(audit_log.category, "AUTH")
        self.assertEqual(audit_log.severity, "INFO")
        self.assertEqual(audit_log.actor_role, "student")
        self.assertEqual(audit_log.entity_type, "User Account")
        self.assertEqual(audit_log.ip_address, "8.8.8.8")
        self.assertEqual(audit_log.metadata_json["actor_name"], self.student.name)
        self.assertEqual(audit_log.metadata_json["actor_id"], self.student.student_id)
        self.assertEqual(audit_log.metadata_json["details"], {
            "message": "Login successful via credentials",
        })

    def test_student_login_otp_accepts_utc_expiry_and_clears_lockout_attempts(self):
        now = datetime.now(timezone.utc)
        otp = "123456"
        reset = PasswordReset(
            email=f"  {self.student.email.upper()}  ",
            otp_hash=main_module._password_reset_otp_hash(
                self.student.email,
                otp,
                "student_login",
            ),
            purpose="student_login",
            expires_at=now.replace(tzinfo=None) + timedelta(minutes=5),
            is_used=False,
            delivery_status="sent",
        )
        attempt = LoginAttempt(
            identifier=f"student:{self.student.student_id.lower()}",
            failed_attempts=5,
            locked_until=(now + timedelta(minutes=15)).replace(tzinfo=None),
        )
        self.db.add_all([reset, attempt])
        self.db.commit()

        with patch.object(main_module, "_utc_now", return_value=now):
            result = main_module.verify_student_login_otp(
                main_module.StudentLoginOtpRequest(
                    email=f" {self.student.email.upper()} ",
                    otp_code=otp,
                ),
                self._request("8.8.8.8", "Mozilla/5.0"),
                self.db,
            )

        self.assertEqual(result["role"], "student")
        self.assertTrue(result["access_token"])
        self.assertTrue(reset.is_used)
        self.assertIsNone(
            self.db.query(LoginAttempt)
            .filter_by(identifier=f"student:{self.student.student_id.lower()}")
            .first()
        )
        self.assertEqual(
            self.db.query(UserSession).filter_by(user_id=self.student.student_id).count(),
            1,
        )

    def test_student_login_otp_logs_and_rejects_exhausted_attempts(self):
        now = datetime.now(timezone.utc)
        self.db.add(PasswordReset(
            email=self.student.email,
            otp_hash=main_module._password_reset_otp_hash(
                self.student.email,
                "123456",
                "student_login",
            ),
            purpose="student_login",
            expires_at=now.replace(tzinfo=None) + timedelta(minutes=5),
            is_used=False,
            delivery_status="sent",
            verification_attempts=5,
        ))
        self.db.commit()

        with (
            patch.object(main_module, "_utc_now", return_value=now),
            self.assertLogs(main_module.__name__, level="WARNING") as logs,
            self.assertRaises(HTTPException) as error,
        ):
            main_module.verify_student_login_otp(
                main_module.StudentLoginOtpRequest(
                    email=self.student.email,
                    otp_code="123456",
                ),
                self._request("8.8.8.8", "Mozilla/5.0"),
                self.db,
            )

        self.assertEqual(error.exception.status_code, 400)
        self.assertIn("reason=max attempts exceeded", logs.output[0])
        self.assertIn("attempts=5", logs.output[0])
        self.assertEqual(self.db.query(UserSession).count(), 0)

    def test_invalid_password_records_auth_failure_audit_event(self):
        request = self._request("8.8.4.4", "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0")

        with self.assertRaises(HTTPException):
            main_module.login_user(
                main_module.LoginRequest(
                    id_or_email=self.student.email,
                    password="incorrect-password",
                ),
                request,
                self.db,
            )

        audit_log = self.db.query(AuditLog).filter_by(action="AUTH_LOGIN_FAILED").one()
        self.assertEqual(audit_log.category, "AUTH")
        self.assertEqual(audit_log.severity, "WARNING")
        self.assertEqual(audit_log.status, "FAILURE")
        self.assertEqual(audit_log.actor_role, "student")
        self.assertEqual(audit_log.ip_address, "8.8.4.4")
        self.assertEqual(audit_log.metadata_json["actor_name"], self.student.email.lower())
        self.assertEqual(audit_log.metadata_json["attempted_identifier"], self.student.email.lower())
        self.assertEqual(audit_log.metadata_json["details"], {
            "reason": "Invalid password or unverified account",
        })

    def test_login_token_expiry_is_fixed_at_seven_days(self):
        started_at = datetime.now(timezone.utc)
        result = self._login()
        payload = main_module._decode_student_jwt(result["access_token"])
        expected_expiry = started_at + timedelta(days=7)

        self.assertAlmostEqual(
            payload["exp"],
            expected_expiry.timestamp(),
            delta=10,
        )

    def test_login_timestamp_is_persisted_and_serialized_as_utc_iso(self):
        started_at = datetime.now(timezone.utc)
        result = self._login()
        finished_at = datetime.now(timezone.utc)
        session_id = self._session_id(result["access_token"])
        session = self.db.query(UserSession).filter(UserSession.id == session_id).one()
        expected_signed_in_at = main_module._as_utc_datetime(session.created_at)

        self.assertGreaterEqual(expected_signed_in_at, started_at)
        self.assertLessEqual(expected_signed_in_at, finished_at)

        sessions = main_module.get_student_sessions(
            authorization=f"Bearer {result['access_token']}",
            db=self.db,
        )
        current_session = next(item for item in sessions if item["is_current"])
        self.assertEqual(current_session["created_at"], expected_signed_in_at.isoformat())
        self.assertEqual(current_session["signed_in_at"], expected_signed_in_at.isoformat())
        self.assertTrue(current_session["last_active_at"].endswith("+00:00"))

    def test_forwarded_ip_is_only_used_from_a_configured_trusted_proxy(self):
        request = self._request(
            "127.0.0.1",
            "Mozilla/5.0",
            forwarded_for="8.8.8.8, 1.1.1.1",
        )
        with patch.dict(os.environ, {"TRUSTED_PROXY_IPS": "127.0.0.1"}):
            self.assertEqual(main_module._request_client_ip(request), "8.8.8.8")
        with patch.dict(os.environ, {"TRUSTED_PROXY_IPS": ""}):
            self.assertEqual(main_module._request_client_ip(request), "127.0.0.1")

    def test_revoked_token_is_rejected_and_other_session_remains_valid(self):
        first = self._login("8.8.8.8")
        second = self._login("1.1.1.1")

        main_module.revoke_student_session(
            self._session_id(first["access_token"]),
            authorization=f"Bearer {second['access_token']}",
            db=self.db,
        )

        with self.assertRaises(HTTPException) as revoked_error:
            main_module._student_from_authorization(f"Bearer {first['access_token']}", self.db)
        self.assertEqual(revoked_error.exception.status_code, 401)
        self.assertEqual(
            main_module._student_from_authorization(f"Bearer {second['access_token']}", self.db).student_id,
            self.student.student_id,
        )

    def test_token_without_a_persisted_session_is_rejected(self):
        token = main_module._create_session_token(
            self.student.student_id,
            "student",
            30,
            main_module._get_session_secret(),
            session_id=str(uuid.uuid4()),
        )
        with self.assertRaises(HTTPException) as missing_session_error:
            main_module._student_from_authorization(f"Bearer {token}", self.db)
        self.assertEqual(missing_session_error.exception.status_code, 401)

    def test_auth_session_prefers_valid_bearer_over_stale_cookie(self):
        valid_token = self._login()["access_token"]
        stale_token = main_module._create_session_token(
            self.student.student_id,
            "student",
            30,
            main_module._get_session_secret(),
            session_id=str(uuid.uuid4()),
        )
        request = self._request(
            "127.0.0.1",
            "Mozilla/5.0",
            cookie_token=stale_token,
        )

        response = main_module.get_oauth_session(
            request,
            authorization=f"Bearer {valid_token}",
            db=self.db,
        )

        self.assertEqual(response["access_token"], valid_token)
        self.assertEqual(response["user"]["studentId"], self.student.student_id)

    def test_logout_without_token_succeeds_without_database_access(self):
        response = Response()
        with patch.object(main_module, "_ensure_student_session_table", side_effect=AssertionError):
            result = main_module.logout_session(
                self._request("127.0.0.1", "Mozilla/5.0"),
                response,
                authorization=None,
                db=self.db,
            )

        self.assertEqual(result, {"success": True})
        self.assertIn("session_token", response.headers["set-cookie"])

    def test_logout_with_expired_token_succeeds_without_database_access(self):
        expired_token = main_module._create_session_token(
            self.student.student_id,
            "student",
            -1,
            main_module._get_session_secret(),
        )
        response = Response()
        with patch.object(main_module, "_ensure_student_session_table", side_effect=AssertionError):
            result = main_module.logout_session(
                self._request("127.0.0.1", "Mozilla/5.0"),
                response,
                authorization=f"Bearer {expired_token}",
                db=self.db,
            )

        self.assertEqual(result, {"success": True})
        self.assertIn("session_token", response.headers["set-cookie"])

    def test_logout_revokes_a_valid_session(self):
        token = main_module._create_session_token(
            self.student.student_id,
            "student",
            30,
            main_module._get_session_secret(),
        )
        session = StudentSession(
            student_id=self.student.student_id,
            session_token=token,
            is_active=True,
            last_active=datetime.now(timezone.utc),
        )
        self.db.add(session)
        self.db.commit()

        result = main_module.logout_session(
            self._request("127.0.0.1", "Mozilla/5.0"),
            Response(),
            authorization=f"Bearer {token}",
            db=self.db,
        )

        self.assertEqual(result, {"success": True})
        self.assertFalse(session.is_active)

    def test_logout_still_succeeds_when_session_storage_fails(self):
        token = main_module._create_session_token(
            self.student.student_id,
            "student",
            30,
            main_module._get_session_secret(),
        )
        with patch.object(self.db, "query", side_effect=main_module.SQLAlchemyError("database unavailable")):
            result = main_module.logout_session(
                self._request("127.0.0.1", "Mozilla/5.0"),
                Response(),
                authorization=f"Bearer {token}",
                db=self.db,
            )

        self.assertEqual(result, {"success": True})

    def test_student_cannot_revoke_another_users_session(self):
        other_student = Student(
            name="Other User",
            student_id="MAU1600002",
            email="other-user@example.test",
            password=hash_password("OtherPass123!"),
            college="Test College",
            department="Testing",
            is_verified=True,
        )
        self.db.add(other_student)
        self.db.commit()
        other_session = main_module._create_user_session(
            self.db,
            other_student,
            self._request("8.8.4.4", "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0"),
        )
        other_token = main_module._create_session_token(
            other_student.student_id,
            "student",
            30,
            main_module._get_session_secret(),
            session_id=other_session.id,
        )
        own_token = self._login()["access_token"]

        with self.assertRaises(HTTPException) as missing_error:
            main_module.revoke_student_session(
                other_session.id,
                authorization=f"Bearer {own_token}",
                db=self.db,
            )
        self.assertEqual(missing_error.exception.status_code, 404)
        self.assertIsNone(self.db.query(UserSession).filter(UserSession.id == other_session.id).one().revoked_at)
        self.assertEqual(
            main_module._student_from_authorization(f"Bearer {other_token}", self.db).student_id,
            other_student.student_id,
        )

    def test_revoke_others_keeps_current_session(self):
        current = self._login("8.8.8.8")["access_token"]
        other = self._login("1.1.1.1")["access_token"]

        result = main_module.revoke_other_student_sessions(
            authorization=f"Bearer {current}",
            db=self.db,
        )

        self.assertEqual(result["revoked"], 1)
        self.assertEqual(
            main_module._student_from_authorization(f"Bearer {current}", self.db).student_id,
            self.student.student_id,
        )
        with self.assertRaises(HTTPException) as revoked_error:
            main_module._student_from_authorization(f"Bearer {other}", self.db)
        self.assertEqual(revoked_error.exception.status_code, 401)

    def test_last_active_timestamp_updates_on_authenticated_requests(self):
        token = self._login()["access_token"]
        session = self.db.query(UserSession).filter(UserSession.id == self._session_id(token)).one()
        original_last_active = datetime.now(timezone.utc) - timedelta(minutes=2)
        session.last_active_at = original_last_active
        self.db.commit()

        main_module._student_from_authorization(f"Bearer {token}", self.db)

        self.assertGreater(main_module._as_utc_datetime(session.last_active_at), original_last_active)

    def test_session_expires_after_configured_idle_timeout(self):
        token = self._login()["access_token"]
        session = self.db.query(UserSession).filter(UserSession.id == self._session_id(token)).one()
        session.last_active_at = datetime.now(timezone.utc) - timedelta(minutes=31)
        self.db.commit()

        with self.assertRaises(HTTPException) as expired:
            main_module._student_from_authorization(f"Bearer {token}", self.db)

        self.assertEqual(expired.exception.status_code, 401)
        self.assertIsNotNone(session.revoked_at)

    def test_session_expiration_uses_updated_database_timeout(self):
        token = self._login()["access_token"]
        session = self.db.query(UserSession).filter(UserSession.id == self._session_id(token)).one()
        self.db.add(SystemSetting(key="security", value='{"sessionTimeout":1}'))
        session.last_active_at = datetime.now(timezone.utc) - timedelta(minutes=2)
        self.db.commit()

        with self.assertRaises(HTTPException) as expired:
            main_module._student_from_authorization(" ".join(["Bearer", token]), self.db)

        self.assertEqual(expired.exception.status_code, 401)
        self.assertIsNotNone(session.revoked_at)

    def test_password_change_revokes_other_sessions_but_keeps_current(self):
        current_token = self._login("8.8.8.8")["access_token"]
        other_token = self._login("1.1.1.1")["access_token"]

        main_module.update_student_password(
            main_module.StudentPasswordUpdate(
                current_password="SessionPass123!",
                new_password="ChangedPass123!",
                confirm_password="ChangedPass123!",
            ),
            self._request("8.8.8.8", "Mozilla/5.0"),
            authorization=f"Bearer {current_token}",
            db=self.db,
        )

        self.assertEqual(
            main_module._student_from_authorization(f"Bearer {current_token}", self.db).student_id,
            self.student.student_id,
        )
        with self.assertRaises(HTTPException) as revoked_error:
            main_module._student_from_authorization(f"Bearer {other_token}", self.db)
        self.assertEqual(revoked_error.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
