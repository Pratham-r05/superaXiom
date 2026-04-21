
import streamlit as st
import os, sys
from dotenv import load_dotenv

# Load .env file from project root
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# Ensure src/ is on the import path so `from axiom ...` resolves
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from langchain_core.prompts import load_prompt
from langchain_core.documents import Document
from datetime import datetime, timedelta

# ── Axiom sub-modules ──────────────────────────────────────
from axiom.fetcher import fetch_arxiv_papers
from axiom.paper import fetch_full_paper
from axiom.retriever import build_temp_store, retrieve_context
from axiom.embeddings import get_embeddings
from axiom.models import get_llm


# ── Model/Embedding bootstrap (read from .env or env vars) ─
BACKEND = os.getenv("AXIOM_BACKEND", "ollama").lower()
MODEL_NAME = os.getenv("AXIOM_MODEL") or None
API_KEY = os.getenv("AXIOM_API_KEY") or None
TEMPERATURE = float(os.getenv("AXIOM_TEMPERATURE", "0.1"))

# Embedding: fallback to main API key if not explicitly set
EMBED_BACKEND = os.getenv("AXIOM_EMBED_BACKEND", BACKEND).lower()
EMBED_MODEL = os.getenv("AXIOM_EMBED_MODEL") or None
EMBED_API_KEY = os.getenv("AXIOM_EMBED_API_KEY") or API_KEY

# ── Instantiate providers ──────────────────────────────────
model = get_llm(
    backend=BACKEND,
    model=MODEL_NAME,
    api_key=API_KEY,
    temperature=TEMPERATURE,
)
embeddings = get_embeddings(
    backend=EMBED_BACKEND,
    model=EMBED_MODEL,
    api_key=EMBED_API_KEY,
)
# ───────────────────────────────────────────────────────────

# ── Vector-store helper (now passes embeddings explicitly) ─
def _build_store(papers=None, embeddings=None):
    """Build/load the main Chroma paper index."""
    from langchain_chroma import Chroma
    from pathlib import Path

    db_dir = Path(__file__).parent / "axiom_db"
    db_dir.mkdir(exist_ok=True)
    date_file = db_dir / "last_updated.json"

    if any(db_dir.iterdir()):
        if date_file.exists():
            import json
            with open(date_file) as f:
                data = json.load(f)
            last_updated = datetime.fromisoformat(data["date"])
            if datetime.now() - last_updated < timedelta(hours=24):
                return Chroma(persist_directory=str(db_dir), embedding_function=embeddings)

    docs = []
    for title, data in papers.items():
        docs.append(Document(
            page_content=data["abstract"],
            metadata={"title": title, "arxiv_id": data["arxiv_id"]},
        ))

    vs = Chroma.from_documents(documents=docs, embedding=embeddings, persist_directory=str(db_dir))
    with open(date_file, "w") as f:
        import json
        json.dump({"date": datetime.now().isoformat()}, f)
    return vs

# ── Search callback ────────────────────────────────────────
def search_papers(query, vector_store, k=10):
    results = vector_store.similarity_search(query, k=k)
    papers = {}
    for doc in results:
        title = doc.metadata["title"]
        papers[title] = {
            "abstract": doc.page_content,
            "arxiv_id": doc.metadata.get("arxiv_id", ""),
        }
    return papers


def _on_search_change():
    query = st.session_state.get("search_query", "").strip()
    if len(query) >= 3:
        st.session_state.papers = search_papers(
            query, st.session_state.vector_store
        )
    elif not query:
        st.session_state.papers = {}


# ── Streamlit page config ──────────────────────────────────
st.set_page_config(page_title="AI Paper Summarizer...", layout="wide")

