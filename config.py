from pydantic_settings import BaseSettings
from pathlib import Path
from typing import List
from dotenv import set_key, unset_key

ENV_FILE = Path(".env")
PROVIDER_KEY_ENV_MAP = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}

class Config(BaseSettings):
    LLM_PROVIDER: str = "ollama"
    LLM_MODEL: str = "gpt-oss:20b"
    API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    OPENROUTER_API_KEY: str = ""
    SEMANTIC_SCHOLAR_API_KEY: str = ""
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    EMBEDDING_MODEL: str = "nomic-embed-text"
    EMBED_PROVIDER: str = "openrouter"
    EMBED_API_KEY: str = ""
    
    CHROMA_PERSIST_DIR: str = "./data/chroma_db"
    UPLOAD_DIR: str = "./data/uploads"
    TITLE_CACHE_DB: str = "./data/title_cache.db"

    MAX_CHUNK_SIZE: int = 512
    CHUNK_OVERLAP: int = 64
    MAX_SEARCH_RESULTS: int = 10
    RAG_TOP_K: int = 8

    PORT: int = 8000
    CORS_ORIGINS: List[str] = ["*"]

    model_config = {"env_file": ".env", "extra": "ignore"}

    def get_api_key(self, provider: str) -> str:
        provider_key_env = PROVIDER_KEY_ENV_MAP.get(provider)
        if provider_key_env:
            provider_key = getattr(self, provider_key_env, "")
            if provider_key:
                return provider_key
        return self.API_KEY if provider == self.LLM_PROVIDER else ""

    def has_api_key(self, provider: str) -> bool:
        if provider == "ollama":
            return False
        return bool(self.get_api_key(provider))

_config: Config | None = None

def _ensure_env_file() -> None:
    ENV_FILE.touch(exist_ok=True)

def persist_setting(key: str, value: str) -> None:
    _ensure_env_file()
    set_key(str(ENV_FILE), key, value)

def clear_setting(key: str) -> None:
    _ensure_env_file()
    unset_key(str(ENV_FILE), key)

def persist_provider_api_key(provider: str, api_key: str) -> None:
    env_key = PROVIDER_KEY_ENV_MAP.get(provider)
    if not env_key:
        return
    if api_key:
        persist_setting(env_key, api_key)
    else:
        clear_setting(env_key)

def get_config() -> Config:
    global _config
    if _config is None:
        _config = Config()
        Path(_config.CHROMA_PERSIST_DIR).mkdir(parents=True, exist_ok=True)
        Path(_config.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
        Path(f"{_config.UPLOAD_DIR}/local").mkdir(parents=True, exist_ok=True)
        Path(f"{_config.UPLOAD_DIR}/arxiv").mkdir(parents=True, exist_ok=True)
    return _config
