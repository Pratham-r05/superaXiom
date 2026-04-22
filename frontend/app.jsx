const { useState, useEffect, useRef, useCallback } = React;

const API = 'https://endraode-7--axiom-fastapi-app.modal.run';

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

async function apiEmbedStatus(arxivId) {
  const r = await fetch(`${API}/api/search/embed-status/${arxivId}`);
  return r.json();
}

async function apiLocalPaperReady(paperId) {
  try {
    const r = await fetch(`${API}/api/upload/list`);
    const data = await r.json();
    const found = (data.papers || []).find(p => p.paper_id === paperId);
    if (found?.error) throw new Error(`Embedding failed: ${found.error}`);
    return found?.ready === true;
  } catch (e) {
    if (e.message.startsWith('Embedding failed')) throw e; // propagate backend errors
    return false; // network errors — keep retrying
  }
}

function isLocalPaper(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
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

// pollUntilReady is no longer used — Loading polls embed-status directly.

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
  const [pendingFileName, setPendingFileName] = useState(null);
  const [localPapers, setLocalPapers] = useState([]);
  const searchTimer = useRef(null);
  const abortRef = useRef(null);

  // Load previously uploaded papers on mount
  useEffect(() => {
    fetch(`${API}/api/upload/list`)
      .then(r => r.json())
      .then(data => setLocalPapers(data.papers || []))
      .catch(() => {});
  }, []);

  const handleDeleteUpload = async (paperId) => {
    try {
      await fetch(`${API}/api/upload/${paperId}`, { method: 'DELETE' });
      setLocalPapers(prev => prev.filter(p => p.paper_id !== paperId));
      if (selectedPaper?.id === paperId) {
        setSelectedPaper(null);
        setSearchQuery('');
        setUploadStatus(null);
      }
    } catch {}
  };

  useEffect(() => {
    if (selectedPaper?.source === 'local') {
      setSearching(false);
      setSearchResults([]);
      return;
    }

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
    e.target.value = '';
    setPendingFileName(file.name);
    setUploading(true);
    setUploadStatus(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await fetch(`${API}/api/upload/pdf`, { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) {
        const msg = data?.detail?.error || data?.detail || `Upload failed (${r.status})`;
        setUploadStatus({ error: String(msg) });
      } else {
        const uploaded = {
          id: data.paper_id,
          title: data.title || file.name.replace(/\.pdf$/i, ''),
          authors: data.authors || [],
          year: 0,
          abstract: '',
          source: 'local',
          cached: false,
        };
        selectPaper(uploaded);
        setUploadStatus({ title: uploaded.title, page_count: data.page_count });
        // Add to local papers list immediately so it shows in "Previously uploaded"
        setLocalPapers(prev => [{
          paper_id: data.paper_id, title: uploaded.title,
          authors: uploaded.authors, ready: false, error: null,
          uploaded_at: Date.now() / 1000,
        }, ...prev]);
      }
    } catch (err) {
      setUploadStatus({ error: err.message });
    }
    setUploading(false);
    setPendingFileName(null);
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
                <div className="upload-icon" style={{ color: uploadStatus?.error ? 'var(--accent)' : undefined }}>
                  {uploading ? '⏳' : uploadStatus?.error ? '✗' : '⬆'}
                </div>
                <div className="upload-title">
                  {uploading
                    ? (pendingFileName ? `Uploading ${pendingFileName}…` : 'Uploading…')
                    : uploadStatus?.error ? 'Upload failed'
                    : 'Drop a PDF here'}
                </div>
                <div className="upload-sub">
                  {uploadStatus?.error
                    ? <span style={{ color: 'var(--accent)', fontStyle: 'italic' }}>{uploadStatus.error}</span>
                    : <span>or <u>browse files</u> — up to 50 MB</span>}
                </div>
              </label>
              <div className="upload-foot">
                {uploadStatus?.error ? (
                  <span style={{ color: 'var(--accent)' }}>✗ Error — try again</span>
                ) : uploadStatus ? (
                  <span style={{ color: 'var(--ok)' }}>
                    ✓ {uploadStatus.title || 'Uploaded'}
                    {uploadStatus.page_count ? ` · ${uploadStatus.page_count} pages` : ''}
                  </span>
                ) : (
                  <span>● Ready</span>
                )}
              </div>
            </div>

            {selectedPaper && (
              <div className="paper-preview" style={{ marginTop: 24 }}>
                <div className="label">
                  {selectedPaper.source === 'local' ? 'Local PDF · embedding in background' : 'Preview · will be indexed'}
                </div>
                <h4>{selectedPaper.title}</h4>
                <div className="authors">{selectedPaper.authors?.join(', ') || 'Unknown authors'}</div>
                <div className="meta-row">
                  <span>
                    {selectedPaper.source === 'local'
                      ? `Local · ${selectedPaper.id.slice(0, 8)}…`
                      : `arXiv · ${selectedPaper.id}`}
                  </span>
                  <span className={selectedPaper.cached ? 'status-dot' : ''}>
                    {selectedPaper.source === 'local'
                      ? '⏳ embedding…'
                      : selectedPaper.cached ? '● ready' : '○ will prefetch'}
                  </span>
                </div>
              </div>
            )}

            {localPapers.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div className="label" style={{ marginBottom: 10 }}>Previously uploaded</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {localPapers.map(p => (
                    <div key={p.paper_id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 12px', border: '1px solid var(--rule)', borderRadius: 4,
                      background: selectedPaper?.id === p.paper_id ? 'rgba(139,111,71,0.08)' : 'transparent',
                    }}>
                      <button
                        type="button"
                        onClick={() => selectPaper({
                          id: p.paper_id,
                          title: p.title,
                          authors: p.authors || [],
                          year: 0,
                          abstract: '',
                          source: 'local',
                          cached: p.ready,
                        })}
                        style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', flex: 1, padding: 0 }}
                      >
                        <div style={{ fontFamily: 'Instrument Serif, serif', fontSize: 14, color: 'var(--ink)' }}>
                          {p.title}
                        </div>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
                          {p.error
                            ? <span style={{ color: 'var(--accent)' }}>✗ embedding failed</span>
                            : p.ready ? '● ready' : '○ embedding…'}
                        </div>
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => handleDeleteUpload(p.paper_id)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--muted)', fontSize: 16, padding: '0 4px',
                          lineHeight: 1, flexShrink: 0,
                        }}
                      >×</button>
                    </div>
                  ))}
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
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let xhr = null;
    const startTime = Date.now();

    // Elapsed-time ticker — runs independently of polling
    const ticker = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    const run = async () => {
      try {
        setStage('Checking if paper is cached…');
        setProgress(10);

        if (isLocalPaper(paper.id)) {
          // ── Local uploaded PDF — embedding already started on upload ─────
          // Poll /api/upload/list until the vectors are in ChromaDB.
          // No hard cap — stop only when ready. Large PDFs can take 10+ min on CPU-only Ollama.
          let ready = false;
          let pollInterval = 2000; // start fast, slow down after 2 min
          while (!cancelled) {
            ready = await apiLocalPaperReady(paper.id);
            if (ready) break;
            const secs = Math.floor((Date.now() - startTime) / 1000);
            const mins = Math.floor(secs / 60);
            const remSecs = secs % 60;
            const elapsed = mins > 0
              ? `${mins}m ${remSecs}s elapsed`
              : `${secs}s elapsed`;
            setStage(`Embedding with nomic-embed-text… ${elapsed} — large PDFs can take a few minutes`);
            setProgress(20 + Math.min(65, Math.log1p(secs) * 10));
            // Slow the poll rate down after 2 minutes to reduce server load
            if (secs > 120) pollInterval = 5000;
            await new Promise(r => setTimeout(r, pollInterval));
          }
          if (!ready) return; // cancelled
        } else {
          // ── arXiv paper ────────────────────────────────────────────────
        const meta = await apiPaperMeta(paper.id);
        if (cancelled) return;

        if (meta.cached) {
          setStage('Paper already indexed · starting summary…');
          setEmbedReady(true);
          setProgress(85);
        } else {
          setStage('Queuing paper for indexing…');
          setProgress(15);
          await apiPrefetch(paper.id);
          if (cancelled) return;

          // ── Poll embed-status until done or error ───────────────────────
          // NO hard timeout — we stop only when the backend says done/error.
          // Large papers with many chunks can take 5-10 min; that is normal.
          while (!cancelled) {
            const status = await apiEmbedStatus(paper.id);
            if (cancelled) return;

            if (status.status === 'done') {
              break; // fall through to summary stream
            }

            if (status.status === 'error') {
              throw new Error(status.error || 'Embedding failed — check backend logs.');
            }

            // Still running — update UI from backend stage string
            const backendStage = status.stage || 'Processing…';
            setStage(backendStage);

            // Animate progress bar from 15 → 82 proportionally to elapsed time.
            // We don't know total time, so we use a logarithmic curve so it
            // always creeps forward without ever reaching 82 on its own.
            const secs = Math.floor((Date.now() - startTime) / 1000);
            const fakeP = Math.min(82, 15 + Math.log1p(secs) * 10);
            setProgress(fakeP);

            await new Promise(r => setTimeout(r, 3000));
          }
          if (cancelled) return;

          setProgress(88);
          setStage('Indexed · building summary…');
          setEmbedReady(true);
        }
        } // end arXiv else-branch

        // ── SSE summarization stream ─────────────────────────────────────
        setProgress(90);
        let fullText = '';
        xhr = streamSSE(
          `${API}/api/summarize/stream`,
          { paper_id: paper.id, mode, length, user_questions: question },
          (token) => {
            fullText += token;
            setProgress(90 + Math.min(9, fullText.length / 200));
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
    return () => {
      cancelled = true;
      clearInterval(ticker);
      if (xhr) xhr.abort();
    };
  }, [paper, mode, length, question, onDone]);

  // Freeze streaks array so it doesn't re-randomise on every render
  const streaks = useRef(null);
  if (!streaks.current) {
    streaks.current = Array.from({ length: 120 }, (_, i) => {
      const angle = (i / 120) * 360 + (Math.random() * 6 - 3);
      const len   = 60 + Math.random() * 340;
      const delay = Math.random() * 2;
      const dur   = 0.6 + Math.random() * 1.1;
      const isRed = i % 11 === 0;
      return (
        <div key={i} className={`streak ${isRed ? 'red' : ''}`} style={{
          height: `${len}px`, transform: `translate(-50%, 0) rotate(${angle}deg)`,
          animation: `streakFly ${dur}s linear ${delay}s infinite`,
        }} />
      );
    });
  }

  const fmtElapsed = (s) => {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  if (error) {
    return (
      <div className="loading-scene" data-screen-label="03 Loading">
        <div className="loading-content">
          <div className="brand">superaXiom</div>
          <h1 style={{ color: 'var(--accent)' }}>Something went <em>wrong.</em></h1>
          <div className="sub" style={{ marginTop: 20, maxWidth: 560, lineHeight: 1.5 }}>{error}</div>
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
      <div className="streaks-bg">{streaks.current}</div>
      <div className="loading-content">
        <div className="brand">superaXiom</div>
        <h1>Going <em>hyperspeed</em><br/>through your paper.</h1>
        <div className="sub">{paper.title}</div>
        <div className="loading-progress">
          <div className="bar" style={{ width: `${progress}%` }} />
        </div>
        <div className="loading-stages">› {stage}</div>
        {elapsed >= 20 && (
          <div style={{
            marginTop: 14,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: '.2em',
            textTransform: 'uppercase',
            opacity: .55,
          }}>
            {elapsed >= 120
              ? `Large paper — still indexing · ${fmtElapsed(elapsed)} elapsed`
              : `Indexing · ${fmtElapsed(elapsed)} elapsed`}
          </div>
        )}
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
  const [embedReady, setEmbedReady] = useState(false);
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
    // Order matters: $$ before $; \[ and \( use [\s\S]+? (dotall) so nested parens/brackets work
    const parts = text.split(/(\$\$[\s\S]+?\$\$|\$(?!\$)[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, i) => {
      // Display math: $$...$$ or \[...\]
      if ((part.startsWith('$$') && part.endsWith('$$')) ||
          (part.startsWith('\\[') && part.endsWith('\\]'))) {
        const latex = part.slice(2, -2).trim();
        try {
          if (window.katex) {
            const html = window.katex.renderToString(latex, { displayMode: true, throwOnError: false, output: 'html' });
            return <span key={i} style={{ display: 'block', margin: '16px 0' }} dangerouslySetInnerHTML={{ __html: html }} />;
          }
        } catch {}
        return <div key={i} className="formula">{latex}</div>;
      }
      // Inline math: $...$ or \(...\)
      if (part.startsWith('$') && part.endsWith('$')) {
        return <span key={i}>{katexInline(part.slice(1, -1))}</span>;
      }
      if (part.startsWith('\\(') && part.endsWith('\\)')) {
        return <span key={i}>{katexInline(part.slice(2, -2))}</span>;
      }
      // Bold: **...**
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      // Code: `...`
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i} className="inline-code" style={{ background: 'var(--paper-deep)', padding: '2px 6px', borderRadius: 3, fontSize: '0.92em' }}>{part.slice(1, -1)}</code>;
      }
      // Italic: *...*
      const italicParts = part.split(/(\*[^*\n]+\*)/g);
      if (italicParts.length > 1 && italicParts.some((p, idx) => idx % 2 === 1)) {
        return <span key={i}>{italicParts.map((p, j) => j % 2 === 1 && p.length > 2 ? <em key={j}>{p.slice(1, -1)}</em> : p)}</span>;
      }
      return part;
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
          const el = qaMessagesRef.current;
          const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          if (isNearBottom) el.scrollTop = el.scrollHeight;
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

  const handleDownloadPDF = useCallback(() => {
    const prevTitle = document.title;
    document.title = `${paper?.title || 'Analysis'} — superaXiom`;
    const onAfterPrint = () => {
      document.title = prevTitle;
      window.removeEventListener('afterprint', onAfterPrint);
    };
    window.addEventListener('afterprint', onAfterPrint);
    window.print();
  }, [paper]);

  const modeLabels = { beginner: 'Beginner', mathematical: 'Mathematical', technical: 'Technical', intuitive: 'Intuitive' };

  const cleanSectionTitle = (title = '') =>
    title
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

  return (
    <div className="analysis" data-screen-label="04 Analysis">
      <div className="analysis-wrap">
        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          <button className="back-btn" onClick={() => onNavigate('query')}>
            ← Back to Query
          </button>
          <button className="zupp-btn" type="button" onClick={handleDownloadPDF}>
            ↓ ZUPP
          </button>
        </div>
        <div className="paper-header">
          <div>
            <div className="meta-top">
              <span>
                {paper?.source === 'local'
                  ? `Local PDF · ${paper?.id?.slice(0, 8) || '—'}…`
                  : `arXiv · ${paper?.id || '—'}`}
              </span>
              <span className="dot">●</span>
              <span>Mode · {modeLabels[mode] || mode}</span>
              <span className="dot">●</span>
              <span>Length · {length}</span>
              <span className="dot">●</span>
              <span>Generated · {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </div>
            <h1>{paper?.title || 'Paper'}.</h1>
            <div className="authors">{paper?.authors?.length ? paper.authors.join(', ') : (paper?.source === 'local' ? 'Local document' : 'Unknown authors')}</div>
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
                  <span className="num">§{i+1}</span><span>{cleanSectionTitle(s.title)}</span>
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
                  <h2><span className="section-num">§{i+1}</span>{cleanSectionTitle(s.title)}</h2>
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
                disabled={!qaQuestion.trim() || !embedReady}
                style={{ background: 'var(--accent)', color: 'var(--paper)', border: 'none', padding: '14px 28px', fontFamily: "'Bodoni Moda', serif", fontWeight: 700, fontStyle: 'italic', fontSize: 18, cursor: (!qaQuestion.trim() || !embedReady) ? 'not-allowed' : 'pointer', opacity: (!qaQuestion.trim() || !embedReady) ? 0.5 : 1 }}
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
            <img src="data:image/jpeg;base64,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BeP9XtzNFcTMyxKrsx/uvJv+Svj7VLz7Rq8srE5+YLz/AH93y0AbGneMde0y2extLhoI3b5gtYlzfXF7J591K0jN/eO6om24G3rt21D8ozzye1ACkLnd2pMcnNKxXG3+7TTyBzQA7PyttHNNCsRzSA/LuyKUb89KAJO5VT2qIbgck80pPPtRs+bmgCRt2OtDIuOOtRYPrUp28beq9aAAqqdabjqoxQeTyeKbldpXvQAetNGQ3IqRc55PFNY8HJ4oAGIzz0NMHU5p3y4O2jPBz36UARktx6049O2KNy4waax5GKAAnndj71OLfL7Co87flagFt3PSgAJbBVgcVFt52r3FSk8nIoO3722gAQtjp92oyeo9ak3f3elNUrtNACfLzyP8aax5AxRnHbmgnf17UALhRzTCF7fjSd884p5PPH40AMxjp0prHnaPwpQf4uMfWkY5PSgBpG35jSZz8xzmn9jjv603OM96AHMSflPFNJUfewaYD1yajO0k7aAHN13A8UF6UNt6iojuPzLQA5jzuBpo3fxdaadyg88Go3ditADn+UH/AGqiz69NtS9utNfaw3UARn5vunmoztU7VFSDbu+WmnuVH3aAIzu+8cVH8ufant23VH8zUAf/0PxDpFLL96k+78zHO7+Gn7flG2gByfN25+tAH8XamnqW607t67qAHf7K07PG3v60fN/COaBtb5v9mgBq9fmo79PvUfdUtmnhuOKAH59qRduDUePU08L/AAr0oAcOvy/w0Z28nvTSfmoXcx+X+GgCb5W29qd83OOlRDr83enn5flXmgA9GGakB5Ckfw01CyjaTQPc/nQAbV7nmj5t3y0nbrzSjdndQA75eM075WJ60Ffl3NRu4+WgA77cmnb9p5OTTfmyNtO2qdu3qvzGgBw5PIppXn2Wgtk9aUbc9sUAKDz8tSZXnjIqNF2521MPpQA49Pao16nHSgsv3cfep/y8qBQA3t83WjPT/vk0bedw60ZOSvPpQAoKn5QKB7dKb83K0fMrfKKAHZYH5TTs8Umev+z1pwfg46UANPXg04Z5JppK7eTxSj2NABnil28dOabj5qcSMigAHX2FV5ot+11IzHzU3Uc075SOTQBo2En2SeCbgruXdz/C9e42jy+WyN8zzx/K2futu314Nprq0TW5YK/3V3V7Lo+ofZlgijId1VPmb+983zb6APQ9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" alt="Pratham Raj" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} onError={e => { e.target.style.display='none'; }} />
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
  const [screen, setScreen] = useState('landing');
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
