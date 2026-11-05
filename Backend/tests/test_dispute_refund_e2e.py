import os
import unittest
from datetime import datetime
from decimal import Decimal

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["SESSION_SECRET"] = "legacy-order-history-test-secret"

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import main as main_module
from app.database import Base
from app.models import Order, PaymentIdempotency, Product, Student, Transaction, UserSession
from app.password_security import hash_password


class LegacyOrderHistoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False, autocommit=False)
        cls.original_session_local = main_module.SessionLocal
        main_module.SessionLocal = cls.session_factory
        main_module.app.dependency_overrides[main_module.get_db] = cls._override_get_db
        cls.client = TestClient(main_module.app)
        Base.metadata.create_all(bind=cls.engine)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        main_module.app.dependency_overrides.pop(main_module.get_db, None)
        main_module.SessionLocal = cls.original_session_local
        cls.engine.dispose()

    @classmethod
    def _override_get_db(cls):
        db = cls.session_factory()
        try:
            yield db
        finally:
            db.close()

    def setUp(self):
        Base.metadata.drop_all(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)
        self.db = self.session_factory()
        self.buyer = Student(
            name="Legacy Buyer",
            student_id="legacy-buyer",
            email="legacy-buyer@example.test",
            password=hash_password("legacy-password"),
            has_password=True,
            wallet_balance=Decimal("0.00"),
        )
        self.seller = Student(
            name="Legacy Seller",
            student_id="legacy-seller",
            email="legacy-seller@example.test",
            password=hash_password("seller-password"),
            has_password=True,
            wallet_balance=Decimal("0.00"),
        )
        self.product = Product(
            title="Legacy Textbook",
            category="Books",
            price="100.00",
            stock=0,
            seller=self.seller.student_id,
            seller_id=self.seller.student_id,
            status="Sold",
        )
        self.db.add_all([self.buyer, self.seller, self.product])
        self.db.flush()
        self.order = Order(
            student_id=self.buyer.student_id,
            product_id=self.product.id,
            title=self.product.title,
            price=self.product.price,
            seller_id=self.seller.student_id,
            seller_name=self.seller.name,
            buyer_name=self.buyer.name,
            quantity=1,
            status="Completed",
            payment_status="Successful",
            paid_at=datetime.now(),
            completed_at=datetime.now(),
        )
        self.db.add(self.order)
        self.db.flush()
        self.db.add(Transaction(
            student_id=self.buyer.student_id,
            tx_id=f"ESCROW-HOLD-{self.order.id}",
            type="Escrow Hold",
            amount=Decimal("100.00"),
            description=f"Escrow hold for order #{self.order.id}",
            status="Successful",
        ))
        session = UserSession(user_id=self.buyer.student_id, device_name="Test device")
        self.db.add(session)
        self.db.flush()
        self.buyer_token = main_module._create_session_token(
            self.buyer.student_id,
            "student",
            60,
            os.environ["SESSION_SECRET"],
            session_id=session.id,
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_legacy_escrow_order_remains_readable_in_receipt(self):
        response = self.client.get(
            f"/api/student/orders/{self.order.id}/receipt",
            headers={"Authorization": f"Bearer {self.buyer_token}"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["order_number"], self.order.id)
        self.assertEqual(response.json()["payment_method"], "Escrow Hold")
        self.assertEqual(response.json()["payment_message"], "This is a legacy order with escrow payment history.")

    def test_chapa_order_receipt_matches_transaction_by_payment_reference(self):
        tx_ref = "TX-CHAPA-ORDER-60"
        self.db.add(Transaction(
            student_id=self.buyer.student_id,
            wallet_id=None,
            tx_id=tx_ref,
            type="Product Purchase",
            amount=Decimal("100.00"),
            description=f"Chapa split payment for order #{self.order.id}",
            status="Successful",
        ))
        self.db.add(PaymentIdempotency(
            idempotency_key=f"chapa-product:{tx_ref}",
            order_id=self.order.id,
            buyer_id=self.buyer.student_id,
            product_id=self.product.id,
            transaction_id=tx_ref,
        ))
        self.db.commit()

        response = self.client.get(
            f"/api/student/orders/{self.order.id}/receipt",
            headers={"Authorization": f"Bearer {self.buyer_token}"},
        )

        self.assertEqual(response.status_code, 200, response.text)
        receipt = response.json()
        self.assertEqual(receipt["payment_method"], "Chapa Split Payment")
        self.assertEqual(receipt["transaction_reference"], tx_ref)
        self.assertEqual(receipt["total_paid"], 100.0)
        self.assertEqual(receipt["payment_message"], "The buyer paid through Chapa Split Payment.")
