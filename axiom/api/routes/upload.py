from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from axiom.core import upload_agent, vector_agent
from pathlib import Path
from config import get_config

router = APIRouter(prefix="/api/upload", tags=["upload"])
MAX_SIZE = 50 * 1024 * 1024

@router.post("/pdf")
async def upload_pdf(background: BackgroundTasks, file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, {"error": "Must be a PDF", "code": "INVALID_TYPE"})
    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(413, {"error": "Max 50MB", "code": "TOO_LARGE"})
    if len(content) < 1000:
        raise HTTPException(400, {"error": "File too small", "code": "TOO_SMALL"})
    paper_id, pdf_path = upload_agent.save_pdf(content, file.filename)
    title, authors, page_count = upload_agent.extract_meta(pdf_path, file.filename)
    background.add_task(upload_agent.embed_in_background, paper_id, pdf_path, title, authors)
    return {
        "paper_id": paper_id, "title": title,
        "authors": authors, "page_count": page_count,
        "status": "processing",
        "message": "Embedding in background. Ready in ~30 seconds."
    }

@router.get("/list")
async def list_uploads():
    config = get_config()
    upload_dir = Path(config.UPLOAD_DIR) / "local"
    if not upload_dir.exists():
        return {"papers": []}
    papers = []
    for pdf in upload_dir.glob("*.pdf"):
        paper_id = pdf.stem
        meta = upload_agent.load_meta(paper_id)
        cached = await vector_agent.exists(paper_id)
        papers.append({
            "paper_id": paper_id,
            "title": meta.get("title", pdf.name),
            "authors": meta.get("authors", []),
            "uploaded_at": pdf.stat().st_mtime,
            "ready": cached
        })
    return {"papers": sorted(papers, key=lambda x: x["uploaded_at"], reverse=True)}

@router.delete("/{paper_id}")
async def delete_upload(paper_id: str):
    await vector_agent.delete(paper_id)
    config = get_config()
    upload_dir = Path(config.UPLOAD_DIR) / "local"
    for ext in [".pdf", ".json"]:
        f = upload_dir / f"{paper_id}{ext}"
        if f.exists():
            f.unlink()
    return {"deleted": True, "paper_id": paper_id}
