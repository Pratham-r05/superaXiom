# AXIOM — Complete Build Specification
### For: Qwen3.6 (or any agentic coding model)
### Read this entire file before writing a single line of code.

---

## 1. What Is Axiom?

Axiom is a **fully local, privacy-first AI research paper summarizer and Q&A tool** built for people who read large volumes of AI research daily.

**Core value:** A user types any AI research paper name → Axiom finds it, downloads the full PDF, embeds the entire paper into a local vector database permanently, and lets the user either get a structured summary or have a full conversation with the paper — asking any question, including math explanations, methodology deep-dives, and section-specific queries.

**The product has two core modes:**
1. **Summarize** — structured output in 4 styles (beginner, mathematical, technical, intuitive) with 3 length options
2. **Q&A** — conversational, multi-turn question answering about any part of the paper with full conversation history

---

## 2. Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend | FastAPI + Uvicorn | async, fast, clean REST + SSE |
| Search | Semantic Scholar API | semantic search, free, no key needed |
| PDF source | arXiv PDF URL | fetched on demand, not stored |
| PDF processing | PyMuPDF (fitz) | fast, reliable text extraction |
| Chunking | Custom sliding window | 512 tokens, 64 overlap |
| Embeddings | nomic-embed-text via Ollama | local, fast, good quality |
| Vector DB | ChromaDB (persistent) | local, no server needed |
| Local LLM | Ollama (llama3.2 default) | fully local inference |
| Cloud LLM | OpenAI / Anthropic / Gemini | optional, user provides API key |
| Streaming | sse-starlette | SSE for token streaming |
| Fuzzy search | rapidfuzz | local title cache matching |
| Async HTTP | httpx | all external HTTP calls |
| Validation | Pydantic v2 | request/response schemas |

---

## 3. Directory Structure (Build Exactly This)

```
axiom/
├── main.py                          # FastAPI app — routers + middleware ONLY
├── config.py                        # ALL settings, .env loading, validation
├── requirements.txt
├── .env.example
│
├── api/
│   ├── __init__.py
│   └── routes/
│       ├── __init__.py
│       ├── search.py                # paper search + prefetch
│       ├── summarize.py             # summarization (blocking + SSE)
│       ├── qa.py                    # Q&A conversational endpoint
│       ├── upload.py                # local PDF upload
│       ├── config_routes.py         # model switching at runtime
│       └── health.py                # health + ollama status
│
├── core/
│   ├── __init__.py
│   ├── search_agent.py              # Semantic Scholar + fuzzy search
│   ├── pdf_agent.py                 # download + extract + chunk full PDF
│   ├── embed_agent.py               # embed chunks via Ollama
│   ├── vector_agent.py              # ChromaDB: store, query, check, delete
│   ├── rag_agent.py                 # retrieve → context → generate
│   ├── summarize_agent.py           # prompt builder + summarization orchestrator
│   ├── qa_agent.py                  # Q&A prompt builder + conversation handler
│   ├── model_router.py              # unified LLM interface: Ollama/OpenAI/Anthropic/Gemini
│   └── upload_agent.py              # local PDF upload handler
│
├── templates/
│   └── prompts/
│       ├── beginner.txt
│       ├── mathematical.txt
│       ├── technical.txt
│       ├── intuitive.txt
│       └── qa.txt
│
├── data/
│   ├── chroma_db/                   # persistent vectors (gitignored)
│   ├── uploads/                     # user-uploaded PDFs (gitignored)
│   └── title_cache.db               # SQLite for fast autocomplete (gitignored)
│
└── tests/
    ├── __init__.py
    ├── test_search.py
    ├── test_rag.py
    ├── test_summarize.py
    └── test_qa.py
```

---

## 4. Step-by-Step Build Order

**Follow this exact order. Each step is a working checkpoint. Do not skip ahead.**

```
Step 1  → config.py
Step 2  → core/search_agent.py
Step 3  → core/pdf_agent.py
Step 4  → core/embed_agent.py
Step 5  → core/vector_agent.py
Step 6  → core/model_router.py
Step 7  → core/rag_agent.py
Step 8  → templates/prompts/ (all 5 files)
Step 9  → core/summarize_agent.py
Step 10 → core/qa_agent.py
Step 11 → core/upload_agent.py
Step 12 → api/routes/search.py
Step 13 → api/routes/summarize.py
Step 14 → api/routes/qa.py
Step 15 → api/routes/upload.py
Step 16 → api/routes/config_routes.py
Step 17 → api/routes/health.py
Step 18 → main.py
Step 19 → tests/
```

---

## 5. Complete Data Flow

### Flow A — First Time Paper Request (Cold)
```
User types: "attention is all you need"
        ↓
search_agent.search(query)
    → Semantic Scholar API: finds exact paper
    → returns: title, authors, year, abstract, arxiv_id
        ↓
User selects paper from suggestions
        ↓
POST /api/search/prefetch {arxiv_id}
    → vector_agent.exists(arxiv_id)? → NO
    → BackgroundTask starts:
        pdf_agent.download(arxiv_id) → full PDF bytes
        pdf_agent.extract_text(pdf) → raw text (entire paper)
        pdf_agent.chunk(text) → 40-60 chunks of 512 tokens
        embed_agent.embed_all(chunks) → list of vectors
        vector_agent.store(arxiv_id, chunks, vectors, metadata)
    → HTTP 202 returned immediately (non-blocking)
        ↓
User selects mode=beginner, length=medium, questions=""
User clicks Summarize
        ↓
POST /api/summarize/stream
    → vector_agent.exists(arxiv_id)? → YES (background done)
    → rag_agent.retrieve(arxiv_id, query=title, top_k=8)
    → summarize_agent.build_prompt(mode, length, context, metadata)
    → model_router.generate(prompt, stream=True)
    → SSE stream tokens to frontend
```

### Flow B — Repeat Request (Hot, Instant)
```
Same paper requested again
        ↓
POST /api/search/prefetch {arxiv_id}
    → vector_agent.exists(arxiv_id)? → YES
    → return 202 immediately, nothing to do
        ↓
POST /api/summarize/stream
    → no download, no embedding, go straight to RAG
    → first token in < 2 seconds
```

