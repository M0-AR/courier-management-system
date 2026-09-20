"""Transparent USA-ready pricing: base fee + per-kg rate."""
from ..config import get_settings


def calculate_charge(weight_kg: float) -> tuple[float, float, float]:
    """Return (base_fee, rate_per_kg, total) in USD. Raises ValueError on bad weight."""
    if weight_kg <= 0 or weight_kg > 500:
        raise ValueError("weight_kg must be between 0 and 500")
    s = get_settings()
    total = round(s.BASE_FEE_USD + s.RATE_PER_KG_USD * weight_kg, 2)
    return s.BASE_FEE_USD, s.RATE_PER_KG_USD, total
