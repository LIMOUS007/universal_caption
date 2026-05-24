from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://uc:uc@localhost:5432/universal_captions"
    redis_url: str = "redis://localhost:6379"
    session_ttl: int = 14_400  # seconds — 4 hours


settings = Settings()
