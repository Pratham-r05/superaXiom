import httpx
import sqlite3
import json
import logging
import asyncio
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from config import get_config

logger = logging.getLogger(__name__)

SEMANTIC_SCHOLAR_API = "https://api.semanticscholar.org/graph/v1/paper/search"
ARXIV_API = "https://export.arxiv.org/api/query"
FIELDS = "title,authors,year,abstract,externalIds,openAccessPdf"
ARXIV_NS = {"atom": "http://www.w3.org/2005/Atom"}

@dataclass
class PaperMeta:
    id: str
    title: str
    authors: list[str]
    year: int
    abstract: str
    arxiv_url: str
    pdf_url: str
    cached: bool = False

def init_title_cache():
    config = get_config()
    con = sqlite3.connect(config.TITLE_CACHE_DB)
    con.execute("""
        CREATE TABLE IF NOT EXISTS papers (
            arxiv_id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            authors TEXT DEFAULT '[]',
            year INTEGER DEFAULT 0,
            abstract TEXT DEFAULT '',
            pdf_url TEXT DEFAULT ''
        )
    """)
    con.execute("CREATE INDEX IF NOT EXISTS idx_title ON papers(title)")
    con.commit()
    con.close()

async def search(
    query: str,
    max_results: int = 10,
    update_cache: bool = True,
    fast_mode: bool = False,
) -> list[PaperMeta]:
    # Run SS + arXiv in parallel for better coverage
    ss_task = asyncio.create_task(
        _semantic_scholar_search(query, max_results, retry_on_rate_limit=not fast_mode)
    )
    arxiv_task = asyncio.create_task(_arxiv_search(query, max_results))

    ss_result, arxiv_result = await asyncio.gather(ss_task, arxiv_task, return_exceptions=True)

    results = []
    if isinstance(ss_result, list):
        results.extend(ss_result)
        if update_cache:
            await _update_cache(ss_result)
    else:
        logger.warning(f"Semantic Scholar search failed: {ss_result}")

    if isinstance(arxiv_result, list):
        results.extend(arxiv_result)
        if update_cache:
            await _update_cache(arxiv_result)
    else:
        logger.warning(f"arXiv search failed: {arxiv_result}")

    try:
        cache_results = await _fuzzy_cache_search(query, max_results)
        results.extend(cache_results)
    except Exception as e:
        logger.warning(f"Cache search failed: {e}")

    return _rank_deduplicate(results, query)[:max_results]

async def _semantic_scholar_search(
    query: str,
    max_results: int,
    retry_on_rate_limit: bool = True,
) -> list[PaperMeta]:
    """Search Semantic Scholar with retry on rate limit (429)."""
    max_attempts = 3 if retry_on_rate_limit else 1
    for attempt in range(max_attempts):
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(SEMANTIC_SCHOLAR_API, params={
                    "query": query,
                    "limit": max_results,
                    "fields": FIELDS
                })
            if resp.status_code == 429:
                if not retry_on_rate_limit:
                    raise Exception("Semantic Scholar rate limited (429)")
                wait = (attempt + 1) * 4
                logger.warning(
                    f"SS rate limited, retrying in {wait}s (attempt {attempt+1}/{max_attempts})"
                )
                await asyncio.sleep(wait)
                continue
            resp.raise_for_status()
            data = resp.json()
            break
        except Exception as e:
            if attempt == max_attempts - 1:
                raise
            await asyncio.sleep(2)
    else:
        raise Exception(f"Semantic Scholar failed after {max_attempts} attempt(s)")
    papers = []
    for item in data.get("data", []):
        arxiv_id = item.get("externalIds", {}).get("ArXiv")
        if not arxiv_id:
            continue
        pdf_url = (item.get("openAccessPdf") or {}).get("url") or f"https://arxiv.org/pdf/{arxiv_id}.pdf"
        papers.append(PaperMeta(
            id=arxiv_id,
            title=item.get("title", ""),
            authors=[a["name"] for a in item.get("authors", [])],
            year=item.get("year") or 0,
            abstract=item.get("abstract") or "",
            arxiv_url=f"https://arxiv.org/abs/{arxiv_id}",
            pdf_url=pdf_url
        ))
    return papers

async def _arxiv_search(query: str, max_results: int) -> list[PaperMeta]:
    # Strategy 1: Exact quoted title phrase
    search_query = f"ti:\"{query}\""
    papers = await _arxiv_query(search_query, max_results)
    if papers:
        return papers
    # Strategy 2: All words in title (AND)
    words = query.split()
    if len(words) > 1:
        search_query = " AND ".join([f"ti:{w}" for w in words])
        papers = await _arxiv_query(search_query, max_results)
        if papers:
            return papers
    # Strategy 3: Broadest search
    search_query = f"ti:{query} OR abs:{query}"
    return await _arxiv_query(search_query, max_results)

async def _arxiv_query(search_query: str, max_results: int) -> list[PaperMeta]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(ARXIV_API, params={
            "search_query": search_query,
            "start": 0,
            "max_results": max_results,
            "sortBy": "relevance",
            "sortOrder": "descending"
        })
    root = ET.fromstring(resp.text)
    return _parse_arxiv_entries(root)

