from fastapi import APIRouter
from pydantic import BaseModel
from typing import Literal
from axiom.core.model_router import get_router

router = APIRouter(prefix="/api/config", tags=["config"])

class ModelConfigRequest(BaseModel):
    provider: Literal["ollama", "openai", "anthropic", "gemini", "openrouter"]
    model: str
    api_key: str | None = None

@router.get("")
async def get_config():
    return get_router().status()

@router.post("/model")
async def update_model(req: ModelConfigRequest):
    get_router().update(req.provider, req.model, req.api_key)
    return {"updated": True, "provider": req.provider, "model": req.model}

@router.get("/available-models")
async def available_models():
    return get_router().available_models()
