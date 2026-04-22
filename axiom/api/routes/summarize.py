import json
import re
import time
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, HTMLResponse
from pydantic import BaseModel
from typing import Literal
from axiom.core import summarize_agent, vector_agent, search_agent

router = APIRouter(prefix="/api/summarize", tags=["summarize"])

class SummarizeRequest(BaseModel):
    paper_id: str
    mode: Literal["beginner", "mathematical", "technical", "intuitive"]
    length: Literal["short", "medium", "long"]
    user_questions: str = ""

@router.get("/view")
async def summary_viewer():
    return HTMLResponse("""
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Axiom — Summary Viewer</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0a;color:#e0e0e0;font-family:'Inter',system-ui,-apple-system,sans-serif;min-height:100vh}
.container{max-width:900px;margin:0 auto;padding:2rem 1.5rem}
h1{font-size:1.8rem;font-weight:700;color:#fff;margin-bottom:.5rem;letter-spacing:-.02em}
.subtitle{color:#666;font-size:.85rem;margin-bottom:2rem}
.form-group{margin-bottom:1.2rem}
label{display:block;font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#818cf8;margin-bottom:.4rem}
input,select,textarea{width:100%;background:#111;color:#fff;border:1px solid #1f1f1f;border-radius:8px;padding:.65rem .85rem;font-size:.9rem;font-family:inherit;transition:border-color .2s}
input:focus,select:focus,textarea:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 1px rgba(79,70,229,.25)}
textarea{resize:vertical;min-height:60px}
.row{display:flex;gap:1rem}
.row .form-group{flex:1}
button{width:100%;background:linear-gradient(135deg,#4f46e5,#6366f1);color:#fff;border:none;border-radius:8px;padding:.7rem;font-size:.95rem;font-weight:600;cursor:pointer;transition:all .2s;margin-top:.5rem}
button:hover{box-shadow:0 4px 20px rgba(79,70,229,.4);transform:translateY(-1px)}
button:disabled{opacity:.5;cursor:not-allowed;transform:none}
#output{margin-top:2rem;padding:1.5rem;background:#111;border:1px solid #1f1f1f;border-radius:12px;display:none;white-space:pre-wrap;line-height:1.7;font-size:.92rem}
#output h2{color:#818cf8;font-size:1.1rem;margin:1.2rem 0 .5rem}
#output h2:first-child{margin-top:0}
.meta{color:#555;font-size:.8rem;margin-bottom:1rem;padding-bottom:.8rem;border-bottom:1px solid #1f1f1f}
.status{color:#818cf8;font-size:.85rem;margin-top:1rem;text-align:center}
.error{color:#ef4444}
</style>
</head>
<body>
<div class="container">
<h1>🧠 Axiom Summary Viewer</h1>
<p class="subtitle">Generate structured research paper summaries with local LLMs</p>
<div class="form-group">
<label>Paper ID (arXiv)</label>
<input id="paper_id" placeholder="e.g. 1706.03762 or 2504.19874" value="2504.19874">
</div>
<div class="row">
<div class="form-group">
<label>Mode</label>
<select id="mode">
<option value="beginner">Beginner</option>
<option value="mathematical">Mathematical</option>
<option value="technical">Technical</option>
<option value="intuitive">Intuitive</option>
</select>
</div>
<div class="form-group">
<label>Length</label>
<select id="length">
<option value="short">Short</option>
<option value="medium" selected>Medium</option>
<option value="long">Long</option>
</select>
</div>
</div>
<div class="form-group">
<label>Your Question (optional)</label>
<textarea id="question" placeholder="e.g. How fast did the model become?"></textarea>
</div>
<button id="btn" onclick="generate()">⚡ Generate Summary</button>
<div id="status" class="status"></div>
<div id="output"></div>
</div>
<script>
async function generate(){
const btn=document.getElementById('btn');
const status=document.getElementById('status');
const output=document.getElementById('output');
btn.disabled=true;status.textContent='⏳ Generating summary...';status.className='status';
output.style.display='block';output.innerHTML='';
const body=JSON.stringify({
paper_id:document.getElementById('paper_id').value,
mode:document.getElementById('mode').value,
length:document.getElementById('length').value,
user_questions:document.getElementById('question').value
});
try{
const res=await fetch('/api/summarize/stream',{method:'POST',headers:{'Content-Type':'application/json'},body});
const reader=res.body.getReader();const decoder=new TextDecoder();let full='';
while(true){
const{done,value}=await reader.read();if(done)break;
const chunk=decoder.decode(value);
for(const line of chunk.split('\\n')){
if(line.startsWith('data: ')){
try{
const ev=JSON.parse(line.slice(6));
if(ev.type==='token'){full+=ev.content;output.innerHTML=render(full)}
else if(ev.type==='done'){status.textContent='✅ Done!';btn.disabled=false}
else if(ev.type==='error'){status.textContent='❌ '+ev.error;status.className='status error';btn.disabled=false}
}catch(e){}
}
}
}
}catch(e){
status.textContent='❌ '+e.message;status.className='status error';btn.disabled=false
}
}
function render(md){
return md
.replace(/^## (.+)$/gm,'<h2>$1</h2>')
.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>')
.replace(/\\n/g,'<br>');
}
</script>
</body>
</html>
""")

@router.post("/stream")
async def summarize_stream(req: SummarizeRequest):
    if not await vector_agent.exists(req.paper_id):
        raise HTTPException(425, {"error": "Paper not ready. Wait for prefetch.", "code": "NOT_READY"})
    meta = await _get_meta(req.paper_id)

    async def event_stream():
        yield f"data: {json.dumps({'type': 'start', 'paper_id': req.paper_id, 'mode': req.mode})}\n\n"
        try:
            async for token in summarize_agent.summarize(
                req.paper_id, req.mode, req.length, req.user_questions, meta
            ):
                yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )

async def _get_meta(paper_id: str) -> dict:
    is_local = bool(re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', paper_id))
    if is_local:
        from axiom.core.upload_agent import load_meta
        return load_meta(paper_id)
    meta = await search_agent.get_paper_meta(paper_id)
    if meta:
        return {"title": meta.title, "authors": meta.authors, "year": meta.year}
    return {"title": paper_id, "authors": [], "year": 0}
