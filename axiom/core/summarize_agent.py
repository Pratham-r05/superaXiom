import json
from pathlib import Path
from typing import AsyncIterator
from axiom.core.rag_agent import retrieve, build_context, stream

PROMPTS_DIR = Path(__file__).parent.parent / "templates" / "prompts"
STRUCTURE = {
    "length": {
        "short": (
            "Write a concise full-paper summary with all 5 required sections. "
            "Minimum 400 words, target 400-550 words. "
            "Cover all major components at a high level and explain the full paper end-to-end in clear language."
        ),
        "medium": (
            "Write an in-depth summary with all 5 required sections. "
            "Minimum 800 words, target 800-1000 words. "
            "Prioritize the most important ideas, include key technical details, and include at least one core equation or formal statement when relevant to the paper."
        ),
        "long": (
            "Write a detailed, structured deep dive with all 5 required sections. "
            "Minimum 1500 words, target 1500-1800 words. "
            "Cover every major concept, method component, result, limitation, and implication with strong structure and clarity."
        )
    }
}

_templates: dict[str, str] = {}

def load_templates():
    for mode in ["beginner", "mathematical", "technical", "intuitive"]:
        path = PROMPTS_DIR / f"{mode}.txt"
        if not path.exists():
            raise FileNotFoundError(f"Missing prompt template: {path}")
        _templates[mode] = path.read_text(encoding="utf-8")

def _get_template(mode: str) -> str:
    if not _templates:
        load_templates()
    return _templates[mode]

def build_prompt(
    mode: str,
    context: str,
    title: str,
    authors: list[str],
    year: int,
    length: str,
    user_questions: str = ""
) -> str:
    template = _get_template(mode)
    length_instruction = STRUCTURE["length"][length]
    user_block = ""
    if user_questions.strip():
        user_block = f"\n## Additional User Questions\n{user_questions.strip()}\nAddress these within the relevant sections.\n"
    return template.format(
        TITLE=title,
        AUTHORS=", ".join(authors),
        YEAR=year,
        CONTEXT=context,
        LENGTH_INSTRUCTION=length_instruction,
        USER_QUESTIONS_BLOCK=user_block
    )

async def summarize(
    paper_id: str,
    mode: str,
    length: str,
    user_questions: str,
    metadata: dict
) -> AsyncIterator[str]:
    query_text = user_questions.strip() or metadata.get("title", paper_id)
    chunks = await retrieve(paper_id, query_text, top_k=8)
    context = build_context(chunks)
    prompt = build_prompt(
        mode=mode, context=context,
        title=metadata.get("title", "Unknown"),
        authors=metadata.get("authors", []),
        year=metadata.get("year", 0),
        length=length, user_questions=user_questions
    )
    async for token in stream(prompt):
        yield token
