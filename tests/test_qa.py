"""Tests for the Q&A API and QA agent pipeline."""

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
        self.authors = kwargs.get("authors", ["A Vaswani"])
        self.year = kwargs.get("year", 2017)
        self.abstract = kwargs.get("abstract", "...")
        self.arxiv_url = kwargs.get("arxiv_url", "")
        self.pdf_url = kwargs.get("pdf_url", "")
        self.cached = kwargs.get("cached", True)


# ── /api/qa/stream ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_qa_stream_success(client):
    """Q&A stream should yield tokens and a final done event."""
    async def fake_answer(*args, **kwargs):
        for token in ["The", " ", "attention", " ", "mechanism", " ", "allows", "..."]:
            yield token

    with patch("axiom.api.routes.qa.vector_agent.exists", new_callable=AsyncMock) as mock_exists:
        mock_exists.return_value = True
        with patch("axiom.api.routes.qa._get_meta", new_callable=AsyncMock) as mock_meta:
            mock_meta.return_value = {"title": "T", "authors": ["A"], "year": 2024}
            with patch("axiom.api.routes.qa.qa_agent.answer") as mock_answer:
                mock_answer.return_value = fake_answer()
                resp = await client.post("/api/qa/stream", json={
                    "paper_id": "1706.03762",
                    "question": "What is attention?",
                    "history": []
                })

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "text/event-stream; charset=utf-8"
    body = resp.text
    assert '"type": "start"' in body
    assert '"type": "token"' in body
    assert '"type": "done"' in body


@pytest.mark.asyncio
async def test_qa_stream_with_history(client):
    """Q&A should pass conversation history to the agent."""
    captured = {}

    async def fake_answer(paper_id, question, history, metadata):
        captured["history"] = history
        captured["question"] = question
        yield "Answer"

    with patch("axiom.api.routes.qa.vector_agent.exists", new_callable=AsyncMock) as mock_exists:
        mock_exists.return_value = True
        with patch("axiom.api.routes.qa._get_meta", new_callable=AsyncMock) as mock_meta:
            mock_meta.return_value = {"title": "T", "authors": ["A"], "year": 2024}
            with patch("axiom.api.routes.qa.qa_agent.answer") as mock_answer:
                mock_answer.side_effect = fake_answer
                history = [
                    {"role": "user", "content": "What is the main contribution?"},
                    {"role": "assistant", "content": "The transformer architecture."},
                ]
                resp = await client.post("/api/qa/stream", json={
                    "paper_id": "1706.03762",
                    "question": "Can you elaborate on that?",
                    "history": history
                })

    assert resp.status_code == 200
    assert captured["question"] == "Can you elaborate on that?"
    assert len(captured["history"]) == 2
    assert captured["history"][0]["role"] == "user"


@pytest.mark.asyncio
async def test_qa_stream_empty_question(client):
    """Empty question should return 400."""
    with patch("axiom.api.routes.qa.vector_agent.is_ready", new_callable=AsyncMock) as mock_ready:
        mock_ready.return_value = True
        resp = await client.post("/api/qa/stream", json={
            "paper_id": "1706.03762",
            "question": "   ",
            "history": []
        })

    assert resp.status_code == 400
    body = resp.json()
    detail = body.get("detail") or body
    assert "empty" in str(detail).lower()


@pytest.mark.asyncio
async def test_qa_stream_paper_not_ready(client):
    """Q&A on uncached paper should return 425."""
    with patch("axiom.api.routes.qa.vector_agent.is_ready", new_callable=AsyncMock) as mock_ready:
        mock_ready.return_value = False
        resp = await client.post("/api/qa/stream", json={
            "paper_id": "1706.03762",
            "question": "What is attention?",
            "history": []
        })

    assert resp.status_code == 425
    body = resp.json()
    detail = body.get("detail") or body
    assert "not ready" in str(detail).lower()


# ── QA Agent unit tests ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_qa_format_history():
    """_format_history should convert JSON turns to readable dialogue."""
    from axiom.core.qa_agent import _format_history
    history = [
        {"role": "user", "content": "What is this?"},
        {"role": "assistant", "content": "It is a transformer."},
    ]
    formatted = _format_history(history)
    assert "User: What is this?" in formatted
    assert "Assistant: It is a transformer." in formatted


@pytest.mark.asyncio
async def test_qa_format_history_empty():
    """Empty history should return a default message."""
    from axiom.core.qa_agent import _format_history
    assert _format_history([]) == "No previous conversation."


@pytest.mark.asyncio
async def test_qa_answer_builds_prompt():
    """answer() should build prompt from template + context + history."""
    captured_prompt = {}

    async def fake_stream(prompt):
        captured_prompt["text"] = prompt
        yield "Yes"

    with patch("axiom.core.qa_agent._qa_template", "Q:{QUESTION}\nH:{HISTORY}\nC:{CONTEXT}\nT:{TITLE}"):
        with patch("axiom.core.qa_agent.retrieve", new_callable=AsyncMock) as mock_retrieve:
            mock_retrieve.return_value = [
                {"text": "chunk1", "metadata": {"chunk_index": 0}}
            ]
            with patch("axiom.core.qa_agent.build_context") as mock_build:
                mock_build.return_value = "[Excerpt 1]\nchunk1"
                with patch("axiom.core.qa_agent.stream") as mock_stream:
                    mock_stream.side_effect = fake_stream
                    from axiom.core.qa_agent import answer
                    tokens = []
                    async for t in answer(
                        "1706.03762", "What?", [], {"title": "T", "authors": ["A"]}
                    ):
                        tokens.append(t)

    assert tokens == ["Yes"]
    assert "Q:What?" in captured_prompt["text"]
    assert "T:T" in captured_prompt["text"]
    assert "H:No previous conversation." in captured_prompt["text"]


