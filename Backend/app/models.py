# C:\xampp\htdocs\Backend\app\models.py
from decimal import Decimal
from datetime import datetime, timezone
import uuid
from sqlalchemy import CheckConstraint, Column, Integer, String, ForeignKey, Boolean, Date, DateTime, Numeric, Text, JSON, UniqueConstraint, Index, text
from sqlalchemy.orm import relationship, synonym
from sqlalchemy.sql import func
from .database import Base

# Payment settings are stored as the JSON value of the ``payment`` system
# setting. Keep the persisted shape explicit so API updates can normalize it.
PAYMENT_SETTINGS_SCHEMA = {
    "paymentProvider": "Chapa",
    "currency": "ETB",
    "paymentVerification": "Automatic",
    "enableOnlinePayment": True,
    "refundsEnabled": True,
    "refundPolicy": "Admin approval required",
    "maximumRefund": "100%",
    "security": {
        "automaticVerification": True,
        "duplicateTransactionProtection": True,
        "adminApprovalForRefunds": True,
        "auditLogging": True,
    },
    "commission": {
        "commission_enabled": True,
        "commission_type": "percentage",
        "commission_rate": "1.0",
        "commission_min_fee": None,
        "commission_max_fee": None,
    },
}

class Student(Base):
    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    student_id = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    phone = Column(String(20), nullable=True)
    password = Column(String(255), nullable=False)
    has_password = Column(Boolean, default=True, nullable=False)
    college = Column(String(150), nullable=True)
    department = Column(String(150), nullable=True)
    wallet_balance = Column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    wallet_pin_hash = Column(String(255), nullable=True)
    pay_failed_attempts = Column(Integer, default=0, nullable=False)
    pay_locked_until = Column(DateTime, nullable=True)
    status = Column(String(50), default="Active", nullable=False)
    restriction_reason = Column(Text, nullable=True)
    suspended_until = Column(DateTime, nullable=True)
    is_verified = Column(Boolean, default=False, nullable=False)
    two_factor_enabled = Column(Boolean, default=False, nullable=False)
    notif_msg_inapp = Column(Boolean, default=True, nullable=False)
    notif_msg_email = Column(Boolean, default=True, nullable=False)
    notif_order_inapp = Column(Boolean, default=True, nullable=False)
    notif_order_email = Column(Boolean, default=True, nullable=False)
    notif_pay_inapp = Column(Boolean, default=True, nullable=False)
    notif_pay_email = Column(Boolean, default=True, nullable=False)
    notif_browser_enabled = Column(Boolean, default=False, nullable=False)
    preferred_pickup_location = Column(String(255), default="Student Center", nullable=False)
    verification_reason = Column(Text, nullable=True)
    id_card_url = Column(String(500), nullable=True)
    avatar_url = Column(String(500), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    @property
    def has_wallet_pin(self) -> bool:
        return bool(self.wallet_pin_hash)

    # 1. ሬላሽንሺፖቹ በምን አምድ በኩል መገናኘት እንዳለባቸው በ "primaryjoin" በግልጽ አስቀምጠነዋል
    reports = relationship("Report", primaryjoin="Student.student_id == Report.student_id", back_populates="student")
    notifications = relationship("Notification", primaryjoin="Student.student_id == Notification.student_id", back_populates="student", cascade="all, delete-orphan")
    messages_sent = relationship("Message", foreign_keys="Message.sender_id", back_populates="sender", cascade="all, delete-orphan")
    messages_received = relationship("Message", foreign_keys="Message.receiver_id", back_populates="receiver", cascade="all, delete-orphan")
    wishlist_items = relationship("WishlistItem", primaryjoin="Student.student_id == WishlistItem.student_id", back_populates="student", cascade="all, delete-orphan")
    cart_items = relationship("CartItem", primaryjoin="Student.student_id == CartItem.student_id", back_populates="student", cascade="all, delete-orphan")
    orders = relationship("Order", primaryjoin="Student.student_id == Order.student_id", back_populates="student", cascade="all, delete-orphan")
    transactions = relationship("Transaction", primaryjoin="Student.student_id == Transaction.student_id", back_populates="student", cascade="all, delete-orphan")
    reviews = relationship("Review", primaryjoin="Student.student_id == Review.student_id", back_populates="student", cascade="all, delete-orphan")
    ai_recommendation_logs = relationship("AIRecommendationLog", back_populates="student", cascade="all, delete-orphan")
    wallet = relationship("Wallet", uselist=False, back_populates="student", cascade="all, delete-orphan")
    seller_payment_account = relationship("SellerPaymentAccount", uselist=False, back_populates="student", cascade="all, delete-orphan")
    id_change_requests = relationship("StudentIdChangeRequest", back_populates="student", cascade="all, delete-orphan")
    sessions = relationship("StudentSession", primaryjoin="Student.student_id == StudentSession.student_id", back_populates="student", cascade="all, delete-orphan")
    user_sessions = relationship("UserSession", primaryjoin="Student.student_id == UserSession.user_id", back_populates="student", cascade="all, delete-orphan")


class StudentSession(Base):
    __tablename__ = "student_sessions"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False, index=True)
    session_token = Column(String(500), unique=True, nullable=False, index=True)
    ip_address = Column(String(50), nullable=True)
    device_browser = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    last_active = Column(DateTime, server_default=func.now(), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    student = relationship("Student", primaryjoin="Student.student_id == StudentSession.student_id", back_populates="sessions")


class UserSession(Base):
    __tablename__ = "user_sessions"
    __table_args__ = (Index("ix_user_sessions_user_id_revoked_at", "user_id", "revoked_at"),)

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)
    device_name = Column(String(255), nullable=False)
    location = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_active_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)

    student = relationship("Student", primaryjoin="Student.student_id == UserSession.user_id", back_populates="user_sessions")


