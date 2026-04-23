import asyncio
import chromadb
from chromadb.config import Settings
import logging
from pathlib import Path
from config import get_config

logger = logging.getLogger(__name__)

_client = None
_collection = None


def _ready_marker_dir() -> Path:
    config = get_config()
    path = Path(config.CHROMA_PERSIST_DIR) / "ready"
    path.mkdir(parents=True, exist_ok=True)
    return path


def ready_marker_path(paper_id: str) -> Path:
    return _ready_marker_dir() / f"{paper_id}.ready"


def has_ready_marker(paper_id: str) -> bool:
    return ready_marker_path(paper_id).exists()


def mark_ready(paper_id: str) -> None:
    ready_marker_path(paper_id).write_text("ready")


def clear_ready_marker(paper_id: str) -> None:
    path = ready_marker_path(paper_id)
    if path.exists():
        path.unlink()


def get_collection():
    global _client, _collection
    if _collection is None:
        config = get_config()
        _client = chromadb.PersistentClient(
            path=config.CHROMA_PERSIST_DIR,
            settings=Settings(anonymized_telemetry=False)
        )
        _collection = _client.get_or_create_collection(
            name="axiom_papers",
            metadata={"hnsw:space": "cosine"}
        )
        logger.info(f"ChromaDB collection ready: {_collection.count()} chunks stored")
    return _collection

async def exists(paper_id: str) -> bool:
    loop = asyncio.get_running_loop()
    def _check():
        col = get_collection()
        results = col.get(where={"paper_id": paper_id}, limit=1, include=[])
        return len(results["ids"]) > 0
    return await loop.run_in_executor(None, _check)


async def is_ready(paper_id: str) -> bool:
    """Return True when a paper is durably ready for summarize/QA.

    A ready marker is written only after a successful store. If we see a paper
    without a marker but the vectors are already visible, bootstrap the marker so
    old cached papers keep working.
    """
    if has_ready_marker(paper_id):
        return await exists(paper_id)

    if await exists(paper_id):
        await asyncio.sleep(0.25)
        if await exists(paper_id):
            mark_ready(paper_id)
            return True

    return False

async def store(
    paper_id: str,
    chunks: list[str],
    embeddings: list[list[float]],
    metadata: dict,
    batch_size: int = 128
) -> None:
    loop = asyncio.get_running_loop()
    def _store():
        col = get_collection()
        total = len(chunks)
        for start in range(0, total, batch_size):
            end = min(start + batch_size, total)
            batch_ids = [f"{paper_id}__chunk_{i}" for i in range(start, end)]
            batch_docs = chunks[start:end]
            batch_embs = embeddings[start:end]
            batch_metas = [{**metadata, "paper_id": paper_id, "chunk_index": i} for i in range(start, end)]
            col.upsert(ids=batch_ids, documents=batch_docs, embeddings=batch_embs, metadatas=batch_metas)
        logger.info(f"Stored {total} chunks for paper {paper_id} in {(total + batch_size - 1) // batch_size} batch(es)")
    await loop.run_in_executor(None, _store)

async def query(
    query_embedding: list[float],
    paper_id: str,
    top_k: int = 8
) -> list[dict]:
    loop = asyncio.get_running_loop()
    def _query():
        col = get_collection()
        # Count only this paper's chunks — avoids n_results=0 crash when total < top_k
        paper_chunks = col.get(where={"paper_id": paper_id}, include=[])
        n_available = len(paper_chunks["ids"])
        if n_available == 0:
            return []
        n_results = min(top_k, n_available)
        results = col.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            where={"paper_id": paper_id},
            include=["documents", "metadatas", "distances"]
        )
        chunks = []
        for i, doc in enumerate(results["documents"][0]):
            chunks.append({
                "text": doc,
                "metadata": results["metadatas"][0][i],
                "distance": results["distances"][0][i]
            })
        return chunks
    return await loop.run_in_executor(None, _query)

async def delete(paper_id: str) -> None:
    loop = asyncio.get_running_loop()
    def _delete():
        col = get_collection()
        col.delete(where={"paper_id": paper_id})
        logger.info(f"Deleted all chunks for paper {paper_id}")
    await loop.run_in_executor(None, _delete)

async def get_stats() -> dict:
    loop = asyncio.get_running_loop()
    def _stats():
        col = get_collection()
        return {"total_chunks": col.count()}
    return await loop.run_in_executor(None, _stats)
