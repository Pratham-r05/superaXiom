import json
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from axiom.core import qa_agent, vector_agent
from axiom.api.routes.summarize import _get_meta

router = APIRouter(prefix="/api/qa", tags=["qa"])

class QARequest(BaseModel):
    paper_id: str
    question: str
    history: list[dict] = []

@router.post("/stream")
async def qa_stream(req: QARequest):
    if not req.question.strip():
        raise HTTPException(400, {"error": "Question cannot be empty", "code": "EMPTY_QUESTION"})
    if not await vector_agent.is_ready(req.paper_id):
        raise HTTPException(425, {"error": "Paper not ready", "code": "NOT_READY"})
    meta = await _get_meta(req.paper_id)

    async def event_stream():
        yield f"data: {json.dumps({'type': 'start', 'question': req.question})}\n\n"
        full_answer = []
        try:
            async for token in qa_agent.answer(req.paper_id, req.question, req.history, meta):
                full_answer.append(token)
                yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'full_answer': ''.join(full_answer)})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )
