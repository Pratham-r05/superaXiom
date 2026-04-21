import fitz
import httpx
import re
import logging
from pathlib import Path
from config import get_config

logger = logging.getLogger(__name__)

async def download(arxiv_id: str, pdf_url: str) -> Path:
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
    text = re.sub(r'(\w)-\n(\w)', r'\1\2', text)
    return text.strip()

def chunk(text: str, chunk_size: int = 512, overlap: int = 64) -> list[str]:
    words = text.split()
    word_chunk = int(chunk_size * 0.75)
    word_overlap = int(overlap * 0.75)
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
    config = get_config()
    pdf_path = await download(arxiv_id, pdf_url)
    text = extract_text(pdf_path)
    return chunk(text, config.MAX_CHUNK_SIZE, config.CHUNK_OVERLAP)
