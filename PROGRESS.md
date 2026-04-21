# AXIOM — Progress Tracker
> Updated: 2026-04-21 | Session: Frontend Wiring + Bug Fixes + OpenRouter + Q&A

---

## Phase 0 — Codebase Audit ✅ COMPLETE

**Audit Notes:**
- Main file: `main.py` (FastAPI), old `axiom.py`/`app.py` deleted
- Existing modules: All rebuilt from scratch per "Axiom AI Research Paper.md" spec
- Working correctly: Search (SS+arXiv fallback), RAG pipeline, SSE streaming, Q&A
- Needs fixing: Semantic Scholar rate limiting (429) — retry logic added, arXiv fallback works
- Missing entirely: Nothing — all spec requirements implemented
- Existing prompt templates: 5 `.txt` files in `axiom/templates/prompts/`
- Vector DB status: ChromaDB persistent, 50+ chunks stored

---

## Phase 1 — Bug Fixes ✅ ALL COMPLETE

### Bug 1 — Search Suggestions ✅ FIXED
- [x] Implemented `core/search_agent.py` with Semantic Scholar (primary) + arXiv fallback
- [x] Added retry logic with exponential backoff (4s, 8s, 12s) for SS rate limits
- [x] SQLite title cache with fuzzy matching (rapidfuzz)
- [x] Relevance filtering — removes unrelated papers from results
- [x] Ranking: exact phrase > title matches > abstract matches > recency
- [x] Test: "turboquant" returns 2 relevant papers, no noise

### Bug 2 — Latency ✅ FIXED
- [x] `vector_agent.exists()` cache check before re-embedding
- [x] Background prefetch on paper selection (`POST /api/search/prefetch`)
- [x] Prefetch returns HTTP 202 immediately
- [x] Chunking: 512 tokens, 64 overlap (word-based: 384 words, 48 overlap)
- [x] Embedding: batch embed via Ollama nomic-embed-text
- [x] Test: TurboQuant paper cached, 50 chunks stored, hot path < 2s

### Bug 3 — No Cloud Model Support ✅ FIXED
- [x] Created `core/model_router.py` with unified interface
- [x] Ollama path (local, default)
- [x] OpenAI path (AsyncOpenAI SDK)
- [x] Anthropic path (AsyncAnthropic SDK)
- [x] Gemini path (google-generativeai SDK)
- [x] OpenRouter path (AsyncOpenAI SDK with base_url override)
- [x] `POST /api/config/model` — live swap with no restart
- [x] `GET /api/config/available-models` — lists models per provider
- [x] Custom model name support — type any exact model ID, used as-is

### Bug 4 — Summary Structure ✅ FIXED
- [x] Created 4 prompt templates as `.txt` files (beginner, mathematical, technical, intuitive)
- [x] Each template has exactly 5 mandatory section headers
- [x] `summary_structure.json` with length instructions
- [x] `core/summarize_agent.py` loads templates at startup
- [x] Validation: app fails to start if any template missing
- [x] Test: All 4 modes produce correct 5-section output

### Bug 5 — Replace Streamlit with FastAPI ✅ FIXED
- [x] Created `main.py` with FastAPI app, CORS, lifespan
- [x] `api/routes/summarize.py` with SSE streaming (`/api/summarize/stream`)
- [x] `api/routes/qa.py` with SSE streaming (`/api/qa/stream`)
- [x] `api/routes/search.py` with suggest, prefetch, paper endpoints
- [x] `api/routes/upload.py` with PDF upload, list, delete
- [x] `api/routes/config_routes.py` with model switching
- [x] `api/routes/health.py` with Ollama + vector DB status
- [x] Added `/api/summarize/view` — dark-mode Summary Viewer UI
- [x] Test: All endpoints return 200, SSE streaming works

### Bug 6 — Refactor Monolithic Structure ✅ FIXED
- [x] Target directory structure matches spec exactly
- [x] All core logic in `axiom/core/` modules (9 agent files)
- [x] All route files thin — only call core functions
- [x] `config.py` is the only file that reads `.env`
- [x] No circular imports
- [x] All modules have `__init__.py`
- [x] Old Streamlit files deleted

---

## Phase 2 — Frontend Integration ✅ COMPLETE

### Frontend — Static SPA (superaXiom.html + app.jsx)
- [x] Removed AuthPage (login/signup) — no backend auth endpoints exist
- [x] Removed Plans page — replaced with TechStack page
- [x] Created TechStack component — 6 layer cards with prose in `Instrument Serif`
- [x] Updated pill nav — removed login/signup buttons, plans → techstack

### Frontend — API Wiring
- [x] `QueryPage` — real search API with debounce, paper selection, prefetch + poll
- [x] `Loading` — real backend progress polling, SSE streaming
- [x] `Analysis` — parses streamed SSE markdown into sections, paper metadata
- [x] `Settings` — fetches from `/api/config` + `/api/config/available-models`, saves via `POST /api/config/model`
- [x] PDF upload — calls `POST /api/upload/pdf`
- [x] All API helpers: `apiSearch`, `apiPrefetch`, `apiPaperMeta`, `apiHealth`, `apiConfig`, `apiUpdateConfig`, `apiAvailableModels`, `streamSSE`, `pollUntilReady`

