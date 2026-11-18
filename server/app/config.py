from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVER_DIR = Path(__file__).resolve().parent.parent
SITE_DIR = SERVER_DIR.parent

KHALTI_HOSTS = {
    "sandbox": "https://dev.khalti.com/api/v2",
    "production": "https://khalti.com/api/v2",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=SERVER_DIR / ".env", extra="ignore")

    public_base_url: str = "http://localhost:8080"

    ncm_api_token: SecretStr | None = None
    ncm_base_url: str = "https://demo.nepalcanmove.com"
    ncm_pickup_branch: str = ""
    ncm_webhook_secret: SecretStr | None = None
    ncm_timeout_seconds: float = 25.0
    ncm_max_retries: int = 3
    ncm_poll_minutes: float = 15.0
    ncm_rates_hours: float = 24.0

    khalti_secret_key: SecretStr | None = None
    khalti_env: Literal["sandbox", "production"] = "sandbox"
    khalti_timeout_seconds: float = 20.0

    admin_api_key: SecretStr | None = None
    trust_proxy: bool = False
    cod_advance: bool = True
    track_limit_per_minute: int = 10
    order_limit_per_minute: int = 5
    database_path: str = str(SERVER_DIR / "data" / "ncm.sqlite3")
    site_dir: str = str(SITE_DIR)

    @field_validator("admin_api_key", "ncm_webhook_secret")
    @classmethod
    def _strong_secret(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and len(value.get_secret_value()) < 32:
            raise ValueError("must be at least 32 characters")
        return value

    @field_validator("public_base_url")
    @classmethod
    def _base_url(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if not value.startswith(("https://", "http://localhost", "http://127.0.0.1")):
            raise ValueError("PUBLIC_BASE_URL must use https outside localhost")
        return value

    @property
    def khalti_base_url(self) -> str:
        return KHALTI_HOSTS[self.khalti_env]


@lru_cache
def get_settings() -> Settings:
    return Settings()
