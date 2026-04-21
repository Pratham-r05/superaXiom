# Axiom — Step-by-Step Execution Plan

## Environment Setup ✅ COMPLETE

```bash
conda create -n axiom python=3.11 -y
conda activate axiom
pip install fastapi uvicorn[standard] httpx chromadb pymupdf rapidfuzz sse-starlette python-dotenv pydantic pydantic-settings openai anthropic google-generativeai ollama pytest pytest-asyncio python-multipart
```

---

## Phase 1 — Full Rebuild ✅ COMPLETE

| Aspect | Old | New |
|--------|-----|-----|
| **Search** | arXiv API only | Semantic Scholar (primary) + arXiv fallback |
| **Core modules** | 6 monolithic agents | 9 clean agents in `axiom/core/` |
| **Q&A** | Not present | Full conversational endpoint with history |
| **Upload** | Not present | PDF upload, list, delete endpoints |
| **Config** | No live switching | Runtime provider/model swap, no restart |
| **Providers** | Ollama only | Ollama, OpenAI, Anthropic, Gemini, OpenRouter |
| **Custom models** | Not supported | Type any exact model ID, used as-is |
| **Health** | Basic | Includes vector DB stats |

### Files Created (All ✅)

**Config & Setup:**
- `config.py` — Pydantic settings with directory creation
- `.env.example` — Template env file
- `requirements.txt` — All dependencies
- `.gitignore` — Proper exclusions

**Core Agents (`axiom/core/`):**
- `search_agent.py` — Semantic Scholar + arXiv fallback + SQLite fuzzy cache
- `pdf_agent.py` — Download + extract + chunk (PyMuPDF)
- `embed_agent.py` — Ollama embeddings + sentence-transformers fallback
- `vector_agent.py` — ChromaDB persistent store
- `model_router.py` — Ollama/OpenAI/Anthropic/Gemini/OpenRouter unified interface
- `rag_agent.py` — Retrieve → build context → stream
- `summarize_agent.py` — Load templates, build prompt, orchestrate RAG
- `qa_agent.py` — Q&A with conversation history
- `upload_agent.py` — PDF upload processing

**Prompt Templates (`axiom/templates/prompts/`):**
- `beginner.txt` — 5 sections, science communicator tone
- `mathematical.txt` — 5 sections, formal math notation
- `technical.txt` — 5 sections, engineering review tone
- `intuitive.txt` — 5 sections, mental model builder
- `qa.txt` — Q&A with history support

**API Routes (`axiom/api/routes/`):**
- `search.py` — `/api/search/suggest`, `/prefetch`, `/paper/{id}`
- `summarize.py` — `/api/summarize/stream` (SSE)
- `qa.py` — `/api/qa/stream` (SSE with history)
- `upload.py` — `/api/upload/pdf`, `/list`, `/{id}` DELETE
- `config_routes.py` — `/api/config`, `/model`, `/available-models`
- `health.py` — `/api/health` with Ollama + vector DB status

**Entry Point:**
- `main.py` — FastAPI app with lifespan, CORS, all routers

**Frontend (`frontend/`):**
- `superaXiom.html` — Single-page HTML with editorial CSS, tweaks panel
- `app.jsx` — React SPA wired to all 12 backend endpoints

---

## Phase 2 — Frontend Integration ✅ COMPLETE

### API Contract

| Frontend Action | Backend Endpoint | Method | Response |
|-----------------|------------------|--------|----------|
| Search papers | `/api/search/suggest?q={query}&limit=5` | GET | `{papers: [...], query, total}` |
| Get paper info | `/api/search/paper/{arxiv_id}` | GET | `{id, title, authors, year, abstract, cached}` |
| Prefetch paper | `/api/search/prefetch` | POST | `{status: "queued", arxiv_id}` |
| Summarize (stream) | `/api/summarize/stream` | POST | SSE: `start → token* → done/error` |
| Q&A (stream) | `/api/qa/stream` | POST | SSE: `start → token* → done/error` |
| Upload PDF | `/api/upload/pdf` | POST (multipart) | `{paper_id, title, status: "processing"}` |
| List uploads | `/api/upload/list` | GET | `{papers: [...]}` |
| Delete upload | `/api/upload/{paper_id}` | DELETE | `{deleted: true}` |
| Get config | `/api/config` | GET | `{provider, model, has_api_key}` |
| Update config | `/api/config/model` | POST | `{updated: true}` |
| Available models | `/api/config/available-models` | GET | `{ollama: [...], openrouter: [...], ...}` |
| Health check | `/api/health` | GET | `{status, ollama_connected, model, vector_db, version}` |