class PayoutProvider(Base):
    __tablename__ = "payout_providers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    type = Column(String(30), nullable=False, index=True)
    code = Column(String(50), nullable=False, unique=True, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    integration_status = Column(String(30), default="unavailable", nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    seller_payment_accounts = relationship("SellerPaymentAccount", back_populates="provider")


class SellerPaymentAccount(Base):
    __tablename__ = "seller_payment_accounts"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), unique=True, nullable=False, index=True)
    provider_id = Column(Integer, ForeignKey("payout_providers.id", ondelete="SET NULL"), nullable=True, index=True)
    chapa_sub_account_id = Column(String(100), nullable=True)
    business_name = Column(String(150), nullable=False)
    payout_type = Column(String(30), default="bank", nullable=False)
    bank_code = Column(String(50), nullable=False)
    account_number = Column(String(100), nullable=True)
    encrypted_account_number = Column(String(255), nullable=True)
    account_last4 = Column(String(4), nullable=True)
    phone_number = Column(String(30), nullable=True)
    account_name = Column(String(150), nullable=False)
    payout_account_name = Column(String(150), nullable=True)
    profile_name = Column(String(150), nullable=True)
    name_mismatch_acknowledged = Column(Boolean, default=False, server_default=text("0"), nullable=False)
    name_verification_at = Column(DateTime, nullable=True)
    account_status = Column(String(30), default="Pending", nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    payout_hold_until = Column(DateTime, nullable=True)

    student = relationship("Student", back_populates="seller_payment_account")
    provider = relationship("PayoutProvider", back_populates="seller_payment_accounts")


class SellerPaymentAccountHistory(Base):
    __tablename__ = "seller_payment_account_history"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String(50), nullable=False, index=True)
    changed_at = Column(DateTime, server_default=func.now(), nullable=False)
    changed_fields = Column(JSON, nullable=False)
    old_last4 = Column(String(10), nullable=True)
    new_last4 = Column(String(10), nullable=True)
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(255), nullable=True)