# ── CSS ────────────────────────────────────────────────────
st.markdown("""
    <style>
    [data-testid="stHeader"] { background-color: transparent !important; }
    .block-container { padding-top: 1rem !important; margin-top: -1rem !important; }
    .stApp { background-color: #000000; }
    html, body, [data-testid="stAppViewContainer"], [data-testid="stMain"], .main {
        background-color: #000000 !important;
    }
    [data-testid="stSidebar"] { background-color: #0A0A0A !important; }
    [data-testid="stSidebar"] > div:first-child { background-color: #0A0A0A !important; padding-top: 1.5rem !important; }
    .stMarkdown, p, h1, h2, h3, h4, li, span, label { color: #FFFFFF !important; }
    .axiom-brand { font-size: 1.6rem; font-weight: 700; letter-spacing: -0.03em; color: #FFFFFF; padding: 0 0 0.15rem 0; margin: 0; }
    .axiom-tagline { font-size: 0.78rem; color: #666666; letter-spacing: 0.04em; text-transform: uppercase; margin: 0 0 0.6rem 0; }
    .axiom-divider { border: none; height: 1px; background: linear-gradient(90deg, #4F46E5 0%, #1A1A1A 100%); margin: 0.5rem 0 1rem 0; }
    .sidebar-section-header { font-size: 0.68rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #4F46E5 !important; margin: 1.2rem 0 0.6rem 0; display: flex; align-items: center; gap: 6px; }
    .sidebar-section-header::after { content: ""; flex: 1; height: 1px; background: #1F1F1F; }
    .paper-count { font-size: 0.72rem; color: #555555; background: #111111; border: 1px solid #1F1F1F; border-radius: 6px; padding: 4px 10px; display: inline-block; margin: 0.25rem 0 0.5rem 0; }
    .stSelectbox div[data-baseweb="select"] > div,
    .stTextArea textarea, .stTextInput input {
        background-color: #111111 !important; color: #FFFFFF !important; border: 1px solid #1F1F1F !important; border-radius: 8px !important; transition: border-color 0.2s ease;
    }
    .stSelectbox div[data-baseweb="select"] > div:focus-within,
    .stTextArea textarea:focus, .stTextInput input:focus {
        border-color: #4F46E5 !important; box-shadow: 0 0 0 1px rgba(79,70,229,0.25) !important;
    }
    .stButton button { background-color: #111111 !important; color: #FFFFFF !important; border: 1px solid #1F1F1F !important; border-radius: 8px !important; transition: all 0.2s ease; }
    .stButton button:hover { border-color: #4F46E5 !important; background-color: #161616 !important; }
    .stButton button[kind="primary"],
    div[data-testid="stSidebar"] .summarize-btn button {
        background: linear-gradient(135deg, #4F46E5 0%, #6366F1 100%) !important; color: #FFFFFF !important; border: none !important; border-radius: 8px !important; font-weight: 600 !important; letter-spacing: 0.02em; padding: 0.55rem 1rem !important; transition: all 0.25s ease; box-shadow: 0 2px 12px rgba(79,70,229,0.25);
    }
    .stButton button[kind="primary"]:hover,
    div[data-testid="stSidebar"] .summarize-btn button:hover {
        background: linear-gradient(135deg, #4338CA 0%, #4F46E5 100%) !important; box-shadow: 0 4px 20px rgba(79,70,229,0.4); transform: translateY(-1px);
    }
    .search-loading { font-size: 0.75rem; color: #4F46E5; padding: 0.25rem 0; animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
    .result-card { background-color: #111111; padding: 20px; border-radius: 12px; border: 1px solid #1F1F1F; }
    </style>
    """, unsafe_allow_html=True)

