"""Courier CRUD + search + status machine + charges + scan history.

Maps 1:1 to the 8 original OOP features, plus market-standard extras:
timestamped scan events, tracking-code lookup, server-computed ETAs.
"""
from sqlalchemy.exc import IntegrityError
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ALLOWED_TRANSITIONS, VALID_STATUSES, Courier, CourierEvent, log_event, new_tracking_id
from ..schemas import ChargePreview, CourierCreate, CourierEventOut, CourierOut, StatusUpdate
from ..services.eta import eta_for
from ..services.pricing import calculate_charge

router = APIRouter(prefix="/couriers", tags=["couriers"])


def with_eta(courier: Courier) -> Courier:
    eta_date, eta_label = eta_for(courier.status, courier.created_at, courier.updated_at)
    # Pydantic reads these plain attributes on the response model.
    courier.__dict__["eta_date"] = eta_date  # noqa: SLF001 (response shaping, not persistence)
    courier.__dict__["eta_label"] = eta_label
    return courier


def _get_or_404(db: Session, courier_id: int) -> Courier:
    courier = db.get(Courier, courier_id)
    if not courier:
        raise HTTPException(status_code=404, detail=f"Courier {courier_id} not found")
    return courier


@router.post("", response_model=CourierOut, status_code=201, summary="1. Add courier")
def create_courier(payload: CourierCreate, db: Session = Depends(get_db)):
    _, _, total = calculate_charge(payload.weight_kg)

    def _build(tracking_id: str) -> Courier:
        return Courier(tracking_id=tracking_id, status="booked", charge_usd=total, **payload.model_dump())

    courier = _build(new_tracking_id())
    db.add(courier)
    try:
        db.flush()  # assign id; retry once on tracking-code collision
    except IntegrityError:
        db.rollback()
        courier = _build(new_tracking_id())  # fresh instance: post-rollback state is unreliable
        db.add(courier)
        db.flush()
    log_event(
        db,
        courier,
        "created",
        "booked",
        message=f"Booked {payload.parcel_type} · {payload.weight_kg} kg · {payload.source} → {payload.destination}",
    )
    db.commit()
    db.refresh(courier)
    return with_eta(courier)


@router.get("", response_model=list[CourierOut], summary="2. View all couriers")
def list_couriers(
    status: str | None = Query(default=None, pattern="^(booked|in_transit|out_for_delivery|delivered|cancelled)$"),
    q: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    stmt = select(Courier).order_by(Courier.id.desc())
    if status:
        stmt = stmt.where(Courier.status == status)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                Courier.tracking_id.ilike(like),
                Courier.customer_name.ilike(like),
                Courier.phone.ilike(like),
                Courier.destination.ilike(like),
                Courier.source.ilike(like),
            )
        )
    return [with_eta(c) for c in db.execute(stmt.offset(offset).limit(limit)).scalars()]


@router.get("/delivered", response_model=list[CourierOut], summary="6. View delivered couriers")
def delivered_couriers(db: Session = Depends(get_db)):
    stmt = select(Courier).where(Courier.status == "delivered").order_by(Courier.id.desc())
    return [with_eta(c) for c in db.execute(stmt).scalars()]


@router.get("/charges/preview", response_model=ChargePreview, summary="5. Calculate courier charges")
def preview_charge(weight_kg: float = Query(gt=0, le=500)):
    base, rate, total = calculate_charge(weight_kg)
    return ChargePreview(weight_kg=weight_kg, base_fee_usd=base, rate_per_kg_usd=rate, total_usd=total)


@router.get("/by-tracking/{code}", response_model=CourierOut, summary="3b. Lookup by tracking code")
def get_by_tracking(code: str, db: Session = Depends(get_db)):
    courier = db.execute(select(Courier).where(func.upper(Courier.tracking_id) == code.strip().upper())).scalar_one_or_none()
    if not courier:
        raise HTTPException(status_code=404, detail=f"No courier with tracking code {code}")
    return with_eta(courier)


@router.get("/{courier_id}", response_model=CourierOut, summary="3. Search courier by ID")
def get_courier(courier_id: int, db: Session = Depends(get_db)):
    return with_eta(_get_or_404(db, courier_id))


@router.get("/{courier_id}/events", response_model=list[CourierEventOut], summary="Scan-event history")
def courier_events(courier_id: int, db: Session = Depends(get_db)):
    _get_or_404(db, courier_id)
    stmt = select(CourierEvent).where(CourierEvent.courier_id == courier_id).order_by(CourierEvent.id.asc())
    return list(db.execute(stmt).scalars())


@router.patch("/{courier_id}/status", response_model=CourierOut, summary="4. Update delivery status")
def update_status(courier_id: int, payload: StatusUpdate, db: Session = Depends(get_db)):
    if payload.status not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail="Invalid status")
    courier = _get_or_404(db, courier_id)
    if payload.status != courier.status and payload.status not in ALLOWED_TRANSITIONS.get(courier.status, ()):
        raise HTTPException(
            status_code=409,
            detail=f"Illegal transition {courier.status} -> {payload.status}. "
            f"Allowed: {list(ALLOWED_TRANSITIONS.get(courier.status, ()))}",
        )
    if payload.status != courier.status:
        pretty = lambda s: s.replace("_", " ").capitalize()
        log_event(
            db,
            courier,
            f"status:{payload.status}",
            payload.status,
            from_status=courier.status,
            message=f"{pretty(courier.status)} → {pretty(payload.status)}",
        )
        courier.status = payload.status
    db.commit()
    db.refresh(courier)
    return with_eta(courier)


@router.delete("/{courier_id}", status_code=204, summary="7. Delete courier")
def delete_courier(courier_id: int, db: Session = Depends(get_db)):
    courier = _get_or_404(db, courier_id)
    db.execute(CourierEvent.__table__.delete().where(CourierEvent.courier_id == courier_id))
    db.delete(courier)
    db.commit()
    return None


@router.get("/{courier_id}/charge", response_model=ChargePreview, summary="5b. Charge for a courier")
def courier_charge(courier_id: int, db: Session = Depends(get_db)):
    courier = _get_or_404(db, courier_id)
    base, rate, _ = calculate_charge(courier.weight_kg)
    return ChargePreview(weight_kg=courier.weight_kg, base_fee_usd=base, rate_per_kg_usd=rate, total_usd=courier.charge_usd)
