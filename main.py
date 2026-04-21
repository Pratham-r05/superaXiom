from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import get_config
from axiom.core.search_agent import init_title_cache
from axiom.core.summarize_agent import load_templates
from axiom.core.qa_agent import load_qa_template

from axiom.api.routes import search, summarize, qa, upload, config_routes, health

@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = get_config()
    init_title_cache()
    load_templates()
    load_qa_template()
    print(f"Axiom ready on http://localhost:{cfg.PORT}")
    yield

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
