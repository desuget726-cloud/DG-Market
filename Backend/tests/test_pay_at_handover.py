import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import main as main_module
from app.database import Base, get_db
from app.models import (
    Admin,
    AuditLog,
    CartItem,
    Dispute,
    Notification,
    Order,
    PaymentIdempotency,
    PayoutProvider,
    Product,
    SellerPaymentAccount,
    Student,
    SystemSetting,
    Transaction,
    Wallet,
)
from app.password_security import hash_password, verify_password


@pytest.fixture
def market(monkeypatch, tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'payments.sqlite3'}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with session_factory() as db:
        buyer = Student(
            name="Buyer",
            student_id="buyer-1",
            email="buyer@example.test",
            password=hash_password("correct-app-password"),
            has_password=True,
            wallet_pin_hash=hash_password("1234"),
            wallet_balance=Decimal("500.00"),
            is_verified=True,
        )
        seller = Student(
            name="Seller",
            student_id="seller-1",
            email="seller@example.test",
            password=hash_password("seller-password"),
            has_password=True,
            wallet_balance=Decimal("0.00"),
            is_verified=True,
        )
        db.add_all([buyer, seller])
        db.flush()
        db.add_all([
            Wallet(student_id=buyer.student_id, balance=Decimal("500.00")),
            Wallet(student_id=seller.student_id, balance=Decimal("0.00")),
            SystemSetting(
                key="payment",
                value=json.dumps({
                    "commission": {
                        "commission_enabled": True,
                        "commission_type": "percentage",
                        "commission_rate": "10",
                        "commission_min_fee": None,
                        "commission_max_fee": None,
                    },
                }),
            ),
        ])
        product = Product(
            title="Used Textbook",
            category="Books",
            price="100.00",
            stock=3,
            seller=seller.student_id,
            seller_id=seller.student_id,
            status="Approved",
        )
        db.add(product)
        db.commit()
        product_id = product.id
        db.add(CartItem(student_id=buyer.student_id, product_id=product_id, quantity=3))
        db.commit()

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    monkeypatch.setattr(main_module, "_student_from_authorization", lambda authorization, db: db.query(Student).filter_by(
        student_id=str(authorization or "").removeprefix("Bearer "),
    ).one())
    monkeypatch.setattr(main_module, "_student_session_from_authorization", lambda authorization, db: (
        db.query(Student).filter_by(
            student_id=str(authorization or "").removeprefix("Bearer "),
        ).one(),
        SimpleNamespace(id="test-session"),
        "test-token",
    ))
    monkeypatch.setattr(main_module, "_send_student_notification_email", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(main_module, "_require_admin", lambda *_args: SimpleNamespace(id=1, username="admin"))
    main_module.app.dependency_overrides[get_db] = override_get_db
    client = TestClient(main_module.app)
    yield client, session_factory, product_id
    client.close()
    main_module.app.dependency_overrides.pop(get_db, None)
    engine.dispose()


def _headers(user="buyer-1", key=None):
    headers = {"Authorization": f"Bearer {user}"}
    if key is not None:
        headers["Idempotency-Key"] = key
    return headers


def _pay(client, product_id, *, pin="1234", quantity=1, key="payment-key-001"):
    return client.post(
        f"/api/products/{product_id}/pay",
        headers=_headers(key=key),
        json={"pin": pin, "quantity": quantity},
    )


def _snapshot(session_factory):
    with session_factory() as db:
        return {
            "buyer_balance": db.query(Wallet).filter_by(student_id="buyer-1").one().balance,
            "seller_balance": db.query(Wallet).filter_by(student_id="seller-1").one().balance,
            "stock": db.query(Product).one().stock,
            "orders": db.query(Order).count(),
            "transactions": db.query(Transaction).count(),
        }


def _create_chapa_seller_account(session_factory, *, subaccount_id="subaccount-123", active=True):
    with session_factory() as db:
        provider = PayoutProvider(
            name="Chapa Test Bank",
            type="bank",
            code="CHAPA-TEST-BANK",
            is_active=True,
            integration_status="available",
        )
        db.add(provider)
        db.flush()
        db.add(SellerPaymentAccount(
            student_id="seller-1",
            provider_id=provider.id,
            chapa_sub_account_id=subaccount_id,
            business_name="Seller Shop",
            payout_type="bank",
            bank_code=provider.code,
            account_name="Seller",
            account_status="Active" if active else "Pending",
        ))
        db.commit()


def _configure_chapa_checkout(monkeypatch):
    monkeypatch.setattr(main_module, "get_chapa_secret_key", lambda: "test-secret")
    monkeypatch.setattr(
        main_module,
        "_get_public_payment_url",
        lambda setting: (
            "https://market.example.test/api/payment/webhook"
            if setting == "CHAPA_CALLBACK_URL"
            else "https://market.example.test/api/payment/return"
        ),
    )
    monkeypatch.setattr(main_module, "_get_chapa_return_url", lambda: "https://market.example.test/return")


def test_product_chapa_checkout_requires_active_seller_subaccount(market, monkeypatch):
    client, session_factory, product_id = market
    _configure_chapa_checkout(monkeypatch)

    response = client.post(
        f"/api/products/{product_id}/checkout",
        headers=_headers(key="chapa-key-001"),
        json={"quantity": 1},
    )

    assert response.status_code == 409
    assert "seller must complete chapa payout setup" in response.json()["detail"].lower()
    snapshot = _snapshot(session_factory)
    assert snapshot["orders"] == 0
    assert snapshot["stock"] == 3


def test_product_chapa_checkout_rejects_inactive_seller_subaccount(market, monkeypatch):
    client, session_factory, product_id = market
    _create_chapa_seller_account(session_factory, active=False)
    _configure_chapa_checkout(monkeypatch)

    response = client.post(
        f"/api/products/{product_id}/checkout",
        headers=_headers(key="chapa-key-003"),
        json={"quantity": 1},
    )

    assert response.status_code == 409
    assert "seller must complete chapa payout setup" in response.json()["detail"].lower()
    snapshot = _snapshot(session_factory)
    assert snapshot["orders"] == 0
    assert snapshot["stock"] == 3


def test_product_chapa_checkout_retries_terminal_failure_with_same_idempotency_key(market, monkeypatch, caplog):
    client, session_factory, product_id = market
    _create_chapa_seller_account(session_factory)
    _configure_chapa_checkout(monkeypatch)

    class ChapaResponse:
        def __init__(self, status_code, payload):
            self.status_code = status_code
            self.is_error = status_code >= 400
            self.payload = payload
            self.text = json.dumps(payload)

        def json(self):
            return self.payload

    responses = [
        ChapaResponse(400, {
            "status": "failed",
            "message": "Validation Error",
            "errors": {"split_value": ["must be greater than zero"]},
        }),
        ChapaResponse(200, {
            "status": "success",
            "data": {"checkout_url": "https://checkout.chapa.test/retry"},
        }),
    ]
    initialized_tx_refs = []
    initialized_payloads = []

    class RetryingChapaClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def post(self, _url, *, json, **_kwargs):
            initialized_tx_refs.append(json["tx_ref"])
            initialized_payloads.append(dict(json))
            return responses.pop(0)

    monkeypatch.setattr(main_module.httpx, "AsyncClient", lambda **_kwargs: RetryingChapaClient())
    headers = _headers(key="chapa-retry-key-01")
    caplog.set_level("INFO", logger="app.payments")
    first_response = client.post(
        f"/api/products/{product_id}/checkout",
        headers=headers,
        json={"quantity": 1},
    )
    assert first_response.status_code == 400
    assert first_response.json()["detail"] == (
        'Validation Error: {"split_value":["must be greater than zero"]}'
    )
    assert json.dumps(
        initialized_payloads[0],
        ensure_ascii=False,
        separators=(",", ":"),
    ) in caplog.text
    expected_error_body = json.dumps({
        'status': 'failed',
        'message': 'Validation Error',
        'errors': {'split_value': ['must be greater than zero']},
    })
    assert f"response_body={expected_error_body}" in caplog.text
    assert _snapshot(session_factory)["stock"] == 3

    retry_response = client.post(
        f"/api/products/{product_id}/checkout",
        headers=headers,
        json={"quantity": 1},
    )
    assert retry_response.status_code == 200, retry_response.text
    assert retry_response.json()["checkout_url"] == "https://checkout.chapa.test/retry"
    assert retry_response.json()["tx_ref"] == initialized_tx_refs[1]
    assert initialized_tx_refs[0] != initialized_tx_refs[1]
    with session_factory() as db:
        orders = db.query(Order).order_by(Order.id).all()
        transactions = db.query(Transaction).order_by(Transaction.id).all()
        assert len(orders) == 2
        assert orders[0].payment_status == "Failed"
        assert orders[1].payment_status == "Pending"
        assert transactions[0].status == "Failed"
        assert transactions[1].status == "Pending"
        assert db.query(PaymentIdempotency).count() == 1
        assert db.query(Product).one().stock == 2


def test_product_chapa_checkout_timeout_returns_json_error(market, monkeypatch):
    client, session_factory, product_id = market
    _create_chapa_seller_account(session_factory)
    _configure_chapa_checkout(monkeypatch)
    client_timeouts = []

    class TimedOutChapaClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def post(self, *_args, **_kwargs):
            raise main_module.httpx.TimeoutException("Chapa request timed out")

    def create_chapa_client(**kwargs):
        client_timeouts.append(kwargs.get("timeout"))
        return TimedOutChapaClient()

    monkeypatch.setattr(
        main_module.httpx,
        "AsyncClient",
        create_chapa_client,
    )

    response = client.post(
        f"/api/products/{product_id}/checkout",
        headers=_headers(key="chapa-timeout-key-01"),
        json={"quantity": 1},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == (
        "Chapa did not respond in time. Retry checkout to resume the same payment safely."
    )
    assert client_timeouts == [15.0]
    snapshot = _snapshot(session_factory)
    assert snapshot["orders"] == 1
    assert snapshot["stock"] == 2


def test_product_chapa_checkout_omits_nonpositive_split_override(market, monkeypatch):
    client, session_factory, product_id = market
    _create_chapa_seller_account(session_factory)
    _configure_chapa_checkout(monkeypatch)
    with session_factory() as db:
        payment_setting = db.query(SystemSetting).filter_by(key="payment").one()
        settings = json.loads(payment_setting.value)
        settings["commission"]["commission_enabled"] = False
        payment_setting.value = json.dumps(settings)
        db.commit()

    captured_payload = {}

    class ChapaResponse:
        status_code = 200
        is_error = False

        def json(self):
            return {"status": "success", "data": {"checkout_url": "https://checkout.chapa.test/pay"}}

    class CapturingChapaClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def post(self, _url, *, json, **_kwargs):
            captured_payload.update(json)
            return ChapaResponse()

    monkeypatch.setattr(main_module.httpx, "AsyncClient", lambda **_kwargs: CapturingChapaClient())
    response = client.post(
        f"/api/products/{product_id}/checkout",
        headers=_headers(key="chapa-no-commission-key"),
        json={"quantity": 1},
    )

    assert response.status_code == 200, response.text
    assert captured_payload["subaccounts"] == {"id": "subaccount-123"}


def test_product_return_verification_settles_and_returns_updated_order(market, monkeypatch):
    client, session_factory, product_id = market
    _create_chapa_seller_account(session_factory)
    _configure_chapa_checkout(monkeypatch)

    class ChapaResponse:
        status_code = 200
        is_error = False

        def json(self):
            return {"status": "success", "data": {"checkout_url": "https://checkout.chapa.test/pay"}}

    class CapturingChapaClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def post(self, _url, *, json, **_kwargs):
            return ChapaResponse()

    monkeypatch.setattr(main_module.httpx, "AsyncClient", lambda **_kwargs: CapturingChapaClient())
    checkout = client.post(
        f"/api/products/{product_id}/checkout",
        headers=_headers(key="chapa-return-verify-key"),
        json={"quantity": 1},
    )
    assert checkout.status_code == 200, checkout.text
    tx_ref = checkout.json()["tx_ref"]

    monkeypatch.setenv("CHAPA_MODE", "live")
    verified_references = []

    def verify_with_chapa(reference):
        verified_references.append(reference)
        return {
            "tx_ref": reference,
            "amount": Decimal("100.00"),
            "currency": "ETB",
            "status": "Successful",
        }

    monkeypatch.setattr(
        main_module,
        "_request_chapa_verification",
        verify_with_chapa,
    )
    response = client.get(
        f"/api/payment/verify/{tx_ref}",
        headers=_headers(),
    )

    assert response.status_code == 200, response.text
    verification = response.json()
    assert verification["status"] == "Successful"
    assert verification["transaction_type"] == "Product Purchase"
    assert verification["order"]["id"] == verification["order_id"]
    assert verification["order"]["status"] == "Completed"
    assert verification["order"]["payment_status"] == "Successful"
    assert verified_references == [tx_ref]
    with session_factory() as db:
        transaction = db.query(Transaction).filter_by(tx_id=tx_ref).one()
        order = db.query(Order).filter_by(id=verification["order_id"]).one()
        assert transaction.status == "Successful"
        assert order.status == "Completed"
        assert order.payment_status == "Successful"


def test_product_chapa_split_checkout_and_webhook_do_not_credit_seller_wallet(market, monkeypatch):
    client, session_factory, product_id = market
    _create_chapa_seller_account(session_factory)
    _configure_chapa_checkout(monkeypatch)
    with session_factory() as db:
        payment_setting = db.query(SystemSetting).filter_by(key="payment").one()
        settings = json.loads(payment_setting.value)
        settings["commission"]["commission_rate"] = "1.0"
        payment_setting.value = json.dumps(settings)
        db.commit()

    captured_payload = {}

    class ChapaResponse:
        status_code = 200
        is_error = False

        def json(self):
            return {"status": "success", "data": {"checkout_url": "https://checkout.chapa.test/pay"}}

    class CapturingChapaClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def post(self, _url, *, json, **_kwargs):
            captured_payload.update(json)
            return ChapaResponse()

    monkeypatch.setattr(main_module.httpx, "AsyncClient", lambda **_kwargs: CapturingChapaClient())
    response = client.post(
        f"/api/products/{product_id}/checkout",
        headers=_headers(key="chapa-key-002"),
        json={"quantity": 2},
    )
    assert response.status_code == 200, response.text
    checkout = response.json()
    assert checkout["checkout_url"] == "https://checkout.chapa.test/pay"
    assert captured_payload["amount"] == "200.00"
    assert captured_payload["subaccounts"] == {
        "id": "subaccount-123",
        "split_type": "percentage",
        "split_value": "1.0000",
    }
    assert _snapshot(session_factory)["stock"] == 1

    tx_ref = checkout["tx_ref"]
    body = json.dumps({
        "status": "success",
        "tx_ref": tx_ref,
        "amount": "200.00",
        "currency": "ETB",
    }).encode()
    signature = main_module._compute_chapa_body_signature("webhook-test-secret", body)
    monkeypatch.setattr(
        main_module,
        "_request_chapa_verification",
        lambda reference: {
            "tx_ref": reference,
            "amount": Decimal("200.00"),
            "currency": "ETB",
            "status": "Successful",
        },
    )
    monkeypatch.setenv("CHAPA_WEBHOOK_SECRET", "webhook-test-secret")

    webhook = client.post(
        "/api/payment/webhook",
        content=body,
        headers={"content-type": "application/json", "x-chapa-signature": signature},
    )
    assert webhook.status_code == 200, webhook.text
    assert webhook.json()["settled"] is True
    replay = client.post(
        "/api/payment/webhook",
        content=body,
        headers={"content-type": "application/json", "x-chapa-signature": signature},
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["settled"] is False

    with session_factory() as db:
        order = db.query(Order).one()
        transaction = db.query(Transaction).filter_by(tx_id=tx_ref).one()
        assert order.status == "Completed"
        assert order.payment_status == "Successful"
        assert order.seller_commission == Decimal("2.00")
        assert transaction.status == "Successful"
        assert db.query(Wallet).filter_by(student_id="seller-1").one().balance == Decimal("0.00")
        assert db.query(Wallet).filter_by(student_id="buyer-1").one().balance == Decimal("500.00")
        commission_balance = db.query(SystemSetting).filter_by(key="system_wallet_balance").one()
        assert Decimal(commission_balance.value) == Decimal("2.00")


def test_cart_total_matches_customer_checkout_total(market):
    client, _session_factory, _product_id = market

    response = client.get("/api/student/cart", params={"student_id": "buyer-1"})

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == body["subtotal"] == body["checkout_total"] == 300.0
    assert body["platform_fee"] == 0.0
    assert body["seller_commission"] == 30.0
    assert body["items"][0]["platform_fee"] == 0.0


def test_pay_summary_and_happy_path_create_completed_order_and_credit_seller(market):
    client, session_factory, product_id = market
    summary = client.get(
        f"/api/products/{product_id}/pay-summary?quantity=2",
        headers=_headers(),
    )
    assert summary.status_code == 200
    assert summary.json()["total"] == "200.00"
    assert summary.json()["checkout_total"] == "200.00"
    assert summary.json()["seller_commission"] == "20.00"
    assert summary.json()["quantity_limit"] == 3
    assert summary.json()["seller_name"] == "Seller"
    assert summary.json()["wallet_balance"] == "500.00"
    assert summary.json()["has_wallet_pin"] is True
    assert _snapshot(session_factory)["orders"] == 0

    response = _pay(client, product_id, quantity=2)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "Completed"
    assert body["amount"] == "200.00"
    assert body["seller_name"] == "Seller"
    assert body["completed_at"]
    assert body["completed_at"].endswith("+00:00")

    with session_factory() as db:
        order = db.query(Order).one()
        assert order.status == "Completed"
        assert order.payment_status == "Successful"
        assert order.created_at == order.paid_at == order.completed_at
        assert order.paid_at == order.completed_at
        assert order.quantity == 2
        assert order.commission_amount == Decimal("20.00")
        assert order.commission_rate == Decimal("10.0000")
        assert order.commission_type == "percentage"
        assert db.query(Wallet).filter_by(student_id="buyer-1").one().balance == Decimal("300.00")
        assert db.query(Wallet).filter_by(student_id="seller-1").one().balance == Decimal("180.00")
        assert db.query(Product).one().stock == 1
        assert db.query(Transaction).filter_by(type="Product Purchase").one().amount == Decimal("200.00")
        assert db.query(Transaction).filter_by(type="Product Sale").one().amount == Decimal("180.00")
        assert db.query(AuditLog).filter_by(action="payment_completed").count() == 1
        assert db.query(Notification).filter_by(student_id="buyer-1").count() == 1
        assert db.query(Notification).filter_by(student_id="seller-1").count() == 1
        for student_id, title, role in (
            ("buyer-1", "Payment completed", "buyer"),
            ("seller-1", "Payment received", "seller"),
        ):
            notification = db.query(Notification).filter_by(
                student_id=student_id,
                title=title,
            ).one()
            assert notification.reference_id == str(body["order_id"])
            assert notification.action_url == (
                f"/dashboard?tab={role}&section=orders&order={body['order_id']}"
            )
            assert notification.action_label == "View Order"
            assert json.loads(notification.target) == {
                "kind": "order",
                "order_id": body["order_id"],
            }

    receipt = client.get(
        f"/api/student/orders/{body['order_id']}/receipt",
        headers=_headers(),
    )
    assert receipt.status_code == 200, receipt.text
    assert receipt.json()["fees"] == 20.0
    assert receipt.json()["platform_commission_label"] == (
        "Platform commission (10%, deducted from seller payout)"
    )

    notification_response = client.get(
        "/api/student/notifications?student_id=buyer-1",
        headers=_headers(),
    )
    assert notification_response.status_code == 200
    buyer_notification = notification_response.json()["notifications"][0]
    assert buyer_notification["reference_id"] == str(body["order_id"])
    assert buyer_notification["action_url"] == (
        f"/dashboard?tab=buyer&section=orders&order={body['order_id']}"
    )


def test_one_percent_commission_is_saved_and_shown_on_receipt(market):
    client, session_factory, product_id = market
    with session_factory() as db:
        buyer = db.query(Student).filter_by(student_id="buyer-1").one()
        buyer.wallet_balance = Decimal("1000.00")
        db.query(Wallet).filter_by(student_id="buyer-1").one().balance = Decimal("1000.00")
        db.query(Product).filter_by(id=product_id).one().price = "1000.00"
        db.query(CartItem).filter_by(
            student_id="buyer-1",
            product_id=product_id,
        ).one().quantity = 1
        payment_setting = db.query(SystemSetting).filter_by(key="payment").one()
        payment = json.loads(payment_setting.value)
        payment["commission"]["commission_rate"] = "1"
        payment_setting.value = json.dumps(payment)
        db.commit()

    response = _pay(client, product_id, quantity=1, key="one-percent-payment")
    assert response.status_code == 200, response.text

    with session_factory() as db:
        order = db.query(Order).one()
        assert order.commission_amount == Decimal("10.00")
        assert order.commission_rate == Decimal("1.0000")
        assert db.query(Wallet).filter_by(student_id="seller-1").one().balance == Decimal("990.00")
        payment_setting = db.query(SystemSetting).filter_by(key="payment").one()
        payment = json.loads(payment_setting.value)
        payment["commission"]["commission_rate"] = "5"
        payment_setting.value = json.dumps(payment)
        db.commit()

    receipt = client.get(
        f"/api/student/orders/{response.json()['order_id']}/receipt",
        headers=_headers(),
    )
    assert receipt.status_code == 200, receipt.text
    assert receipt.json()["fees"] == 10.0
    assert receipt.json()["platform_commission_label"] == (
        "Platform commission (1%, deducted from seller payout)"
    )


def test_wallet_payment_requires_product_in_buyer_cart(market):
    client, session_factory, product_id = market
    with session_factory() as db:
        cart_item = db.query(CartItem).filter_by(student_id="buyer-1", product_id=product_id).one()
        db.delete(cart_item)
        db.commit()

    response = _pay(client, product_id)

    assert response.status_code == 409
    assert response.json()["detail"] == "Add this product to your cart before paying."
    snapshot = _snapshot(session_factory)
    assert snapshot["buyer_balance"] == Decimal("500.00")
    assert snapshot["seller_balance"] == Decimal("0.00")
    assert snapshot["stock"] == 3
    assert snapshot["orders"] == 0
    assert snapshot["transactions"] == 0


def test_pin_failures_are_committed_and_lock_even_correct_pin(market):
    client, session_factory, product_id = market
    responses = [
        _pay(client, product_id, pin="0000", key=f"wrong-key-{i:02d}")
        for i in range(5)
    ]
    assert [response.status_code for response in responses] == [400, 400, 400, 400, 423]
    assert [response.json() for response in responses[:4]] == [
        {
            "detail": "Incorrect Wallet PIN",
            "error_code": "INCORRECT_PIN",
            "remaining_attempts": attempts_left,
        }
        for attempts_left in [4, 3, 2, 1]
    ]
    assert responses[-1].json()["detail"]["retry_after_seconds"] == 15 * 60
    locked = _pay(client, product_id, key="correct-but-locked")
    assert locked.status_code == 423
    assert _snapshot(session_factory)["orders"] == 0
    with session_factory() as db:
        buyer = db.query(Student).filter_by(student_id="buyer-1").one()
        assert buyer.pay_failed_attempts == 5
        assert buyer.pay_locked_until is not None
        logs = db.query(AuditLog).filter(
            AuditLog.action.in_(["payment_pin_failed", "payment_locked"]),
        ).all()
        assert len(logs) == 5
        assert all("0000" not in (log.description or "") for log in logs)
        assert "0000" not in json.dumps([response.json() for response in responses])

        buyer.pay_locked_until = datetime.utcnow() - timedelta(seconds=1)
        db.commit()

    success = _pay(client, product_id, key="after-lock-expired")
    assert success.status_code == 200, success.text


def test_google_only_buyer_can_set_wallet_pin_without_an_app_password(market):
    client, session_factory, product_id = market
    with session_factory() as db:
        buyer = db.query(Student).filter_by(student_id="buyer-1").one()
        buyer.has_password = False
        buyer.password = ""
        buyer.wallet_pin_hash = None
        db.commit()

    response = _pay(client, product_id)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "PIN_NOT_SET"
    assert response.json()["detail"]["action"] == "set_pin"
    assert _snapshot(session_factory)["orders"] == 0

    setup_response = client.post(
        "/api/wallet/set-pin",
        headers=_headers(),
        json={"pin": "2468"},
    )
    assert setup_response.status_code == 200, setup_response.text
    assert setup_response.json()["has_wallet_pin"] is True
    with session_factory() as db:
        buyer = db.query(Student).filter_by(student_id="buyer-1").one()
        assert buyer.has_password is False
        assert buyer.wallet_pin_hash != "2468"
        assert verify_password("2468", buyer.wallet_pin_hash)
    assert _pay(client, product_id, pin="2468").status_code == 200


def test_wallet_pin_change_requires_current_pin_and_validates_four_digits(market):
    client, session_factory, product_id = market
    missing_current_pin = client.post(
        "/api/wallet/set-pin",
        headers=_headers(),
        json={"pin": "5678"},
    )
    assert missing_current_pin.status_code == 400
    assert missing_current_pin.json() == {
        "detail": "Current wallet PIN is incorrect.",
        "error_code": "INCORRECT_PIN",
        "remaining_attempts": 4,
    }

    changed = client.post(
        "/api/wallet/set-pin",
        headers=_headers(),
        json={"current_pin": "1234", "pin": "5678"},
    )
    assert changed.status_code == 200, changed.text
    assert _pay(client, product_id, pin="5678").status_code == 200

    invalid_pin = client.post(
        "/api/wallet/set-pin",
        headers=_headers(),
        json={"pin": "12a4"},
    )
    assert invalid_pin.status_code == 422
    with session_factory() as db:
        buyer = db.query(Student).filter_by(student_id="buyer-1").one()
        assert verify_password("5678", buyer.wallet_pin_hash)


def test_same_idempotency_key_returns_same_order_and_different_product_conflicts(market):
    client, session_factory, product_id = market
    first = _pay(client, product_id, key="repeat-key-0001")
    second = _pay(client, product_id, key="repeat-key-0001")
    assert first.status_code == second.status_code == 200
    assert first.json()["order_id"] == second.json()["order_id"]
    assert second.json()["already_paid"] is True
    assert _snapshot(session_factory) == {
        "buyer_balance": Decimal("400.00"),
        "seller_balance": Decimal("90.00"),
        "stock": 2,
        "orders": 1,
        "transactions": 2,
    }
    with session_factory() as db:
        other_product = Product(
            title="Second book",
            category="Books",
            price="50.00",
            stock=2,
            seller="seller-1",
            seller_id="seller-1",
            status="Approved",
        )
        db.add(other_product)
        db.commit()
        other_product_id = other_product.id
    conflict = _pay(client, other_product_id, key="repeat-key-0001")
    assert conflict.status_code == 409


def test_concurrent_duplicate_requests_charge_once(market):
    client, session_factory, product_id = market
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(
            lambda _: _pay(client, product_id, key="concurrent-key-01"),
            range(2),
        ))
    assert all(response.status_code == 200 for response in responses), [response.text for response in responses]
    assert len({response.json()["order_id"] for response in responses}) == 1
    assert _snapshot(session_factory)["orders"] == 1
    assert _snapshot(session_factory)["buyer_balance"] == Decimal("400.00")


def test_insufficient_balance_moves_nothing_and_chapa_settlement_is_idempotent(market):
    client, session_factory, product_id = market
    with session_factory() as db:
        buyer_wallet = db.query(Wallet).filter_by(student_id="buyer-1").one()
        buyer_wallet.balance = Decimal("5.00")
        db.query(Student).filter_by(student_id="buyer-1").one().wallet_balance = Decimal("5.00")
        db.commit()
    before = _snapshot(session_factory)
    response = _pay(client, product_id)
    assert response.status_code == 402
    detail = response.json()["detail"]
    assert detail["code"] == "INSUFFICIENT_BALANCE"
    assert detail["missing"] == "95.00"
    assert detail["action"] == "topup"
    assert _snapshot(session_factory) == before

    with session_factory() as db:
        db.add(Transaction(
            student_id="buyer-1",
            tx_id="CHAPA-TOPUP-ONCE",
            type="Wallet Deposit",
            amount=Decimal("200.00"),
            description="Test top-up",
            status="Pending",
        ))
        db.commit()
        first = main_module._settle_verified_chapa_transaction(db, "CHAPA-TOPUP-ONCE")
        duplicate = main_module._settle_verified_chapa_transaction(db, "CHAPA-TOPUP-ONCE")
        assert first["already_settled"] is False
        assert duplicate["already_settled"] is True
    assert _snapshot(session_factory)["buyer_balance"] == Decimal("205.00")
    assert _pay(client, product_id).status_code == 200


def test_own_listing_out_of_stock_and_quantity_limit_do_not_move_money(market):
    client, session_factory, product_id = market
    with session_factory() as db:
        product = db.query(Product).filter_by(id=product_id).one()
        product.stock = 0
        db.commit()
    before = _snapshot(session_factory)
    assert _pay(client, product_id).json()["detail"]["code"] == "OUT_OF_STOCK"
    assert _snapshot(session_factory) == before

    with session_factory() as db:
        product = db.query(Product).filter_by(id=product_id).one()
        product.stock = 2
        db.commit()
    before = _snapshot(session_factory)
    too_many = _pay(client, product_id, quantity=3, key="quantity-key-01")
    assert too_many.status_code == 409
    assert too_many.json()["detail"]["code"] == "OUT_OF_STOCK"
    assert _snapshot(session_factory) == before

    with session_factory() as db:
        product = db.query(Product).filter_by(id=product_id).one()
        product.seller_id = "buyer-1"
        product.seller = "buyer-1"
        db.commit()
    own_listing = _pay(client, product_id, key="own-listing-key")
    assert own_listing.status_code == 403
    assert own_listing.json()["detail"] == "You cannot buy your own listing."
    assert _snapshot(session_factory)["orders"] == 0


def test_payment_requires_reliable_seller_id_and_valid_positive_price(market):
    client, session_factory, product_id = market
    with session_factory() as db:
        product = db.query(Product).filter_by(id=product_id).one()
        product.seller_id = None
        product.seller = "Seller"
        db.commit()
    before = _snapshot(session_factory)
    missing_seller_id = _pay(client, product_id)
    assert missing_seller_id.status_code == 409
    assert _snapshot(session_factory) == before

    with session_factory() as db:
        product = db.query(Product).filter_by(id=product_id).one()
        product.seller_id = "seller-1"
        product.seller = "Seller"
        product.price = "NaN"
        db.commit()
    before = _snapshot(session_factory)
    invalid_price = _pay(client, product_id, key="invalid-price-key")
    assert invalid_price.status_code == 409
    assert _snapshot(session_factory) == before


def test_sold_out_listing_returns_out_of_stock_for_summary_and_payment(market):
    client, session_factory, product_id = market
    with session_factory() as db:
        product = db.query(Product).filter_by(id=product_id).one()
        product.stock = 0
        product.status = "Sold"
        db.commit()

    before = _snapshot(session_factory)
    summary = client.get(
        f"/api/products/{product_id}/pay-summary?quantity=1",
        headers=_headers(),
    )
    assert summary.status_code == 409
    assert summary.json()["detail"]["code"] == "OUT_OF_STOCK"

    payment = _pay(client, product_id, key="sold-out-key-01")
    assert payment.status_code == 409
    assert payment.json()["detail"]["code"] == "OUT_OF_STOCK"
    assert _snapshot(session_factory) == before


def test_post_payment_dispute_freezes_available_proceeds_and_admin_refund(market):
    client, session_factory, product_id = market
    paid = _pay(client, product_id)
    order_id = paid.json()["order_id"]
    with session_factory() as db:
        seller = db.query(Student).filter_by(student_id="seller-1").one()
        seller_wallet = db.query(Wallet).filter_by(student_id="seller-1").one()
        seller_wallet.balance = Decimal("10.00")
        seller.wallet_balance = Decimal("10.00")
        admin = Admin(username="admin", email="admin@example.test", password_hash="unused")
        db.add(admin)
        db.commit()
        admin_id = admin.id
    dispute_response = client.post(
        f"/api/student/orders/{order_id}/dispute",
        headers=_headers(),
        json={"reason": "Item differs from description", "description": "The condition is different."},
    )
    assert dispute_response.status_code == 200, dispute_response.text
    with session_factory() as db:
        seller_wallet = db.query(Wallet).filter_by(student_id="seller-1").one()
        assert seller_wallet.balance == Decimal("0.00")
        assert seller_wallet.frozen_balance == Decimal("10.00")
        dispute = db.query(Dispute).one()
        assert dispute.post_payment is True
        assert dispute.frozen_amount == Decimal("10.00")
        assert db.query(Notification).filter(Notification.student_id.in_(["buyer-1", "seller-1"])).count() >= 4
        assert db.query(AuditLog).filter_by(
            action="Dispute Funds Frozen",
        ).one().description.endswith("shortfall 80.00 ETB.")
        assert db.query(AuditLog).filter_by(
            action="Order Dispute Raised",
            admin_id=admin_id,
        ).count() == 1
        dispute_id = dispute.id

    resolved = client.patch(
        f"/api/admin/disputes/{dispute_id}/resolve",
        headers=_headers("admin"),
        json={"decision": "REFUND"},
    )
    assert resolved.status_code == 200, resolved.text
    with session_factory() as db:
        assert db.query(Wallet).filter_by(student_id="buyer-1").one().balance == Decimal("410.00")
        seller_wallet = db.query(Wallet).filter_by(student_id="seller-1").one()
        assert seller_wallet.balance == Decimal("0.00")
        assert seller_wallet.frozen_balance == Decimal("0.00")
        assert db.query(AuditLog).filter_by(action="post_payment_dispute_resolved").count() == 1
        assert db.query(Transaction).filter_by(tx_id=f"DISPUTE-REFUND-{dispute_id}").one().amount == Decimal("10.00")
    assert client.patch(
        f"/api/admin/disputes/{dispute_id}/resolve",
        headers=_headers("admin"),
        json={"decision": "REFUND"},
    ).status_code == 409


@pytest.mark.parametrize(
    ("decision", "split_amount", "buyer_balance", "seller_balance"),
    [
        ("RELEASE", None, Decimal("400.00"), Decimal("90.00")),
        ("SPLIT", "30.00", Decimal("430.00"), Decimal("60.00")),
    ],
)
def test_admin_release_and_split_move_only_frozen_funds(
    market, decision, split_amount, buyer_balance, seller_balance,
):
    client, session_factory, product_id = market
    order_id = _pay(client, product_id).json()["order_id"]
    dispute = client.post(
        f"/api/student/orders/{order_id}/dispute",
        headers=_headers(),
        json={"reason": "Item damaged", "description": "There is damage not shown in the listing."},
    )
    assert dispute.status_code == 200
    dispute_id = dispute.json()["dispute"]["id"]
    payload = {"decision": decision}
    if split_amount is not None:
        payload["amount"] = split_amount
    resolved = client.patch(
        f"/api/admin/disputes/{dispute_id}/resolve",
        headers=_headers("admin"),
        json=payload,
    )
    assert resolved.status_code == 200, resolved.text
    with session_factory() as db:
        assert db.query(Wallet).filter_by(student_id="buyer-1").one().balance == buyer_balance
        seller_wallet = db.query(Wallet).filter_by(student_id="seller-1").one()
        assert seller_wallet.balance == seller_balance
        assert seller_wallet.frozen_balance == Decimal("0.00")


def test_dispute_after_window_is_rejected(market):
    client, session_factory, product_id = market
    order_id = _pay(client, product_id).json()["order_id"]
    with session_factory() as db:
        db.query(Order).filter_by(id=order_id).one().completed_at = datetime.utcnow() - timedelta(hours=25)
        db.commit()
    response = client.post(
        f"/api/student/orders/{order_id}/dispute",
        headers=_headers(),
        json={"reason": "Item damaged", "description": "The product is damaged."},
    )
    assert response.status_code == 409
    with session_factory() as db:
        assert db.query(Dispute).count() == 0
