
import time
import requests
import streamlit as st
import xml.etree.ElementTree as ET
from langchain_chroma import Chroma
from langchain_ollama import ChatOllama
from langchain_ollama import OllamaEmbeddings
from langchain_core.documents import Document
from langchain_core.prompts import load_prompt

@st.cache_data(ttl=3600)
def fetch_arxiv_papers():
    time.sleep(3)
    url = "https://export.arxiv.org/api/query"
    params = {
        "search_query": "cat:cs.AI OR cat:cs.LG OR cat:cs.CL",
        "sortBy": "submittedDate",
        "sortOrder": "descending",
        "max_results": 20
    }
    response = requests.get(url, params=params)
    if response.status_code != 200:
        return {}
    root = ET.fromstring(response.content)
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    papers = {}
    for entry in root.findall("atom:entry", ns):
        title = entry.find("atom:title", ns).text.strip().replace("\n", " ")
        abstract = entry.find("atom:summary", ns).text.strip().replace("\n", " ")
        papers[title] = abstract
    return papers

def build_vector_store(papers):
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

# 2. Updated CSS to fix the top gap and styling
st.markdown("""
    <style>
    /* 1. Make the header transparent */
    [data-testid="stHeader"] {
        background-color: transparent !important;
    }
    
    /* 2. Pull the main content up */
    .block-container {
        padding-top: 1rem !important;
        margin-top: -3rem !important; 
    }
    
    /* 3. Deep Black Background for the main app */
    .stApp {
        background-color: #000000;
    }
    
    /* 4. Sleek Dark Sidebar */
    [data-testid="stSidebar"] {
        background-color: #0A0A0A !important;
    }
    [data-testid="stSidebar"] > div:first-child {
        background-color: #0A0A0A !important;
    }
    
    /* 5. Force Text to White (including sidebar labels) */
    .stMarkdown, p, h1, h2, h3, h4, li, span, label {
        color: #FFFFFF !important;
    }
    
    /* 6. Input Boxes & Button Styling */
    .stSelectbox div[data-baseweb="select"] > div,
    .stTextArea textarea,
    .stButton button {
        background-color: #1A1A1A !important;
        color: #FFFFFF !important;
        border: 1px solid #333333 !important;
    }
    
    /* 7. Result Card Styling */
    .result-card {
        background-color: #111111;
        padding: 20px;
        border-radius: 12px;
        border: 1px solid #333333;
    }
    </style>
    """, unsafe_allow_html=True)

# 3. Sidebar Configuration
with st.sidebar:
    st.title("Axiom 🗞️🧠")
    st.markdown("---")

    if "vector_store" not in st.session_state:
        raw_papers = fetch_arxiv_papers()
        st.session_state.vector_store = build_vector_store(raw_papers)

    search_query = st.text_input("Search Papers", placeholder="e.g. LoRA, diffusion models, RLHF...")
    search_button = st.button("Search")

    if search_button and search_query:
        papers = search_papers(search_query, st.session_state.vector_store)
        st.session_state.papers = papers
    elif "papers" not in st.session_state:
        st.session_state.papers = {}

    papers = st.session_state.papers

    paper_input = st.selectbox(
        "Select Research Paper",
        list(papers.keys()),
        index=None,
        placeholder="Type to search..."
    )   

    style_input = st.selectbox("Output Style", 
        ["Beginner-Friendly", "Technical", "Code-Oriented", "Mathematical"],
        index=None, placeholder="Choose a style...")

    length_input = st.selectbox("Length", 
        ["Short (1-2 paragraphs)", "Medium (3-5 paragraphs)", "Detailed (6+ paragraphs)"],
        index=None, placeholder="Choose length...")

    focus_input = st.text_area("Specific Focus (Optional)", 
                               placeholder="e.g. explain the math with a concrete example...")
    
    summarize_button = st.button("Summarize Paper", use_container_width=True)

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