### Flow C — Q&A Mode
```
Paper already embedded (from Flow A or B)
        ↓
User asks: "explain the math behind scaled dot-product attention"
        ↓
POST /api/qa
{
  paper_id, question, history: []
}
        ↓
embed_agent.embed_query(question) → query vector
vector_agent.query(query_vector, paper_id, top_k=8)
    → retrieves chunks from that specific section of the paper
        ↓
qa_agent.build_prompt(question, context, history)
        ↓
model_router.generate(prompt, stream=True)
        ↓
SSE stream answer
        ↓
User asks follow-up: "why do they scale by sqrt(d_k)?"
POST /api/qa {question, history: [prev turn]}
    → model has full conversation context
    → answers in context of previous exchange
```

### Flow D — Upload Own PDF
```
User uploads private paper (not on arXiv)
        ↓
POST /api/upload/pdf (multipart)
    → validate: PDF, < 50MB
    → save to data/uploads/local/{uuid}.pdf
    → extract title/authors from PDF metadata (fallback: filename)
    → BackgroundTask: chunk → embed → store with source="local"
    → return {paper_id: uuid, title, status: "processing"}
        ↓
Same summarize + Q&A flow using paper_id=uuid
```

---

## 6. Every File — Complete Implementation

---

### `config.py`

```python
from pydantic_settings import BaseSettings
from pathlib import Path
from typing import List

class Config(BaseSettings):
    # LLM
    LLM_PROVIDER: str = "ollama"
    LLM_MODEL: str = "llama3.2"
    API_KEY: str = ""
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    EMBEDDING_MODEL: str = "nomic-embed-text"

    # Storage
    CHROMA_PERSIST_DIR: str = "./data/chroma_db"
    UPLOAD_DIR: str = "./data/uploads"
    TITLE_CACHE_DB: str = "./data/title_cache.db"

    # Processing
    MAX_CHUNK_SIZE: int = 512
    CHUNK_OVERLAP: int = 64
    MAX_SEARCH_RESULTS: int = 10
    RAG_TOP_K: int = 8

    # Server
    PORT: int = 8000
    CORS_ORIGINS: List[str] = ["*"]

    class Config:
        env_file = ".env"
        extra = "ignore"

_config: Config | None = None

def get_config() -> Config:
    global _config
    if _config is None:
        _config = Config()
        # Create required directories
        Path(_config.CHROMA_PERSIST_DIR).mkdir(parents=True, exist_ok=True)
        Path(_config.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
        Path(f"{_config.UPLOAD_DIR}/local").mkdir(parents=True, exist_ok=True)
        Path(f"{_config.UPLOAD_DIR}/arxiv").mkdir(parents=True, exist_ok=True)
    return _config
```

---

### `core/search_agent.py`

**Responsibility:** Find papers by name. Primary source: Semantic Scholar (semantic search, free, no API key). Secondary: local SQLite title cache with fuzzy matching. Never use arXiv search API directly — it's too weak.

```python
import httpx
import sqlite3
import json
import logging
from dataclasses import dataclass
from config import get_config

logger = logging.getLogger(__name__)

SEMANTIC_SCHOLAR_API = "https://api.semanticscholar.org/graph/v1/paper/search"
FIELDS = "title,authors,year,abstract,externalIds,openAccessPdf"

@dataclass
class PaperMeta:
    id: str                    # arxiv_id like "1706.03762"
    title: str
    authors: list[str]
    year: int
    abstract: str
    arxiv_url: str
    pdf_url: str
    cached: bool = False       # True if already in ChromaDB

def init_title_cache():
    config = get_config()
    con = sqlite3.connect(config.TITLE_CACHE_DB)
    con.execute("""
        CREATE TABLE IF NOT EXISTS papers (
            arxiv_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            authors TEXT DEFAULT '[]',
            year INTEGER DEFAULT 0,
            abstract TEXT DEFAULT '',
            pdf_url TEXT DEFAULT ''
        )
    """)
    con.execute("CREATE INDEX IF NOT EXISTS idx_title ON papers(title)")
    con.commit()
    con.close()

async def search(query: str, max_results: int = 10) -> list[PaperMeta]:
    """3-layer search: Semantic Scholar → fuzzy cache → merge + rank."""
    results = []

    # Layer 1: Semantic Scholar
    try:
        ss_results = await _semantic_scholar_search(query, max_results)
        results.extend(ss_results)
        await _update_cache(ss_results)
    except Exception as e:
        logger.warning(f"Semantic Scholar search failed: {e}")

    # Layer 2: Fuzzy local cache (catches repeat searches instantly)
    try:
        cache_results = await _fuzzy_cache_search(query, max_results)
        results.extend(cache_results)
    except Exception as e:
        logger.warning(f"Cache search failed: {e}")

    # Layer 3: Deduplicate + rank
    return _rank_deduplicate(results, query)[:max_results]

async def _semantic_scholar_search(query: str, max_results: int) -> list[PaperMeta]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(SEMANTIC_SCHOLAR_API, params={
            "query": query,
            "limit": max_results,
            "fields": FIELDS
        })
        resp.raise_for_status()
        data = resp.json()

    papers = []
    for item in data.get("data", []):
        arxiv_id = item.get("externalIds", {}).get("ArXiv")
        if not arxiv_id:
            continue
        pdf_url = (item.get("openAccessPdf") or {}).get("url") or f"https://arxiv.org/pdf/{arxiv_id}.pdf"
        papers.append(PaperMeta(
            id=arxiv_id,
            title=item.get("title", ""),
            authors=[a["name"] for a in item.get("authors", [])],
            year=item.get("year") or 0,
            abstract=item.get("abstract") or "",
            arxiv_url=f"https://arxiv.org/abs/{arxiv_id}",
            pdf_url=pdf_url
        ))
    return papers

async def _fuzzy_cache_search(query: str, limit: int) -> list[PaperMeta]:
    from rapidfuzz import process, fuzz
    config = get_config()
    con = sqlite3.connect(config.TITLE_CACHE_DB)
    rows = con.execute("SELECT arxiv_id, title, authors, year, abstract, pdf_url FROM papers").fetchall()
    con.close()
    if not rows:
        return []
    titles = [r[1] for r in rows]
    matches = process.extract(query, titles, scorer=fuzz.partial_ratio, limit=limit)
    results = []
    for match_title, score, idx in matches:
        if score < 55:
            continue
        r = rows[idx]
        results.append(PaperMeta(
            id=r[0], title=r[1],
            authors=json.loads(r[2] or "[]"),
            year=r[3], abstract=r[4],
            arxiv_url=f"https://arxiv.org/abs/{r[0]}",
            pdf_url=r[5] or f"https://arxiv.org/pdf/{r[0]}.pdf",
            cached=True
        ))
    return results

async def _update_cache(papers: list[PaperMeta]):
    config = get_config()
    con = sqlite3.connect(config.TITLE_CACHE_DB)
    for p in papers:
        con.execute("""
            INSERT OR REPLACE INTO papers (arxiv_id, title, authors, year, abstract, pdf_url)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (p.id, p.title, json.dumps(p.authors), p.year, p.abstract, p.pdf_url))
    con.commit()
    con.close()

def _rank_deduplicate(papers: list[PaperMeta], query: str) -> list[PaperMeta]:
    from rapidfuzz import fuzz
    seen = set()
    unique = []
    for p in papers:
        if p.id not in seen:
            seen.add(p.id)
            unique.append(p)
    query_lower = query.lower()
    def score(p: PaperMeta) -> float:
        exact = 2.0 if query_lower in p.title.lower() else 0.0
        fuzzy = fuzz.partial_ratio(query_lower, p.title.lower()) / 100
        recency = min((p.year or 2000) / 2025, 1.0)
        return exact + fuzzy * 1.5 + recency * 0.3
    return sorted(unique, key=score, reverse=True)

async def get_paper_meta(arxiv_id: str) -> PaperMeta | None:
    """Get single paper metadata from cache or Semantic Scholar."""
    config = get_config()
    con = sqlite3.connect(config.TITLE_CACHE_DB)
    row = con.execute(
        "SELECT arxiv_id, title, authors, year, abstract, pdf_url FROM papers WHERE arxiv_id=?",
        (arxiv_id,)
    ).fetchone()
    con.close()
    if row:
        return PaperMeta(
            id=row[0], title=row[1],
            authors=json.loads(row[2] or "[]"),
            year=row[3], abstract=row[4],
            arxiv_url=f"https://arxiv.org/abs/{row[0]}",
            pdf_url=row[5]
        )
    # Fallback: fetch from Semantic Scholar by arXiv ID
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"https://api.semanticscholar.org/graph/v1/paper/arXiv:{arxiv_id}",
                params={"fields": FIELDS}
            )
            data = resp.json()
            pdf_url = (data.get("openAccessPdf") or {}).get("url") or f"https://arxiv.org/pdf/{arxiv_id}.pdf"
            paper = PaperMeta(
                id=arxiv_id,
                title=data.get("title", arxiv_id),
                authors=[a["name"] for a in data.get("authors", [])],
                year=data.get("year") or 0,
                abstract=data.get("abstract") or "",
                arxiv_url=f"https://arxiv.org/abs/{arxiv_id}",
                pdf_url=pdf_url
            )
            await _update_cache([paper])
            return paper
    except Exception:
        return None
```

