
import time
import requests
import streamlit as st
import xml.etree.ElementTree as ET
from langchain_chroma import Chroma
from langchain_ollama import ChatOllama
from langchain_ollama import OllamaEmbeddings
from langchain_core.documents import Document
from langchain_core.prompts import load_prompt

@st.cache_data(ttl=86400)
def fetch_arxiv_papers():
    all_papers = {}
    for start in range(0, 500, 100):
        time.sleep(3)
        url = "https://export.arxiv.org/api/query"
        params = {
            "search_query": "cat:cs.AI OR cat:cs.LG OR cat:cs.CL",
            "sortBy": "submittedDate",
            "sortOrder": "descending",
            "max_results": 100,
            "start": start
        }
        response = requests.get(url, params=params)
        if response.status_code != 200:
            break
        root = ET.fromstring(response.content)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        for entry in root.findall("atom:entry", ns):
            title = entry.find("atom:title", ns).text.strip().replace("\n", " ")
            abstract = entry.find("atom:summary", ns).text.strip().replace("\n", " ")
            all_papers[title] = abstract
    return all_papers

def build_vector_store(papers=None):
    import os
    import json
    from datetime import datetime, timedelta

    date_file = "./axiom_db/last_updated.json"

    if os.path.exists("./axiom_db") and os.listdir("./axiom_db"):
        if os.path.exists(date_file):
            with open(date_file) as f:
                data = json.load(f)
            last_updated = datetime.fromisoformat(data["date"])
            if datetime.now() - last_updated < timedelta(hours=24):
                return Chroma(
                    persist_directory="./axiom_db",
                    embedding_function=embeddings
                )

    docs = []
    for title, abstract in papers.items():
        docs.append(Document(
            page_content=abstract,
            metadata={"title": title}
        ))

    vector_store = Chroma.from_documents(
        documents=docs,
        embedding=embeddings,
        persist_directory="./axiom_db"
    )

    os.makedirs("./axiom_db", exist_ok=True)
    with open(date_file, "w") as f:
        json.dump({"date": datetime.now().isoformat()}, f)

    return vector_store

def search_papers(query, vector_store, k=10):
    results = vector_store.similarity_search(query, k=k)
    papers = {}
    for doc in results:
        title = doc.metadata["title"]
        abstract = doc.page_content
        papers[title] = abstract
    return papers

st.set_page_config(page_title="AI Paper Summarizer...", layout="wide")

# 1. Model Setup
model = ChatOllama(
    model = "gpt-oss:20b",
    temperature = 0.1
)
embeddings = OllamaEmbeddings(model="nomic-embed-text")

# 2. Updated CSS — premium dark theme with indigo accents
st.markdown("""
    <style>
    /* ── Base ─────────────────────────────────────── */
    [data-testid="stHeader"] {
        background-color: transparent !important;
    }
    .block-container {
        padding-top: 1rem !important;
        margin-top: -3rem !important;
    }
    .stApp {
        background-color: #000000;
    }

    /* ── Sidebar ──────────────────────────────────── */
    [data-testid="stSidebar"] {
        background-color: #0A0A0A !important;
    }
    [data-testid="stSidebar"] > div:first-child {
        background-color: #0A0A0A !important;
        padding-top: 1.5rem !important;
    }

    /* ── Typography ───────────────────────────────── */
    .stMarkdown, p, h1, h2, h3, h4, li, span, label {
        color: #FFFFFF !important;
    }

    /* ── Sidebar branding ─────────────────────────── */
    .axiom-brand {
        font-size: 1.6rem;
        font-weight: 700;
        letter-spacing: -0.03em;
        color: #FFFFFF;
        padding: 0 0 0.15rem 0;
        margin: 0;
    }
    .axiom-tagline {
        font-size: 0.78rem;
        color: #666666;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        margin: 0 0 0.6rem 0;
    };
    .axiom-divider {
        border: none;
        height: 1px;
        background: linear-gradient(90deg, #4F46E5 0%, #1A1A1A 100%);
        margin: 0.5rem 0 1rem 0;
    }

    /* ── Section headers ──────────────────────────── */
    .sidebar-section-header {
        font-size: 0.68rem;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #4F46E5 !important;
        margin: 1.2rem 0 0.6rem 0;
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .sidebar-section-header::after {
        content: "";
        flex: 1;
        height: 1px;
        background: #1F1F1F;
    }

    /* ── Paper count badge ────────────────────────── */
    .paper-count {
        font-size: 0.72rem;
        color: #555555;
        background: #111111;
        border: 1px solid #1F1F1F;
        border-radius: 6px;
        padding: 4px 10px;
        display: inline-block;
        margin: 0.25rem 0 0.5rem 0;
    }

    /* ── Inputs ───────────────────────────────────── */
    .stSelectbox div[data-baseweb="select"] > div,
    .stTextArea textarea,
    .stTextInput input {
        background-color: #111111 !important;
        color: #FFFFFF !important;
        border: 1px solid #1F1F1F !important;
        border-radius: 8px !important;
        transition: border-color 0.2s ease;
    }
    .stSelectbox div[data-baseweb="select"] > div:focus-within,
    .stTextArea textarea:focus,
    .stTextInput input:focus {
        border-color: #4F46E5 !important;
        box-shadow: 0 0 0 1px rgba(79,70,229,0.25) !important;
    }

    /* ── Default buttons ──────────────────────────── */
    .stButton button {
        background-color: #111111 !important;
        color: #FFFFFF !important;
        border: 1px solid #1F1F1F !important;
        border-radius: 8px !important;
        transition: all 0.2s ease;
    }
    .stButton button:hover {
        border-color: #4F46E5 !important;
        background-color: #161616 !important;
    }

    /* ── Primary / Summarize button ───────────────── */
    .stButton button[kind="primary"],
    div[data-testid="stSidebar"] .summarize-btn button {
        background: linear-gradient(135deg, #4F46E5 0%, #6366F1 100%) !important;
        color: #FFFFFF !important;
        border: none !important;
        border-radius: 8px !important;
        font-weight: 600 !important;
        letter-spacing: 0.02em;
        padding: 0.55rem 1rem !important;
        transition: all 0.25s ease;
        box-shadow: 0 2px 12px rgba(79,70,229,0.25);
    }
    .stButton button[kind="primary"]:hover,
    div[data-testid="stSidebar"] .summarize-btn button:hover {
        background: linear-gradient(135deg, #4338CA 0%, #4F46E5 100%) !important;
        box-shadow: 0 4px 20px rgba(79,70,229,0.4);
        transform: translateY(-1px);
    }

    /* ── Search loading indicator ─────────────────── */
    .search-loading {
        font-size: 0.75rem;
        color: #4F46E5;
        padding: 0.25rem 0;
        animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
        0%, 100% { opacity: 0.5; }
        50% { opacity: 1; }
    }

    /* ── Result Card ──────────────────────────────── */
    .result-card {
        background-color: #111111;
        padding: 20px;
        border-radius: 12px;
        border: 1px solid #1F1F1F;
    }
    </style>
    """, unsafe_allow_html=True)

