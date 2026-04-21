from typing import AsyncIterator
from axiom.core.embed_agent import embed_query
from axiom.core.vector_agent import query as vector_query
from axiom.core.model_router import get_router
import logging

logger = logging.getLogger(__name__)

async def retrieve(paper_id: str, query_text: str, top_k: int = 8) -> list[dict]:
    q_vec = await embed_query(query_text)
    chunks = await vector_query(q_vec, paper_id=paper_id, top_k=top_k)
    logger.info(f"Retrieved {len(chunks)} chunks for '{query_text[:50]}'")
    return chunks

def build_context(chunks: list[dict]) -> str:
    parts = []
    for i, chunk in enumerate(chunks):
        page = chunk["metadata"].get("chunk_index", i)
        parts.append(f"[Excerpt {i+1} | Chunk {page}]\n{chunk['text']}")
    return "\n\n---\n\n".join(parts)

async def stream(prompt: str) -> AsyncIterator[str]:
    router = get_router()
    async for token in router.generate(prompt, stream=True):
        yield token
