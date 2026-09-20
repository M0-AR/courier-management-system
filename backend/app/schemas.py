"""Pydantic v2 schemas — validation boundary for every request/response."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CourierCreate(BaseModel):
    customer_name: str = Field(min_length=2, max_length=120)
    phone: str = Field(min_length=7, max_length=24)
    parcel_type: str = Field(min_length=2, max_length=60)
    weight_kg: float = Field(gt=0, le=500)
    source: str = Field(min_length=2, max_length=120)
    destination: str = Field(min_length=2, max_length=120)


class StatusUpdate(BaseModel):
    status: str = Field(pattern="^(booked|in_transit|out_for_delivery|delivered|cancelled)$")


class CourierOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tracking_id: str
    customer_name: str
    phone: str
    parcel_type: str
    weight_kg: float
    source: str
    destination: str
    status: str
    charge_usd: float
    created_at: datetime
    updated_at: datetime
    # Deterministic delivery estimate, computed server-side (single source of
    # truth — the frontend never invents dates). Labelled "estimated" in UI.
    eta_date: str | None = None
    eta_label: str | None = None


class CourierEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    courier_id: int
    event: str
    from_status: str | None
    to_status: str
    message: str
    created_at: datetime


class ChargePreview(BaseModel):
    weight_kg: float
    base_fee_usd: float
    rate_per_kg_usd: float
    total_usd: float
    currency: str = "USD"


class RevenueOut(BaseModel):
    total_revenue_usd: float
    delivered_count: int
    total_count: int
    currency: str = "USD"


class StatsOut(BaseModel):
    total: int
    booked: int
    in_transit: int
    out_for_delivery: int
    delivered: int
    cancelled: int
    total_revenue_usd: float
