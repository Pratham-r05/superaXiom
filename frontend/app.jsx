const { useState, useEffect, useRef, useCallback } = React;

const API = 'http://localhost:8000';

function readStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// ============ API HELPERS ============
async function apiSearch(query, limit = 5, options = {}) {
  const r = await fetch(`${API}/api/search/suggest?q=${encodeURIComponent(query)}&limit=${limit}`, {
    signal: options.signal,
  });
  return r.json();
}

async function apiPrefetch(arxivId) {
  const r = await fetch(`${API}/api/search/prefetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ arxiv_id: arxivId }),
  });
  return r.json();
}

async function apiPaperMeta(arxivId) {
  const r = await fetch(`${API}/api/search/paper/${arxivId}`);
  return r.json();
}

async function apiHealth() {
  const r = await fetch(`${API}/api/health`);
  return r.json();
}

async function apiConfig() {
  const r = await fetch(`${API}/api/config`);
  return r.json();
}

async function apiUpdateConfig(provider, model, apiKey = null) {
  const r = await fetch(`${API}/api/config/model`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, model, api_key: apiKey }),
  });
  return r.json();
}

async function apiAvailableModels() {
  const r = await fetch(`${API}/api/config/available-models`);
  return r.json();
}

function streamSSE(url, body, onToken, onDone, onError) {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', url, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  let lastLen = 0;
  let doneCalled = false;
  let buffer = '';

  function processNewData() {
    const newText = xhr.responseText.slice(lastLen);
    lastLen = xhr.responseText.length;
    buffer += newText;
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete last line in buffer
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        if (evt.type === 'token') onToken(evt.content);
        else if (evt.type === 'done' && !doneCalled) { doneCalled = true; onDone(evt); }
        else if (evt.type === 'error' && !doneCalled) { doneCalled = true; onError(evt.error); }
      } catch {}
    }
  }

  xhr.onprogress = processNewData;
  xhr.onload = () => {
    if (xhr.status !== 200) {
      // Non-200 responses (e.g. 425 paper not ready, 422 validation) are not SSE
      try {
        const body = JSON.parse(xhr.responseText);
        const msg = body?.detail?.error || body?.detail || body?.error || `HTTP ${xhr.status}`;
        onError(String(msg));
      } catch {
        onError(`HTTP ${xhr.status}`);
      }
      return;
    }
    processNewData();
    // flush any remaining buffered line
    if (buffer.startsWith('data: ')) {
      try {
        const evt = JSON.parse(buffer.slice(6));
        if (evt.type === 'done' && !doneCalled) { doneCalled = true; onDone(evt); }
        else if (evt.type === 'error' && !doneCalled) { doneCalled = true; onError(evt.error); }
      } catch {}
    }
    if (!doneCalled) { doneCalled = true; onDone({}); }
  };
  xhr.onerror = () => onError('Network error');
  xhr.send(JSON.stringify(body));
  return xhr;
}

async function pollUntilReady(arxivId, maxAttempts = 60, intervalMs = 2000) {
  for (let i = 0; i < maxAttempts; i++) {
    const meta = await apiPaperMeta(arxivId);
    if (meta.cached) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Paper embedding timed out');
}

// ============ PILL NAV ============
function PillNav({ active, onNavigate }) {
  const items = [
    { id: 'about', label: 'About' },
    { id: 'techstack', label: 'Tech Stack' },
    { id: 'settings', label: 'Settings' },
  ];
  return (
    <nav className="pill-nav">
      <a className="pill-logo" onClick={() => onNavigate('landing')}>
        <span className="super">super</span><span className="axiom">aXiom</span>
      </a>
      <div className="pill-group">
        {items.map(it => (
          <button
            key={it.id}
            className={`pill-item ${active === it.id ? 'active' : ''}`}
            onClick={() => onNavigate(it.id)}
          >
            <span className="circle" />
            <span className="label">{it.label}</span>
          </button>
        ))}
      </div>
      <div className="pill-right">
        <button className="pill-cta" onClick={() => onNavigate('query')}>
          <span>Query</span>
          <span className="arrow">→</span>
        </button>
      </div>
    </nav>
  );
}

// ============ LANDING ============
function Landing({ onNavigate }) {
  useEffect(() => {
    if (typeof gsap !== 'undefined') {
      gsap.from('.scrap, .stamp', {
        opacity: 0, y: -20, rotate: 0, duration: 1.1, stagger: 0.08,
        ease: 'power3.out', delay: 0.3,
      });
      gsap.from('.hero h1 .line', {
        y: 120, opacity: 0, duration: 1.2, stagger: 0.12, ease: 'power4.out',
      });
    }
  }, []);

  const [recentPapers, setRecentPapers] = useState([
    { t: 'Attention Is All You Need', s: '17.06' },
    { t: 'LLaMA 3 Technical Report', s: '24.04' },
    { t: 'Chain-of-Thought Prompting', s: '22.01' },
    { t: 'Mamba: Linear-Time Sequence…', s: '23.12' },
    { t: 'Retrieval-Augmented Generation', s: '20.05' },
  ]);

  useEffect(() => {
    apiHealth().then(h => {
      if (h.vector_db && h.vector_db.total_chunks > 0) {
        // Could fetch actual recent papers from uploads
      }
    }).catch(() => {});
  }, []);

  return (
    <div className="landing" data-screen-label="01 Landing">
      <div className="landing-meta" style={{ marginTop: 60 }}>
        <span>No.07 / Vol.mmxxvi</span>
        <span>Local · Private · Offline-first</span>
        <span>Est. 2026 — New Delhi</span>
      </div>

      <div className="hero">
        <div className="scrap tape" style={{ top: -40, left: '8%', transform: 'rotate(-6deg)' }}>arXiv:1706.03762</div>
        <div className="scrap tape" style={{ top: 20, right: '4%', transform: 'rotate(4deg)' }}>RAG · top-k=8</div>
        <div className="stamp" style={{ top: 120, right: '18%' }}>Full-Text · Indexed</div>
        <div className="scrap" style={{ top: 300, left: '-1%', transform: 'rotate(-8deg)' }}>Ollama · llama3.2</div>

        <h1>
          <span className="line">Read AI research</span>
          <span className="line">like a <em>local.</em></span>
          <span className="line" style={{ fontSize: '.55em', color: 'var(--muted)', marginTop: '16px' }}>
            {' '}<span className="strike">slow reads, dense jargon, dead ends.</span>
          </span>
        </h1>

        <div className="hero-grid">
          <p className="hero-lead">
            Type a paper name. superaXiom fetches the full PDF, embeds it permanently into a
            local vector store, and lets you <em>summarize</em> or <em>talk to it</em> — math and all.
            Nothing leaves your machine.
          </p>

          <div className="ticker-box">
            <div className="label">Recently summarized · local cache</div>
            {recentPapers.map((r,i) => (
              <div className="ticker-line" key={i}>
                <span className="t">{r.t}</span>
                <span className="s">{r.s}</span>
              </div>
            ))}
          </div>

          <div className="hero-cta-block">
            <button className="big-cta" onClick={() => onNavigate('query')}>
              <span className="sub">Start a query ↴</span>
              <span>Summon<br/>a paper.</span>
              <span className="arr">↗</span>
            </button>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '.2em', textTransform: 'uppercase', opacity: .5, textAlign: 'right' }}>
              No sign-up · No cloud · No tracking
            </div>
          </div>
        </div>
      </div>

      <div className="marquee" style={{ marginTop: 120 }}>
        <div className="marquee-track">
          <span>Summarize <em>deeply</em></span>
          <span className="dot">✺</span>
          <span>Ask <em>anything</em></span>
          <span className="dot">✺</span>
          <span>Stay <em>local</em></span>
          <span className="dot">✺</span>
          <span>Own your <em>library</em></span>
          <span className="dot">✺</span>
          <span>Summarize <em>deeply</em></span>
          <span className="dot">✺</span>
          <span>Ask <em>anything</em></span>
          <span className="dot">✺</span>
          <span>Stay <em>local</em></span>
          <span className="dot">✺</span>
          <span>Own your <em>library</em></span>
          <span className="dot">✺</span>
        </div>
      </div>

      <div className="cards-section">
        <div className="section-head">
          <h2><em>Four</em> steps. One local brain.</h2>
          <span className="tag">§01 · How it works</span>
        </div>
        <div className="cards-row">
          {[
            { n:'01', h:'Search', p:'Semantic Scholar finds the paper. Fuzzy cache catches repeat queries instantly.', m:'Semantic + fuzzy' },
            { n:'02', h:'Embed', p:'Full PDF downloaded, extracted, chunked into 512-token pieces, embedded with nomic-embed-text.', m:'~30s cold start' },
            { n:'03', h:'Summarize', p:'Choose beginner, mathematical, technical or intuitive. Pick length. Stream via SSE.', m:'4 modes · 3 lengths' },
            { n:'04', h:'Converse', p:'Multi-turn Q&A over the exact sections. Math explanations included. Full history kept.', m:'Retrieval-grounded' },
          ].map((s,i) => (
            <div className="step-card" key={i}>
              <div className="num">{s.n}</div>
              <h3>{s.h}</h3>
              <p>{s.p}</p>
              <div className="meta">{s.m}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="modes-section">
        <div className="section-head">
          <h2>Four <em>voices.</em> One paper.</h2>
          <span className="tag">§02 · Summarization modes</span>
        </div>
        <div className="modes-grid">
          {[
            { i:'β', h:'Beginner', p:'No-jargon explanations built around a relatable analogy. Five clean sections.', tag:'For the curious' },
            { i:'Σ', h:'Mathematical', p:'Formal notation, key theorems, proofs, and experimental validation — graduate level.', tag:'For the rigorous' },
            { i:'τ', h:'Technical', p:'Engineer-level review: architecture, ablations, hyperparameters, critical analysis.', tag:'For the builders' },
            { i:'∞', h:'Intuitive', p:'Mental models. Analogies. The insight that makes the paper feel obvious in hindsight.', tag:'For the thinkers' },
          ].map((m,i) => (
            <div className="mode-cell" key={i}>
              <div className="icon">{m.i}</div>
              <div>
                <h4>{m.h}</h4>
                <p>{m.p}</p>
              </div>
              <div className="tag">{m.tag}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="foot">
        <span className="brand">superaXiom</span>
        <span>Local · Private · Yours</span>
        <span>© mmxxvi — No.07</span>
      </div>
    </div>
  );
}

// ============ QUERY PAGE (WIRED) ============
function QueryPage({ onNavigate, onSubmit }) {
  const savedDraft = readStoredJson('sa_query_draft', null);
  const [searchQuery, setSearchQuery] = useState(savedDraft?.searchQuery || '');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedPaper, setSelectedPaper] = useState(savedDraft?.selectedPaper || null);
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useState(savedDraft?.mode || 'technical');
  const [length, setLength] = useState(savedDraft?.length || 'medium');
  const [question, setQuestion] = useState(savedDraft?.question || '');
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const searchTimer = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    const trimmedQuery = searchQuery.trim();

    clearTimeout(searchTimer.current);
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    if (trimmedQuery.length < 3) {
      setSearching(false);
      setSearchResults([]);
      return;
    }

    if (selectedPaper && trimmedQuery === (selectedPaper.title || '').trim()) {
      setSearching(false);
      setSearchResults([]);
      return;
    }

    setSearching(true);
    searchTimer.current = setTimeout(() => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      abortRef.current = controller;

      apiSearch(trimmedQuery, 5, { signal: controller.signal }).then(r => {
        if (controller.signal.aborted) return;
        setSearchResults(r.papers || []);
        setSearching(false);
      }).catch(err => {
        if (err?.name === 'AbortError') return;
        setSearchResults([]);
        setSearching(false);
      }).finally(() => {
        clearTimeout(timeoutId);
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      });
    }, 300);

    return () => {
      clearTimeout(searchTimer.current);
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [searchQuery, selectedPaper]);

  useEffect(() => {
    writeStoredJson('sa_query_draft', {
      searchQuery,
      selectedPaper,
      mode,
      length,
      question,
    });
  }, [searchQuery, selectedPaper, mode, length, question]);

  const selectPaper = (paper) => {
    setSelectedPaper(paper);
    setSearchQuery(paper.title);
    setSearchResults([]);
    setSearching(false);
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await fetch(`${API}/api/upload/pdf`, { method: 'POST', body: fd });
      const data = await r.json();
      setUploadStatus(data);
      setTimeout(() => setUploadStatus(null), 5000);
    } catch (err) {
      setUploadStatus({ error: err.message });
    }
    setUploading(false);
  };

  const handleSubmit = () => {
    if (!selectedPaper) return;
    onSubmit({ paper: selectedPaper, mode, length, question });
  };

  const modes = [
    { id:'beginner', label:'Beginner', ic:'β' },
    { id:'mathematical', label:'Mathematical', ic:'Σ' },
    { id:'technical', label:'Technical', ic:'τ' },
    { id:'intuitive', label:'Intuitive', ic:'∞' },
  ];
  const lengths = [
    { id:'short', label:'Short · ~200w', ic:'—' },
    { id:'medium', label:'Medium · ~450w', ic:'≡' },
    { id:'long', label:'Long · ~800w', ic:'¶' },
  ];

  return (
    <div className="query" data-screen-label="02 Query">
      <div className="query-wrap">
        <div className="uppercase-mono" style={{ marginBottom: 16, opacity: .6 }}>
          § · New query &nbsp;/&nbsp; Step 01 of 01
        </div>
        <h1>What shall we <em>read</em> today?</h1>
        <div className="subhead">
          Paper name, the kind of analysis you want, and any specific questions you'd like addressed within the summary.
        </div>

        <div className="form-grid">
          <div className="form-col">
            <div className="field">
              <label>
                <span>① Paper title or arXiv ID <span className="req">*</span></span>
                <span>{searching ? 'searching…' : searchQuery.trim().length > 0 && searchQuery.trim().length < 3 ? 'type 3+ chars' : selectedPaper ? (selectedPaper.cached ? '● cached' : '○ will prefetch') : 'auto-fetches full PDF'}</span>
              </label>
              <input
                type="text"
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setSelectedPaper(null); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                  }
                }}
                placeholder="e.g. Attention Is All You Need, 1706.03762, Mamba…"
                autoComplete="off"
                spellCheck={false}
              />
              {searchResults.length > 0 && (
                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {searchResults.map(p => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => selectPaper(p)}
                      style={{
                        textAlign: 'left', padding: '12px 16px', background: 'transparent',
                        border: '1px solid var(--rule)', borderRadius: 4, cursor: 'pointer',
                        fontFamily: 'Instrument Serif, serif', fontSize: 16, color: 'var(--ink)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      }}
                    >
                      <span>{p.title}</span>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, opacity: .5 }}>
                        {p.cached ? '● cached' : p.year}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="field" style={{ borderBottom: 'none' }}>
              <label>
                <span>② Analysis mode</span>
                <span>{mode}</span>
              </label>
              <div className="chips">
                {modes.map(m => (
                  <button type="button" key={m.id} className={`chip ${mode === m.id ? 'on' : ''}`} onClick={() => setMode(m.id)}>
                    <span className="ic">{m.ic}</span>{m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field" style={{ borderBottom: 'none' }}>
              <label>
                <span>③ Length</span>
                <span>{length}</span>
              </label>
              <div className="chips">
                {lengths.map(l => (
                  <button type="button" key={l.id} className={`chip ${length === l.id ? 'on' : ''}`} onClick={() => setLength(l.id)}>
                    <span className="ic">{l.ic}</span>{l.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>
                <span>④ Specific questions <span style={{opacity:.5}}>(optional)</span></span>
                <span>{question.length}/500</span>
              </label>
              <textarea
                value={question}
                onChange={e => setQuestion(e.target.value.slice(0, 500))}
                placeholder="Why √d_k scaling? Walk me through the positional encoding derivation…"
              />
            </div>
          </div>

          <div>
            <div className="upload-box">
              <div className="upload-header">
                <span className="label">Or · upload your own</span>
                <span className="upload-badge">PDF</span>
              </div>
              <label className="upload-drop" style={{ cursor: uploading ? 'wait' : 'pointer' }}>
                <input type="file" accept=".pdf" style={{ display:'none' }} onChange={handleUpload} disabled={uploading} />
                <div className="upload-icon">⬆</div>
                <div className="upload-title">{uploading ? 'Uploading…' : 'Drop a PDF here'}</div>
                <div className="upload-sub">or <u>browse files</u> — upto 50 MB</div>
              </label>
              <div className="upload-foot">
                {uploadStatus ? (
                  <span style={{ color: 'var(--ok)' }}>✓ {uploadStatus.title || 'Uploaded'}</span>
                ) : (
                  <span>● Ready</span>
                )}
              </div>
            </div>

            {selectedPaper && (
              <div className="paper-preview" style={{ marginTop: 24 }}>
                <div className="label">Preview · will be indexed</div>
                <h4>{selectedPaper.title}</h4>
                <div className="authors">{selectedPaper.authors?.join(', ') || 'Unknown authors'}</div>
                <div className="meta-row">
                  <span>arXiv · {selectedPaper.id}</span>
                  <span className={selectedPaper.cached ? 'status-dot' : ''}>
                    {selectedPaper.cached ? '● ready' : '○ will prefetch'}
                  </span>
                </div>
              </div>
            )}

            <div style={{ marginTop: 24, fontFamily: 'Instrument Serif, serif', fontSize: 15, fontStyle: 'italic', color: 'var(--muted)', lineHeight: 1.45 }}>
              First run per paper takes ~30 seconds (download + embed). Every run after that is instant — the vectors live on your disk, forever.
            </div>
          </div>
        </div>

        <button
          type="button"
          className="summarize-btn"
          onClick={handleSubmit}
          disabled={!selectedPaper}
          style={{ opacity: selectedPaper ? 1 : .45, cursor: selectedPaper ? 'pointer' : 'not-allowed' }}
        >
          <div style={{ display:'flex', flexDirection:'column', gap: 8 }}>
            <span className="sub">Press to begin →</span>
            <span>Summarize <em style={{fontStyle:'italic', color:'var(--accent)'}}>&</em> index.</span>
          </div>
          <span className="go">↗</span>
        </button>

        <div className="foot" style={{ marginTop: 80 }}>
          <span className="brand">superaXiom</span>
          <span>Query composer · v2.0</span>
          <span>⌘ + ↵ to submit</span>
        </div>
      </div>
    </div>
  );
}

// ============ LOADING (REAL) ============
function Loading({ paper, mode, length, question, onDone }) {
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('Starting…');
  const [error, setError] = useState(null);
  const stages = [
    'Checking if paper is cached…',
    'Locating paper on Semantic Scholar…',
    'Downloading full PDF…',
    'Extracting text · chunking…',
    'Embedding with nomic-embed-text…',
    'Storing in ChromaDB · permanent…',
    'Paper ready · starting summary…',
  ];

  useEffect(() => {
    let cancelled = false;
    let xhr = null;
    const run = async () => {
      try {
        setStage(stages[0]);
        setProgress(10);

        const meta = await apiPaperMeta(paper.id);
        if (cancelled) return;
        setStage(meta.cached ? stages[6] : stages[1]);
        setProgress(meta.cached ? 80 : 20);

        if (!meta.cached) {
          await apiPrefetch(paper.id);
          setStage(stages[2]);
          setProgress(30);
          await pollUntilReady(paper.id, 90, 2000);
          if (cancelled) return;
        }

        setProgress(90);
        setStage(stages[6]);

        // Start SSE stream
        let fullText = '';
        xhr = streamSSE(
          `${API}/api/summarize/stream`,
          { paper_id: paper.id, mode, length, user_questions: question },
          (token) => {
            fullText += token;
            setProgress(90 + Math.min(10, fullText.length / 200));
          },
          () => {
            if (!cancelled) onDone(fullText, paper, mode, length);
          },
          (err) => {
            if (!cancelled) setError(err);
          }
        );
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };
    run();
    return () => { cancelled = true; if (xhr) xhr.abort(); };
  }, [paper, mode, length, question, onDone]);

  const streaks = [];
  for (let i = 0; i < 120; i++) {
    const angle = (i / 120) * 360 + (Math.random() * 6 - 3);
    const len = 60 + Math.random() * 340;
    const delay = Math.random() * 2;
    const dur = 0.6 + Math.random() * 1.1;
    const isRed = i % 11 === 0;
    streaks.push(
      <div key={i} className={`streak ${isRed ? 'red' : ''}`} style={{
        height: `${len}px`, transform: `translate(-50%, 0) rotate(${angle}deg)`,
        animation: `streakFly ${dur}s linear ${delay}s infinite`,
      }} />
    );
  }

  if (error) {
    return (
      <div className="loading-scene" data-screen-label="03 Loading">
        <div className="loading-content">
          <div className="brand">superaXiom</div>
          <h1 style={{ color: 'var(--accent)' }}>Something went <em>wrong.</em></h1>
          <div className="sub" style={{ marginTop: 20 }}>{error}</div>
          <button className="pill-cta" style={{ marginTop: 40 }} onClick={() => onDone('', null, '', '')}>
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="loading-scene" data-screen-label="03 Loading">
      <style>{`
        @keyframes streakFly {
          0%   { transform-origin: center 0; opacity: 0; height: 20px; }
          10%  { opacity: 1; }
          100% { transform-origin: center 0; opacity: 0; height: 800px; }
        }
      `}</style>
      <div className="streaks-bg">{streaks}</div>
      <div className="loading-content">
        <div className="brand">superaXiom</div>
        <h1>Going <em>hyperspeed</em><br/>through your paper.</h1>
        <div className="sub">{paper.title}</div>
        <div className="loading-progress">
          <div className="bar" style={{ width: `${progress}%` }} />
        </div>
        <div className="loading-stages">› {stage}</div>
      </div>
      <div className="loading-ticker">
        <span>sys · local inference</span>
        <span>{Math.floor(progress)}%</span>
        <span>{mode} / {length}</span>
      </div>
    </div>
  );
}

// ============ ANALYSIS PAGE (WIRED) ============
function Analysis({ summaryText, paper, mode, length, onNavigate }) {
  const [active, setActive] = useState('s1');
  const [parsedSections, setParsedSections] = useState([]);
  const [rawText, setRawText] = useState('');
  const [qaOpen, setQaOpen] = useState(false);
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaHistory, setQaHistory] = useState([]);
  const [qaStreaming, setQaStreaming] = useState(false);
  const [qaQueue, setQaQueue] = useState([]);
  const qaXhrRef = useRef(null);
  const qaMessagesRef = useRef(null);
  const qaHistoryRef = useRef([]);

  useEffect(() => {
    if (!summaryText) return;
    let normalized = summaryText.replace(/\\n/g, '\n').replace(/\\t/g, '  ');
    setRawText(normalized);
    const lines = normalized.split('\n');
    const sections = [];
    let currentSection = null;
    let currentContent = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('## ')) {
        if (currentSection) {
          currentSection.content = currentContent.join('\n').trim();
          sections.push(currentSection);
        }
        currentSection = { title: trimmedLine.slice(3).trim(), content: '' };
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }
    if (currentSection) {
      currentSection.content = currentContent.join('\n').trim();
      sections.push(currentSection);
    }
    setParsedSections(sections);
  }, [summaryText]);

  // keep ref in sync so callbacks always read latest history
  useEffect(() => { qaHistoryRef.current = qaHistory; }, [qaHistory]);

  const katexInline = (latex) => {
    try {
      if (window.katex) {
        const html = window.katex.renderToString(latex.trim(), { displayMode: false, throwOnError: false, output: 'html' });
        return <span key={latex} dangerouslySetInnerHTML={{ __html: html }} />;
      }
    } catch {}
    return <code className="inline-formula" style={{ fontFamily: "'JetBrains Mono', monospace", background: 'var(--paper-deep)', border: '1px solid var(--rule)', padding: '2px 8px', borderRadius: 3, fontSize: '0.9em' }}>{latex}</code>;
  };

  const renderInline = (text) => {
    if (!text) return text;
    // split on **bold**, `code`, $inline-math$, \( inline-math \)
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\$[^$\n]+\$|\\\([^)]+\\\))/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i} className="inline-code" style={{ background: 'var(--paper-deep)', padding: '2px 6px', borderRadius: 3, fontSize: '0.92em' }}>{part.slice(1, -1)}</code>;
      }
      if (part.startsWith('$') && part.endsWith('$')) {
        return <span key={i}>{katexInline(part.slice(1, -1))}</span>;
      }
      if (part.startsWith('\\(') && part.endsWith('\\)')) {
        return <span key={i}>{katexInline(part.slice(2, -2))}</span>;
      }
      const italicParts = part.split(/(\*[^*]+\*)/g);
      if (italicParts.some((p, idx) => idx % 2 === 1)) {
        return <span key={i}>{italicParts.map((p, j) => j % 2 === 1 ? <em key={j}>{p.slice(1, -1)}</em> : p)}</span>;
      }
      return text === part ? part : <span key={i}>{part}</span>;
    });
  };

  const renderMarkdown = (text) => {
    if (!text) return null;

    let normalized = text;
    normalized = normalized.replace(/\\n/g, '\n');
    normalized = normalized.replace(/\\t/g, '  ');

    const blocks = normalized.split(/\n\n+/);
    const elements = [];
    let key = 0;

    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;

      /* Horizontal rules --- *** ___ */
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        elements.push(<hr key={key++} style={{ border: 'none', borderTop: '1px solid var(--rule)', margin: '24px 0' }} />);
        continue;
      }

      if (trimmed.startsWith('$$') && trimmed.endsWith('$$')) {
        const formula = trimmed.slice(2, -2).trim();
        try {
          if (window.katex) {
            const html = window.katex.renderToString(formula, { displayMode: true, throwOnError: false, output: 'html' });
            elements.push(<div key={key++} className="formula" dangerouslySetInnerHTML={{ __html: html }} />);
          } else {
            elements.push(<div key={key++} className="formula">{formula}</div>);
          }
        } catch { elements.push(<div key={key++} className="formula">{formula}</div>); }
        continue;
      }

      if (trimmed.startsWith('\\[') && trimmed.endsWith('\\]')) {
        const formula = trimmed.slice(2, -2).trim();
        try {
          if (window.katex) {
            const html = window.katex.renderToString(formula, { displayMode: true, throwOnError: false, output: 'html' });
            elements.push(<div key={key++} className="formula" dangerouslySetInnerHTML={{ __html: html }} />);
          } else {
            elements.push(<div key={key++} className="formula">{formula}</div>);
          }
        } catch { elements.push(<div key={key++} className="formula">{formula}</div>); }
        continue;
      }

      if (trimmed.startsWith('## ')) {
        elements.push(<h2 key={key++} style={{ fontFamily: "'Instrument Serif', serif", fontWeight: 400, fontSize: 'clamp(28px, 4vw, 40px)', lineHeight: 1.1, letterSpacing: '-.02em', margin: '32px 0 14px', color: 'var(--ink)' }}>{renderInline(trimmed.slice(3))}</h2>);
        continue;
      }

      if (trimmed.startsWith('### ')) {
        elements.push(<h3 key={key++} style={{ fontFamily: "'Bodoni Moda', serif", fontStyle: 'italic', fontSize: '1.15em', margin: '28px 0 12px', color: 'var(--ink)' }}>{renderInline(trimmed.slice(4))}</h3>);
        continue;
      }

      /* Markdown tables */
      const tableLines = trimmed.split('\n').filter(l => l.trim());
      if (tableLines.length >= 2 && tableLines.every(l => l.includes('|'))) {
        const sepRow = tableLines[1];
        if (/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(sepRow)) {
          const headers = tableLines[0].split('|').map(h => h.trim()).filter(Boolean);
          const rows = tableLines.slice(2).map(row =>
            row.split('|').map(c => c.trim()).filter(Boolean)
          );
          elements.push(
            <table key={key++} style={{ width: '100%', borderCollapse: 'collapse', margin: '16px 0', fontSize: '15px', lineHeight: 1.5 }}>
              <thead>
                <tr>
                  {headers.map((h, i) => <th key={i} style={{ borderBottom: '2px solid var(--ink)', padding: '8px 12px', textAlign: 'left', fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.15em', opacity: .7 }}>{renderInline(h)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => <td key={ci} style={{ borderBottom: '1px solid var(--rule)', padding: '8px 12px', verticalAlign: 'top' }}>{renderInline(cell)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          );
          continue;
        }
      }

      if (/^[-*] /.test(trimmed)) {
        const items = trimmed.split('\n').filter(l => /^[-*] /.test(l)).map(l => l.replace(/^[-*] /, ''));
        elements.push(<ul key={key++}>{items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}</ul>);
        continue;
      }

      const numberedMatch = trimmed.match(/^(\d+)\.\s/m);
      if (numberedMatch) {
        const items = trimmed.split('\n').filter(l => /^\d+\.\s/.test(l)).map(l => l.replace(/^\d+\.\s/, ''));
        elements.push(<ol key={key++}>{items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}</ol>);
        continue;
      }

      elements.push(<p key={key++}>{renderInline(trimmed)}</p>);
    }

    return elements;
  };

  const startQA = (q) => {
    const paperId = paper?.id;
    if (!paperId) return;
    const historySnapshot = qaHistoryRef.current;
    setQaStreaming(true);
    setQaHistory(h => [...h, { role: 'user', content: q }, { role: 'assistant', content: '' }]);
    let answer = '';

    const xhr = streamSSE(
      `${API}/api/qa/stream`,
      { paper_id: paperId, question: q, history: historySnapshot },
      (token) => {
        answer += token;
        setQaHistory(h => {
          const updated = [...h];
          updated[updated.length - 1] = { role: 'assistant', content: answer };
          return updated;
        });
        if (qaMessagesRef.current) {
          qaMessagesRef.current.scrollTop = qaMessagesRef.current.scrollHeight;
        }
      },
      () => {
        qaXhrRef.current = null;
        setQaStreaming(false);
        // process next queued question after state flushes
        setQaQueue(prev => {
          if (prev.length > 0) {
            const [next, ...rest] = prev;
            setTimeout(() => startQA(next), 0);
            return rest;
          }
          return prev;
        });
      },
      (err) => {
        qaXhrRef.current = null;
        setQaHistory(h => {
          const updated = [...h];
          updated[updated.length - 1] = { role: 'assistant', content: answer || `Error: ${err}` };
          return updated;
        });
        setQaStreaming(false);
        setQaQueue([]);
      }
    );
    qaXhrRef.current = xhr;
  };

  const handleQA = () => {
    const q = qaQuestion.trim();
    if (!q) return;
    setQaQuestion('');
    if (qaStreaming) {
      setQaQueue(prev => [...prev, q]);
    } else {
      startQA(q);
    }
  };

  const stopQA = () => {
    if (qaXhrRef.current) { qaXhrRef.current.abort(); qaXhrRef.current = null; }
    setQaStreaming(false);
    setQaQueue([]);
  };

  const modeLabels = { beginner: 'Beginner', mathematical: 'Mathematical', technical: 'Technical', intuitive: 'Intuitive' };

  return (
    <div className="analysis" data-screen-label="04 Analysis">
      <div className="analysis-wrap">
        <div style={{ marginBottom: 18 }}>
          <button className="back-btn" onClick={() => onNavigate('query')}>
            ← Back to Query
          </button>
        </div>
        <div className="paper-header">
          <div>
            <div className="meta-top">
              <span>arXiv · {paper?.id || '—'}</span>
              <span className="dot">●</span>
              <span>Mode · {modeLabels[mode] || mode}</span>
              <span className="dot">●</span>
              <span>Length · {length}</span>
              <span className="dot">●</span>
              <span>Generated · {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </div>
            <h1>{paper?.title || 'Paper'}.</h1>
            <div className="authors">{paper?.authors?.join(', ') || 'Unknown authors'}</div>
          </div>
          <div className="paper-header-side">
            <div className="row"><span>mode</span><span>{mode}</span></div>
            <div className="row"><span>length</span><span>{length}</span></div>
            <div className="row"><span>sections</span><span>{parsedSections.length}</span></div>
            <div className="row"><span>tokens</span><span>{rawText.length}</span></div>
          </div>
        </div>

        <div className="analysis-body">
          <aside className="toc">
            <div className="t-head">Contents</div>
            <ul>
              {parsedSections.map((s, i) => (
                <li key={i} className={active === `s${i+1}` ? 'active' : ''} onClick={() => { setActive(`s${i+1}`); const el = document.getElementById(`s${i+1}`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                  <span className="num">§{i+1}</span><span>{s.title}</span>
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 24 }} className="t-head">Meta</div>
            <ul>
              <li style={{ cursor: 'pointer' }} onClick={() => { const text = rawText; navigator.clipboard?.writeText(text); }}><span className="num">◇</span>Export · MD</li>
              <li style={{ cursor: 'pointer' }} onClick={() => onNavigate('query')}><span className="num">◇</span>Re-run · new mode</li>
            </ul>
          </aside>

          <article className="article">
            {parsedSections.length === 0 ? (
              <div style={{ padding: '60px 0' }}>
                <p style={{ fontFamily:"'Instrument Serif',serif", fontStyle:'italic', fontSize:22, color:'var(--muted)', marginBottom: 28 }}>No summary generated yet.</p>
                <button onClick={() => onNavigate('query')} style={{ background:'var(--ink)', color:'var(--paper)', border:'none', padding:'14px 28px', fontFamily:"'JetBrains Mono',monospace", fontSize:11, letterSpacing:'.18em', textTransform:'uppercase', cursor:'pointer' }}>← Back to Query</button>
              </div>
            ) : (
              parsedSections.map((s, i) => (
                <div key={i} id={`s${i+1}`}>
                  <h2><span className="section-num">§{i+1}</span>{s.title}</h2>
                  {renderMarkdown(s.content)}
                </div>
              ))
            )}
          </article>

          <aside className="margin-notes">
            <div className="margin-note">
              <div className="note-label">↳ Mode</div>
              <div className="note-body">{modeLabels[mode] || mode} — {length} length</div>
            </div>
            <div className="margin-note">
              <div className="note-label">↳ Paper</div>
              <div className="note-body">{paper?.id || '—'}</div>
            </div>
            <div className="margin-note">
              <div className="note-label">↳ Retrieval</div>
              <div className="note-body">Grounded in top-8 relevant chunks from the full PDF.</div>
            </div>
          </aside>
        </div>

        <div className="qa-strip">
          <div>
            <h3>Now <em>ask</em> it anything.</h3>
            <p>The paper is permanently indexed. Ask about the math, a specific figure, an ablation — multi-turn, grounded, private.</p>
          </div>
          <button className="qa-btn" onClick={() => setQaOpen(true)}>Open Q&amp;A ↓</button>
        </div>

        {qaOpen && (
          <div className="qa-panel" style={{ marginTop: 40, borderTop: '2px solid var(--ink)', paddingTop: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontFamily: "'Instrument Serif', serif", fontWeight: 400, fontSize: 36, margin: 0 }}>
                Q&amp;A <em style={{ fontFamily: "'Bodoni Moda', serif" }}>with this paper.</em>
              </h2>
              <button onClick={() => setQaOpen(false)} style={{ background: 'none', border: '1px solid var(--rule)', padding: '8px 16px', cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '.15em', textTransform: 'uppercase' }}>Close ×</button>
            </div>

            <div ref={qaMessagesRef} className="qa-messages" style={{ maxHeight: 480, overflowY: 'auto', marginBottom: 16 }}>
              {qaHistory.length === 0 && (
                <p style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', color: 'var(--muted)', textAlign: 'center', padding: '24px 0' }}>
                  Ask any question about this paper. The answer will be grounded in its content.
                </p>
              )}
              {qaHistory.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'qa-msg-user' : 'qa-msg-assistant'} style={{
                  marginBottom: 16, padding: m.role === 'user' ? '12px 20px' : '16px 20px',
                  background: m.role === 'user' ? 'var(--ink)' : 'var(--paper-deep)',
                  color: m.role === 'user' ? 'var(--paper)' : 'var(--ink)',
                  fontFamily: "'Instrument Serif', serif",
                  fontSize: m.role === 'user' ? 17 : 18,
                  lineHeight: 1.6,
                }}>
                  {m.role === 'assistant'
                    ? (m.content ? renderMarkdown(m.content) : <span style={{ fontStyle:'italic', opacity:.5 }}>Thinking…</span>)
                    : m.content}
                </div>
              ))}
            </div>

            {(qaStreaming || qaQueue.length > 0) && (
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12, fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:'.15em', textTransform:'uppercase', color:'var(--muted)' }}>
                {qaStreaming && <span style={{ animation:'pulse 1.2s ease-in-out infinite', color:'var(--accent)' }}>● generating</span>}
                {qaQueue.length > 0 && <span>{qaQueue.length} queued</span>}
                {qaStreaming && (
                  <button onClick={stopQA} style={{ marginLeft:'auto', background:'none', border:'1px solid var(--accent)', color:'var(--accent)', padding:'5px 12px', cursor:'pointer', fontFamily:"'JetBrains Mono',monospace", fontSize:10, letterSpacing:'.15em', textTransform:'uppercase' }}>
                    ■ Stop
                  </button>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12 }}>
              <input
                value={qaQuestion}
                onChange={e => setQaQuestion(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleQA(); } }}
                placeholder={qaStreaming ? 'Type to queue next question…' : 'Ask about this paper…'}
                style={{ flex: 1, background: 'var(--paper-deep)', border: '1px solid var(--rule)', padding: '14px 20px', fontFamily: "'Instrument Serif', serif", fontSize: 18, color: 'var(--ink)', outline: 'none' }}
              />
              <button
                onClick={handleQA}
                disabled={!qaQuestion.trim()}
                style={{ background: 'var(--accent)', color: 'var(--paper)', border: 'none', padding: '14px 28px', fontFamily: "'Bodoni Moda', serif", fontWeight: 700, fontStyle: 'italic', fontSize: 18, cursor: !qaQuestion.trim() ? 'not-allowed' : 'pointer', opacity: !qaQuestion.trim() ? 0.5 : 1 }}
              >
                {qaStreaming ? 'Queue →' : 'Ask →'}
              </button>
            </div>
          </div>
        )}

        <div className="foot" style={{ marginTop: 80 }}>
          <span className="brand">superaXiom</span>
          <span>Analysis · {mode} / {length}</span>
          <span>Generated locally</span>
        </div>
      </div>
    </div>
  );
}

// ============ TECH STACK ============
function TechStack({ onNavigate }) {
  const layers = [
    {
      n: '01',
      category: 'Interface',
      title: 'The paper you see.',
      body: `You type a paper name — the interface catches it, searches in real time, and shows you results before you finish typing. React renders the components, GSAP breathes life into the entrance, and Babel transpiles JSX in the browser so there's no build step, no bundler, no complexity. The entire frontend is a single HTML file and a single JSX file. When the summary arrives, it streams token by token via Server-Sent Events — you watch the words appear as the model thinks them, not after.`,
    },
    {
      n: '02',
      category: 'API Layer',
      title: 'The brain that routes.',
      body: `FastAPI sits at the center — async, fast, and clean. Every endpoint is a thin layer that delegates to the core agents below. Uvicorn serves it. Pydantic validates every request and response so bad data never reaches the pipeline. SSE streaming flushes each token the moment the model produces it — no buffering, no waiting for the full answer. The config endpoint lets you swap providers at runtime with no restart.`,
    },
    {
      n: '03',
      category: 'Retrieval',
      title: 'The paper you find.',
      body: `Semantic Scholar is the primary search engine — it understands meaning, not just keywords. When it's rate-limited, arXiv API takes over. Every paper you've ever searched is cached in a local SQLite database with fuzzy matching via rapidfuzz, so repeat queries hit instantly without any network call. Results are ranked by exact phrase match first, then fuzzy title similarity, then recency — noise gets filtered out before you ever see it.`,
    },
    {
      n: '04',
      category: 'Embedding',
      title: 'The paper you index.',
      body: `The full PDF is downloaded — never just the abstract. PyMuPDF extracts every page of text, cleans hyphenated line breaks and whitespace, then a sliding window chunker cuts it into overlapping pieces: 512 tokens wide, 64 tokens of overlap so nothing falls through the cracks. Each chunk is embedded into a vector using nomic-embed-text via Ollama, with sentence-transformers as a fallback. The result is a permanent numerical fingerprint of every idea in the paper.`,
    },
    {
      n: '05',
      category: 'Vector Store',
      title: 'The paper you remember.',
      body: `ChromaDB stores every vector on disk — persistent, not in-memory. A single collection holds all papers, scoped by paper_id so queries never bleed across documents. When you ask a question, it gets embedded and compared against every chunk using cosine similarity. The top 8 most relevant pieces are pulled back as context. Once a paper is embedded, it stays forever — an exists() check prevents any re-download or re-embedding.`,
    },
    {
      n: '06',
      category: 'Generation',
      title: 'The paper you understand.',
      body: `The model router is the final layer — a unified interface that speaks to Ollama locally or any cloud provider. Four summary modes, each a carefully written prompt template on disk: beginner, mathematical, technical, intuitive. Three length options control depth. The retrieved chunks are woven into the prompt alongside the paper's metadata, and the model streams its answer token by token. Swap from llama3.2 to GPT-4o to Claude mid-session — no restart, no downtime.`,
    },
  ];

  return (
    <div className="landing" data-screen-label="07 Tech Stack" style={{ paddingBottom: 40 }}>
      <style>{`
        .ts-hero { max-width: 1500px; margin: 60px auto 0; padding: 0 20px; }
        .ts-hero h1 { font-family: 'Instrument Serif', serif; font-weight: 400; font-size: clamp(72px, 12vw, 200px); line-height: .88; letter-spacing: -.03em; margin: 20px 0 0; }
        .ts-hero h1 em { font-style: italic; font-family: 'Bodoni Moda', serif; }
        .ts-sub { font-family: 'Instrument Serif', serif; font-size: 26px; line-height: 1.25; color: var(--ink-soft); max-width: 720px; margin: 30px 0 0; }
        .ts-sub em { font-style: italic; color: var(--accent); }

        .ts-layers { max-width: 1500px; margin: 80px auto 0; padding: 0 20px; }
        .ts-layer { display: grid; grid-template-columns: 280px 1fr; gap: 0; border: 1px solid var(--ink); margin-bottom: -1px; }
        .ts-layer-left { padding: 48px 40px; border-right: 1px solid var(--ink); background: var(--paper-deep); display: flex; flex-direction: column; gap: 16px; }
        .ts-layer .layer-num { font-family: 'Bodoni Moda', serif; font-style: italic; font-weight: 700; font-size: 64px; color: var(--accent); line-height: 1; }
        .ts-layer .layer-cat { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: .22em; opacity: .55; }
        .ts-layer h3 { font-family: 'Instrument Serif', serif; font-weight: 400; font-size: 38px; line-height: 1.05; margin: 0; }
        .ts-layer h3 em { font-style: italic; }
        .ts-layer-right { padding: 48px 40px; }
        .ts-layer-right p { font-family: 'Instrument Serif', serif; font-size: 20px; line-height: 1.5; color: var(--ink-soft); margin: 0; max-width: 72ch; }
        .ts-layer-right p em { font-style: italic; color: var(--accent); }

        .ts-oss { max-width: 1500px; margin: 100px auto 0; padding: 0 20px; }
        .ts-oss-box { border: 2px solid var(--ink); padding: 50px; text-align: center; background: var(--ink); color: var(--paper); position: relative; }
        .ts-oss-box h2 { font-family: 'Instrument Serif', serif; font-weight: 400; font-size: clamp(40px, 6vw, 80px); line-height: .95; margin: 0 0 16px; }
        .ts-oss-box h2 em { font-style: italic; font-family: 'Bodoni Moda', serif; color: var(--accent); }
        .ts-oss-box p { font-family: 'Instrument Serif', serif; font-size: 20px; font-style: italic; line-height: 1.4; opacity: .8; max-width: 600px; margin: 0 auto 30px; }
        .ts-oss-btn { display: inline-flex; align-items: center; gap: 12px; padding: 18px 32px; background: var(--accent); color: var(--paper); border: none; font-family: 'Bodoni Moda', serif; font-weight: 700; font-style: italic; font-size: 22px; cursor: pointer; transition: transform .2s; }
        .ts-oss-btn:hover { transform: scale(1.03); }

        @media (max-width: 900px) {
          .ts-layer { grid-template-columns: 1fr !important; }
          .ts-layer-left { border-right: none !important; border-bottom: 1px solid var(--ink); padding: 32px 24px; }
          .ts-layer-right { padding: 32px 24px; }
          .ts-layer-right p { font-size: 17px; }
        }
      `}</style>

      <div className="landing-meta" style={{ maxWidth: 1500, margin: '60px auto 0', padding: '0 20px' }}>
        <span>§ · Architecture</span>
        <span>6 layers · fully local</span>
        <span>v2.0 · mmxxvi</span>
      </div>

      <div className="ts-hero">
        <div className="uppercase-mono" style={{ opacity: .6 }}>Six layers. One local brain.</div>
        <h1>How the <em>machine</em><br/>actually <em>works.</em></h1>
        <p className="ts-sub">
          Every layer is <em>independent</em>, <em>swappable</em>, and <em>runs on your machine</em>.
          No cloud. No tracking. Just a pipeline that turns a paper name into understanding.
        </p>
      </div>

      <div className="ts-layers">
        {layers.map((l, i) => (
          <div className="ts-layer" key={i}>
            <div className="ts-layer-left">
              <div className="layer-num">{l.n}</div>
              <div className="layer-cat">{l.category}</div>
              <h3>{l.title}</h3>
            </div>
            <div className="ts-layer-right">
              <p>{l.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="ts-oss">
        <div className="ts-oss-box">
          <div className="scrap tape" style={{ top: -16, left: 30, transform: 'rotate(-4deg)', background: 'rgba(245,215,110,.3)', color: 'var(--paper)', borderColor: 'rgba(242,236,225,.2)' }}>coming soon</div>
          <h2>Going <em>open source.</em></h2>
          <p>
            Once the hosted version is stable, the entire codebase goes public.
            Clone it, run it locally, own your research forever.
          </p>
          <button className="ts-oss-btn" onClick={() => window.open('https://github.com/Pratham-r05', '_blank')}>
            Star on GitHub <span style={{ fontSize: 28 }}>↗</span>
          </button>
        </div>
      </div>

      <div className="foot" style={{ marginTop: 100 }}>
        <span className="brand">superaXiom</span>
        <span>Tech Stack · 6 layers</span>
        <span>Built in Bangalore</span>
      </div>
    </div>
  );
}

// ============ ABOUT ============
function About({ onNavigate }) {
  useEffect(() => {
    if (typeof gsap !== 'undefined') {
      gsap.from('.about-scrap', { opacity: 0, y: -20, rotate: 0, duration: 1, stagger: 0.07, ease: 'power3.out', delay: 0.2 });
      gsap.from('.about-hero h1 .line', { y: 100, opacity: 0, duration: 1.1, stagger: 0.1, ease: 'power4.out' });
    }
  }, []);

  return (
    <div className="landing" data-screen-label="06 About" style={{ paddingBottom: 40 }}>
      <style>{`
        .about-hero { position: relative; max-width: 1500px; margin: 0 auto; padding: 40px 20px 60px; }
        .about-hero h1 { font-family:'Instrument Serif',serif; font-weight:400; font-size: clamp(64px, 11vw, 180px); line-height:.9; letter-spacing:-.03em; margin:0; }
        .about-hero h1 em { font-style:italic; font-family:'Bodoni Moda',serif; }
        .about-hero .line { display:block; }
        .about-grid { display:grid; grid-template-columns: 360px 1fr; gap: 60px; max-width:1500px; margin: 40px auto 0; padding: 0 20px; align-items:start; }
        .portrait { position:relative; }
        .portrait-frame { aspect-ratio: 3/4; background: var(--paper-deep); border: 1px solid var(--ink); position:relative; overflow:hidden; box-shadow: 4px 4px 0 var(--ink); }
        .portrait-frame::before { content:''; position:absolute; inset:0; pointer-events:none; z-index:1; background: repeating-linear-gradient(45deg, transparent 0 6px, rgba(23,20,15,.04) 6px 7px); }
        .portrait-frame img { position:relative; z-index:0; }
        .portrait-caption { font-family:'JetBrains Mono',monospace; font-size:10px; text-transform:uppercase; letter-spacing:.2em; opacity:.6; margin-top:14px; display:flex; justify-content:space-between; }
        .about-prose { font-family:'Instrument Serif',serif; font-size: 22px; line-height:1.45; color: var(--ink); max-width: 720px; }
        .about-prose p { margin: 0 0 20px 0; }
        .about-prose p:first-of-type::first-letter { font-family:'Bodoni Moda',serif; font-weight:700; font-size: 5em; float:left; line-height:.85; padding:6px 12px 0 0; color: var(--accent); }
        .about-prose em { font-style:italic; color: var(--accent); }
        .about-prose .mark { background: var(--highlighter); padding: 1px 4px; }
        .about-scrap { position:absolute; z-index: 3; pointer-events:auto; }
        .principles { margin-top: 80px; max-width:1500px; margin-left:auto; margin-right:auto; padding: 0 20px; }
        .principles-grid { display:grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background:var(--ink); border:1px solid var(--ink); margin-top: 30px; }
        .principle { background: var(--paper); padding: 28px 22px; min-height: 200px; display:flex; flex-direction:column; justify-content:space-between; }
        .principle .pn { font-family:'Bodoni Moda',serif; font-style:italic; font-weight:700; font-size: 42px; color: var(--accent); line-height:1; }
        .principle h4 { font-family:'Instrument Serif',serif; font-weight:400; font-size: 28px; margin: 6px 0 8px; }
        .principle h4 em { font-style:italic; }
        .principle p { font-size: 13px; line-height:1.5; color: var(--ink-soft); margin:0; }
        .manifesto { margin: 90px auto 0; max-width: 1500px; padding: 0 20px; }
        .manifesto-quote { font-family:'Bodoni Moda',serif; font-style:italic; font-weight:400; font-size: clamp(36px, 5vw, 68px); line-height:1.1; border-left: 4px solid var(--accent); padding: 10px 0 10px 28px; max-width: 1100px; }
        .manifesto-quote em { font-style:italic; color: var(--accent); }
        .contact-strip { margin: 90px auto 0; max-width:1500px; padding: 40px; background: var(--ink); color: var(--paper); display:grid; grid-template-columns: 1fr auto auto; gap: 30px; align-items:center; }
        .contact-strip h3 { font-family:'Instrument Serif',serif; font-weight:400; font-size: 48px; line-height:1; margin:0; }
        .contact-strip h3 em { font-style:italic; font-family:'Bodoni Moda',serif; color: var(--accent); }
        .contact-strip a { color: var(--paper); text-decoration:none; padding: 16px 22px; border:1px solid var(--paper); font-family:'JetBrains Mono',monospace; font-size: 11px; text-transform:uppercase; letter-spacing:.2em; transition: all .2s; }
        .contact-strip a:hover { background: var(--accent); border-color: var(--accent); }
        @media (max-width: 900px) { .about-grid { grid-template-columns: 1fr; } .principles-grid { grid-template-columns: repeat(2, 1fr); } .contact-strip { grid-template-columns: 1fr; } }
      `}</style>

      <div className="landing-meta" style={{ maxWidth: 1500, margin: '60px auto 0', padding: '0 20px' }}>
        <span>§ · About the maker</span>
        <span>No.07 / Vol.mmxxvi</span>
        <span>Dispatched from Bangalore</span>
      </div>

      <div className="about-hero">
        <div className="about-scrap scrap tape" style={{ top: 20, left: '2%', transform: 'rotate(-6deg)' }}>ai/llm engineer</div>
        <div className="about-scrap stamp" style={{ top: 60, right: '8%' }}>Local-first · Built solo</div>
        <div className="about-scrap scrap" style={{ top: 200, right: '2%', transform: 'rotate(5deg)' }}>est. bangalore</div>

        <h1>
          <span className="line">One engineer.</span>
          <span className="line">One <em>axiom:</em></span>
          <span className="line" style={{ fontSize: '.55em', color: 'var(--muted)', marginTop: 10 }}>research should be <em style={{color:'var(--accent)'}}>readable.</em></span>
        </h1>
      </div>

      <div className="about-grid">
        <div className="portrait">
          <div className="about-scrap scrap tape" style={{ top: -16, left: -12, transform: 'rotate(-8deg)', zIndex:4 }}>Pratham · '26</div>
          <div className="about-scrap stamp" style={{ bottom: 90, right: -30, transform:'rotate(6deg)', zIndex:4 }}>The maker</div>
          <div className="portrait-frame">
            <img src="pratham.jpg" alt="Pratham Raj" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} onError={e => { e.target.style.display='none'; }} />
          </div>
          <div className="portrait-caption">
            <span>Pratham Raj</span>
            <span>Bangalore, IN</span>
          </div>
          <div className="portrait-caption" style={{ marginTop: 6 }}>
            <span>ai / llm engineer</span>
            <span>solo build</span>
          </div>
        </div>

        <div className="about-prose">
          <p>
            I'm <em>Pratham Raj</em> — an AI/LLM engineer grinding to solve the
            daily-life problems that shouldn't still be problems. superaXiom is the
            first of them.
          </p>
          <p>
            I read AI research for a living. Papers pile up faster than any human can
            keep pace with — dense notation, buried insights, math that assumes you
            already know the math. For a working engineer this is friction. For
            <span className="mark"> anyone outside the field it's a wall.</span> That wall is what I'm here
            to knock down.
          </p>
          <p>
            So I built superaXiom: type any paper, and it pulls the full PDF, embeds it
            permanently into a local vector store on <em>your</em> machine, and lets
            you either read a structured summary or have a real multi-turn conversation
            with it — math explained, methodology unpacked, no cloud, no account.
          </p>
          <p>
            Upload your own private papers too. Pick any local model via Ollama, or
            bring your own API key. Either way the data stays with you. This is the
            tool I wished existed while I was trying to read
            <em> Attention Is All You Need</em> at 2am. It exists now.
          </p>
        </div>
      </div>

      <div className="principles">
        <div className="section-head">
          <h2><em>Four</em> beliefs I won't budge on.</h2>
          <span className="tag">§ · Principles</span>
        </div>
        <div className="principles-grid">
          <div className="principle">
            <div className="pn">01</div>
            <div><h4>Local <em>by default.</em></h4><p>Your papers, your vectors, your conversations — on your disk, not someone else's server.</p></div>
          </div>
          <div className="principle">
            <div className="pn">02</div>
            <div><h4>Math is <em>explainable.</em></h4><p>Every formula has a plain-English twin. If the model can't explain the math, the model doesn't ship.</p></div>
          </div>
          <div className="principle">
            <div className="pn">03</div>
            <div><h4>Own your <em>library.</em></h4><p>Embedded once, yours forever. No subscription is going to take your research history away.</p></div>
          </div>
          <div className="principle">
            <div className="pn">04</div>
            <div><h4>Ship <em>useful.</em></h4><p>Not demo-ware. Not a thin wrapper. A tool you'd use every day, and one I already do.</p></div>
          </div>
        </div>
      </div>

      <div className="manifesto">
        <div className="uppercase-mono" style={{ opacity:.6, marginBottom: 16 }}>§ · Manifesto</div>
        <div className="manifesto-quote">
          "Research papers are how the future is written. They should not read like a
          <em> locked door.</em> I'm building the key — and I'm handing it to you."
        </div>
        <div style={{ fontFamily:"'Instrument Serif', serif", fontStyle:'italic', fontSize: 18, color:'var(--ink-soft)', marginTop: 16, paddingLeft: 32 }}>
          — Pratham, on why superaXiom exists
        </div>
      </div>

      <div className="contact-strip">
        <h3>Come <em>build</em> / break<br/>things with me.</h3>
        <a href="https://github.com/Pratham-r05" target="_blank" rel="noreferrer">GitHub ↗</a>
        <a href="https://www.linkedin.com/in/pratham-r05/" target="_blank" rel="noreferrer">LinkedIn ↗</a>
      </div>

      <div className="foot" style={{ marginTop: 60 }}>
        <span className="brand">superaXiom</span>
        <span>About · one maker, one mission</span>
        <span>© mmxxvi · Bangalore</span>
      </div>
    </div>
  );
}

// ============ SETTINGS (WIRED) ============
function Settings({ onNavigate }) {
  const [provider, setProvider] = useState('ollama');
  const [model, setModel] = useState('llama3.2');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [apiKeyStatus, setApiKeyStatus] = useState({});
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [availableModels, setAvailableModels] = useState(null);

  useEffect(() => {
    Promise.all([apiConfig(), apiAvailableModels()]).then(([config, models]) => {
      setProvider(config.provider || 'ollama');
      setModel(config.model || 'llama3.2');
      setApiKeyStatus(config.api_key_status || {});
      setAvailableModels(models);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const providers = [
    { id:'ollama', label:'Ollama', ic:'🦙', sub:'Local · free · private', needsKey:false },
    { id:'openrouter', label:'OpenRouter', ic:'⬡', sub:'Cloud · 200+ models · aggregated', needsKey:true },
    { id:'openai', label:'OpenAI', ic:'◉', sub:'Cloud · fastest', needsKey:true },
    { id:'anthropic', label:'Anthropic', ic:'✳', sub:'Cloud · deepest reasoning', needsKey:true },
    { id:'gemini', label:'Gemini', ic:'✦', sub:'Cloud · long context', needsKey:true },
  ];
  const current = providers.find(p => p.id === provider) || providers[0];
  const models = availableModels?.[provider] || [];
  const isCustomModel = model && !models.includes(model);
  const [useCustom, setUseCustom] = useState(false);
  const hasSavedKey = !!apiKeyStatus[provider];
  const keyRemovalPending = current.needsKey && apiKeyDirty && apiKey === '';
  const effectiveKeyPresent = current.needsKey ? (keyRemovalPending ? false : Boolean(apiKey.trim() || hasSavedKey)) : true;

  const handleModelSelect = (m) => {
    setModel(m);
    setUseCustom(false);
  };
  const handleCustomModel = (v) => {
    setModel(v);
    setUseCustom(true);
  };

  const save = async () => {
    await apiUpdateConfig(provider, model, current.needsKey ? (apiKeyDirty ? apiKey : null) : null);
    const config = await apiConfig();
    setProvider(config.provider || provider);
    setModel(config.model || model);
    setApiKeyStatus(config.api_key_status || {});
    setApiKey('');
    setApiKeyDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const maskedKey = apiKey ? apiKey.slice(0,3) + '•'.repeat(Math.max(0, apiKey.length - 6)) + apiKey.slice(-3) : '';

  if (loading) return <div className="query" style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh' }}><div className="mono" style={{ opacity:.5 }}>Loading config…</div></div>;

  return (
    <div className="query" data-screen-label="05 Settings">
      <div className="query-wrap">
        <div className="uppercase-mono" style={{ marginBottom: 16, opacity: .6 }}>
          § · Settings &nbsp;/&nbsp; Model &amp; API
        </div>
        <h1>Your <em>engine,</em><br/>your choice.</h1>
        <div className="subhead">
          Run locally with Ollama, or plug in a cloud provider. Saved API keys stay in local backend config until you replace or remove them.
        </div>

        <div className="form-grid">
          <div className="form-col">
            <div className="field" style={{ borderBottom:'none' }}>
              <label><span>① Provider <span className="req">*</span></span><span>{current.sub}</span></label>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap: 12, marginTop: 10 }}>
                {providers.map(p => (
                  <button type="button" key={p.id} onClick={() => { setProvider(p.id); setModel(availableModels?.[p.id]?.[0] || ''); setUseCustom(false); setApiKey(''); setApiKeyDirty(false); }} style={{
                    textAlign:'left', padding:'18px 20px', cursor:'pointer',
                    background: provider === p.id ? 'var(--ink)' : 'transparent',
                    color: provider === p.id ? 'var(--paper)' : 'var(--ink)',
                    border: '1px solid var(--ink)', borderRadius: 2,
                    display:'flex', flexDirection:'column', gap: 6, transition:'all .2s'
                  }}>
                    <span style={{ fontFamily:"'Bodoni Moda', serif", fontStyle:'italic', fontWeight:700, fontSize: 28, color: 'var(--accent)' }}>{p.ic} {p.label}</span>
                    <span style={{ fontFamily:"'JetBrains Mono', monospace", fontSize: 10, letterSpacing:'.18em', textTransform:'uppercase', opacity:.7 }}>{p.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="field" style={{ borderBottom:'none' }}>
              <label>
                <span>② Model {!useCustom && <span style={{ cursor:'pointer', fontFamily:"'JetBrains Mono', monospace", fontSize:10, letterSpacing:'.1em', textTransform:'uppercase', opacity:.6, marginLeft:12 }} onClick={() => setUseCustom(true)}>or type exact model name ↴</span>}</span>
                <span>{useCustom ? 'custom model name' : `${models.length} available`}</span>
              </label>
              {useCustom ? (
                <div style={{ marginTop: 10 }}>
                  <input
                    type="text"
                    value={model}
                    onChange={e => handleCustomModel(e.target.value)}
                    placeholder={provider === 'openrouter' ? 'e.g. deepseek/deepseek-chat-v3-0324' : provider === 'ollama' ? 'e.g. llama3.2' : 'e.g. gpt-4o'}
                    style={{ width: '100%', background: 'var(--paper-deep)', border: '1px solid var(--ink)', padding: '14px 18px', fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: 'var(--ink)', outline: 'none' }}
                  />
                  <div style={{ marginTop: 8, fontFamily:"'JetBrains Mono', monospace", fontSize: 10, letterSpacing:'.1em', textTransform:'uppercase', opacity:.5 }}>
                    Enter the exact model ID. It will be used as-is.
                  </div>
                  <button type="button" onClick={() => setUseCustom(false)} style={{ marginTop: 8, background: 'none', border: '1px solid var(--rule)', padding: '6px 14px', cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing:'.1em', textTransform:'uppercase' }}>
                    ← back to list
                  </button>
                </div>
              ) : (
                <div className="chips">
                  {models.map(m => (
                    <button type="button" key={m} className={`chip ${model === m ? 'on' : ''}`} onClick={() => handleModelSelect(m)}>
                      <span className="ic">▸</span>{m}
                    </button>
                  ))}
                  {model && isCustomModel && (
                    <button type="button" className="chip on" onClick={() => handleModelSelect(model)}>
                      <span className="ic">▸</span>{model}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="field">
              <label>
                <span>③ API key {current.needsKey ? <span className="req">*</span> : <span style={{opacity:.5}}>(not needed for Ollama)</span>}</span>
                <span onClick={() => setShowKey(s => !s)} style={{ cursor:'pointer' }}>{showKey ? 'hide' : 'show'}</span>
              </label>
              <input type={showKey ? 'text' : 'password'} value={apiKey} onChange={e => { setApiKey(e.target.value); setApiKeyDirty(true); }}
                placeholder={current.needsKey ? (hasSavedKey ? `saved ${current.label} key available — enter new key to replace it` : `your ${current.label} key`) : 'no key required — Ollama runs locally'}
                disabled={!current.needsKey}
                style={{ opacity: current.needsKey ? 1 : .4, fontFamily:"'JetBrains Mono', monospace", fontSize: 18 }}
              />
              {current.needsKey && hasSavedKey && !apiKey && !keyRemovalPending && (
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontFamily:"'JetBrains Mono', monospace", fontSize: 10, letterSpacing:'.1em', textTransform:'uppercase', opacity:.6 }}>
                    saved key available in backend
                  </div>
                  <button
                    type="button"
                    onClick={() => { setApiKey(''); setApiKeyDirty(true); }}
                    style={{ background: 'none', border: '1px solid var(--rule)', padding: '6px 12px', cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase' }}
                  >
                    remove on save
                  </button>
                </div>
              )}
              {provider === 'openrouter' && (
                <div style={{ marginTop: 8, fontFamily:"'Instrument Serif', serif", fontSize: 14, fontStyle:'italic', color:'var(--accent)', opacity:.7 }}>
                  Get your key at openrouter.ai/keys — works with 200+ models, pay-per-token.
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="paper-preview" style={{ transform:'rotate(-.6deg)' }}>
              <div className="label">Current config · live from backend</div>
              <h4 style={{ fontFamily:"'Bodoni Moda', serif", fontStyle:'italic', fontWeight:700 }}>{current.label}</h4>
              <div className="authors" style={{ fontFamily:"'JetBrains Mono', monospace", fontStyle:'normal', fontSize: 12, letterSpacing:'.1em' }}>{model}</div>
              <div className="meta-row">
                <span>key · {current.needsKey ? (apiKey ? maskedKey || '•••' : (keyRemovalPending ? 'will remove' : (hasSavedKey ? 'available' : 'not set'))) : 'n/a'}</span>
                <span className={effectiveKeyPresent ? 'status-dot' : ''}>
                  {effectiveKeyPresent ? '● ready' : '○ missing'}
                </span>
              </div>
            </div>

            <div style={{ marginTop: 24, fontFamily:"'Instrument Serif', serif", fontSize: 15, fontStyle:'italic', color:'var(--muted)', lineHeight: 1.45 }}>
              Swap providers any time — the model router hot-switches without restarting. Type any exact model name for models not in the list.
            </div>
          </div>
        </div>

        <button type="button" className="summarize-btn" onClick={save}>
          <div style={{ display:'flex', flexDirection:'column', gap: 8 }}>
            <span className="sub">{saved ? 'Saved ✓' : 'Sync to backend →'}</span>
            <span>{saved ? <>Saved <em style={{fontStyle:'italic', color:'var(--accent)'}}>successfully.</em></> : <>Save <em style={{fontStyle:'italic', color:'var(--accent)'}}>settings.</em></>}</span>
          </div>
          <span className="go">{saved ? '✓' : '↗'}</span>
        </button>

        <div className="foot" style={{ marginTop: 80 }}>
          <span className="brand">superaXiom</span>
          <span>Settings · model router v2.0</span>
          <span>{provider} / {model}</span>
        </div>
      </div>
    </div>
  );
}

// ============ APP ============
function App() {
  const [screen, setScreen] = useState(() => {
    try {
      const savedScreen = localStorage.getItem('sa_screen') || 'landing';
      if (savedScreen === 'loading') {
        const savedSummary = readStoredJson('sa_summary_state', null);
        return savedSummary?.text ? 'analysis' : 'query';
      }
      return savedScreen;
    } catch {
      return 'landing';
    }
  });
  const [summaryState, setSummaryState] = useState(() => readStoredJson('sa_summary_state', { text: '', paper: null, mode: '', length: '' }));

  useEffect(() => {
    try { localStorage.setItem('sa_screen', screen); } catch {}
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [screen]);

  useEffect(() => {
    writeStoredJson('sa_summary_state', summaryState);
  }, [summaryState]);

  const navigate = useCallback((s) => setScreen(s), []);

  const handleSubmit = (q) => {
    setSummaryState({ text: '', paper: q.paper, mode: q.mode, length: q.length, question: q.question });
    setScreen('loading');
  };

  const handleSummaryDone = useCallback((text, paper, mode, length) => {
    if (!paper) { setScreen('query'); return; }
    setSummaryState({ text, paper, mode, length });
    setScreen('analysis');
  }, []);

  const showNav = screen !== 'loading';
  const navActive = { settings: 'settings', about: 'about', techstack: 'techstack' }[screen];

  return (
    <>
      {showNav && <PillNav active={navActive} onNavigate={navigate} />}
      {screen === 'landing'  && <Landing onNavigate={navigate} />}
      {screen === 'query'    && <QueryPage onNavigate={navigate} onSubmit={handleSubmit} />}
      {screen === 'loading'  && <Loading paper={summaryState.paper} mode={summaryState.mode} length={summaryState.length} question={summaryState.question || ''} onDone={handleSummaryDone} />}
      {screen === 'analysis' && <Analysis summaryText={summaryState.text} paper={summaryState.paper} mode={summaryState.mode} length={summaryState.length} onNavigate={navigate} />}
      {screen === 'settings' && <Settings onNavigate={navigate} />}
      {screen === 'about' && <About onNavigate={navigate} />}
      {screen === 'techstack' && <TechStack onNavigate={navigate} />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('app')).render(<App />);