# 3. Sidebar Configuration

# ── Search callback (runs on every keystroke change) ──
def _on_search_change():
    query = st.session_state.get("search_query", "").strip()
    if len(query) >= 3:
        st.session_state.papers = search_papers(
            query, st.session_state.vector_store
        )
    elif not query:
        st.session_state.papers = {}

with st.sidebar:
    # ── Brand ──
    st.markdown('<p class="axiom-brand">Axiom 🗞️🧠</p>', unsafe_allow_html=True)
    st.markdown('<p class="axiom-tagline">AI Research Paper Summarizer</p>', unsafe_allow_html=True)
    st.markdown('<hr class="axiom-divider">', unsafe_allow_html=True)

    # ── Bootstrap vector store ──
    if "vector_store" not in st.session_state:
        with st.spinner("Loading paper index…"):
            raw_papers = fetch_arxiv_papers()
            st.session_state.vector_store = build_vector_store(raw_papers)

    if "papers" not in st.session_state:
        st.session_state.papers = {}

    # ── Paper count indicator ──
    try:
        total_papers = st.session_state.vector_store._collection.count()
    except Exception:
        total_papers = 500
    st.markdown(
        f'<span class="paper-count">📚 {total_papers:,} papers indexed</span>',
        unsafe_allow_html=True,
    )

    # ══════════════════════════════════════════════
    # Section 1 — Find a Paper
    # ══════════════════════════════════════════════
    st.markdown(
        '<div class="sidebar-section-header">Find a Paper</div>',
        unsafe_allow_html=True,
    )

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

    # ══════════════════════════════════════════════
    # Section 2 — Customize Output
    # ══════════════════════════════════════════════
    st.markdown(
        '<div class="sidebar-section-header">Customize Output</div>',
        unsafe_allow_html=True,
    )

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

# 4. Main content Area
st.header("Research Summary")

if summarize_button:
    if not paper_input or not style_input or not length_input:
        st.warning("⚠️ Please select all options in the sidebar.")
    else:
        try:
            # Loading prompt from JSON
            template = load_prompt("template1.json")
            chain = template | model 
            
            focus_val = focus_input if focus_input.strip() else "No specific focus."

            with st.spinner("Now analyzing... 🧠✨"):
                result = chain.invoke({
                    "paper_input": f"{paper_input}\n\nAbstract: {papers[paper_input]}",
                    "style_input": style_input,
                    "length_input": length_input,
                    "focus_input": focus_val
                })
                
                # Math rendering cleanup
                final_text = result.content
                final_text = final_text.replace(r"\[", "$$").replace(r"\]", "$$")
                final_text = final_text.replace(r"\(", "$").replace(r"\)", "$")
                
                # Custom Result Container
                st.markdown(
                    f'<div class="result-card">\n\n### Results: {paper_input}\n\n{final_text}\n\n</div>', 
                    unsafe_allow_html=True
                )
                    
        except Exception as e:
            st.error(f"Error: {e}")
else:
    st.markdown("Select parameters on the left and click Summarize.")