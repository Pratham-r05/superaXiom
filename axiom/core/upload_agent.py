import uuid
import json
import logging
import fitz
import re
from pathlib import Path
from config import get_config
from axiom.core import pdf_agent, embed_agent, vector_agent

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

def save_error_meta(paper_id: str, error: str):
    """Write an error flag so the frontend can surface embedding failures instead of polling forever."""
    config = get_config()
    path = Path(config.UPLOAD_DIR) / "local" / f"{paper_id}.error"
    path.write_text(error)

def load_meta(paper_id: str) -> dict:
    config = get_config()
    path = Path(config.UPLOAD_DIR) / "local" / f"{paper_id}.json"
    if path.exists():
        return json.loads(path.read_text())
    return {}

async def embed_in_background(paper_id: str, pdf_path: Path, title: str, authors: list[str]):
    try:
        import asyncio
        config = get_config()
        loop = asyncio.get_running_loop()
        # Run blocking text-extraction in thread pool so we don't block the event loop
        text = await loop.run_in_executor(None, pdf_agent.extract_text, pdf_path)
        chunks = await loop.run_in_executor(
            None, pdf_agent.chunk, text, config.MAX_CHUNK_SIZE, config.CHUNK_OVERLAP
        )
        if not chunks:
            logger.error(f"No text extracted from {paper_id}")
            save_error_meta(paper_id, "No text could be extracted from the PDF.")
            return
        logger.info(f"Embedding {len(chunks)} chunks for {paper_id}…")
        embeddings = await embed_agent.embed_chunks(chunks)
        await vector_agent.store(
            paper_id, chunks, embeddings,
            {"title": title, "authors": json.dumps(authors), "source": "local", "year": 0}
        )
        save_meta(paper_id, title, authors)
        logger.info(f"Embedded uploaded paper {paper_id}: {title}")
    except Exception as e:
        logger.error(f"Upload embedding failed for {paper_id}: {e}", exc_info=True)
        save_error_meta(paper_id, str(e))