class PayoutAccountSetupAttempt(Base):
    __tablename__ = "payout_account_setup_attempts"
    __table_args__ = (Index("ix_payout_setup_attempt_student_created", "student_id", "created_at"),)

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class PayoutTransaction(Base):
    __tablename__ = "payout_transactions"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False, index=True)
    wallet_id = Column(Integer, ForeignKey("wallets.id", ondelete="RESTRICT"), nullable=True, index=True)
    payout_account_id = Column(Integer, ForeignKey("seller_payment_accounts.id", ondelete="RESTRICT"), nullable=False, index=True)
    provider_id = Column(Integer, ForeignKey("payout_providers.id", ondelete="RESTRICT"), nullable=False, index=True)
    amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(10), default="ETB", nullable=False)
    status = Column(String(30), default="pending", nullable=False, index=True)
    provider_reference = Column(String(150), nullable=True, index=True)
    internal_reference = Column(String(100), unique=True, nullable=False, index=True)
    idempotency_key = Column(String(100), unique=True, nullable=True, index=True)
    is_test_mode = Column(Boolean, default=False, nullable=False)
    failure_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=text("CURRENT_TIMESTAMP"), nullable=False)
    updated_at = Column(DateTime, server_default=text("CURRENT_TIMESTAMP"), onupdate=func.now(), nullable=False)

    student = relationship("Student")
    wallet = relationship("Wallet")
    payout_account = relationship("SellerPaymentAccount")
    provider = relationship("PayoutProvider")


