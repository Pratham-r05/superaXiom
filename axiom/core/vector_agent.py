import chromadb
from chromadb.config import Settings
import logging
from config import get_config

logger = logging.getLogger(__name__)

_client = None
_collection = None

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
    col = get_collection()
    results = col.get(where={"paper_id": paper_id}, limit=1, include=[])
    return len(results["ids"]) > 0

async def store(
    paper_id: str,
    chunks: list[str],
    embeddings: list[list[float]],
    metadata: dict,
    batch_size: int = 128
) -> None:
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

async def query(
    query_embedding: list[float],
    paper_id: str,
    top_k: int = 8
) -> list[dict]:
    col = get_collection()
    results = col.query(
        query_embeddings=[query_embedding],
        n_results=min(top_k, col.count()),
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

async def delete(paper_id: str) -> None:
    col = get_collection()
    col.delete(where={"paper_id": paper_id})
    logger.info(f"Deleted all chunks for paper {paper_id}")

async def get_stats() -> dict:
    col = get_collection()
    return {"total_chunks": col.count()}