# ── Sidebar ───────────────────────────────────────────────
with st.sidebar:
    st.markdown('<p class="axiom-brand">Axiom 🗞️🧠</p>', unsafe_allow_html=True)
    st.markdown('<p class="axiom-tagline">AI Research Paper Summarizer</p>', unsafe_allow_html=True)
    st.markdown('<hr class="axiom-divider">', unsafe_allow_html=True)

    if "vector_store" not in st.session_state:
        with st.spinner("Loading paper index…"):
            raw_papers = fetch_arxiv_papers()
            # ── Use the env-configured embedding provider ──────────────────
            st.session_state.vector_store = _build_store(raw_papers, embeddings=embeddings)

    if "papers" not in st.session_state:
        st.session_state.papers = {}

    # Paper count
    try:
        total_papers = st.session_state.vector_store._collection.count()
    except Exception:
        total_papers = 500
    st.markdown(
        f'<span class="paper-count">📚 {total_papers:,} papers indexed</span>',
        unsafe_allow_html=True,
    )

    # ── Find a Paper ──────────────────────────────────────
    st.markdown('<div class="sidebar-section-header">Find a Paper</div>', unsafe_allow_html=True)

    search_query = st.text_input(
        "Search Papers",
        placeholder="e.g. LoRA, diffusion models, RLHF…",
        key="search_query",
        on_change=_on_search_change,
        label_visibility="collapsed",
    )

    papers = st.session_state.papers

    paper_input = st.selectbox(
        "Select Research Paper",
        list(papers.keys()),
        index=None,
        placeholder="Pick from results…" if papers else "Search above first…",
        label_visibility="collapsed",
    )

    if paper_input and (
        "current_paper" not in st.session_state or
        st.session_state.current_paper != paper_input
    ):
        st.session_state.current_paper = paper_input
        arxiv_id = papers[paper_input]["arxiv_id"]
        with st.spinner("📄 Loading full paper..."):
            full_text = fetch_full_paper(arxiv_id)
            st.session_state.temp_store = build_temp_store(full_text, embeddings=embeddings)

    # ── Customize Output ─────────────────────────────────
    st.markdown('<div class="sidebar-section-header">Customize Output</div>', unsafe_allow_html=True)

    style_input = st.selectbox(
        "Output Style",
        ["Beginner-Friendly", "Technical", "Code-Oriented", "Mathematical"],
        index=None,
        placeholder="Choose a style…",
    )

    length_input = st.selectbox(
        "Length",
        ["Short (1-2 paragraphs)", "Medium (3-5 paragraphs)", "Detailed (6+ paragraphs)"],
        index=None,
        placeholder="Choose length…",
    )

    focus_input = st.text_area(
        "Specific Focus (Optional)",
        placeholder="e.g. explain the math with a concrete example…",
    )

    st.markdown("<div style='margin-top:0.75rem'></div>", unsafe_allow_html=True)
    summarize_button = st.button(
        "⚡ Summarize Paper",
        use_container_width=True,
        type="primary",
    )

# ── Main content ──────────────────────────────────────────
st.header("Research Summary")

if summarize_button:
    if not paper_input or not style_input or not length_input:
        st.warning("⚠️ Please select all options in the sidebar.")
    elif "temp_store" not in st.session_state:
        st.warning("⚠️ Paper text not loaded yet. Select a paper and wait for it to load.")
    else:
        try:
            TEMPLATE_PATHS = {
                "Beginner-Friendly": os.path.join(os.path.dirname(__file__), "src", "templates", "template_beginner.json"),
                "Technical": os.path.join(os.path.dirname(__file__), "src", "templates", "template_technical.json"),
                "Code-Oriented": os.path.join(os.path.dirname(__file__), "src", "templates", "template_code.json"),
                "Mathematical": os.path.join(os.path.dirname(__file__), "src", "templates", "template_mathematical.json"),
            }

            template = load_prompt(TEMPLATE_PATHS[style_input])
            chain = template | model

            focus_val = focus_input if focus_input.strip() else "No specific focus."

            with st.spinner("Now analyzing... 🧠✨"):
                context = retrieve_context(
                    focus_val if focus_val != "No specific focus." else paper_input,
                    st.session_state.temp_store,
                )

                result = chain.invoke({
                    "paper_input": f"{paper_input}\n\nRelevant Sections:\n{context}",
                    "style_input": style_input,
                    "length_input": length_input,
                    "focus_input": focus_val,
                })

                final_text = result.content
                final_text = final_text.replace(r"\[", "$$").replace(r"\]", "$$")
                final_text = final_text.replace(r"\(", "$").replace(r"\)", "$")

                st.markdown(
                    f'<div class="result-card">\n\n### Results: {paper_input}\n\n{final_text}\n\n</div>',
                    unsafe_allow_html=True,
                )

        except Exception as e:
            st.error(f"Error: {e}")
else:
    st.markdown("Select parameters on the left and click Summarize.")