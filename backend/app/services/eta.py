"""Deterministic delivery estimates — no fake AI, no invented precision.

Offsets are documented business policy (ground parcel, US contiguous):
booked +4d, in_transit +2d, out_for_delivery same-day, delivered = actual.
The UI must label these "Estimated" (and "Delivered <date>" when done).
"""
from datetime import datetime, timedelta

# Business days approximated as calendar days; kept simple and documented.
_OFFSETS_DAYS: dict[str, int] = {
    "booked": 4,
    "in_transit": 2,
    "out_for_delivery": 0,
    "cancelled": 0,
}


def eta_for(status: str, created_at: datetime, updated_at: datetime) -> tuple[str | None, str | None]:
    if status == "delivered":
        day = updated_at.date().isoformat()
        return day, f"Delivered {day}"
    if status == "cancelled":
        return None, None
    base = created_at if created_at.tzinfo else created_at
    day = (base + timedelta(days=_OFFSETS_DAYS.get(status, 4))).date().isoformat()
    if status == "out_for_delivery":
        return day, "Arriving today (estimated)"
    return day, f"Estimated {day}"
