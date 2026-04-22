# import asyncio
# import logging
# from config import get_config

# logger = logging.getLogger(__name__)

# # Batch size for embedding requests — tune based on your Ollama / GPU capacity
# DEFAULT_BATCH_SIZE = 32


# async def embed_chunks(chunks: list[str], batch_size: int = DEFAULT_BATCH_SIZE) -> list[list[float]]:
#     """Embed a list of text chunks using Ollama."""
#     config = get_config()
#     loop = asyncio.get_running_loop()
#     embeddings: list[list[float]] = []

#     for batch_start in range(0, len(chunks), batch_size):
#         batch = chunks[batch_start:batch_start + batch_size]
#         batch_embeddings = await loop.run_in_executor(
#             None,
#             lambda b=batch: _embed_batch(b, config.EMBEDDING_MODEL)
#         )
#         embeddings.extend(batch_embeddings)

#     logger.info(f"Embedded {len(embeddings)} chunks in {(len(chunks) + batch_size - 1) // batch_size} batch(es)")
#     return embeddings


# async def embed_query(query: str) -> list[float]:
#     """Embed a single query string."""
#     config = get_config()
#     loop = asyncio.get_running_loop()
#     results = await loop.run_in_executor(
#         None,
#         lambda: _embed_batch([query], config.EMBEDDING_MODEL)
#     )
#     return results[0]


# def _embed_batch(texts: list[str], model: str) -> list[list[float]]:
#     """Embed a batch of texts via Ollama.

#     The Ollama Python client returns Pydantic models, not plain dicts, so we
#     use attribute access (response.embeddings) with a dict-key fallback for
#     older SDK versions that returned plain dicts.

#     Tries the newer batch `embed` API first, then falls back to the legacy
#     single-prompt `embeddings` API. If both fail, raises a clear error.
#     """
#     import ollama

#     def _extract(obj, *keys):
#         """Get a value from either a Pydantic model (attr) or a plain dict (key)."""
#         for k in keys:
#             v = getattr(obj, k, None)
#             if v is not None:
#                 return v
#             if isinstance(obj, dict):
#                 v = obj.get(k)
#                 if v is not None:
#                     return v
#         return None

#     # 1. Newer Ollama: batch embed API (returns EmbedResponse with .embeddings)
#     try:
#         response = ollama.embed(model=model, input=texts)
#         embs = _extract(response, "embeddings", "embedding")
#         if embs:
#             return list(embs)
#     except Exception:
#         pass

#     # 2. Legacy Ollama: single-prompt embeddings API (returns EmbeddingResponse with .embedding)
#     last_err = None
#     try:
#         result_list = []
#         for text in texts:
#             result = ollama.embeddings(model=model, prompt=text)
#             emb = _extract(result, "embedding", "embeddings")
#             if not emb:
#                 raise ValueError(f"Empty embedding returned for model '{model}'")
#             result_list.append(list(emb))
#         return result_list
#     except Exception as e:
#         last_err = e

#     # Both failed — clear, actionable error
#     raise RuntimeError(
#         f"Ollama embedding failed with model '{model}'. "
#         f"Ensure Ollama is running and the model is available: "
#         f"`ollama pull {model}`. Detail: {last_err}"
#     )
import asyncio
import os
import logging
from config import get_config

logger = logging.getLogger(__name__)

DEFAULT_BATCH_SIZE = 32


async def embed_chunks(chunks: list[str], batch_size: int = DEFAULT_BATCH_SIZE) -> list[list[float]]:
    """Embed a list of text chunks using configured embedding provider."""
    config = get_config()
    loop = asyncio.get_running_loop()
    embeddings: list[list[float]] = []

    for batch_start in range(0, len(chunks), batch_size):
        batch = chunks[batch_start:batch_start + batch_size]
        batch_embeddings = await loop.run_in_executor(
            None,
            lambda b=batch: _embed_batch(b, config)
        )
        embeddings.extend(batch_embeddings)

    logger.info(f"Embedded {len(embeddings)} chunks in {(len(chunks) + batch_size - 1) // batch_size} batch(es)")
    return embeddings


async def embed_query(query: str) -> list[float]:
    """Embed a single query string."""
    config = get_config()
    loop = asyncio.get_running_loop()
    results = await loop.run_in_executor(
        None,
        lambda: _embed_batch([query], config)
    )
    return results[0]


def _embed_batch(texts: list[str], config) -> list[list[float]]:
    """Embed a batch of texts via configured provider."""
    provider = getattr(config, "EMBED_PROVIDER", "openrouter")
    model = config.EMBEDDING_MODEL

    # OpenRouter
    if provider == "openrouter":
        from openai import OpenAI
        api_key = getattr(config, "EMBED_API_KEY", "") or config.get_api_key("openrouter")
        referer = os.getenv("OPENROUTER_HTTP_REFERER", "https://superaxiom.vercel.app")
        title = os.getenv("OPENROUTER_APP_TITLE", "superaXiom")
        client = OpenAI(
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1",
            default_headers={
                "HTTP-Referer": referer,
                "X-Title": title,
            },
        )
        response = client.embeddings.create(model=model, input=texts)
        return [item.embedding for item in response.data]

    # OpenAI
    if provider == "openai":
        from openai import OpenAI
        api_key = getattr(config, "EMBED_API_KEY", "") or config.get_api_key("openai")
        client = OpenAI(api_key=api_key)
        response = client.embeddings.create(model=model, input=texts)
        return [item.embedding for item in response.data]

    # Ollama (default fallback)
    import ollama

    def _extract(obj, *keys):
        """Get a value from either a Pydantic model (attr) or a plain dict (key)."""
        for k in keys:
            v = getattr(obj, k, None)
            if v is not None:
                return v
            if isinstance(obj, dict):
                v = obj.get(k)
                if v is not None:
                    return v
        return None

    # 1. Newer Ollama: batch embed API
    try:
        response = ollama.embed(model=model, input=texts)
        embs = _extract(response, "embeddings", "embedding")
        if embs:
            return list(embs)
    except Exception:
        pass

    # 2. Legacy Ollama: single-prompt embeddings API
    last_err = None
    try:
        result_list = []
        for text in texts:
            result = ollama.embeddings(model=model, prompt=text)
            emb = _extract(result, "embedding", "embeddings")
            if not emb:
                raise ValueError(f"Empty embedding returned for model '{model}'")
            result_list.append(list(emb))
        return result_list
    except Exception as e:
        last_err = e

    raise RuntimeError(
        f"Ollama embedding failed with model '{model}'. "
        f"Ensure Ollama is running and the model is available: "
        f"`ollama pull {model}`. Detail: {last_err}"
    )