---

### `core/pdf_agent.py`

**Responsibility:** Download full PDF, extract ALL text (every page, every section), chunk into overlapping pieces. Never use abstract only — always full paper.

```python
import fitz  # pymupdf
import httpx
import re
import logging
from pathlib import Path
from config import get_config

logger = logging.getLogger(__name__)

async def download(arxiv_id: str, pdf_url: str) -> Path:
    """Download PDF to disk. Returns path. Skips if already downloaded."""
    config = get_config()
    dest = Path(config.UPLOAD_DIR) / "arxiv" / f"{arxiv_id.replace('/', '_')}.pdf"
    if dest.exists() and dest.stat().st_size > 1000:
        return dest
    logger.info(f"Downloading PDF for {arxiv_id}")
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        resp = await client.get(pdf_url)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
    logger.info(f"Downloaded {dest.stat().st_size / 1024:.1f}KB for {arxiv_id}")
    return dest

def extract_text(pdf_path: Path) -> str:
    """Extract full text from every page. Clean noise."""
    doc = fitz.open(str(pdf_path))
    pages = []
    for page_num, page in enumerate(doc):
        text = page.get_text("text")
        text = _clean(text)
        if len(text.strip()) > 30:
            pages.append(f"[Page {page_num + 1}]\n{text}")
    doc.close()
    full_text = "\n\n".join(pages)
    logger.info(f"Extracted {len(full_text)} chars from {pdf_path.name}")
    return full_text

def _clean(text: str) -> str:
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r' {2,}', ' ', text)
    text = re.sub(r'(\w)-\n(\w)', r'\1\2', text)  # fix hyphenated line breaks
    return text.strip()

def chunk(text: str, chunk_size: int = 512, overlap: int = 64) -> list[str]:
    """Sliding window word-based chunker. 1 token ≈ 0.75 words."""
    words = text.split()
    word_chunk = int(chunk_size * 0.75)   # ~384 words per chunk
    word_overlap = int(overlap * 0.75)    # ~48 words overlap
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + word_chunk, len(words))
        piece = " ".join(words[start:end])
        if len(piece.strip()) > 50:
            chunks.append(piece)
        start += word_chunk - word_overlap
    logger.info(f"Created {len(chunks)} chunks")
    return chunks

async def process(arxiv_id: str, pdf_url: str) -> list[str]:
    """Full pipeline: download → extract → chunk. Returns chunks."""
    config = get_config()
    pdf_path = await download(arxiv_id, pdf_url)
    text = extract_text(pdf_path)
    return chunk(text, config.MAX_CHUNK_SIZE, config.CHUNK_OVERLAP)
```

---

### `core/embed_agent.py`

**Responsibility:** Convert text chunks into vectors using `nomic-embed-text` via Ollama. Fallback to `sentence-transformers` if Ollama embedding unavailable.

