from fastapi import APIRouter, HTTPException
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
    raise HTTPException(403, {"error": "Model configuration is locked.", "code": "CONFIG_LOCKED"})

@router.get("/available-models")
async def available_models():
    return get_router().available_models()