### Frontend — Math Rendering
- [x] `renderInline()` — handles `$...$` inline math, `\(...\)`, `**bold**`, `` `code` ``, `*italic*`
- [x] `renderMarkdown()` — handles `$$...$$` and `\[...\]` block formulas, `###` headers, bullet/numbered lists, paragraph splitting
- [x] Literal `\n` → real newlines, `\t` → spaces
- [x] Block formulas render as `.formula` div with monospace styling
- [x] Inline formulas render as styled `<code>` with border + background

### Frontend — TOC Click-to-Scroll
- [x] Clicking TOC entries now `scrollIntoView({ behavior: 'smooth', block: 'start' })`
- [x] Added `scroll-behavior: smooth` on `html`
- [x] Added `scroll-margin-top: 140px` on `.article [id]`

### Frontend — Q&A Panel (Inline)
- [x] "Open Q&A ↓" button on Analysis page expands inline panel
- [x] Real SSE streaming to `POST /api/qa/stream`
- [x] Multi-turn conversation — maintains `qaHistory` state
- [x] Close button collapses the panel
- [x] Enter key submits question
- [x] Streaming answers appear token-by-token

### Frontend — Settings: OpenRouter + Custom Model
- [x] Added `openrouter` as provider (5th, after Ollama)
- [x] `model_router.py` — `_openrouter()` method using OpenAI SDK with `base_url="https://openrouter.ai/api/v1"`
- [x] `config_routes.py` — accepts `"openrouter"` as provider
- [x] `available_models` — 8 popular OpenRouter model slugs
- [x] Custom model name input — "or type exact model name ↴" toggle
- [x] Free-text input with provider-specific placeholders
- [x] "← back to list" button to return to chip selection
- [x] Custom models passed as-is to backend (no validation against list)

### Frontend — Bug Fixes
- [x] Fixed blank page — removed orphaned duplicate TechStack code block that broke Babel transpilation (brace mismatch)
- [x] Fixed `\n` rendering — model output converts literal `\n` strings to newlines
- [x] Fixed math rendering — proper `$...$`, `$$...$$`, `\(...\)`, `\[...\]` handling
- [x] Export MD button in TOC — copies raw markdown text to clipboard

---

## Phase 3 — Tests ⏳ PENDING

- [ ] `tests/test_search.py` — mock arXiv API, verify fuzzy matching + ranking
- [ ] `tests/test_rag.py` — embed sample chunk, store, retrieve, verify similarity > 0.8
- [ ] `tests/test_summarize.py` — mock model output, verify prompt has correct section headers
- [ ] `tests/test_qa.py` — verify conversation history works
- [ ] All tests pass: `pytest tests/ -v`

---

## Phase 4 — Next Steps ⏳ PENDING

1. **End-to-end testing** — Full flow: search → prefetch → summarize → view → Q&A
2. **Web Augmentation** — Semantic Scholar citations injection (Phase 2 Improvement 3)
3. **Performance** — batch embedding, connection pooling
4. **Error handling** — user-friendly error messages on frontend
5. **Rate limiting** — protect against API abuse
6. **Deploy** — local first, deploy later

---

## Known Issues / Blockers

1. **Semantic Scholar rate limiting (429)**: Free API has strict rate limits. Retry logic with exponential backoff added. arXiv fallback works. Frontend debounces search calls.
2. **Google TurboQuant paper not on arXiv**: Can be uploaded via `POST /api/upload/pdf`.

---

## Session Log

### Session 1 (2026-04-21): Full Rebuild
- Deleted old Streamlit files
- Created clean directory structure
- Implemented 9 core agents, 5 prompt templates, 6 API route files, config
- Tested all 12 endpoints — all passing

### Session 2 (2026-04-21): Frontend Wiring
- Removed auth/plans from frontend
- Created TechStack component with prose
- Wired all screens to real backend APIs
- Created all API helper functions
- File: `frontend/app.jsx` (major rewrite), `frontend/superaXiom.html` (nav updates)

### Session 3 (2026-04-21): Bug Fixes + Features
- Fixed blank page (orphaned duplicate code block breaking Babel)
- Rewrote `renderMarkdown` + `renderInline` for proper math/LaTeX rendering
- Fixed TOC click-to-scroll with `scrollIntoView` + `scroll-margin-top`
- Added inline Q&A panel on Analysis page with SSE streaming
- Added OpenRouter provider to backend + frontend
- Added custom model name input (type any exact model ID)
- Added provider-specific placeholders and OpenRouter key hint

**Current state:**
- Server: `http://localhost:8000` (uvicorn --reload)
- Frontend: `http://localhost:3000/superaXiom.html` (python http.server)
- All 12 API endpoints working
- 5 providers supported: Ollama, OpenRouter, OpenAI, Anthropic, Gemini
- Custom model names accepted via Settings
- Q&A streaming functional inline on Analysis page