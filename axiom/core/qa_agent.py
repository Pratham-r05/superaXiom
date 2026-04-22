from pathlib import Path
from typing import AsyncIterator
from axiom.core.rag_agent import retrieve, build_context, stream

QA_TEMPLATE_PATH = Path(__file__).parent.parent / "templates" / "prompts" / "qa.txt"
_qa_template: str = ""

def load_qa_template():
    global _qa_template
    if not QA_TEMPLATE_PATH.exists():
        raise FileNotFoundError(f"Missing QA template: {QA_TEMPLATE_PATH}")
    _qa_template = QA_TEMPLATE_PATH.read_text(encoding="utf-8")

def _format_history(history: list[dict]) -> str:
    if not history:
        return "No previous conversation."
    lines = []
    for turn in history:
        role = "User" if turn["role"] == "user" else "Assistant"
        lines.append(f"{role}: {turn['content']}")
    return "\n".join(lines)

async def answer(
    paper_id: str,
    question: str,
    history: list[dict],
    metadata: dict
) -> AsyncIterator[str]:
    global _qa_template
    if not _qa_template:
        load_qa_template()
    chunks = await retrieve(paper_id, question, top_k=8)
    context = build_context(chunks)
    history_str = _format_history(history)
    prompt = _qa_template.format(
        TITLE=metadata.get("title", "Unknown"),
        AUTHORS=", ".join(metadata.get("authors", [])),
        QUESTION=question,
        CONTEXT=context,
        HISTORY=history_str
    )
    async for token in stream(prompt):
        yield token
