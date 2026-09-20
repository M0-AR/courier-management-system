"""Centralised runtime configuration (12-factor, pydantic-settings)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    APP_NAME: str = "SwiftCourier API"
    APP_VERSION: str = "2.0.0"
    ENVIRONMENT: str = "production"

    # Postgres by default; falls back to SQLite for local dev without docker.
    DATABASE_URL: str = "postgresql+psycopg://courier:courierpass@db:5432/courierdb"

    # Shared rate-limit counter. Falls back to per-process memory when unset
    # (local dev / tests) — documented, never silent.
    REDIS_URL: str = "redis://cache:6379/0"

    CORS_ORIGINS: str = "http://localhost:8080,http://localhost:5173,http://localhost:3000"

    # USD pricing — transparent, documented, saleable in the USA.
    BASE_FEE_USD: float = 6.99
    RATE_PER_KG_USD: float = 4.50
    CURRENCY: str = "USD"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
