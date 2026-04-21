"""Tests for the RAG pipeline: retrieval, context building, and vector ops."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import AsyncClient, ASGITransport
from main import app


@pytest.fixture
async def client():
    """Async HTTP client for FastAPI app."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


# ── RAG Agent unit tests ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_retrieve_returns_chunks():
    """retrieve() should return ranked chunks from the vector store."""
    fake_chunks = [
        {"text": "Chunk one", "metadata": {"chunk_index": 0}, "distance": 0.1},
        {"text": "Chunk two", "metadata": {"chunk_index": 1}, "distance": 0.2},
    ]

    with patch("axiom.core.rag_agent.embed_query", new_callable=AsyncMock) as mock_embed:
        mock_embed.return_value = [0.1] * 768
        with patch("axiom.core.rag_agent.vector_query", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = fake_chunks
            from axiom.core.rag_agent import retrieve
            chunks = await retrieve("1706.03762", "attention mechanism", top_k=8)

    assert len(chunks) == 2
    assert chunks[0]["text"] == "Chunk one"
    mock_embed.assert_awaited_once_with("attention mechanism")
    mock_query.assert_awaited_once()


@pytest.mark.asyncio
async def test_build_context_formatting():
    """build_context() should format chunks with excerpt labels."""
    from axiom.core.rag_agent import build_context
    chunks = [
        {"text": "First chunk content", "metadata": {"chunk_index": 0}},
        {"text": "Second chunk content", "metadata": {"chunk_index": 1}},
    ]
    context = build_context(chunks)
    assert "[Excerpt 1 | Chunk 0]" in context
    assert "First chunk content" in context
    assert "---" in context
    assert "[Excerpt 2 | Chunk 1]" in context


@pytest.mark.asyncio
async def test_stream_yields_tokens():
    """stream() should yield tokens from the model router."""
    async def fake_generate(prompt, stream):
        for token in ["Hello", " ", "world", "."]:
            yield token

    with patch("axiom.core.rag_agent.get_router") as mock_get_router:
        mock_router = MagicMock()
        mock_router.generate = fake_generate
        mock_get_router.return_value = mock_router
        from axiom.core.rag_agent import stream
        tokens = [t async for t in stream("Test prompt")]

    assert tokens == ["Hello", " ", "world", "."]


# ── Vector Agent unit tests ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_vector_exists_true():
    """exists() should return True when paper_id is found."""
    with patch("axiom.core.vector_agent.get_collection") as mock_get:
        mock_col = MagicMock()
        mock_col.get.return_value = {"ids": ["1706.03762__chunk_0"]}
        mock_get.return_value = mock_col
        from axiom.core.vector_agent import exists
        result = await exists("1706.03762")
    assert result is True


@pytest.mark.asyncio
async def test_vector_exists_false():
    """exists() should return False when paper_id is not found."""
    with patch("axiom.core.vector_agent.get_collection") as mock_get:
        mock_col = MagicMock()
        mock_col.get.return_value = {"ids": []}
        mock_get.return_value = mock_col
        from axiom.core.vector_agent import exists
        result = await exists("0000.00000")
    assert result is False


@pytest.mark.asyncio
async def test_vector_store_upserts():
    """store() should upsert chunks with correct IDs and metadata."""
    with patch("axiom.core.vector_agent.get_collection") as mock_get:
        mock_col = MagicMock()
        mock_get.return_value = mock_col
        from axiom.core.vector_agent import store
        await store(
            "1706.03762",
            ["chunk one", "chunk two"],
            [[0.1] * 768, [0.2] * 768],
            {"title": "Test Paper"}
        )
    mock_col.upsert.assert_called_once()
    call_kwargs = mock_col.upsert.call_args.kwargs
    assert call_kwargs["ids"] == ["1706.03762__chunk_0", "1706.03762__chunk_1"]
    assert len(call_kwargs["documents"]) == 2
    assert call_kwargs["metadatas"][0]["paper_id"] == "1706.03762"
    assert call_kwargs["metadatas"][0]["title"] == "Test Paper"


@pytest.mark.asyncio
async def test_vector_query_returns_chunks():
    """query() should return formatted chunk results."""
    with patch("axiom.core.vector_agent.get_collection") as mock_get:
        mock_col = MagicMock()
        mock_col.count.return_value = 100
        mock_col.query.return_value = {
            "documents": [["doc1", "doc2"]],
            "metadatas": [[{"chunk_index": 0}, {"chunk_index": 1}]],
            "distances": [[0.1, 0.2]],
        }
        mock_get.return_value = mock_col
        from axiom.core.vector_agent import query
        results = await query([0.1] * 768, "1706.03762", top_k=8)

    assert len(results) == 2
    assert results[0]["text"] == "doc1"
    assert results[0]["metadata"]["chunk_index"] == 0
    assert results[0]["distance"] == 0.1


@pytest.mark.asyncio
async def test_vector_delete():
    """delete() should remove all chunks for a paper."""
    with patch("axiom.core.vector_agent.get_collection") as mock_get:
        mock_col = MagicMock()
        mock_get.return_value = mock_col
        from axiom.core.vector_agent import delete
        await delete("1706.03762")
    mock_col.delete.assert_called_once()
    assert mock_col.delete.call_args.kwargs["where"]["paper_id"] == "1706.03762"


# ── End-to-end: prefetch → verify stored ─────────────────────────────────

@pytest.mark.asyncio
async def test_e2e_prefetch_and_exists(client):
    """After prefetch, the paper should report as cached."""
    with patch("axiom.api.routes.search.vector_agent.exists", new_callable=AsyncMock) as mock_exists:
        mock_exists.return_value = False
        resp = await client.post("/api/search/prefetch", json={"arxiv_id": "1706.03762"})
    assert resp.status_code == 202
    assert resp.json()["status"] == "queued"

    # Simulate background task completing — now paper exists
    with patch("axiom.api.routes.search.vector_agent.exists", new_callable=AsyncMock) as mock_exists:
        mock_exists.return_value = True
        from axiom.core.search_agent import PaperMeta
        fake_meta = PaperMeta(
            id="1706.03762", title="Attention", authors=["A"], year=2017,
            abstract="...", arxiv_url="", pdf_url="", cached=True
        )
        with patch("axiom.api.routes.search.search_agent.get_paper_meta", new_callable=AsyncMock) as mock_meta:
            mock_meta.return_value = fake_meta
            resp2 = await client.get("/api/search/paper/1706.03762")

    assert resp2.status_code == 200
    assert resp2.json()["cached"] is True
