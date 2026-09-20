"""Revenue + dashboard aggregates (feature 8 + KPI header)."""
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Courier
from ..schemas import RevenueOut, StatsOut

router = APIRouter(tags=["insights"])


@router.get("/revenue", response_model=RevenueOut, summary="8. Calculate total revenue")
def total_revenue(db: Session = Depends(get_db)):
    total = db.execute(select(func.coalesce(func.sum(Courier.charge_usd), 0.0))).scalar_one()
    delivered = db.execute(select(func.count()).select_from(Courier).where(Courier.status == "delivered")).scalar_one()
    count = db.execute(select(func.count()).select_from(Courier)).scalar_one()
    return RevenueOut(total_revenue_usd=round(float(total), 2), delivered_count=delivered, total_count=count)


@router.get("/stats", response_model=StatsOut, summary="Dashboard KPIs")
def stats(db: Session = Depends(get_db)):
    rows = db.execute(select(Courier.status, func.count()).group_by(Courier.status)).all()
    by_status = {s: c for s, c in rows}
    total = sum(by_status.values())
    revenue = db.execute(select(func.coalesce(func.sum(Courier.charge_usd), 0.0))).scalar_one()
    return StatsOut(
        total=total,
        booked=by_status.get("booked", 0),
        in_transit=by_status.get("in_transit", 0),
        out_for_delivery=by_status.get("out_for_delivery", 0),
        delivered=by_status.get("delivered", 0),
        cancelled=by_status.get("cancelled", 0),
        total_revenue_usd=round(float(revenue), 2),
    )