```python
import asyncio
import logging
from config import get_config

logger = logging.getLogger(__name__)

async def embed_chunks(chunks: list[str]) -> list[list[float]]:
    """Batch embed all chunks. Returns list of vectors."""
    config = get_config()
    loop = asyncio.get_event_loop()
    embeddings = []
    for i, chunk in enumerate(chunks):
        try:
            embedding = await loop.run_in_executor(
                None,
                lambda c=chunk: _embed_one(c, config.EMBEDDING_MODEL)
            )
            embeddings.append(embedding)
        except Exception as e:
            logger.error(f"Embedding failed for chunk {i}: {e}")
            raise
    logger.info(f"Embedded {len(embeddings)} chunks")
    return embeddings

async def embed_query(query: str) -> list[float]:
    """Embed a single query string."""
    config = get_config()
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        lambda: _embed_one(query, config.EMBEDDING_MODEL)
    )

def _embed_one(text: str, model: str) -> list[float]:
    try:
        import ollama
        result = ollama.embeddings(model=model, prompt=text)
        return result["embedding"]
    except Exception:
        # Fallback: sentence-transformers
        logger.warning("Ollama embedding failed, using sentence-transformers fallback")
        from sentence_transformers import SentenceTransformer
        m = SentenceTransformer("all-MiniLM-L6-v2")
        return m.encode(text).tolist()
```

---

### `core/vector_agent.py`

**Responsibility:** All ChromaDB operations. Single persistent collection. Check, store, query, delete. This is the permanent memory of the system.

```python
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
    metadata: dict
) -> None:
    col = get_collection()
    ids = [f"{paper_id}__chunk_{i}" for i in range(len(chunks))]
    metas = [{**metadata, "paper_id": paper_id, "chunk_index": i} for i in range(len(chunks))]
    col.upsert(ids=ids, documents=chunks, embeddings=embeddings, metadatas=metas)
    logger.info(f"Stored {len(chunks)} chunks for paper {paper_id}")

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
```

---

### `core/model_router.py`

**Responsibility:** Single unified interface for all LLM calls. Routes to Ollama (local) or any cloud provider. Swappable at runtime — no restart needed.

```python
import asyncio
import logging
from typing import AsyncIterator, Literal
from config import get_config

logger = logging.getLogger(__name__)
Provider = Literal["ollama", "openai", "anthropic", "gemini"]

class ModelRouter:
    def __init__(self):
        cfg = get_config()
        self.provider: Provider = cfg.LLM_PROVIDER
        self.model: str = cfg.LLM_MODEL
        self.api_key: str = cfg.API_KEY
        self.ollama_url: str = cfg.OLLAMA_BASE_URL

    def update(self, provider: Provider, model: str, api_key: str = ""):
        self.provider = provider
        self.model = model
        self.api_key = api_key
        logger.info(f"Model router updated: {provider}/{model}")

    async def generate(self, prompt: str, stream: bool = True) -> AsyncIterator[str]:
        generators = {
            "ollama": self._ollama,
            "openai": self._openai,
            "anthropic": self._anthropic,
            "gemini": self._gemini,
        }
        gen = generators.get(self.provider)
        if not gen:
            raise ValueError(f"Unknown provider: {self.provider}")
        async for token in gen(prompt, stream):
            yield token

    async def _ollama(self, prompt: str, stream: bool) -> AsyncIterator[str]:
        import ollama
        loop = asyncio.get_event_loop()
        if stream:
            def _run():
                return list(ollama.generate(
                    model=self.model, prompt=prompt,
                    stream=True, options={"temperature": 0.3, "num_predict": 3000}
                ))
            chunks = await loop.run_in_executor(None, _run)
            for chunk in chunks:
                if chunk.get("response"):
                    yield chunk["response"]
        else:
            result = await loop.run_in_executor(
                None, lambda: ollama.generate(model=self.model, prompt=prompt)
            )
            yield result["response"]

    async def _openai(self, prompt: str, stream: bool) -> AsyncIterator[str]:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=self.api_key)
        if stream:
            async with client.chat.completions.stream(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3, max_tokens=3000
            ) as s:
                async for chunk in s:
                    delta = chunk.choices[0].delta.content
                    if delta:
                        yield delta
        else:
            resp = await client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3, max_tokens=3000
            )
            yield resp.choices[0].message.content

    async def _anthropic(self, prompt: str, stream: bool) -> AsyncIterator[str]:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=self.api_key)
        if stream:
            async with client.messages.stream(
                model=self.model, max_tokens=3000,
                messages=[{"role": "user", "content": prompt}]
            ) as s:
                async for text in s.text_stream:
                    yield text
        else:
            resp = await client.messages.create(
                model=self.model, max_tokens=3000,
                messages=[{"role": "user", "content": prompt}]
            )
            yield resp.content[0].text

    async def _gemini(self, prompt: str, stream: bool) -> AsyncIterator[str]:
        import google.generativeai as genai
        genai.configure(api_key=self.api_key)
        model = genai.GenerativeModel(self.model)
        loop = asyncio.get_event_loop()
        if stream:
            response = await loop.run_in_executor(
                None, lambda: model.generate_content(prompt, stream=True)
            )
            for chunk in response:
                if chunk.text:
                    yield chunk.text
        else:
            result = await loop.run_in_executor(
                None, lambda: model.generate_content(prompt)
            )
            yield result.text

    def status(self) -> dict:
        return {
            "provider": self.provider,
            "model": self.model,
            "has_api_key": bool(self.api_key)
        }

    def available_models(self) -> dict:
        return {
            "ollama": ["llama3.2", "llama3.1", "mistral", "mixtral", "phi3", "gemma2", "deepseek-r1"],
            "openai": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
            "anthropic": ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
            "gemini": ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"]
        }

    async def check_ollama(self) -> bool:
        import httpx
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{self.ollama_url}/api/tags")
                return resp.status_code == 200
        except Exception:
            return False

_router: ModelRouter | None = None

def get_router() -> ModelRouter:
    global _router
    if _router is None:
        _router = ModelRouter()
    return _router
```

---

### `core/rag_agent.py`

**Responsibility:** Orchestrate retrieval and generation. Retrieve relevant chunks → build context string → stream generation.