### Frontend Screens (All Wired ✅)

| Screen | Status | Details |
|--------|--------|---------|
| Landing | ✅ | Static editorial page, hero, cards, modes |
| Query | ✅ | Real search with debounce, prefetch, paper selection |
| Loading | ✅ | Real backend progress, SSE streaming |
| Analysis | ✅ | Parsed sections, math rendering, TOC scroll, inline Q&A |
| TechStack | ✅ | 6 layer prose cards, open source CTA |
| About | ✅ | Maker bio, principles, manifesto |
| Settings | ✅ | 5 providers, custom model name input, live config preview |

### Math Rendering (✅)

| Syntax | Render | Example |
|--------|--------|---------|
| `$...$` | Inline formula (styled code) | `$x^2$` → monospace bordered pill |
| `$$...$$` | Block formula (`.formula` div) | `$$E = mc^2$$` → centered block |
| `\(...\)` | Inline formula | `\(x^2\)` → monospace bordered pill |
| `\[...\]` | Block formula | `\[E = mc^2\]` → centered block |
| `**bold**` | `<strong>` | **bold** |
| `` `code` `` | `<code>` inline | code background |
| `*italic*` | `<em>` | italic |
| `\n` (literal) | Real newline | Converted to `\n` → line break |
| `\t` (literal) | Spaces | Converted to two spaces |

### Q&A Panel (✅)

- Inline panel on Analysis page (no navigation away)
- "Open Q&A ↓" expands panel, "Close ×" collapses
- SSE streaming to `POST /api/qa/stream`
- Multi-turn conversation history maintained
- Enter key submits, streaming token-by-token rendering

### Settings — Provider Support (✅)

| Provider | needsKey | Models | Custom Name |
|----------|----------|--------|-------------|
| Ollama | No | 7 built-in | ✅ any model ID |
| OpenRouter | Yes | 8 built-in + any custom | ✅ e.g. `microsoft/phi-4` |
| OpenAI | Yes | 3 built-in + any custom | ✅ |
| Anthropic | Yes | 2 built-in + any custom | ✅ |
| Gemini | Yes | 3 built-in + any custom | ✅ |

Custom model name: Click "or type exact model name ↴" → free-text input → saved as-is to backend.

---

## Phase 3 — Remaining Work ⏳ PENDING

### 3.1 — End-to-End Testing
- [ ] Search → select paper → prefetch → summarize → view all 4 modes
- [ ] Settings: switch provider, verify model swap persists
- [ ] Settings: type custom model name, verify it's used
- [ ] Q&A: multi-turn conversation on a summarized paper
- [ ] PDF upload: upload a PDF, verify it appears in search
- [ ] Math rendering: verify mathematical mode renders `$`, `$$`, `\n` correctly

### 3.2 — Web Augmentation (Phase 2 Improvement 3)
- [ ] Only enabled when `LLM_PROVIDER != "ollama"` AND `use_web_augmentation: true`
- [ ] Fetch citations from Semantic Scholar API
- [ ] Fetch abstracts of top 3 most cited references
- [ ] Inject as `## Related Work Context` section in prompt

### 3.3 — Tests
- [ ] `tests/test_search.py` — mock arXiv API, verify fuzzy matching + ranking
- [ ] `tests/test_rag.py` — embed sample chunk, store, retrieve, verify similarity > 0.8
- [ ] `tests/test_summarize.py` — mock model output, verify prompt has correct section headers
- [ ] `tests/test_qa.py` — verify conversation history works
- [ ] All tests pass: `pytest tests/ -v`

### 3.4 — Polish
- [ ] Error handling — user-friendly error messages on frontend
- [ ] Rate limiting — protect against API abuse
- [ ] Performance — batch embedding, connection pooling
- [ ] Deploy — local first, deploy later

---

## How to Run

```bash
# Prerequisites
# - Python 3.11+ (conda env: axiom)
# - Ollama running: ollama serve
# - Models pulled: ollama pull gpt-oss:20b && ollama pull nomic-embed-text

conda activate axiom
uvicorn main:app --reload --port 8000

# Frontend (in another terminal)
cd frontend && python3 -m http.server 3000

# Open in browser
open http://localhost:3000/superaXiom.html

# Swagger UI
open http://localhost:8000/docs
```