def _parse_arxiv_entries(root) -> list[PaperMeta]:
    papers = []
    for entry in root.findall("atom:entry", ARXIV_NS):
        title_el = entry.find("atom:title", ARXIV_NS)
        summary_el = entry.find("atom:summary", ARXIV_NS)
        id_el = entry.find("atom:id", ARXIV_NS)
        published_el = entry.find("atom:published", ARXIV_NS)
        if title_el is None or id_el is None:
            continue
        title = title_el.text.strip().replace("\n", " ")
        abstract = summary_el.text.strip().replace("\n", " ") if summary_el is not None else ""
        raw_id = id_el.text.strip()
        arxiv_id = raw_id.split("/abs/")[-1].split("v")[0]
        authors = []
        for author_el in entry.findall("atom:author", ARXIV_NS):
            name_el = author_el.find("atom:name", ARXIV_NS)
            if name_el is not None:
                authors.append(name_el.text.strip())
        year = 0
        if published_el is not None:
            try:
                year = int(published_el.text.strip()[:4])
            except (ValueError, TypeError):
                pass
        papers.append(PaperMeta(
            id=arxiv_id, title=title, authors=authors,
            abstract=abstract, year=year,
            arxiv_url=f"https://arxiv.org/abs/{arxiv_id}",
            pdf_url=f"https://arxiv.org/pdf/{arxiv_id}.pdf"
        ))
    return papers

async def _fuzzy_cache_search(query: str, limit: int) -> list[PaperMeta]:
    from rapidfuzz import process, fuzz
    config = get_config()
    con = sqlite3.connect(config.TITLE_CACHE_DB)
    rows = con.execute("SELECT arxiv_id, title, authors, year, abstract, pdf_url FROM papers").fetchall()
    con.close()
    if not rows:
        return []
    titles = [r[1] for r in rows]
    matches = process.extract(query, titles, scorer=fuzz.partial_ratio, limit=limit)
    results = []
    for match_title, score, idx in matches:
        if score < 45:
            continue
        r = rows[idx]
        results.append(PaperMeta(
            id=r[0], title=r[1],
            authors=json.loads(r[2] or "[]"),
            year=r[3], abstract=r[4],
            arxiv_url=f"https://arxiv.org/abs/{r[0]}",
            pdf_url=r[5] or f"https://arxiv.org/pdf/{r[0]}.pdf",
            cached=True
        ))
    return results

async def _update_cache(papers: list[PaperMeta]):
    config = get_config()
    con = sqlite3.connect(config.TITLE_CACHE_DB)
    for p in papers:
        con.execute("""
            INSERT OR REPLACE INTO papers (arxiv_id, title, authors, year, abstract, pdf_url)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (p.id, p.title, json.dumps(p.authors), p.year, p.abstract, p.pdf_url))
    con.commit()
    con.close()

def _rank_deduplicate(papers: list[PaperMeta], query: str) -> list[PaperMeta]:
    from rapidfuzz import fuzz
    query_lower = query.lower()
    # skip very short stop words when checking word-level matches
    query_words = {w for w in query_lower.split() if len(w) > 2}
    seen = set()
    scored = []
    for p in papers:
        if p.id in seen:
            continue
        seen.add(p.id)
        title_lower = p.title.lower()
        abstract_lower = p.abstract.lower()

        fuzzy_title = fuzz.partial_ratio(query_lower, title_lower) / 100
        fuzzy_abs = fuzz.partial_ratio(query_lower, abstract_lower) / 100
        title_matches = sum(1 for w in query_words if w in title_lower)
        abs_matches = sum(1 for w in query_words if w in abstract_lower)

        # Accept if there's any signal: word match OR decent fuzzy hit
        if title_matches == 0 and abs_matches == 0 and fuzzy_title < 0.40 and fuzzy_abs < 0.35:
            continue

        exact_phrase = 10.0 if query_lower in title_lower else 0.0
        title_score = title_matches * 3.0
        abs_score = abs_matches * 1.0
        fuzzy_score = fuzzy_title * 2.5 + fuzzy_abs * 0.5
        recency = 1.0 if (p.year or 0) >= 2024 else 0.3
        total = exact_phrase + title_score + abs_score + fuzzy_score + recency
        scored.append((p, total))

    scored.sort(key=lambda x: x[1], reverse=True)
    return [p for p, _ in scored]

async def get_paper_meta(arxiv_id: str) -> PaperMeta | None:
    config = get_config()
    con = sqlite3.connect(config.TITLE_CACHE_DB)
    row = con.execute(
        "SELECT arxiv_id, title, authors, year, abstract, pdf_url FROM papers WHERE arxiv_id=?",
        (arxiv_id,)
    ).fetchone()
    con.close()
    if row:
        return PaperMeta(
            id=row[0], title=row[1],
            authors=json.loads(row[2] or "[]"),
            year=row[3], abstract=row[4],
            arxiv_url=f"https://arxiv.org/abs/{row[0]}",
            pdf_url=row[5]
        )
    # Fallback: try Semantic Scholar first, then arXiv
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"https://api.semanticscholar.org/graph/v1/paper/arXiv:{arxiv_id}",
                params={"fields": FIELDS}
            )
            data = resp.json()
        pdf_url = (data.get("openAccessPdf") or {}).get("url") or f"https://arxiv.org/pdf/{arxiv_id}.pdf"
        paper = PaperMeta(
            id=arxiv_id,
            title=data.get("title", arxiv_id),
            authors=[a["name"] for a in data.get("authors", [])],
            year=data.get("year") or 0,
            abstract=data.get("abstract") or "",
            arxiv_url=f"https://arxiv.org/abs/{arxiv_id}",
            pdf_url=pdf_url
        )
        await _update_cache([paper])
        return paper
    except Exception:
        pass
    # arXiv fallback for single paper lookup
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(ARXIV_API, params={
                "search_query": f"id:{arxiv_id}",
                "max_results": 1
            })
        root = ET.fromstring(resp.text)
        papers = _parse_arxiv_entries(root)
        if papers:
            await _update_cache(papers)
            return papers[0]
    except Exception:
        pass
    return None