```python
from typing import AsyncIterator
from core.embed_agent import embed_query
from core.vector_agent import query as vector_query
from core.model_router import get_router
import logging

logger = logging.getLogger(__name__)

async def retrieve(paper_id: str, query_text: str, top_k: int = 8) -> list[dict]:
    """Embed query → find most relevant chunks from this paper."""
    q_vec = await embed_query(query_text)
    chunks = await vector_query(q_vec, paper_id=paper_id, top_k=top_k)
    logger.info(f"Retrieved {len(chunks)} chunks for '{query_text[:50]}'")
    return chunks

def build_context(chunks: list[dict]) -> str:
    """Join chunks into readable context block."""
    parts = []
    for i, chunk in enumerate(chunks):
        page = chunk["metadata"].get("chunk_index", i)
        parts.append(f"[Excerpt {i+1} | Chunk {page}]\n{chunk['text']}")
    return "\n\n---\n\n".join(parts)

async def stream(prompt: str) -> AsyncIterator[str]:
    """Stream generation from current model router."""
    router = get_router()
    async for token in router.generate(prompt, stream=True):
        yield token
```

---

### Prompt Templates (create all 5 files exactly as written)

#### `templates/prompts/beginner.txt`
```
You are a science communicator explaining cutting-edge AI research to a curious person with no machine learning background. Make complex ideas genuinely understandable — not dumbed down, just clearly explained.

Paper: {TITLE}
Authors: {AUTHORS}
Year: {YEAR}

You MUST use EXACTLY these 5 section headers. Do not add, remove, rename, or reorder them:

## 🧩 What Problem Does This Solve?
Explain the real-world problem. Use a relatable analogy. No jargon.

## 💡 The Big Idea
The core innovation in plain English. What did the authors figure out that nobody had before?

## 🔬 How It Actually Works
Step-by-step walkthrough using numbered steps. Avoid heavy math notation.

## 📊 Results & What They Mean
What did experiments show? Why should a non-expert care?

## 🚀 Why This Matters
Real-world implications. What becomes possible now?

{USER_QUESTIONS_BLOCK}

Length: {LENGTH_INSTRUCTION}

STRICT RULE: Produce all 5 sections. Do not skip or merge any. Headers must appear exactly as written.

Paper context:
{CONTEXT}
```

#### `templates/prompts/mathematical.txt`
```
You are a mathematician and ML researcher reviewing this paper for an audience of graduate students comfortable with advanced mathematics.

Paper: {TITLE}
Authors: {AUTHORS}
Year: {YEAR}

You MUST use EXACTLY these 5 section headers. Do not add, remove, rename, or reorder them:

## 📐 Problem Formulation
State the problem formally. Define variables, spaces, objectives. Use precise notation.

## 🔣 Core Mathematical Framework
Key equations, loss functions, optimization objectives. Show the most important formulas.

## 📎 Key Theorems & Proofs
Main theoretical results. Are proofs rigorous? Key lemmas and assumptions?

## 🧪 Experimental Validation
Benchmark analysis. Ablations. Statistical significance. What do numbers actually show?

## ⚠️ Limitations & Open Problems
What assumptions does the math rely on? What open theoretical questions remain?

{USER_QUESTIONS_BLOCK}

Length: {LENGTH_INSTRUCTION}

STRICT RULE: Produce all 5 sections. Do not skip or merge any. Headers must appear exactly as written.

Paper context:
{CONTEXT}
```

#### `templates/prompts/technical.txt`
```
You are a senior ML engineer doing a technical review of this paper. Audience: engineers who will implement or build on this work.

Paper: {TITLE}
Authors: {AUTHORS}
Year: {YEAR}

You MUST use EXACTLY these 5 section headers. Do not add, remove, rename, or reorder them:

## 🎯 Motivation & Prior Work
What gap does this fill? Key differentiator from closest prior work?

## ⚙️ Technical Approach
Architecture, algorithm, method in precise detail. Data flow, component interactions, design decisions.

## 🛠️ Implementation Details
Training setup, hyperparameters, compute requirements, preprocessing, engineering tricks.

## 📈 Experimental Setup & Results
Benchmarks, baselines, metrics. What do numbers show? Reproducibility?

## 🔍 Critical Analysis
Weaknesses, missing ablations, failure modes, scalability concerns. What you'd do differently.

{USER_QUESTIONS_BLOCK}

Length: {LENGTH_INSTRUCTION}

STRICT RULE: Produce all 5 sections. Do not skip or merge any. Headers must appear exactly as written.

Paper context:
{CONTEXT}
```

#### `templates/prompts/intuitive.txt`
```
You are a deep thinker who builds intuition for AI/ML ideas — making them feel obvious in hindsight, not just explained.

Paper: {TITLE}
Authors: {AUTHORS}
Year: {YEAR}

You MUST use EXACTLY these 5 section headers. Do not add, remove, rename, or reorder them:

## 💎 The Core Insight
The single most important idea. If you had to say it in one sentence, what would it be?

## 🧠 Mental Model
What mental model should the reader build? What existing concept does this extend or challenge?

## 🌊 What Changes With This
How does this shift the way we think about the problem?

## 🔭 Real-World Analogy
A concrete analogy from outside ML/AI that captures the essence of the contribution.

## ❓ Open Questions
What does this make you wonder? Most interesting follow-up experiment?

{USER_QUESTIONS_BLOCK}

Length: {LENGTH_INSTRUCTION}

STRICT RULE: Produce all 5 sections. Do not skip or merge any. Headers must appear exactly as written.

Paper context:
{CONTEXT}
```

#### `templates/prompts/qa.txt`
```
You are an expert AI researcher and teacher helping someone deeply understand a research paper.

Paper: {TITLE}
Authors: {AUTHORS}

Using the context excerpts from the paper below, answer the user's question in as much detail as needed.

Rules:
- If the question involves mathematics, explain every step of every formula clearly.
- If the question is about a specific section or method, focus your answer there.
- If the context doesn't have enough information to answer fully, say so clearly — do not hallucinate.
- Keep your answer grounded in the paper. Do not add information from outside the paper unless clearly labeled as general knowledge.

Previous conversation:
{HISTORY}

User question: {QUESTION}

Paper context:
{CONTEXT}

Answer in as much detail as the question requires. If math is involved, show your work.
```

---

### `core/summarize_agent.py`

