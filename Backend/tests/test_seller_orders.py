import os
import unittest
from datetime import datetime

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["SESSION_SECRET"] = "seller-orders-test-secret"

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import main as main_module
from app.database import Base
from app.models import Order, Product, Student, Transaction, UserSession
from app.password_security import hash_password


class SellerOrderEndpointTests(unittest.TestCase):
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
            name="Order Buyer",
            student_id="orders-buyer",
            email="orders-buyer@example.test",
            password=hash_password("buyer-password"),
            department="Computer Science",
            phone="0900000000",
            wallet_balance=250,
            is_verified=True,
        )
        self.seller = Student(
            name="Order Seller",
            student_id="orders-seller",
            email="orders-seller@example.test",
            password=hash_password("seller-password"),
        )
        self.other_seller = Student(
            name="Other Seller",
            student_id="orders-other-seller",
            email="orders-other-seller@example.test",
            password=hash_password("other-password"),
        )
        self.product = Product(
            title="Test Textbook",
            category="Books",
            price="100.00",
            stock=0,
            seller=self.seller.student_id,
            seller_id=self.seller.student_id,
            status="Sold",
        )
        self.db.add_all([self.buyer, self.seller, self.other_seller, self.product])
        self.db.flush()
        completed_at = datetime.now()
        self.order = Order(
            student_id=self.buyer.student_id,
            product_id=self.product.id,
            title=self.product.title,
            price=self.product.price,
            seller_id=self.seller.student_id,
            seller_name=self.seller.name,
            buyer_name=self.buyer.name,
            buyer_email=self.buyer.email,
            buyer_phone=self.buyer.phone,
            quantity=1,
            status="Completed",
            payment_status="Successful",
            paid_at=completed_at,
            completed_at=completed_at,
        )
        self.db.add(self.order)
        self.db.flush()
        self.seller_token = self._create_token(self.seller)
        self.other_seller_token = self._create_token(self.other_seller)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def _create_token(self, student):
        session = UserSession(user_id=student.student_id, device_name="Test device")
        self.db.add(session)
        self.db.flush()
        return main_module._create_session_token(
            student.student_id,
            "student",
            60,
            os.environ["SESSION_SECRET"],
            session_id=session.id,
        )

    def test_seller_can_view_owned_order_without_buyer_private_fields(self):
        response = self.client.get(
            f"/api/seller/orders/{self.order.id}",
            headers={"Authorization": f"Bearer {self.seller_token}"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["id"], self.order.id)
        self.assertEqual(payload["buyer"]["name"], self.buyer.name)
        self.assertEqual(
            set(payload["timeline"]),
            {"order_created_at", "payment_completed_at", "order_completed_at"},
        )
        self.assertTrue(all(
            timestamp.endswith(("+00:00", "Z"))
            for timestamp in payload["timeline"].values()
            if timestamp is not None
        ))
        self.assertNotIn("wallet_balance", response.text)
        self.assertNotIn("phone", payload["buyer"])
        self.assertNotIn("email", payload["buyer"])

    def test_another_seller_receives_not_found_for_order(self):
        response = self.client.get(
            f"/api/seller/orders/{self.order.id}",
            headers={"Authorization": f"Bearer {self.other_seller_token}"},
        )

        self.assertEqual(response.status_code, 404)

    def test_seller_order_list_is_scoped_and_searchable(self):
        response = self.client.get(
            "/api/seller/orders?page=1&page_size=1&search=Textbook",
            headers={"Authorization": f"Bearer {self.seller_token}"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["page"], 1)
        self.assertEqual(payload["page_size"], 1)
        self.assertEqual(payload["items"][0]["id"], self.order.id)

        other_seller_response = self.client.get(
            "/api/seller/orders",
            headers={"Authorization": f"Bearer {self.other_seller_token}"},
        )
        self.assertEqual(other_seller_response.status_code, 200)
        self.assertEqual(other_seller_response.json()["items"], [])

    def test_seller_can_view_receipt_for_paid_order_with_paid_transaction_status(self):
        self.order.id = 61
        self.db.flush()
        tx_ref = f"CHAPA-ORDER-{self.order.id}"
        self.db.add(Transaction(
            student_id=self.buyer.student_id,
            tx_id=tx_ref,
            type="Product Purchase",
            amount=100,
            description=f"Chapa split payment for order #{self.order.id}",
            status="Paid",
        ))
        self.db.commit()
        response = self.client.get(
            f"/api/student/orders/{self.order.id}/receipt",
            headers={"Authorization": f"Bearer {self.seller_token}"},
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["order_number"], self.order.id)
        self.assertEqual(response.json()["transaction_reference"], tx_ref)

    def test_unrelated_seller_cannot_access_receipt(self):
        other_token = self.other_seller_token
        response = self.client.get(
            f"/api/student/orders/{self.order.id}/receipt",
            headers={"Authorization": f"Bearer {other_token}"},
        )

        self.assertEqual(response.status_code, 403)
