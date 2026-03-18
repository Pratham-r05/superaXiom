from langchain_ollama import ChatOllama
import streamlit as st
from langchain_core.prompts import load_prompt

# ADD THIS LINE RIGHT HERE:
st.set_page_config(page_title="AI Paper Summarizer...", layout="wide")

# 1. Model Setup
model = ChatOllama(
    model = "gpt-oss:20b",
    temperature = 0.1
)

# 2. Updated CSS to fix the top gap and styling
# 2. Updated CSS to fix the top gap and styling
# 2. Updated CSS to fix the top gap and styling
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
    
    paper_input = st.selectbox("Select Research Paper", [
        "Attention Is All You Need",
        "BERT: Pre-Training of Deep Bidirectional Transformers",
        "GPT-3: Language Models are Few-Shot Learners",
        "Diffusion Models Beat GANs on Image Synthesis",
        "ResNet: Deep Residual Learning for Image Recognition",
        "LoRA: Low-Rank Adaptation of Large Language Models"
    ], index=None, placeholder="Type to search...")

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
                    "paper_input": paper_input,
                    "style_input": style_input,
                    "length_input": length_input,
                    "focus_input": focus_val
                })
                
                # Math rendering cleanup
                final_text = result.content
                final_text = final_text.replace(r"\[", "$$").replace(r"\]", "$$")
                final_text = final_text.replace(r"\(", "$").replace(r"\)", "$")
                
                # Custom Result Container
                # Custom Result Container (FIXED)
                st.markdown(
                    f'<div class="result-card">\n\n### Results: {paper_input}\n\n{final_text}\n\n</div>', 
                    unsafe_allow_html=True
                )
                    
        except Exception as e:
            st.error(f"Error: {e}")
else:
    st.markdown("Select parameters on the left and click Summarize.")