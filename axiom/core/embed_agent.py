import asyncio
import logging
from config import get_config

logger = logging.getLogger(__name__)

# Batch size for embedding requests — tune based on your Ollama / GPU capacity
DEFAULT_BATCH_SIZE = 32

# Cached sentence-transformers model (loaded once, reused forever)
_st_model = None


def _get_st_model():
    """Lazy-load and cache the sentence-transformers fallback model."""
    global _st_model
    if _st_model is None:
        logger.info("Loading sentence-transformers fallback model (all-MiniLM-L6-v2)...")
        from sentence_transformers import SentenceTransformer
        _st_model = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("Sentence-transformers model loaded.")
    return _st_model


async def embed_chunks(chunks: list[str], batch_size: int = DEFAULT_BATCH_SIZE) -> list[list[float]]:
    """Embed a list of text chunks using batched requests for speed."""
    config = get_config()
    loop = asyncio.get_event_loop()
    embeddings: list[list[float]] = []

    for batch_start in range(0, len(chunks), batch_size):
        batch = chunks[batch_start:batch_start + batch_size]
        try:
            batch_embeddings = await loop.run_in_executor(
                None,
                lambda b=batch: _embed_batch(b, config.EMBEDDING_MODEL)
            )
            embeddings.extend(batch_embeddings)
        except Exception as e:
            logger.error(f"Embedding failed for batch starting at {batch_start}: {e}")
            raise

    logger.info(f"Embedded {len(embeddings)} chunks in { (len(chunks) + batch_size - 1) // batch_size } batch(es)")
    return embeddings


async def embed_query(query: str) -> list[float]:
    """Embed a single query string."""
    config = get_config()
    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(
        None,
        lambda: _embed_batch([query], config.EMBEDDING_MODEL)
    )
    return results[0]


def _embed_batch(texts: list[str], model: str) -> list[list[float]]:
    """Embed a batch of texts. Tries Ollama batch API, then single-prompt API, then cached ST fallback."""

    # 1. Try Ollama's batch `embed` API (newer versions)
    try:
        import ollama
        response = ollama.embed(model=model, input=texts)
        return response["embeddings"]
    except Exception:
        pass  # Method may not exist in this ollama version

    # 2. Fall back to Ollama's single-prompt `embeddings` API (always works)
    try:
        import ollama
        embeddings = []
        for text in texts:
            result = ollama.embeddings(model=model, prompt=text)
            embeddings.append(result["embedding"])
        return embeddings
    except Exception as e:
        logger.warning(f"Ollama embedding failed ({e}), using cached sentence-transformers fallback")

    # 3. Last resort: cached sentence-transformers (loaded once)
    m = _get_st_model()
    embeddings = m.encode(texts, batch_size=len(texts), convert_to_numpy=True)
    return [emb.tolist() for emb in embeddings]
