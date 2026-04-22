# 🚀 Axiom
## *AI Research Paper Summarizer & Q&A Engine*

> **Going hyperspeed through your papers** — Local inference, zero rate limits, permanent vector storage.

<div align="center">

[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-blue?style=flat-square&logo=python)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-v0.100+-green?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com/)
[![ChromaDB](https://img.shields.io/badge/ChromaDB-Vector%20DB-orange?style=flat-square)](https://www.trychroma.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)
[![Status: Active](https://img.shields.io/badge/Status-Active-brightgreen?style=flat-square)](https://github.com/Pratham-r05/Axiom)

</div>

---

## ✨ What is Axiom?

Axiom is a **production-ready AI research paper analysis system** that combines arXiv searching, intelligent summarization, and conversational Q&A. Process papers locally with no API rate limits, store embeddings forever, and get insights in seconds.

```
     ╔══════════════════════════════════════════╗
     ║   PAPER → SEARCH → EMBED → SUMMARIZE    ║
     ║   └─────────→ Q&A ←──────────────────┘  ║
     ╚══════════════════════════════════════════╝
```

**Core strengths:**
- 🔍 **Smart Search** — Semantic Scholar + arXiv with fuzzy matching
- 📚 **Multiple Summaries** — Beginner, Mathematical, Technical, Intuitive
- 💬 **Interactive Q&A** — Ask follow-up questions about any paper
- 🏠 **Local + Cloud** — Ollama (default) or OpenAI, Anthropic, Gemini, OpenRouter
- 🗄️ **Permanent Storage** — ChromaDB vector persistence on disk
- 🎨 **Beautiful UI** — Dark-mode React SPA with live streaming

---

## 🎯 Quick Start

### Prerequisites
- **Python 3.10+**
- **Ollama** (for local LLM inference) — [Download](https://ollama.ai)
  ```bash
  ollama pull gpt-oss:20b nomic-embed-text
  ```

### Installation

```bash
# Clone the repository
git clone https://github.com/Pratham-r05/Axiom.git
cd Axiom

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env (optional — defaults to local Ollama)
cat > .env << EOF
LLM_PROVIDER=ollama
LLM_MODEL=gpt-oss:20b
EMBEDDING_MODEL=nomic-embed-text
OLLAMA_BASE_URL=http://localhost:11434
PORT=8000
EOF
```

### Running

```bash
# Start backend server (FastAPI on port 8000)
python -m uvicorn main:app --reload

# In another terminal, open the frontend
open frontend/superaXiom.html
# or navigate to http://localhost:8000/docs for API docs
```

**✅ That's it.** Paper search, summarization, and Q&A are live.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (React)                     │
│              superaXiom.html + app.jsx                   │
│    (Search • Load • Summarize • Q&A • Export)            │
└────────────────────┬────────────────────────────────────┘
                     │ HTTP + SSE
┌────────────────────▼────────────────────────────────────┐
│                   FastAPI Backend                        │
├─────────────────────────────────────────────────────────┤
│  /api/search      /api/summarize   /api/qa              │
│  /api/upload      /api/config      /api/health          │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
   ┌────▼─────┐           ┌─────▼─────┐
   │   Core   │           │   Data    │
   │  Agents  │           │  Storage  │
   ├──────────┤           ├───────────┤
   │ search   │           │ ChromaDB  │
   │ summarize│           │ (vectors) │
   │ qa       │           │           │
   │ embed    │           │ SQLite    │
   │ rag      │           │ (cache)   │
   │ pdf      │           │           │
   │ upload   │           │ File      │
   │ vector   │           │ (PDFs)    │
   └──────────┘           └───────────┘
        │
  ┌─────┴──────────────────┬──────────────┐
  │                        │              │
  ▼                        ▼              ▼
Ollama               Cloud LLMs        Semantic Scholar
(local)              (OpenAI, etc)     + arXiv
```

### Directory Structure

```
Axiom/
├── main.py                    # FastAPI app entry point
├── config.py                  # Configuration & .env handling
├── requirements.txt           # Python dependencies
│
├── axiom/
│   ├── __init__.py
│   ├── api/                   # HTTP routes & endpoints
│   │   ├── routes/
│   │   │   ├── search.py      # Search, suggest, prefetch
│   │   │   ├── summarize.py   # Streaming summaries
│   │   │   ├── qa.py          # Streaming Q&A
│   │   │   ├── upload.py      # PDF upload & management
│   │   │   ├── config_routes.py  # Model switching
│   │   │   └── health.py      # Status checks
│   │
│   ├── core/                  # Business logic & agents
│   │   ├── search_agent.py    # Semantic Scholar + arXiv
│   │   ├── pdf_agent.py       # PDF extraction & chunking
│   │   ├── embed_agent.py     # Text → vectors (Ollama)
│   │   ├── vector_agent.py    # ChromaDB operations
│   │   ├── rag_agent.py       # Retrieval augmented gen
│   │   ├── summarize_agent.py # Multi-mode summaries
│   │   ├── qa_agent.py        # Question answering
│   │   ├── upload_agent.py    # Local PDF handling
│   │   └── model_router.py    # LLM provider routing
│   │
│   ├── templates/
│   │   └── prompts/           # Prompt templates
│   │       ├── beginner.txt
│   │       ├── mathematical.txt
│   │       ├── technical.txt
│   │       └── intuitive.txt
│   │
│   └── data/
│       ├── chroma_db/         # Persistent vectors
│       └── uploads/           # User-uploaded PDFs
│
├── frontend/
│   ├── superaXiom.html        # Single-page app shell
│   ├── app.jsx                # React components
│   └── (no build step needed)
│
└── tests/
    ├── conftest.py
    ├── test_search.py
    ├── test_rag.py
    ├── test_qa.py
    └── test_summarize.py
```

---

## 📋 Features Breakdown

### 🔍 Search

**Smart paper discovery with retry logic & caching:**

```python
# Semantic Scholar (primary) + arXiv fallback
# Fuzzy title matching, relevance filtering, ranking
results = await search_agent.search("transformer attention mechanism", max_results=5)
```

- ✅ Rate-limit retry (4s, 8s, 12s backoff)
- ✅ SQLite title cache (rapid fuzzy matching)
- ✅ Semantic Scholar primary, arXiv fallback
- ✅ Relevance scoring & ranking
- ✅ Metadata: title, authors, year, abstract, PDF URL

---

### 📚 Summarization

**Four summary modes tailored to different audiences:**

| Mode | Length | Audience | Sections |
|------|--------|----------|----------|
| **Beginner** | Short | Non-experts | Problem • Big Idea • How It Works • Results • Why It Matters |
| **Mathematical** | Medium | Researchers | Problem Formulation • Framework • Theorems • Validation • Limitations |
| **Technical** | Long | Engineers | Motivation • Approach • Implementation • Setup & Results • Analysis |
| **Intuitive** | Medium | Generalists | Core Insight • Mental Model • What Changes • Analogy • Open Questions |

**Live streaming output** — words appear as they're generated:

```javascript
streamSSE('/api/summarize/stream', 
  { paper_id: 'arxiv_id', mode: 'beginner', length: 'short' },
  (token) => updateUI(token)
);
```

---

### 💬 Interactive Q&A

**Ask follow-up questions about the paper using RAG:**

```
User: "What's the attention mechanism doing?"
System: [Retrieves relevant chunks] → [Streams answer]
→ "The attention mechanism computes…"
```

- Real-time streaming
- RAG-enhanced (retrieves relevant chunks automatically)
- Multi-turn conversation support
- Context awareness (remembers the paper)

---

### 🏠 Local Inference

**Run everything on your machine with Ollama:**

```bash
# Download model once
ollama pull gpt-oss:20b

# Axiom runs inference locally, zero API calls
POST /api/summarize/stream → instant SSE stream
```

**Or connect to cloud LLMs:**

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4
```

Supported: **Ollama** (default), **OpenAI**, **Anthropic**, **Gemini**, **OpenRouter**

---

### 📁 PDF Upload

**Analyze your own PDFs alongside arXiv papers:**

```bash
POST /api/upload/pdf
Content-Type: multipart/form-data
{ file: <your_paper.pdf> }

Response: { paper_id: "uuid", title: "...", page_count: 42 }
```

- ✅ Local file storage
- ✅ Background embedding (no blocking)
- ✅ Progress tracking
- ✅ Error reporting
- ✅ Deletion support

---

### 🗄️ Persistent Vector Storage

**Vectors live on disk, forever — no re-embedding:**

```
First run:  Paper → chunks → embeddings → ChromaDB (30s)
Cached run: Paper → query → top-k chunks (< 2s)
```

ChromaDB persists in `./data/chroma_db/` — reuse across sessions.

---

## ⚙️ Configuration

### Environment Variables

Create `.env` in the project root:

```env
# LLM Configuration (default: Ollama)
LLM_PROVIDER=ollama                          # ollama, openai, anthropic, gemini, openrouter
LLM_MODEL=gpt-oss:20b                        # Model name (or any exact ID)
EMBEDDING_MODEL=nomic-embed-text             # For Ollama
OLLAMA_BASE_URL=http://localhost:11434       # Ollama endpoint

# Cloud API Keys (only if using cloud LLMs)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=...

# Storage
CHROMA_PERSIST_DIR=./data/chroma_db
UPLOAD_DIR=./data/uploads
TITLE_CACHE_DB=./data/title_cache.db

# RAG Parameters
MAX_CHUNK_SIZE=512                           # Tokens per chunk
CHUNK_OVERLAP=64                             # Overlap for context
RAG_TOP_K=8                                  # Top chunks to retrieve
MAX_SEARCH_RESULTS=10                        # Papers per search

# Server
PORT=8000
CORS_ORIGINS=["*"]                           # CORS whitelist
```

### Live Model Switching

**Change LLM providers on-the-fly without restarting:**

```bash
# Get available models
GET /api/config/available-models

# Switch model
POST /api/config/model
{ "provider": "openai", "model": "gpt-4", "api_key": "sk-..." }
```

---

## 🔌 API Documentation

### Endpoints

#### Search

```
GET /api/search/suggest?q=<query>&limit=5
  → { papers: [...], query, total }

GET /api/search/paper/<arxiv_id>
  → { title, authors, abstract, pdf_url, year, ... }

POST /api/search/prefetch
  { arxiv_id: "1706.03762" }
  → { status: "queued", arxiv_id }

GET /api/search/embed-status/<arxiv_id>
  → { status, stage, error, chunk_count, arxiv_id }
```

#### Summarization

```
POST /api/summarize/stream
  { paper_id, mode, length, user_questions? }
  → Server-Sent Events (streaming markdown)

GET /api/summarize/view
  → Interactive dark-mode summary viewer
```

#### Q&A

```
POST /api/qa/stream
  { paper_id, question, context? }
  → Server-Sent Events (streaming response)
```

#### Upload

```
POST /api/upload/pdf
  { file: <pdf> }
  → { paper_id, title, page_count, authors }

GET /api/upload/list
  → { papers: [{ paper_id, title, authors, ready, error }] }

DELETE /api/upload/<paper_id>
  → Remove from storage & vectors
```

#### Configuration

```
GET /api/config
  → { llm_provider, llm_model, embedding_model, ... }

GET /api/config/available-models
  → { ollama: [...], openai: [...], ... }

POST /api/config/model
  { provider, model, api_key? }
  → Updates configuration
```

#### Health

```
GET /api/health
  → { status: "healthy", ollama: true, vectors: true }
```

---

## 🧪 Testing

```bash
# Run all tests
pytest

# Run specific test file
pytest tests/test_rag.py -v

# Run with async support
pytest tests/ -v --asyncio-mode=auto
```

**Test coverage:**
- Search agent (fuzzy matching, ranking)
- RAG pipeline (chunking, embedding, retrieval)
- Q&A streaming
- Summarization (all 4 modes)
- PDF upload & deletion

---

## 🚀 Development

### Adding a New LLM Provider

**Edit `axiom/core/model_router.py`:**

```python
async def stream(prompt: str, model: str, provider: str):
    if provider == "your_provider":
        # Call your API, stream tokens
        async for token in your_api.stream(prompt):
            yield token
```

Then update `config.py` with API key handling.

### Adding a New Prompt Template

1. Create `axiom/templates/prompts/your_mode.txt`
2. Use exactly 5 section headers (mandatory)
3. Add to `summarize_agent.py`:
   ```python
   STRUCTURE = {
       "your_mode": { ... sections ... }
   }
   ```
4. Frontend automatically picks it up

### Debugging

```bash
# Enable debug logging
LOGLEVEL=DEBUG python -m uvicorn main:app --reload

# Check vector DB
python -c "from axiom.core.vector_agent import get_collection; print(get_collection().count())"

# Clear cache (start fresh)
rm -rf data/chroma_db data/title_cache.db
```

---

## 📊 Performance Notes

| Operation | Time | Notes |
|-----------|------|-------|
| Search | ~500ms | Semantic Scholar + cache |
| Prefetch (first run) | 30-120s | Download + embed (depends on PDF size) |
| Prefetch (cached) | <100ms | Vector lookup only |
| Summarization | 10-60s | Depends on model size & inference |
| Q&A | 5-30s | Depends on context size |

**Optimization tips:**
- Use smaller embedding model for faster prefetch
- Increase `RAG_TOP_K` if summaries miss context
- Batch embed requests if uploading multiple PDFs
- Run Ollama on GPU for 10x speedup

---

## 🎨 Frontend Features

**superaXiom.html + app.jsx**

- 🌙 Dark mode by default
- ⚡ Real-time streaming (SSE)
- 📱 Responsive design (desktop-first, mobile OK)
- 🔤 Math rendering (KaTeX for $\LaTeX$)
- 📄 PDF export (ZUPP button)
- 🎯 Paper management (search, upload, delete)
- 💾 Local draft persistence

**No build step needed** — open HTML file directly.

---

## 🤝 Contributing

Contributions welcome! Here's how:

1. **Fork** the repo
2. **Create branch** (`git checkout -b feat/your-feature`)
3. **Commit** changes (`git commit -am "Add feature"`)
4. **Push** (`git push origin feat/your-feature`)
5. **Pull request** (describe what you did)

### Development Setup

```bash
# Install dev dependencies
pip install pytest pytest-asyncio black flake8

# Format code
black axiom/ main.py

# Lint
flake8 axiom/ main.py
```

---

## 📝 License

MIT License — see [LICENSE](LICENSE) file.

You're free to use, modify, and distribute Axiom for personal or commercial projects.

---

## 🙏 Acknowledgments

- **Semantic Scholar API** — Paper metadata & search
- **arXiv** — Open access to 2M+ papers
- **ChromaDB** — Vector persistence made easy
- **Ollama** — Local LLM inference
- **FastAPI** — Modern async Python web framework
- **React** — Beautiful, reactive UI

---

## 📞 Support & Questions

- 📖 Check [PROGRESS.md](PROGRESS.md) for detailed implementation notes
- 🐛 Found a bug? [Open an issue](https://github.com/Pratham-r05/Axiom/issues)
- 💡 Have ideas? Discussions welcome
- 🚀 Want to deploy? See [deployment guides](#deployment-guides) (coming soon)

---

## 🎯 Roadmap

- [ ] Web UI hosted (no local installation needed)
- [ ] Paper collections & tagging
- [ ] Multi-paper comparison
- [ ] Citation tracking
- [ ] Collaborative annotations
- [ ] Mobile app (iOS/Android)
- [ ] Export to Notion, Obsidian, Roam

---

<div align="center">

**Built with ❤️ for researchers who hate reading papers slowly**

*Axiom — Going hyperspeed through your research.*

[⬆ Back to top](#-axiom)

</div>