class Wallet(Base):
    __tablename__ = "wallets"
    __table_args__ = (CheckConstraint("balance >= 0", name="ck_wallets_nonnegative_balance"),)

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), unique=True, nullable=False, index=True)
    balance = Column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    held_balance = Column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    frozen_balance = Column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    student = relationship("Student", back_populates="wallet")
    transactions = relationship("Transaction", back_populates="wallet")


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    icon = Column(String(50), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    ads_count = Column(String(50), default="0 ads")
    subcategories = relationship("SubCategory", back_populates="category", cascade="all, delete-orphan")

class SubCategory(Base):
    __tablename__ = "subcategories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    icon = Column(String(50), nullable=True)
    ads_count = Column(String(50), default="0 ads")
    category_id = Column(Integer, ForeignKey("categories.id", ondelete="CASCADE"))
    category = relationship("Category", back_populates="subcategories")

class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        Index("ix_products_seller_created_at_id", "seller_id", "created_at", "id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(150), nullable=False)
    category = Column(String(100), nullable=False)
    subcategory = Column(String(100), nullable=True)
    price = Column(String(50), nullable=False)
    stock = Column(Integer, default=1, nullable=False)
    condition = Column(String(50), nullable=True)
    image = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    seller = Column(String(100), nullable=True)
    seller_id = Column(String(50), ForeignKey("students.student_id", ondelete="SET NULL", onupdate="CASCADE"), nullable=True, index=True)
    negotiable = Column(Boolean, default=False, nullable=False)
    pickup_location = Column(String(255), default="", nullable=False)
    pickup_hours = Column(String(120), default="08:00-17:00", nullable=False)
    image_notes = Column(Text, nullable=True)
    status = Column(String(50), default="Pending", nullable=False)
    moderation_reason = Column(Text, nullable=True)
    views = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    wishlist_items = relationship("WishlistItem", back_populates="product", cascade="all, delete-orphan")
    cart_items = relationship("CartItem", back_populates="product", cascade="all, delete-orphan")
    orders = relationship("Order", back_populates="product", cascade="all, delete-orphan")
    messages = relationship("Message", back_populates="product", cascade="all, delete-orphan")
    ai_recommendation_logs = relationship("AIRecommendationLog", back_populates="product", cascade="all, delete-orphan")
    view_records = relationship("ProductView", back_populates="product", cascade="all, delete-orphan")


class ProductView(Base):
    __tablename__ = "product_views"
    __table_args__ = (UniqueConstraint("product_id", "visitor_key", name="uq_product_views_visitor"),)

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    viewer_id = Column(String(50), ForeignKey("students.student_id", ondelete="SET NULL", onupdate="CASCADE"), nullable=True, index=True)
    visitor_key = Column(String(255), nullable=False)
    viewed_at = Column(DateTime, server_default=func.now(), nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    product = relationship("Product", back_populates="view_records")

class AIRecommendationLog(Base):
    __tablename__ = "ai_recommendation_logs"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    action_type = Column(String(20), nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False, index=True)

    student = relationship("Student", back_populates="ai_recommendation_logs")
    product = relationship("Product", back_populates="ai_recommendation_logs")

class WishlistItem(Base):
    __tablename__ = "wishlist_items"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    student = relationship("Student", primaryjoin="WishlistItem.student_id == Student.student_id", back_populates="wishlist_items")
    product = relationship("Product", back_populates="wishlist_items")

class CartItem(Base):
    __tablename__ = "cart_items"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    quantity = Column(Integer, default=1, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    student = relationship("Student", primaryjoin="CartItem.student_id == Student.student_id", back_populates="cart_items")
    product = relationship("Product", back_populates="cart_items")

class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        Index("ix_orders_seller_status_completed_at", "seller_id", "status", "completed_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(150), nullable=False)
    price = Column(String(50), nullable=False)
    platform_fee = Column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    seller_commission = Column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    commission_amount = synonym("seller_commission")
    commission_rate = Column(Numeric(10, 4), default=Decimal("0.0000"), nullable=False)
    commission_type = Column(String(20), default="percentage", nullable=False)
    product_category = Column(String(100), nullable=True)
    product_subcategory = Column(String(100), nullable=True)
    product_description = Column(String(500), nullable=True)
    product_condition = Column(String(50), nullable=True)
    product_image = Column(Text, nullable=True)
    seller_id = Column(String(50), nullable=True)
    seller_name = Column(String(100), nullable=True)
    seller_business_name = Column(String(150), nullable=True)
    buyer_name = Column(String(100), nullable=True)
    buyer_email = Column(String(100), nullable=True)
    buyer_phone = Column(String(20), nullable=True)
    quantity = Column(Integer, default=1, nullable=False)
    status = Column(String(50), default="Processing", nullable=False)
    pickup_location = Column(String(255), default="Student Center", nullable=False)
    payment_status = Column(String(50), default="Successful", nullable=False)
    reviewed = Column(Boolean, default=False, nullable=False)
    is_funds_released = Column(Boolean, default=False, nullable=False)
    paid_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    expired_at = Column(DateTime, nullable=True)
    refund_status = Column(String(20), default="none", nullable=False)
    refund_reference = Column(String(100), nullable=True)
    refund_attempts = Column(Integer, default=0, nullable=False)
    rejection_reason = Column(String(30), nullable=True)
    rejection_note = Column(Text, nullable=True)
    hidden_by_buyer = Column(Boolean, default=False, nullable=False)
    dispute_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    student = relationship("Student", primaryjoin="Order.student_id == Student.student_id", back_populates="orders")
    product = relationship("Product", back_populates="orders")
    reviews = relationship("Review", back_populates="order", cascade="all, delete-orphan")
    disputes = relationship("Dispute", back_populates="order", cascade="all, delete-orphan")


class Dispute(Base):
    __tablename__ = "disputes"
    __table_args__ = (
        Index("ix_disputes_order_status", "order_id", "status"),
        Index("ix_disputes_status_created", "status", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True)
    buyer_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False, index=True)
    seller_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False, index=True)
    reason = Column(String(120), nullable=False)
    description = Column(Text, nullable=False)
    evidence_image = Column(String(500), nullable=True)
    seller_response = Column(Text, nullable=True)
    seller_evidence = Column(String(500), nullable=True)
    previous_order_status = Column(String(50), nullable=False)
    status = Column(String(30), nullable=False, default="OPEN", index=True)
    resolution = Column(String(30), nullable=True)
    frozen_amount = Column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    post_payment = Column(Boolean, default=False, nullable=False)
    resolved_by = Column(Integer, ForeignKey("admins.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    resolved_at = Column(DateTime, nullable=True)

    order = relationship("Order", back_populates="disputes")
    buyer = relationship("Student", foreign_keys=[buyer_id])
    seller = relationship("Student", foreign_keys=[seller_id])
    resolver = relationship("Admin", foreign_keys=[resolved_by])


class PaymentIdempotency(Base):
    __tablename__ = "payment_idempotency"

    id = Column(Integer, primary_key=True, index=True)
    idempotency_key = Column(String(255), unique=True, nullable=False, index=True)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=True, index=True)
    buyer_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True)
    transaction_id = Column(String(50), nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    wallet_id = Column(Integer, ForeignKey("wallets.id", ondelete="SET NULL"), nullable=True, index=True)
    tx_id = Column(String(50), unique=True, nullable=False)
    type = Column(String(50), nullable=False)
    amount = Column(Numeric(10, 2), nullable=False)
    description = Column(String(255), nullable=True)
    status = Column(String(50), default="Successful", nullable=False)
    is_hidden = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    student = relationship("Student", primaryjoin="Transaction.student_id == Student.student_id", back_populates="transactions")
    wallet = relationship("Wallet", back_populates="transactions")

class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (
        UniqueConstraint("order_id", "student_id", name="uq_reviews_order_student"),
    )

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    student_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    rating = Column(Integer, nullable=False)
    comment = Column(String(500), nullable=False)
    is_hidden = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    order = relationship("Order", back_populates="reviews")
    student = relationship("Student", primaryjoin="Review.student_id == Student.student_id", back_populates="reviews")

class Admin(Base):
    __tablename__ = "admins"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    full_name = Column(String(150), nullable=True)
    phone = Column(String(30), nullable=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(50), default="Admin", nullable=False)
    status = Column(String(50), default="Active", nullable=False)
    two_factor_enabled = Column(Boolean, default=False, nullable=False)
    two_factor_secret = Column(String(255), nullable=True)
    two_factor_pending_secret = Column(String(255), nullable=True)
    avatar_url = Column(String(500), nullable=True)
    backup_codes = Column(Text, nullable=True)
    permissions = Column(JSON, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    last_login = Column(DateTime, nullable=True)
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    locked_until = Column(DateTime, nullable=True)

    audit_logs = relationship("AuditLog", back_populates="admin", cascade="all, delete-orphan")
    sessions = relationship("AdminSession", back_populates="admin", cascade="all, delete-orphan")
    login_history = relationship("AdminLoginHistory", back_populates="admin", cascade="all, delete-orphan")
    backup_code_records = relationship("AdminBackupCode", back_populates="admin", cascade="all, delete-orphan")
    reviewed_student_id_change_requests = relationship("StudentIdChangeRequest", back_populates="reviewer")


class AdminBackupCode(Base):
    __tablename__ = "admin_backup_codes"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, ForeignKey("admins.id", ondelete="CASCADE"), nullable=False, index=True)
    code_hash = Column(String(255), nullable=False)
    used = Column(Boolean, default=False, nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    admin = relationship("Admin", back_populates="backup_code_records")


class AdminLoginChallenge(Base):
    __tablename__ = "admin_login_challenges"

    challenge_id = Column(String(64), primary_key=True)
    admin_id = Column(Integer, ForeignKey("admins.id", ondelete="CASCADE"), nullable=False, index=True)
    failed_attempts = Column(Integer, default=0, nullable=False)
    setup_verified = Column(Boolean, default=False, nullable=False)
    used = Column(Boolean, default=False, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    admin = relationship("Admin")


class AdminLoginEmailCode(Base):
    __tablename__ = "admin_login_email_codes"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, ForeignKey("admins.id", ondelete="CASCADE"), nullable=False, index=True)
    challenge_id = Column(String(64), ForeignKey("admin_login_challenges.challenge_id", ondelete="CASCADE"), nullable=False, index=True)
    code_hash = Column(String(255), nullable=False)
    failed_attempts = Column(Integer, default=0, nullable=False)
    used = Column(Boolean, default=False, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    sent_at = Column(DateTime, nullable=False, index=True)

    admin = relationship("Admin")
    challenge = relationship("AdminLoginChallenge")


class GoogleOAuthState(Base):
    __tablename__ = "google_oauth_states"

    id = Column(Integer, primary_key=True, index=True)
    state = Column(String(128), unique=True, nullable=False, index=True)
    verifier = Column(String(128), nullable=False)
    used = Column(Boolean, default=False, nullable=False, index=True)
    created_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
        nullable=False,
        index=True,
    )


class StudentIdChangeRequest(Base):
    __tablename__ = "student_id_change_requests"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    requested_student_id = Column(String(50), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="pending", index=True)
    evidence_url = Column(String(500), nullable=True)
    admin_note = Column(Text, nullable=True)
    reviewed_by = Column(Integer, ForeignKey("admins.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    reviewed_at = Column(DateTime, nullable=True)

    student = relationship("Student", back_populates="id_change_requests")
    reviewer = relationship("Admin", back_populates="reviewed_student_id_change_requests")


class AdminSession(Base):
    __tablename__ = "admin_sessions"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, ForeignKey("admins.id", ondelete="CASCADE"), nullable=False, index=True)
    session_token = Column(String(500), unique=True, nullable=False, index=True)
    ip_address = Column(String(50), nullable=True)
    location = Column(String(255), nullable=True)
    device_browser = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    last_active = Column(DateTime, server_default=func.now(), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    revoke_reason = Column(String(60), nullable=True)

    admin = relationship("Admin", back_populates="sessions")


class AdminItemSeen(Base):
    __tablename__ = "admin_item_seen"

    admin_id = Column(Integer, ForeignKey("admins.id", ondelete="CASCADE"), primary_key=True)
    item_type = Column(String(30), primary_key=True)
    item_id = Column(Integer, primary_key=True)
    seen_at = Column(DateTime, nullable=False)

    admin = relationship("Admin")


class AdminLoginHistory(Base):
    __tablename__ = "admin_login_history"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, ForeignKey("admins.id", ondelete="CASCADE"), nullable=True, index=True)
    admin_session_id = Column(Integer, nullable=True)
    event_type = Column(String(50), nullable=False)
    ip_address = Column(String(50), nullable=True)
    device_browser = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    is_deleted = Column(Boolean, default=False, server_default=text("FALSE"), nullable=False)
    deleted_at = Column(DateTime, nullable=True)

    admin = relationship("Admin", back_populates="login_history")


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key = Column(String(100), primary_key=True, index=True)
    value = Column(Text, nullable=False)


class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    identifier = Column(String(150), primary_key=True)
    failed_attempts = Column(Integer, nullable=False, default=0)
    locked_until = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, ForeignKey("admins.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(255), nullable=False, index=True)
    entity_type = Column(String(100), nullable=False, default="System")
    entity_id = Column(Integer, nullable=True)
    description = Column(Text, nullable=True)
    status = Column(String(50), default="SUCCESS", nullable=False)
    severity = Column(String(20), default="informational", nullable=False)
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(255), nullable=True)
    actor_role = Column(String(30), nullable=True)
    event_type = Column(String(255), nullable=True)
    category = Column(String(30), nullable=True)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    admin = relationship("Admin", back_populates="audit_logs")


class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True)
    student_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=True)
    seller_id = Column(String(50), nullable=True, index=True)
    student_name = Column(String(150), nullable=False)
    email = Column(String(100), nullable=True)
    category = Column(String(100), nullable=True)
    issue = Column(String(1000), nullable=False)
    evidence_image = Column(Text, nullable=True)
    priority = Column(String(20), nullable=False, default="Low")
    status = Column(String(50), nullable=False, default="Open")
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    reviewed_by = Column(Integer, ForeignKey("admins.id", ondelete="SET NULL"), nullable=True, index=True)
    reviewed_at = Column(DateTime, nullable=True)
    decision = Column(String(50), nullable=True)
    decision_reason = Column(Text, nullable=True)
    review_by = Column(Date, nullable=True)
    resolved_by = Column(Integer, ForeignKey("admins.id", ondelete="SET NULL"), nullable=True, index=True)
    resolved_at = Column(DateTime, nullable=True)
    refunded_amount = Column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    seller_response = Column(Text, nullable=True)
    seller_response_image = Column(Text, nullable=True)
    seller_response_at = Column(DateTime, nullable=True)
    appeal_text = Column(Text, nullable=True)
    appealed_by = Column(String(50), nullable=True)
    appealed_at = Column(DateTime, nullable=True)
    revision = Column(Integer, nullable=False, default=1)

    student = relationship("Student", primaryjoin="Report.student_id == Student.student_id", back_populates="reports")
    order = relationship("Order")
    reviewer = relationship("Admin", foreign_keys=[reviewed_by])
    resolver = relationship("Admin", foreign_keys=[resolved_by])

    __mapper_args__ = {"version_id_col": revision}


class ReportSellerWarning(Base):
    __tablename__ = "report_seller_warnings"
    __table_args__ = (
        Index("ix_report_seller_warnings_seller_created", "seller_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("reports.id", ondelete="CASCADE"), nullable=False, index=True)
    seller_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False, index=True)
    admin_id = Column(Integer, ForeignKey("admins.id", ondelete="SET NULL"), nullable=True)
    reason = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(50), nullable=True, index=True)
    requester_name = Column(String(150), nullable=True)
    requester_email = Column(String(150), nullable=True)
    subject = Column(String(200), nullable=True)
    category = Column(String(50), nullable=False)
    message = Column(Text, nullable=False)
    attachment_url = Column(String(500), nullable=True)
    status = Column(String(30), nullable=False, default="open", index=True)
    assigned_admin_id = Column(Integer, ForeignKey("admins.id", ondelete="SET NULL"), nullable=True, index=True)
    last_admin_reply_at = Column(DateTime, nullable=True)
    last_reminder_at = Column(DateTime, nullable=True)
    reopen_used = Column(Boolean, nullable=False, default=False)
    reopened_at = Column(DateTime, nullable=True)
    revision = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)

    __mapper_args__ = {"version_id_col": revision}


class SupportTicketMessage(Base):
    __tablename__ = "support_ticket_messages"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("support_tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_type = Column(String(20), nullable=False)
    sender_id = Column(String(50), nullable=False)
    body = Column(Text, nullable=False)
    attachment_url = Column(String(500), nullable=True)
    is_internal = Column(Boolean, nullable=False, default=False)
    is_edited = Column(Boolean, nullable=False, default=False, server_default=text("0"))
    is_deleted = Column(Boolean, nullable=False, default=False, server_default=text("0"))
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, nullable=True)


class ReportMessage(Base):
    __tablename__ = "report_messages"

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("reports.id", ondelete="CASCADE"), nullable=False, index=True)
    admin_id = Column(Integer, ForeignKey("admins.id", ondelete="SET NULL"), nullable=True)
    body = Column(Text, nullable=False)
    is_internal = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class AdminNotification(Base):
    __tablename__ = "admin_notifications"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, ForeignKey("admins.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    message = Column(String(500), nullable=False)
    reference_type = Column(String(30), nullable=False)
    reference_id = Column(String(75), nullable=False)
    action_url = Column(String(500), nullable=True)
    is_read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class EmailOutbox(Base):
    __tablename__ = "email_outbox"

    id = Column(Integer, primary_key=True, index=True)
    recipient = Column(String(150), nullable=False)
    subject = Column(String(250), nullable=False)
    body = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="queued", index=True)
    attempts = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    sent_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class CannedResponse(Base):
    __tablename__ = "canned_responses"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(150), nullable=False)
    body = Column(Text, nullable=False)
    created_by = Column(Integer, ForeignKey("admins.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        Index(
            "uq_notifications_user_type_reference",
            "student_id",
            "type",
            "reference_id",
            unique=True,
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    title = Column(String(200), nullable=True)
    message = Column(String(500), nullable=False)
    image_url = Column(String(500), nullable=True)
    target = Column(String(150), nullable=True)
    reference_id = Column(String(75), nullable=True)
    action_label = Column(String(150), nullable=True)
    action_url = Column(String(500), nullable=True)
    is_read = Column(Boolean, default=False, nullable=False)
    type = Column(String(50), nullable=False, default="system")
    created_at = Column(DateTime, server_default=func.now(), nullable=False)

    student = relationship("Student", primaryjoin="Notification.student_id == Student.student_id", back_populates="notifications")


class BroadcastCampaign(Base):
    __tablename__ = "broadcast_campaigns"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    image_url = Column(String(500), nullable=True)
    target = Column(String(200), nullable=False)
    target_type = Column(String(30), nullable=False)
    department = Column(String(150), nullable=True)
    delivery_channels = Column(JSON, nullable=False, default=list)
    recipient_count = Column(Integer, nullable=False, default=0)
    admin_id = Column(Integer, ForeignKey("admins.id", ondelete="SET NULL"), nullable=True, index=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="1")
    banner_pinned = Column(Boolean, nullable=False, default=False, server_default="0")
    sent_at = Column(DateTime, nullable=False, server_default=func.now(), index=True)


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    receiver_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=True)
    message_text = Column(Text, nullable=False)
    attachment_url = Column(String(500), nullable=True)
    attachment_type = Column(String(20), nullable=True)
    reply_to_id = Column(Integer, ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    edited = Column(Boolean, nullable=False, default=False, server_default="0")
    edited_at = Column(DateTime, nullable=True)

    sender = relationship("Student", foreign_keys=[sender_id], back_populates="messages_sent")
    receiver = relationship("Student", foreign_keys=[receiver_id], back_populates="messages_received")
    product = relationship("Product", back_populates="messages")


class MessageBlock(Base):
    __tablename__ = "message_blocks"
    __table_args__ = (
        UniqueConstraint("blocker_id", "blocked_id", name="uq_message_blocks_direction"),
    )

    id = Column(Integer, primary_key=True, index=True)
    blocker_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    blocked_id = Column(String(50), ForeignKey("students.student_id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class PasswordReset(Base):
    __tablename__ = "password_resets"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(100), nullable=False)
    otp_hash = Column("otp_code", String(64), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    is_used = Column(Boolean, default=False)
    delivery_status = Column(String(20), nullable=False, default="queued")
    purpose = Column(String(30), nullable=False, default="password_reset")
    verification_attempts = Column(Integer, nullable=False, default=0)
    created_at = Column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
    )


class PasswordResetRequest(Base):
    __tablename__ = "password_reset_requests"
    __table_args__ = (
        Index("ix_password_reset_requests_account_requested", "account_key", "requested_at"),
        Index("ix_password_reset_requests_ip_requested", "request_ip", "requested_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    account_key = Column(String(150), nullable=False)
    request_ip = Column(String(45), nullable=False)
    requested_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    delivery_status = Column(String(20), nullable=False, default="queued")