```python
import json
from pathlib import Path
from typing import AsyncIterator
from core.rag_agent import retrieve, build_context, stream

PROMPTS_DIR = Path("templates/prompts")
STRUCTURE = {
    "length": {
        "short":  "1-2 sentences per section. Total: 150-250 words. Be extremely concise.",
        "medium": "2-3 sentences per section. Total: 350-500 words. Clear and informative.",
        "long":   "3-5 sentences per section. Total: 600-900 words. Be thorough."
    }
}

_templates: dict[str, str] = {}

def load_templates():
    for mode in ["beginner", "mathematical", "technical", "intuitive"]:
        path = PROMPTS_DIR / f"{mode}.txt"
        if not path.exists():
            raise FileNotFoundError(f"Missing prompt template: {path}")
        _templates[mode] = path.read_text(encoding="utf-8")

def _get_template(mode: str) -> str:
    if not _templates:
        load_templates()
    return _templates[mode]

def build_prompt(
    mode: str,
    context: str,
    title: str,
    authors: list[str],
    year: int,
    length: str,
    user_questions: str = ""
) -> str:
    template = _get_template(mode)
    length_instruction = STRUCTURE["length"][length]
    user_block = ""
    if user_questions.strip():
        user_block = f"\n## Additional User Questions\n{user_questions.strip()}\nAddress these within the relevant sections.\n"
    return template.format(
        TITLE=title,
        AUTHORS=", ".join(authors),
        YEAR=year,
        CONTEXT=context,
        LENGTH_INSTRUCTION=length_instruction,
        USER_QUESTIONS_BLOCK=user_block
    )

async def summarize(
    paper_id: str,
    mode: str,
    length: str,
    user_questions: str,
    metadata: dict
) -> AsyncIterator[str]:
    query_text = user_questions.strip() or metadata.get("title", paper_id)
    chunks = await retrieve(paper_id, query_text, top_k=8)
    context = build_context(chunks)
    prompt = build_prompt(
        mode=mode, context=context,
        title=metadata.get("title", "Unknown"),
        authors=metadata.get("authors", []),
        year=metadata.get("year", 0),
        length=length, user_questions=user_questions
    )
    async for token in stream(prompt):
        yield token
```

---

### `core/qa_agent.py`

```python
from pathlib import Path
from typing import AsyncIterator
from core.rag_agent import retrieve, build_context, stream

QA_TEMPLATE_PATH = Path("templates/prompts/qa.txt")
_qa_template: str = ""

def load_qa_template():
    global _qa_template
    if not QA_TEMPLATE_PATH.exists():
        raise FileNotFoundError(f"Missing QA template: {QA_TEMPLATE_PATH}")
    _qa_template = QA_TEMPLATE_PATH.read_text(encoding="utf-8")

def _format_history(history: list[dict]) -> str:
    if not history:
        return "No previous conversation."
    lines = []
    for turn in history:
        role = "User" if turn["role"] == "user" else "Assistant"
        lines.append(f"{role}: {turn['content']}")
    return "\n".join(lines)

async def answer(
    paper_id: str,
    question: str,
    history: list[dict],
    metadata: dict
) -> AsyncIterator[str]:
    global _qa_template
    if not _qa_template:
        load_qa_template()

    # Use question as retrieval query — finds the most relevant paper sections
    chunks = await retrieve(paper_id, question, top_k=8)
    context = build_context(chunks)
    history_str = _format_history(history)

    prompt = _qa_template.format(
        TITLE=metadata.get("title", "Unknown"),
        AUTHORS=", ".join(metadata.get("authors", [])),
        QUESTION=question,
        CONTEXT=context,
        HISTORY=history_str
    )

    async for token in stream(prompt):
        yield token
```

---

### `core/upload_agent.py`

```python
import uuid
import json
import logging
import fitz
import re
from pathlib import Path
from config import get_config
from core import pdf_agent, embed_agent, vector_agent

logger = logging.getLogger(__name__)

def save_pdf(content: bytes, filename: str) -> tuple[str, Path]:
    config = get_config()
    paper_id = str(uuid.uuid4())
    dest = Path(config.UPLOAD_DIR) / "local" / f"{paper_id}.pdf"
    dest.write_bytes(content)
    return paper_id, dest

def extract_meta(pdf_path: Path, filename: str) -> tuple[str, list[str], int]:
    try:
        doc = fitz.open(str(pdf_path))
        page_count = len(doc)
        meta = doc.metadata
        doc.close()
        title = (meta.get("title") or "").strip()
        authors_raw = (meta.get("author") or "").strip()
        if not title:
            title = re.sub(r'[-_]', ' ', filename.replace(".pdf", "")).title()
        authors = []
        if authors_raw:
            authors = [a.strip() for a in re.split(r'[;,]', authors_raw) if a.strip()]
        return title, authors, page_count
    except Exception:
        return filename.replace(".pdf", ""), [], 0

def save_meta(paper_id: str, title: str, authors: list[str]):
    config = get_config()
    path = Path(config.UPLOAD_DIR) / "local" / f"{paper_id}.json"
    path.write_text(json.dumps({"title": title, "authors": authors}))

def load_meta(paper_id: str) -> dict:
    config = get_config()
    path = Path(config.UPLOAD_DIR) / "local" / f"{paper_id}.json"
    if path.exists():
        return json.loads(path.read_text())
    return {}

async def embed_in_background(paper_id: str, pdf_path: Path, title: str, authors: list[str]):
    try:
        config = get_config()
        text = pdf_agent.extract_text(pdf_path)
        chunks = pdf_agent.chunk(text, config.MAX_CHUNK_SIZE, config.CHUNK_OVERLAP)
        if not chunks:
            logger.error(f"No text extracted from {paper_id}")
            return
        embeddings = await embed_agent.embed_chunks(chunks)
        await vector_agent.store(
            paper_id, chunks, embeddings,
            {"title": title, "authors": json.dumps(authors), "source": "local", "year": 0}
        )
        save_meta(paper_id, title, authors)
        logger.info(f"Embedded uploaded paper {paper_id}: {title}")
    except Exception as e:
        logger.error(f"Upload embedding failed for {paper_id}: {e}", exc_info=True)
```

---

### `api/routes/search.py`