# ── End-to-end: search → summarize → Q&A ─────────────────────────────────

@pytest.mark.asyncio
async def test_e2e_search_summarize_qa(client):
    """Full flow: search, summarize, then ask a follow-up question."""
    fake_papers = [FakePaperMeta(id="1706.03762", title="Attention Is All You Need")]

    # 1. Search
    with patch("axiom.api.routes.search.search_agent.search", new_callable=AsyncMock) as mock_search:
        mock_search.return_value = fake_papers
        resp = await client.get("/api/search/suggest?q=attention&limit=5")
    assert resp.status_code == 200
    paper_id = resp.json()["papers"][0]["id"]

    # 2. Prefetch
    with patch("axiom.api.routes.search.vector_agent.exists", new_callable=AsyncMock) as mock_exists:
        mock_exists.return_value = False
        resp = await client.post("/api/search/prefetch", json={"arxiv_id": paper_id})
    assert resp.status_code == 202

    # 3. Summarize
    async def fake_summary(*args, **kwargs):
        for t in ["This", " ", "paper", " ", "proposes", " ", "transformers", "."]:
            yield t

    with patch("axiom.api.routes.summarize.vector_agent.is_ready", new_callable=AsyncMock) as mock_ready:
        mock_ready.return_value = True
        with patch("axiom.api.routes.summarize._get_meta", new_callable=AsyncMock) as mock_meta:
            mock_meta.return_value = {"title": "Attention", "authors": ["A"], "year": 2017}
            with patch("axiom.api.routes.summarize.summarize_agent.summarize") as mock_summarize:
                mock_summarize.return_value = fake_summary()
                resp = await client.post("/api/summarize/stream", json={
                    "paper_id": paper_id,
                    "mode": "beginner",
                    "length": "short",
                })
    assert resp.status_code == 200
    assert '"type": "done"' in resp.text

    # 4. Q&A
    async def fake_qa(*args, **kwargs):
        for t in ["Attention", " ", "lets", " ", "the", " ", "model", " ", "focus", "."]:
            yield t

    with patch("axiom.api.routes.qa.vector_agent.is_ready", new_callable=AsyncMock) as mock_ready:
        mock_ready.return_value = True
        with patch("axiom.api.routes.qa._get_meta", new_callable=AsyncMock) as mock_meta:
            mock_meta.return_value = {"title": "Attention", "authors": ["A"], "year": 2017}
            with patch("axiom.api.routes.qa.qa_agent.answer") as mock_answer:
                mock_answer.return_value = fake_qa()
                resp = await client.post("/api/qa/stream", json={
                    "paper_id": paper_id,
                    "question": "What is attention in simple terms?",
                    "history": []
                })

    assert resp.status_code == 200
    body = resp.text
    assert '"type": "start"' in body
    assert '"type": "token"' in body
    assert '"type": "done"' in body
    # Verify the streamed answer contains our fake tokens
    assert "Attention" in body
    assert "focus" in body


@pytest.mark.asyncio
async def test_e2e_multi_turn_qa(client):
    """Multi-turn Q&A: first question, then follow-up with history."""
    history = []

    async def fake_qa(paper_id, question, hist, meta):
        history.append((question, len(hist)))
        if "simple" in question.lower():
            yield "It is a mechanism to focus on relevant parts."
        else:
            yield "Self-attention relates every token to every other token."

    with patch("axiom.api.routes.qa.vector_agent.is_ready", new_callable=AsyncMock) as mock_ready:
        mock_ready.return_value = True
        with patch("axiom.api.routes.qa._get_meta", new_callable=AsyncMock) as mock_meta:
            mock_meta.return_value = {"title": "T", "authors": ["A"], "year": 2024}
            with patch("axiom.api.routes.qa.qa_agent.answer") as mock_answer:
                mock_answer.side_effect = fake_qa

                # Turn 1
                r1 = await client.post("/api/qa/stream", json={
                    "paper_id": "1706.03762",
                    "question": "Explain attention in simple terms.",
                    "history": []
                })
                assert r1.status_code == 200

                # Turn 2 — with history from turn 1
                turn1_history = [
                    {"role": "user", "content": "Explain attention in simple terms."},
                    {"role": "assistant", "content": "It is a mechanism to focus on relevant parts."},
                ]
                r2 = await client.post("/api/qa/stream", json={
                    "paper_id": "1706.03762",
                    "question": "What about self-attention?",
                    "history": turn1_history
                })
                assert r2.status_code == 200

    assert len(history) == 2
    assert history[0] == ("Explain attention in simple terms.", 0)
    assert history[1] == ("What about self-attention?", 2)
