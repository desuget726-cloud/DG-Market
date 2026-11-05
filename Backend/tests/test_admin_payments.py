import os
import unittest
from decimal import Decimal

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from app import main as main_module
from app.database import Base
from app.models import Order, Product, Student, Transaction, Wallet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


class AdminPaymentsEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False, autocommit=False)
        Base.metadata.create_all(bind=cls.engine)

    @classmethod
    def tearDownClass(cls):
        cls.engine.dispose()

    def setUp(self):
        Base.metadata.drop_all(bind=self.engine)
        Base.metadata.create_all(bind=self.engine)
        self.db = self.session_factory()
        self.buyer = Student(
            name="Test Buyer",
            student_id="payment-buyer",
            email="payment-buyer@example.test",
            password="test-password",
            college="Test College",
            department="Testing",
        )
        self.seller = Student(
            name="Test Seller",
            student_id="payment-seller",
            email="payment-seller@example.test",
            password="test-password",
            college="Test College",
            department="Testing",
        )
        self.db.add_all([self.buyer, self.seller])
        self.db.flush()
        self.buyer_wallet = Wallet(student_id=self.buyer.student_id, balance=Decimal("500.00"))
        self.seller_wallet = Wallet(student_id=self.seller.student_id, balance=Decimal("500.00"))
        self.db.add_all([self.buyer_wallet, self.seller_wallet])
        self.db.flush()

    def tearDown(self):
        self.db.close()

    def create_order(self):
        product = Product(
            title="Test Product",
            category="Test Category",
            price="100.00",
            seller=self.seller.student_id,
        )
        self.db.add(product)
        self.db.flush()
        order = Order(
            student_id=self.buyer.student_id,
            product_id=product.id,
            title=product.title,
            price=product.price,
            seller_id=None,
            status="Pending",
        )
        self.db.add(order)
        self.db.flush()
        return order

    def get_payment(self, tx_id):
        return next(
            row
            for row in main_module.get_admin_payments_endpoint(db=self.db)
            if row["transaction_id"] == tx_id
        )

    def test_order_payment_resolves_seller_from_order_product(self):
        order = self.create_order()
        transaction = Transaction(
            student_id=self.buyer.student_id,
            wallet_id=self.buyer_wallet.id,
            tx_id="ORDER-PAYMENT-1",
            type="Product Purchase",
            amount=Decimal("100.00"),
            description=f"Product purchase for order #{order.id}",
            status="Successful",
        )
        self.db.add(transaction)
        self.db.flush()

        payment = self.get_payment(transaction.tx_id)

        self.assertEqual(payment["seller_id"], self.seller.student_id)
        self.assertEqual(payment["order_id"], order.id)
        self.assertEqual(payment["payment_method"], "Wallet")

    def test_chapa_product_payment_is_displayed_as_chapa(self):
        order = self.create_order()
        transaction = Transaction(
            student_id=self.buyer.student_id,
            wallet_id=None,
            tx_id="TX-CHAPA-PRODUCT-1",
            type="Product Purchase",
            amount=Decimal("100.00"),
            description=f"Chapa split payment for order #{order.id}",
            status="Pending",
        )
        self.db.add(transaction)
        self.db.flush()

        payment = self.get_payment(transaction.tx_id)

        self.assertEqual(payment["seller_id"], self.seller.student_id)
        self.assertEqual(payment["order_id"], order.id)
        self.assertEqual(payment["payment_method"], "Chapa")
        self.assertEqual(payment["chapa_reference"], transaction.tx_id)

    def test_payout_uses_wallet_owner_and_is_not_an_order(self):
        transaction = Transaction(
            student_id=self.seller.student_id,
            wallet_id=self.seller_wallet.id,
            tx_id="PAYOUT-TEST-123",
            type="Wallet Withdrawal",
            amount=Decimal("-150.00"),
            description="Pending Withdrawal",
            status="Pending",
        )
        self.db.add(transaction)
        self.db.flush()

        payment = self.get_payment(transaction.tx_id)

        self.assertEqual(payment["seller_id"], self.seller.student_id)
        self.assertEqual(payment["order_id"], "-")

    def test_chapa_deposit_uses_system_as_seller(self):
        transaction = Transaction(
            student_id=self.buyer.student_id,
            wallet_id=self.buyer_wallet.id,
            tx_id="CHAPA-DEPOSIT-1",
            type="Wallet Deposit",
            amount=Decimal("200.00"),
            description="Chapa wallet deposit initiated for payment-buyer",
            status="Successful",
        )
        self.db.add(transaction)
        self.db.flush()

        payment = self.get_payment(transaction.tx_id)

        self.assertEqual(payment["seller_id"], "System (Chapa)")
        self.assertEqual(payment["order_id"], "-")

    def test_order_refund_keeps_order_and_seller(self):
        order = self.create_order()
        transaction = Transaction(
            student_id=self.buyer.student_id,
            wallet_id=self.buyer_wallet.id,
            tx_id=f"REFUND-{order.id}",
            type="Refund",
            amount=Decimal("100.00"),
            description=f"Refund for cancelled order #{order.id}",
            status="Successful",
        )
        self.db.add(transaction)
        self.db.flush()

        payment = self.get_payment(transaction.tx_id)

        self.assertEqual(payment["seller_id"], self.seller.student_id)
        self.assertEqual(payment["order_id"], order.id)