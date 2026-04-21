"""Tests for the search API endpoints and search agent."""

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


# ── Helpers ──────────────────────────────────────────────────────────────

class FakePaperMeta:
    """Fake PaperMeta dataclass for mocking."""
    def __init__(self, **kwargs):
        self.id = kwargs.get("id", "1706.03762")
        self.title = kwargs.get("title", "Attention Is All You Need")
        self.authors = kwargs.get("authors", ["Ashish Vaswani", "Noam Shazeer"])
        self.year = kwargs.get("year", 2017)
        self.abstract = kwargs.get("abstract", "We propose a new simple network architecture...")
        self.arxiv_url = kwargs.get("arxiv_url", "https://arxiv.org/abs/1706.03762")
        self.pdf_url = kwargs.get("pdf_url", "https://arxiv.org/pdf/1706.03762.pdf")
        self.cached = kwargs.get("cached", False)


# ── /api/search/suggest ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_suggest_with_results(client):
    """Search suggestions should return formatted paper list."""
    fake_papers = [
        FakePaperMeta(id="1706.03762", title="Attention Is All You Need"),
        FakePaperMeta(id="1810.04805", title="BERT: Pre-training..."),
    ]

    with patch("axiom.api.routes.search.search_agent.search", new_callable=AsyncMock) as mock_search:
        mock_search.return_value = fake_papers
        resp = await client.get("/api/search/suggest?q=attention&limit=5")

    assert resp.status_code == 200
    data = resp.json()
    assert data["query"] == "attention"
    assert data["total"] == 2
    assert len(data["papers"]) == 2
    assert data["papers"][0]["id"] == "1706.03762"
    assert data["papers"][0]["title"] == "Attention Is All You Need"
    assert data["papers"][0]["cached"] is False


@pytest.mark.asyncio
async def test_suggest_short_query(client):
    """Queries under 2 chars should return empty results gracefully."""
    resp = await client.get("/api/search/suggest?q=a&limit=5")
    assert resp.status_code == 200
    data = resp.json()
    assert data["papers"] == []
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_suggest_no_results(client):
    """Empty result set should still return valid JSON."""
    with patch("axiom.api.routes.search.search_agent.search", new_callable=AsyncMock) as mock_search:
        mock_search.return_value = []
        resp = await client.get("/api/search/suggest?q=xyznonexistent&limit=5")

    assert resp.status_code == 200
    data = resp.json()
    assert data["papers"] == []
    assert data["total"] == 0


# ── /api/search/prefetch ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_prefetch_new_paper(client):
    """Prefetching a new paper should queue background embedding."""
    with patch("axiom.api.routes.search.vector_agent.exists", new_callable=AsyncMock) as mock_exists:
        mock_exists.return_value = False
        resp = await client.post("/api/search/prefetch", json={"arxiv_id": "1706.03762"})

    assert resp.status_code == 202
    data = resp.json()
    assert data["status"] == "queued"
    assert data["arxiv_id"] == "1706.03762"


@pytest.mark.asyncio
async def test_prefetch_already_cached(client):
    """Prefetching an already-cached paper should return immediately."""
    with patch("axiom.api.routes.search.vector_agent.exists", new_callable=AsyncMock) as mock_exists:
        mock_exists.return_value = True
        resp = await client.post("/api/search/prefetch", json={"arxiv_id": "1706.03762"})

    assert resp.status_code == 202
    data = resp.json()
    assert data["status"] == "already_cached"


# ── /api/search/paper/{arxiv_id} ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_paper_found(client):
    """Fetching metadata for a known paper should succeed."""
    fake_meta = FakePaperMeta(id="1706.03762", cached=True)

    with patch("axiom.api.routes.search.search_agent.get_paper_meta", new_callable=AsyncMock) as mock_meta:
        mock_meta.return_value = fake_meta
        with patch("axiom.api.routes.search.vector_agent.exists", new_callable=AsyncMock) as mock_exists:
            mock_exists.return_value = True
            resp = await client.get("/api/search/paper/1706.03762")

    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "1706.03762"
    assert data["title"] == "Attention Is All You Need"
    assert data["cached"] is True


@pytest.mark.asyncio
async def test_get_paper_not_found(client):
    """Fetching metadata for an unknown paper should 404."""
    with patch("axiom.api.routes.search.search_agent.get_paper_meta", new_callable=AsyncMock) as mock_meta:
        mock_meta.return_value = None
        resp = await client.get("/api/search/paper/0000.00000")

    assert resp.status_code == 404


# ── End-to-end: search → select paper ────────────────────────────────────

@pytest.mark.asyncio
async def test_e2e_search_to_select(client):
    """Full flow: user searches, then fetches paper metadata."""
    fake_papers = [FakePaperMeta(id="1706.03762", title="Attention Is All You Need")]

    with patch("axiom.api.routes.search.search_agent.search", new_callable=AsyncMock) as mock_search:
        mock_search.return_value = fake_papers
        suggest_resp = await client.get("/api/search/suggest?q=attention&limit=5")

    assert suggest_resp.status_code == 200
    papers = suggest_resp.json()["papers"]
    assert len(papers) == 1
    selected_id = papers[0]["id"]

    fake_meta = FakePaperMeta(id=selected_id, cached=False)
    with patch("axiom.api.routes.search.search_agent.get_paper_meta", new_callable=AsyncMock) as mock_meta:
        mock_meta.return_value = fake_meta
        with patch("axiom.api.routes.search.vector_agent.exists", new_callable=AsyncMock) as mock_exists:
            mock_exists.return_value = False
            meta_resp = await client.get(f"/api/search/paper/{selected_id}")

    assert meta_resp.status_code == 200
    assert meta_resp.json()["cached"] is False

    # User then prefetches
    with patch("axiom.api.routes.search.vector_agent.exists", new_callable=AsyncMock) as mock_exists:
        mock_exists.return_value = False
        prefetch_resp = await client.post("/api/search/prefetch", json={"arxiv_id": selected_id})

    assert prefetch_resp.status_code == 202
    assert prefetch_resp.json()["status"] == "queued"