```python
from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel
from core import search_agent, pdf_agent, embed_agent, vector_agent
import logging

router = APIRouter(prefix="/api/search", tags=["search"])
logger = logging.getLogger(__name__)

class PrefetchRequest(BaseModel):
    arxiv_id: str

@router.get("/suggest")
async def suggest(q: str, limit: int = 5):
    if len(q.strip()) < 2:
        return {"papers": [], "query": q, "total": 0}
    papers = await search_agent.search(q, max_results=limit)
    from core.vector_agent import exists
    result = []
    for p in papers:
        cached = await exists(p.id)
        result.append({
            "id": p.id, "title": p.title,
            "authors": p.authors, "year": p.year,
            "abstract": p.abstract, "arxiv_url": p.arxiv_url,
            "pdf_url": p.pdf_url, "cached": cached
        })
    return {"papers": result, "query": q, "total": len(result)}

@router.post("/prefetch", status_code=202)
async def prefetch(req: PrefetchRequest, background: BackgroundTasks):
    already_cached = await vector_agent.exists(req.arxiv_id)
    if already_cached:
        return {"status": "already_cached", "arxiv_id": req.arxiv_id}
    background.add_task(_embed_paper, req.arxiv_id)
    return {"status": "queued", "arxiv_id": req.arxiv_id}

async def _embed_paper(arxiv_id: str):
    try:
        meta = await search_agent.get_paper_meta(arxiv_id)
        if not meta:
            logger.error(f"No metadata found for {arxiv_id}")
            return
        chunks = await pdf_agent.process(arxiv_id, meta.pdf_url)
        embeddings = await embed_agent.embed_chunks(chunks)
        import json
        await vector_agent.store(
            arxiv_id, chunks, embeddings,
            {"title": meta.title, "authors": json.dumps(meta.authors),
             "source": "arxiv", "year": meta.year}
        )
        logger.info(f"Prefetch complete for {arxiv_id}")
    except Exception as e:
        logger.error(f"Prefetch failed for {arxiv_id}: {e}", exc_info=True)

@router.get("/paper/{arxiv_id}")
async def get_paper(arxiv_id: str):
    meta = await search_agent.get_paper_meta(arxiv_id)
    if not meta:
        from fastapi import HTTPException
        raise HTTPException(404, {"error": "Paper not found", "code": "NOT_FOUND"})
    cached = await vector_agent.exists(arxiv_id)
    return {**meta.__dict__, "cached": cached}
```

---

### `api/routes/summarize.py`

```python
import json
import time
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Literal
from core import summarize_agent, vector_agent, search_agent

router = APIRouter(prefix="/api/summarize", tags=["summarize"])

class SummarizeRequest(BaseModel):
    paper_id: str
    mode: Literal["beginner", "mathematical", "technical", "intuitive"]
    length: Literal["short", "medium", "long"]
    user_questions: str = ""

@router.post("/stream")
async def summarize_stream(req: SummarizeRequest):
    if not await vector_agent.exists(req.paper_id):
        raise HTTPException(425, {"error": "Paper not ready. Wait for prefetch.", "code": "NOT_READY"})

    meta = await _get_meta(req.paper_id)

    async def event_stream():
        yield f"data: {json.dumps({'type': 'start', 'paper_id': req.paper_id, 'mode': req.mode})}\n\n"
        try:
            async for token in summarize_agent.summarize(
                req.paper_id, req.mode, req.length, req.user_questions, meta
            ):
                yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )

async def _get_meta(paper_id: str) -> dict:
    import re
    is_local = bool(re.match(r'^[0-9a-f-]{36}$', paper_id))
    if is_local:
        from core.upload_agent import load_meta
        return load_meta(paper_id)
    meta = await search_agent.get_paper_meta(paper_id)
    if meta:
        return {"title": meta.title, "authors": meta.authors, "year": meta.year}
    return {"title": paper_id, "authors": [], "year": 0}
```

---

### `api/routes/qa.py`

```python
import json
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from core import qa_agent, vector_agent
from api.routes.summarize import _get_meta

router = APIRouter(prefix="/api/qa", tags=["qa"])

class QARequest(BaseModel):
    paper_id: str
    question: str
    history: list[dict] = []   # [{"role": "user"|"assistant", "content": "..."}]

@router.post("/stream")
async def qa_stream(req: QARequest):
    if not req.question.strip():
        raise HTTPException(400, {"error": "Question cannot be empty", "code": "EMPTY_QUESTION"})
    if not await vector_agent.exists(req.paper_id):
        raise HTTPException(425, {"error": "Paper not ready", "code": "NOT_READY"})

    meta = await _get_meta(req.paper_id)

    async def event_stream():
        yield f"data: {json.dumps({'type': 'start', 'question': req.question})}\n\n"
        full_answer = []
        try:
            async for token in qa_agent.answer(req.paper_id, req.question, req.history, meta):
                full_answer.append(token)
                yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'full_answer': ''.join(full_answer)})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )
```

---

### `api/routes/upload.py`

```python
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from core import upload_agent, vector_agent
from pathlib import Path
from config import get_config

router = APIRouter(prefix="/api/upload", tags=["upload"])
MAX_SIZE = 50 * 1024 * 1024  # 50MB

@router.post("/pdf")
async def upload_pdf(background: BackgroundTasks, file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, {"error": "Must be a PDF", "code": "INVALID_TYPE"})
    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(413, {"error": "Max 50MB", "code": "TOO_LARGE"})
    if len(content) < 1000:
        raise HTTPException(400, {"error": "File too small", "code": "TOO_SMALL"})

    paper_id, pdf_path = upload_agent.save_pdf(content, file.filename)
    title, authors, page_count = upload_agent.extract_meta(pdf_path, file.filename)
    background.add_task(upload_agent.embed_in_background, paper_id, pdf_path, title, authors)

    return {
        "paper_id": paper_id, "title": title,
        "authors": authors, "page_count": page_count,
        "status": "processing",
        "message": "Embedding in background. Ready in ~30 seconds."
    }

@router.get("/list")
async def list_uploads():
    config = get_config()
    upload_dir = Path(config.UPLOAD_DIR) / "local"
    if not upload_dir.exists():
        return {"papers": []}
    papers = []
    for pdf in upload_dir.glob("*.pdf"):
        paper_id = pdf.stem
        meta = upload_agent.load_meta(paper_id)
        cached = await vector_agent.exists(paper_id)
        papers.append({
            "paper_id": paper_id,
            "title": meta.get("title", pdf.name),
            "authors": meta.get("authors", []),
            "uploaded_at": pdf.stat().st_mtime,
            "ready": cached
        })
    return {"papers": sorted(papers, key=lambda x: x["uploaded_at"], reverse=True)}

@router.delete("/{paper_id}")
async def delete_upload(paper_id: str):
    await vector_agent.delete(paper_id)
    config = get_config()
    upload_dir = Path(config.UPLOAD_DIR) / "local"
    for ext in [".pdf", ".json"]:
        f = upload_dir / f"{paper_id}{ext}"
        if f.exists():
            f.unlink()
    return {"deleted": True, "paper_id": paper_id}
```

