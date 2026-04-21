from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from axiom.core import search_agent, pdf_agent, embed_agent, vector_agent
import logging
import json

router = APIRouter(prefix="/api/search", tags=["search"])
logger = logging.getLogger(__name__)

class PrefetchRequest(BaseModel):
    arxiv_id: str

@router.get("/suggest")
async def suggest(q: str, limit: int = 5):
    if len(q.strip()) < 2:
        return {"papers": [], "query": q, "total": 0}
    # Keep suggestion calls read-only; writing cache on each keystroke can trigger
    # dev-server live reload loops and makes typing unusable.
    papers = await search_agent.search(
        q,
        max_results=limit,
        update_cache=False,
        fast_mode=True,
    )
    result = []
    for p in papers:
        result.append({
            "id": p.id, "title": p.title,
            "authors": p.authors, "year": p.year,
            "abstract": p.abstract, "arxiv_url": p.arxiv_url,
            "pdf_url": p.pdf_url, "cached": False
        })
    return {"papers": result, "query": q, "total": len(result)}

@router.post("/prefetch", status_code=202)
async def prefetch(req: PrefetchRequest, background: BackgroundTasks):
    already_cached = await vector_agent.exists(req.arxiv_id)
    if already_cached:
        return {"status": "already_cached", "arxiv_id": req.arxiv_id}
    background.add_task(_embed_paper, req.arxiv_id)
    return {"status": "queued", "arxiv_id": req.arxiv_id}

async def _embed_paper(arxiv_id: str):
    try:
        meta = await search_agent.get_paper_meta(arxiv_id)
        if not meta:
            logger.error(f"No metadata found for {arxiv_id}")
            return
        chunks = await pdf_agent.process(arxiv_id, meta.pdf_url)
        embeddings = await embed_agent.embed_chunks(chunks)
        await vector_agent.store(
            arxiv_id, chunks, embeddings,
            {"title": meta.title, "authors": json.dumps(meta.authors),
             "source": "arxiv", "year": meta.year}
        )
        logger.info(f"Prefetch complete for {arxiv_id}")
    except Exception as e:
        logger.error(f"Prefetch failed for {arxiv_id}: {e}", exc_info=True)

@router.get("/paper/{arxiv_id}")
async def get_paper(arxiv_id: str):
    meta = await search_agent.get_paper_meta(arxiv_id)
    if not meta:
        raise HTTPException(404, {"error": "Paper not found", "code": "NOT_FOUND"})
    cached = await vector_agent.exists(arxiv_id)
    return {**meta.__dict__, "cached": cached}
