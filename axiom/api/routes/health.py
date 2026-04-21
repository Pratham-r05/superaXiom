from fastapi import APIRouter
from axiom.core.model_router import get_router
from axiom.core.vector_agent import get_stats

router = APIRouter(prefix="/api/health", tags=["health"])

@router.get("")
async def health():
    router_inst = get_router()
    ollama_ok = await router_inst.check_ollama()
    stats = await get_stats()
    return {
        "status": "ok",
        "ollama_connected": ollama_ok,
        "model": router_inst.status(),
        "vector_db": stats,
        "version": "2.0.0"
    }
