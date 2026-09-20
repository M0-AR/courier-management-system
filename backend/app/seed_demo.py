"""Curated demo universe — the best seed data ever for SwiftCourier sales demos.

19 shipments across the last 14 days: every status represented, realistic US
customers/routes/parcels, full timestamped scan-event histories, revenue chart
lit up across all 14 days.

Run INSIDE the backend container (DB env is already wired there):
    docker compose exec backend python -m app.seed_demo --yes

Safety: refuses to run without --yes because it WIPES couriers + events.
Tests are unaffected (they use an isolated SQLite file).
"""
import argparse
import secrets
from datetime import datetime, timedelta, timezone

from .database import Base, SessionLocal, engine
from .models import Courier, CourierEvent
from .services.pricing import calculate_charge

# Fictional 555-01XX numbers — safe for demos, never real subscribers.
PHONE = "+155501{:04d}"

# (days_ago, status, customer, parcel, weight_kg, source, destination)
DATASET: list[tuple[int, str, str, str, float, str, str]] = [
    (13, "delivered", "James Carter", "Auto Parts", 18.5, "Detroit", "Chicago"),
    (12, "delivered", "Maria Gonzalez", "Apparel", 3.2, "Los Angeles", "Phoenix"),
    (11, "delivered", "Robert Kim", "Electronics", 2.1, "Seattle", "Portland"),
    (10, "delivered", "Aisha Patel", "Medical Supplies", 5.0, "Houston", "Dallas"),
    (9, "delivered", "Daniel Okafor", "Books", 4.4, "Atlanta", "Charlotte"),
    (9, "delivered", "Emily Nguyen", "Jewelry", 0.4, "San Jose", "San Diego"),
    (8, "delivered", "William Brown", "Furniture", 32.0, "Denver", "Kansas City"),
    (7, "delivered", "Sofia Rossi", "Perishables", 6.8, "Miami", "Orlando"),
    (6, "out_for_delivery", "Liam Smith", "Electronics", 1.2, "Boston", "New York"),
    (5, "in_transit", "Olivia Johnson", "Documents", 0.8, "Chicago", "Minneapolis"),
    (5, "out_for_delivery", "Noah Williams", "Toys", 7.5, "Dallas", "San Antonio"),
    (4, "in_transit", "Emma Davis", "Apparel", 2.6, "Philadelphia", "Baltimore"),
    (4, "cancelled", "Benjamin Jackson", "Toys", 5.5, "St. Louis", "Indianapolis"),
    (3, "booked", "Lucas Miller", "Auto Parts", 12.3, "Cleveland", "Pittsburgh"),
    (2, "booked", "Mia Wilson", "Medical Supplies", 1.9, "Nashville", "Memphis"),
    (2, "in_transit", "Ethan Moore", "Electronics", 3.7, "Austin", "El Paso"),
    (1, "booked", "Amelia Taylor", "Documents", 0.5, "San Francisco", "Sacramento"),
    (1, "out_for_delivery", "Alexander Anderson", "Furniture", 28.0, "Portland", "Boise"),
    (0, "booked", "Harper Thomas", "Perishables", 2.2, "Las Vegas", "Salt Lake City"),
]

FLOW = ["booked", "in_transit", "out_for_delivery", "delivered"]
pretty = lambda s: s.replace("_", " ").capitalize()  # noqa: E731


def stage_times(created: datetime, stages: int, now: datetime) -> list[datetime]:
    """Spread stage timestamps evenly between creation and now (always valid)."""
    if stages <= 1:
        return [created]
    span = max((now - created).total_seconds(), 3600)
    return [created + timedelta(seconds=span * i / (stages - 1)) for i in range(stages)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true", help="confirm wiping couriers + events")
    args = ap.parse_args()
    if not args.yes:
        raise SystemExit("Refusing to wipe without --yes. Re-run with --yes.")

    Base.metadata.create_all(bind=engine)
    now = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        db.query(CourierEvent).delete()
        db.query(Courier).delete()

        used_codes: set[str] = set()
        total_revenue = 0.0
        for i, (days_ago, status, name, parcel, weight, src, dst) in enumerate(DATASET):
            code = f"SWC-{secrets.token_hex(3).upper()}"
            while code in used_codes:
                code = f"SWC-{secrets.token_hex(3).upper()}"
            used_codes.add(code)
            _, _, total = calculate_charge(weight)
            total_revenue += total

            created = now - timedelta(days=days_ago, hours=(i * 37) % 20, minutes=(i * 53) % 60)
            if status == "cancelled":
                reached = ["booked", "cancelled"]
            else:
                reached = FLOW[: FLOW.index(status) + 1]
            times = stage_times(created, len(reached), now)

            courier = Courier(
                tracking_id=code,
                customer_name=name,
                phone=PHONE.format(1000 + i * 137),
                parcel_type=parcel,
                weight_kg=weight,
                source=src,
                destination=dst,
                status=status,
                charge_usd=total,
                created_at=times[0],
                updated_at=times[-1],
            )
            db.add(courier)
            db.flush()  # assign id for event FKs

            db.add(
                CourierEvent(
                    courier_id=courier.id,
                    event="created",
                    from_status=None,
                    to_status="booked",
                    message=f"Booked {parcel} · {weight} kg · {src} → {dst}",
                    created_at=times[0],
                )
            )
            for prev, cur, ts in zip(reached[:-1], reached[1:], times[1:]):
                db.add(
                    CourierEvent(
                        courier_id=courier.id,
                        event=f"status:{cur}",
                        from_status=prev,
                        to_status=cur,
                        message=f"{pretty(prev)} → {pretty(cur)}",
                        created_at=ts,
                    )
                )
        db.commit()
    finally:
        db.close()

    print(f"Seeded {len(DATASET)} shipments · revenue ${total_revenue:,.2f}")
    print("Statuses:", {s: sum(1 for r in DATASET if r[1] == s) for s in sorted({r[1] for r in DATASET})})


if __name__ == "__main__":
    main()
