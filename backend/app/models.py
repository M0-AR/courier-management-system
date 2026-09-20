"""Courier SQLAlchemy models — single source of truth for persistence."""
import secrets
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base

VALID_STATUSES = ("booked", "in_transit", "out_for_delivery", "delivered", "cancelled")

# Forward-only delivery state machine (cancel allowed from any non-delivered state).
ALLOWED_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "booked": ("in_transit", "cancelled"),
    "in_transit": ("out_for_delivery", "cancelled"),
    "out_for_delivery": ("delivered", "cancelled"),
    "delivered": (),
    "cancelled": (),
}


def new_tracking_id() -> str:
    return f"SWC-{secrets.token_hex(3).upper()}"


class Courier(Base):
    __tablename__ = "couriers"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    tracking_id: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    customer_name: Mapped[str] = mapped_column(String(120), index=True)
    phone: Mapped[str] = mapped_column(String(24))
    parcel_type: Mapped[str] = mapped_column(String(60))
    weight_kg: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(120))
    destination: Mapped[str] = mapped_column(String(120), index=True)
    status: Mapped[str] = mapped_column(String(24), default="booked", index=True)
    charge_usd: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class CourierEvent(Base):
    """Immutable scan-event / audit trail: every booking and status change.

    Market standard (ShipStation/eLogii): detailed events with timestamps,
    locations/messages, never mutated — disputes become lookups.
    """

    __tablename__ = "courier_events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    courier_id: Mapped[int] = mapped_column(ForeignKey("couriers.id", ondelete="CASCADE"), index=True)
    event: Mapped[str] = mapped_column(String(32), index=True)  # created | status:<to>
    from_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    to_status: Mapped[str] = mapped_column(String(24))
    message: Mapped[str] = mapped_column(String(280), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )


def log_event(db, courier: "Courier", event: str, to_status: str, from_status: str | None = None, message: str = "") -> None:
    """Append an immutable scan event. Caller commits."""
    db.add(
        CourierEvent(
            courier_id=courier.id,
            event=event,
            from_status=from_status,
            to_status=to_status,
            message=message or event,
        )
    )
