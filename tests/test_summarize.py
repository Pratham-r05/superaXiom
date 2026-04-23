"""Tests for the summarize API and streaming pipeline."""

import pytest
import json
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import AsyncClient, ASGITransport
from main import app


@pytest.fixture
async def client():
    """Async HTTP client for FastAPI app."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


class FakePaperMeta:
    def __init__(self, **kwargs):
        self.id = kwargs.get("id", "1706.03762")
        self.title = kwargs.get("title", "Attention Is All You Need")
        self.authors = kwargs.get("authors", ["A Vaswani", "N Shazeer"])
        self.year = kwargs.get("year", 2017)
        self.abstract = kwargs.get("abstract", "...")
        self.arxiv_url = kwargs.get("arxiv_url", "")
        self.pdf_url = kwargs.get("pdf_url", "")
        self.cached = kwargs.get("cached", True)


async def _read_sse(resp):
    """Parse SSE stream into list of event dicts."""
    events = []
    async for line in resp.aiter_lines():
        if line.startswith("data: "):
            try:
                events.append(json.loads(line[6:]))
            except json.JSONDecodeError:
                pass
    return events


# ── /api/summarize/stream ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_summarize_stream_success(client):
    """Streaming summary should yield start, tokens, and done events."""
    async def fake_summarize(*args, **kwargs):
        for token in ["## ", "Problem", " Formulation", "\n\n", "The", " paper", "."]:
            yield token

    with patch("axiom.api.routes.summarize.vector_agent.exists", new_callable=AsyncMock) as mock_exists:
        mock_exists.return_value = True
        with patch("axiom.api.routes.summarize._get_meta", new_callable=AsyncMock) as mock_meta:
            mock_meta.return_value = {"title": "T", "authors": ["A"], "year": 2024}
            with patch("axiom.api.routes.summarize.summarize_agent.summarize") as mock_summarize:
                mock_summarize.return_value = fake_summarize()
                resp = await client.post("/api/summarize/stream", json={
                    "paper_id": "1706.03762",
                    "mode": "technical",
                    "length": "short",
                    "user_questions": ""
                })

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/event-stream; charset=utf-8"

    body = resp.text
    assert 'data: {"type": "start"' in body
    assert '"type": "token"' in body
    assert '"type": "done"' in body


@pytest.mark.asyncio
async def test_summarize_stream_not_ready(client):
    """Summarizing before prefetch should return 425."""
    with patch("axiom.api.routes.summarize.vector_agent.is_ready", new_callable=AsyncMock) as mock_ready:
        mock_ready.return_value = False
        resp = await client.post("/api/summarize/stream", json={
            "paper_id": "1706.03762",
            "mode": "technical",
            "length": "short",
        })

    assert resp.status_code == 425
    body = resp.json()
    detail = body.get("detail") or body
    assert "not ready" in str(detail).lower()


@pytest.mark.asyncio
async def test_summarize_stream_invalid_mode(client):
    """Invalid mode should return 422 validation error."""
    with patch("axiom.api.routes.summarize.vector_agent.is_ready", new_callable=AsyncMock) as mock_ready:
        mock_ready.return_value = True
        resp = await client.post("/api/summarize/stream", json={
            "paper_id": "1706.03762",
            "mode": "invalid_mode",
            "length": "short",
        })

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_summarize_stream_with_user_questions(client):
    """Stream should include user questions in the prompt."""
    captured = {}

    async def fake_summarize(paper_id, mode, length, user_questions, meta):
        captured["user_questions"] = user_questions
        for token in ["Answer", "."]:
            yield token

    with patch("axiom.api.routes.summarize.vector_agent.exists", new_callable=AsyncMock) as mock_exists:
        mock_exists.return_value = True
        with patch("axiom.api.routes.summarize._get_meta", new_callable=AsyncMock) as mock_meta:
            mock_meta.return_value = {"title": "T", "authors": ["A"], "year": 2024}
            with patch("axiom.api.routes.summarize.summarize_agent.summarize") as mock_summarize:
                mock_summarize.side_effect = fake_summarize
                resp = await client.post("/api/summarize/stream", json={
                    "paper_id": "1706.03762",
                    "mode": "beginner",
                    "length": "long",
                    "user_questions": "Explain the attention mechanism with a concrete example."
                })

    assert resp.status_code == 200
    assert captured["user_questions"] == "Explain the attention mechanism with a concrete example."


# ── Summary viewer page ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_summarize_viewer_page(client):
    """The summary viewer HTML page should load."""
    resp = await client.get("/api/summarize/view")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert "Axiom" in resp.text
    assert "paper_id" in resp.text


# ── Summarize agent unit tests ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_build_prompt_substitution():
    """build_prompt() should correctly substitute template variables."""
    from axiom.core.summarize_agent import build_prompt
    with patch("axiom.core.summarize_agent._get_template") as mock_template:
        mock_template.return_value = (
            "Title: {TITLE}\nAuthors: {AUTHORS}\nYear: {YEAR}\n"
            "Length: {LENGTH_INSTRUCTION}\n{USER_QUESTIONS_BLOCK}\nContext: {CONTEXT}"
        )
        prompt = build_prompt(
            mode="technical",
            context="Some context",
            title="Test Paper",
            authors=["A", "B"],
            year=2024,
            length="short",
            user_questions="What is the main result?"
        )
    assert "Title: Test Paper" in prompt
    assert "Authors: A, B" in prompt
    assert "Year: 2024" in prompt
    assert "Length: 1-2 sentences" in prompt
    assert "What is the main result?" in prompt
    assert "Context: Some context" in prompt


@pytest.mark.asyncio
async def test_build_prompt_no_questions():
    """build_prompt() should omit user questions block when empty."""
    from axiom.core.summarize_agent import build_prompt
    with patch("axiom.core.summarize_agent._get_template") as mock_template:
        mock_template.return_value = "{USER_QUESTIONS_BLOCK}Context: {CONTEXT}"
        prompt = build_prompt(
            mode="beginner", context="ctx", title="T", authors=["A"],
            year=2024, length="medium", user_questions=""
        )
    assert "Additional User Questions" not in prompt
    assert "Context: ctx" in prompt


# ── End-to-end: search → prefetch → summarize ────────────────────────────

@pytest.mark.asyncio
async def test_e2e_search_prefetch_summarize(client):
    """Full flow: search for paper, prefetch it, then stream summary."""
    fake_papers = [FakePaperMeta(id="1706.03762", title="Attention Is All You Need")]

    # 1. Search
    with patch("axiom.api.routes.search.search_agent.search", new_callable=AsyncMock) as mock_search:
        mock_search.return_value = fake_papers
        resp = await client.get("/api/search/suggest?q=attention&limit=5")
    assert resp.status_code == 200
    paper_id = resp.json()["papers"][0]["id"]

    # 2. Prefetch (paper not cached yet)
    with patch("axiom.api.routes.search.vector_agent.exists", new_callable=AsyncMock) as mock_exists:
        mock_exists.return_value = False
        resp = await client.post("/api/search/prefetch", json={"arxiv_id": paper_id})
    assert resp.status_code == 202
    assert resp.json()["status"] == "queued"

    # 3. Summarize (paper now cached)
    async def fake_tokens(*args, **kwargs):
        for t in ["This", " ", "paper", " ", "introduces", " ", "transformers", "."]:
            yield t

    with patch("axiom.api.routes.summarize.vector_agent.is_ready", new_callable=AsyncMock) as mock_ready:
        mock_ready.return_value = True
        with patch("axiom.api.routes.summarize._get_meta", new_callable=AsyncMock) as mock_meta:
            mock_meta.return_value = {"title": "Attention", "authors": ["A"], "year": 2017}
            with patch("axiom.api.routes.summarize.summarize_agent.summarize") as mock_summarize:
                mock_summarize.return_value = fake_tokens()
                resp = await client.post("/api/summarize/stream", json={
                    "paper_id": paper_id,
                    "mode": "beginner",
                    "length": "short",
                })

    assert resp.status_code == 200
    body = resp.text
    assert '"type": "start"' in body
    assert '"type": "token"' in body
    assert '"type": "done"' in body
