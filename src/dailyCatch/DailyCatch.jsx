import { useEffect, useMemo, useState } from 'react';
import { asLibraryPaper, chooseCatch, localDay, paperKey } from './engine';
import { fetchDiscoveries } from './discovery';
import './DailyCatch.css';

const storeKey = identity => `paperreef-dailycatch-v1:${identity || 'local'}`;
function readStore(identity) {
  try { return JSON.parse(localStorage.getItem(storeKey(identity)) || '{}'); }
  catch { return {}; }
}

export default function DailyCatch({ papers, userId, enabled = true, onMarkRead, onSavePaper }) {
  const [state, setState] = useState(() => readStore(userId));
  const [open, setOpen] = useState(false);
  const [discoveries, setDiscoveries] = useState([]);
  const [feedError, setFeedError] = useState('');
  const [loading, setLoading] = useState(true);
  const today = localDay();
  const history = useMemo(() => state.history || [], [state.history]);
  const catchOfDay = state.current?.date === today ? state.current : null;
  const paper = catchOfDay?.category === 'backlog'
    ? papers.find(p => p.id === catchOfDay.paper.id) || catchOfDay.paper
    : catchOfDay?.paper;
  const done = Boolean(catchOfDay && (catchOfDay.completed || papers.some(p => p.isRead && paperKey(p) === catchOfDay.key)));

  useEffect(() => { setState(readStore(userId)); }, [userId]);
  useEffect(() => { localStorage.setItem(storeKey(userId), JSON.stringify(state)); }, [state, userId]);
  useEffect(() => {
    let alive = true;
    const cacheKey = 'paperreef-discovery-cache-v1';
    let cached = [];
    try { cached = JSON.parse(localStorage.getItem(cacheKey) || '[]'); } catch { /* ignore */ }
    setDiscoveries(cached);
    fetchDiscoveries().then(items => {
      if (!alive) return;
      const byId = new Map([...cached, ...items].map(p => [p.id,p]));
      const merged = [...byId.values()].slice(-500);
      setDiscoveries(merged);
      localStorage.setItem(cacheKey, JSON.stringify(merged));
    }).catch(error => { if (alive) setFeedError(error.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // Once a day, choose automatically when visiting the page. No misleading placeholder paper.
  useEffect(() => {
    if (!enabled || loading || catchOfDay || state.current?.date === today) return;
    const chosen = chooseCatch({ saved: papers, discoveries, history, today });
    if (chosen) setState(prev => ({ ...prev, current: chosen, history: [...(prev.history || []), { date: today, key: chosen.key }].slice(-365) }));
  }, [loading, today, catchOfDay, papers, discoveries, history, state.current?.date, enabled]);

  const reroll = () => {
    if (!catchOfDay || catchOfDay.rerolls >= 1 || done) return;
    const candidate = chooseCatch({ saved: papers, discoveries, history: [...history, { date:today, key:catchOfDay.key }], today });
    if (!candidate) return;
    candidate.rerolls = catchOfDay.rerolls + 1;
    setState(prev => ({ ...prev, current: candidate, history: [...history,{date:today,key:candidate.key}].slice(-365) }));
  };

  const markRead = () => {
    if (!paper || done) return;
    if (catchOfDay.category === 'backlog') onMarkRead(paper.id);
    else {
      const existing = papers.find(p => paperKey(p) === paperKey(paper));
      if (existing) onMarkRead(existing.id);
      else onSavePaper({ ...asLibraryPaper(paper), isRead: true });
    }
    setState(prev => ({ ...prev, current: { ...prev.current, completed: true } }));
  };

  const save = () => {
    if (!paper || papers.some(p => paperKey(p) === paperKey(paper))) return;
    onSavePaper(asLibraryPaper(paper));
  };

  const label = { backlog: 'MY BACKLOG', trending: 'TRENDING NOW', forYou: 'FOR YOU', wild: 'WILD CARD' }[catchOfDay?.category];
  return <>
    <button type="button" className="dc-launcher" onClick={() => setOpen(v => !v)} aria-expanded={open}>🐠 Daily Catch {done ? "✓" : ""}</button>
    {open && <section className="daily-catch" aria-label="Today's Catch">
    <div className="dc-heading"><div><span className="dc-kicker">🐠 DAILY CATCH · {today}</span><h2>Today's Catch</h2></div><span className="dc-rule">50% saved · 50% new</span></div>
    {!catchOfDay && <div className="dc-empty">{loading ? 'Casting the net…' : 'No papers in the net yet. Save a paper or check the discovery feed.'}</div>}
    {paper && <div className="dc-paper">
      <div className="dc-top"><span className="dc-category">{label}</span><span className="dc-status">{done ? '✓ READ' : '○ TO READ'}</span></div>
      <h3>{paper.title}</h3>
      <p className="dc-meta">{paper.authors || 'Authors unavailable'} {paper.year ? `· ${paper.year}` : ''}</p>
      {paper.summary && <p className="dc-summary">{paper.summary.length > 450 ? `${paper.summary.slice(0,450)}…` : paper.summary}</p>}
      <div className="dc-actions">
        {paper.url && <a className="dc-primary" href={paper.url} target="_blank" rel="noreferrer">↗ OPEN PAPER</a>}
        <button disabled={done} onClick={markRead}>{done ? '✓ COMPLETED' : '✓ MARK AS READ'}</button>
        {catchOfDay.category !== 'backlog' && !papers.some(p => paperKey(p) === paperKey(paper)) && <button onClick={save}>+ SAVE</button>}
        <button onClick={reroll} disabled={done || catchOfDay.rerolls >= 1}>↻ REROLL {catchOfDay.rerolls ? '(0 LEFT)' : '(1 LEFT)'}</button>
      </div>
    </div>}
    {feedError && <p className="dc-warning">Discovery feed unavailable ({feedError}). Saved papers still work.</p>}
    <p className="dc-foot">One paper a day. No guilt if you miss one. Just return tomorrow.</p>
  </section>}
  </>;
}