---

### `api/routes/config_routes.py`

```python
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Literal
from core.model_router import get_router

router = APIRouter(prefix="/api/config", tags=["config"])

class ModelConfigRequest(BaseModel):
    provider: Literal["ollama", "openai", "anthropic", "gemini"]
    model: str
    api_key: str = ""

@router.get("")
async def get_config():
    return get_router().status()

@router.post("/model")
async def update_model(req: ModelConfigRequest):
    get_router().update(req.provider, req.model, req.api_key)
    return {"updated": True, "provider": req.provider, "model": req.model}

@router.get("/available-models")
async def available_models():
    return get_router().available_models()
```

---

### `api/routes/health.py`

```python
from fastapi import APIRouter
from core.model_router import get_router
from core.vector_agent import get_stats

router = APIRouter(prefix="/api/health", tags=["health"])

@router.get("")
async def health():
    router_inst = get_router()
    ollama_ok = await router_inst.check_ollama()
    stats = await get_stats()
    return {
        "status": "ok",
        "ollama_connected": ollama_ok,
        "model": router_inst.status(),
        "vector_db": stats,
        "version": "2.0.0"
    }
```

---

### `main.py`

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import get_config
from core.search_agent import init_title_cache
from core.summarize_agent import load_templates
from core.qa_agent import load_qa_template

from api.routes import search, summarize, qa, upload, config_routes, health

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    cfg = get_config()           # creates data dirs
    init_title_cache()           # creates SQLite DB
    load_templates()             # validates all 4 prompt files exist
    load_qa_template()           # validates QA prompt file exists
    print(f"Axiom ready on http://localhost:{cfg.PORT}")
    yield
    # Shutdown (nothing needed)

app = FastAPI(
    title="Axiom API",
    description="AI Research Paper Summarizer & Q&A",
    version="2.0.0",
    lifespan=lifespan
)

config = get_config()
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router)
app.include_router(summarize.router)
app.include_router(qa.router)
app.include_router(upload.router)
app.include_router(config_routes.router)
app.include_router(health.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=config.PORT, reload=True)
```

---

### `requirements.txt`

```
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
python-multipart>=0.0.9
sse-starlette>=2.1.0
pydantic>=2.0.0
pydantic-settings>=2.0.0
python-dotenv>=1.0.0
httpx>=0.27.0
pymupdf>=1.24.0
chromadb>=0.5.0
sentence-transformers>=3.0.0
ollama>=0.2.0
rapidfuzz>=3.9.0
openai>=1.30.0
anthropic>=0.28.0
google-generativeai>=0.7.0
pytest>=8.0.0
pytest-asyncio>=0.23.0
```

---

### `.env.example`

```
LLM_PROVIDER=ollama
LLM_MODEL=llama3.2
API_KEY=
OLLAMA_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text
CHROMA_PERSIST_DIR=./data/chroma_db
UPLOAD_DIR=./data/uploads
TITLE_CACHE_DB=./data/title_cache.db
MAX_CHUNK_SIZE=512
CHUNK_OVERLAP=64
MAX_SEARCH_RESULTS=10
PORT=8000
CORS_ORIGINS=*
```

---

## 7. Non-Negotiable Rules

1. **Full paper always** — never embed only the abstract. Always download and process the complete PDF.
2. **Permanent cache** — once a paper is embedded in ChromaDB, never re-download or re-embed it.
3. **Prefetch is non-blocking** — always `BackgroundTask`, always returns HTTP 202 immediately.
4. **If paper not ready** — return HTTP 425 with `{"error": "Paper not ready", "code": "NOT_READY"}`. Never block.
5. **ChromaDB must persist to disk** — `PersistentClient`, never in-memory.
6. **All external HTTP calls are async** — `httpx.AsyncClient` only, never `requests`.
7. **SSE flushes per token** — never buffer full response.
8. **Prompt templates are files** — loaded from `templates/prompts/`, never inline strings in Python.
9. **`config.py` is the only `.env` reader** — no other file reads env vars directly.
10. **No logic in `main.py`** — routers and middleware only.
11. **All errors return structured JSON** — `{"error": "...", "code": "ERROR_CODE"}`.
12. **CORS fully open** — `allow_origins=["*"]` for local dev.

---

## 8. How to Run

```bash
# Prerequisites
# Python 3.11+
# Ollama running: ollama serve
# Models: ollama pull llama3.2 && ollama pull nomic-embed-text

git clone <repo> && cd axiom
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python main.py

# Swagger UI: http://localhost:8000/docs
```

---

## 9. Quick Smoke Test (run after build)

```bash
# 1. Health check
curl http://localhost:8000/api/health

# 2. Search for a paper
curl "http://localhost:8000/api/search/suggest?q=attention+is+all+you+need&limit=3"

# 3. Prefetch (triggers background download + embed)
curl -X POST http://localhost:8000/api/search/prefetch \
  -H "Content-Type: application/json" \
  -d '{"arxiv_id": "1706.03762"}'

# 4. Wait ~30-60 seconds for embedding, then summarize (streaming)
curl -X POST http://localhost:8000/api/summarize/stream \
  -H "Content-Type: application/json" \
  -N \
  -d '{"paper_id": "1706.03762", "mode": "beginner", "length": "short", "user_questions": ""}'

# 5. Ask a question
curl -X POST http://localhost:8000/api/qa/stream \
  -H "Content-Type: application/json" \
  -N \
  -d '{"paper_id": "1706.03762", "question": "explain the scaled dot-product attention formula", "history": []}'
```

All 5 tests must pass before the build is considered complete.
