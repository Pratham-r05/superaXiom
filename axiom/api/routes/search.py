from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from axiom.core import search_agent, pdf_agent, embed_agent, vector_agent
import logging
import json
from typing import Dict, Any

router = APIRouter(prefix="/api/search", tags=["search"])
logger = logging.getLogger(__name__)

# In-process embed status — survives for the lifetime of the server process.
# Keys are arxiv_ids; values: {status, stage, error, chunk_count}
_embed_tasks: Dict[str, Dict[str, Any]] = {}


class PrefetchRequest(BaseModel):
    arxiv_id: str


@router.get("/suggest")
async def suggest(q: str, limit: int = 5):
    if len(q.strip()) < 2:
        return {"papers": [], "query": q, "total": 0}
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
    # If a task is already running for this paper, don't queue a second one.
    existing = _embed_tasks.get(req.arxiv_id, {})
    if existing.get("status") in ("queued", "processing"):
        return {"status": "already_running", "arxiv_id": req.arxiv_id}
    _embed_tasks[req.arxiv_id] = {
        "status": "queued", "stage": "Queued — waiting to start…",
        "error": None, "chunk_count": 0,
    }
    background.add_task(_embed_paper, req.arxiv_id)
    return {"status": "queued", "arxiv_id": req.arxiv_id}


@router.get("/embed-status/{arxiv_id}")
async def embed_status(arxiv_id: str):
    """Live status of a running embed task for a given paper."""
    cached = await vector_agent.exists(arxiv_id)
    if cached:
        return {"status": "done", "stage": "Indexed", "error": None,
                "chunk_count": 0, "arxiv_id": arxiv_id}
    task = _embed_tasks.get(arxiv_id)
    if not task:
        return {"status": "unknown", "stage": "", "error": None,
                "chunk_count": 0, "arxiv_id": arxiv_id}
    return {**task, "arxiv_id": arxiv_id}


async def _embed_paper(arxiv_id: str):
    def _set(stage: str, status: str = "processing", **kw):
        _embed_tasks[arxiv_id] = {
            "status": status, "stage": stage,
            "error": None, "chunk_count": 0, **kw,
        }

    try:
        _set("Fetching paper metadata…")
        meta = await search_agent.get_paper_meta(arxiv_id)
        if not meta:
            _embed_tasks[arxiv_id] = {
                "status": "error", "stage": "Paper not found",
                "error": "Could not find metadata for this paper. "
                         "Try searching by arXiv ID (e.g. 1706.03762).",
                "chunk_count": 0,
            }
            return

        _set("Downloading PDF from arXiv…")
        chunks = await pdf_agent.process(arxiv_id, meta.pdf_url)

        _set(f"Embedding {len(chunks)} chunks — this takes 1–5 min for large papers…",
             chunk_count=len(chunks))
        embeddings = await embed_agent.embed_chunks(chunks)

        _set("Storing vectors in ChromaDB…", chunk_count=len(chunks))
        await vector_agent.store(
            arxiv_id, chunks, embeddings,
            {"title": meta.title, "authors": json.dumps(meta.authors),
             "source": "arxiv", "year": meta.year}
        )
        _embed_tasks[arxiv_id] = {
            "status": "done", "stage": "Indexed",
            "error": None, "chunk_count": len(chunks),
        }
        logger.info(f"Prefetch complete for {arxiv_id} ({len(chunks)} chunks)")

    except Exception as e:
        _embed_tasks[arxiv_id] = {
            "status": "error",
            "stage": "Embedding failed",
            "error": str(e),
            "chunk_count": 0,
        }
        logger.error(f"Prefetch failed for {arxiv_id}: {e}", exc_info=True)


@router.get("/paper/{arxiv_id}")
async def get_paper(arxiv_id: str):
    meta = await search_agent.get_paper_meta(arxiv_id)
    if not meta:
        raise HTTPException(404, {"error": "Paper not found", "code": "NOT_FOUND"})
    cached = await vector_agent.exists(arxiv_id)
    return {**meta.__dict__, "cached": cached}
