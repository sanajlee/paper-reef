import { useEffect, useMemo, useRef, useState } from 'react';
import { asLibraryPaper, chooseCatch, localDay, paperKey } from './engine';
import { fetchDiscoveries } from './discovery';
import { createCatch, loadCatches, updateCatch } from './sync';
import './DailyCatch.css';

const storeKey = identity => `paperreef-dailycatch-v1:${identity || 'local'}`;
function readStore(identity) {
  try { return JSON.parse(localStorage.getItem(storeKey(identity)) || '{}'); }
  catch { return {}; }
}

export default function DailyCatch({ papers, userId, enabled = true, onMarkRead, onSavePaper }) {
  const signedIn = !!userId && userId !== 'local';
  const today = localDay();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({});
  const [rows, setRows] = useState([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [discoveries, setDiscoveries] = useState([]);
  const [feedError, setFeedError] = useState('');
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);
  const identityRef = useRef(userId);
  identityRef.current = userId;

  const currentRow = signedIn ? rows.find(r => r.catch_date === today) : null;
  const catchOfDay = signedIn ? (currentRow?.assignment || null) : (state.current?.date === today ? state.current : null);
  const history = useMemo(() => signedIn
    ? rows.map(r => ({ date: r.catch_date, key: r.assignment?.key })).filter(r => r.key)
    : (state.history || []), [signedIn, rows, state.history]);
  const paper = catchOfDay?.category === 'backlog'
    ? papers.find(p => p.id === catchOfDay.paper.id) || catchOfDay.paper
    : catchOfDay?.paper;
  const done = Boolean(catchOfDay && (catchOfDay.completed || papers.some(p => p.isRead && paperKey(p) === catchOfDay.key)));

  // Never write remote state before the first remote read completes.
  useEffect(() => {
    let alive = true;
    setReady(false);
    setRows([]);
    setState({});
    setSyncError('');
    inFlight.current = false;
    if (!signedIn) {
      setState(readStore('local'));
      setReady(true);
    } else {
      loadCatches(userId, localDay()).then(data => {
        if (alive) { setRows(data); setReady(true); }
      }).catch(err => {
        if (alive) { setSyncError(`Daily Catch sync unavailable: ${err.message}`); setReady(false); }
      });
    }
    return () => { alive = false; };
  }, [userId, signedIn]);

  useEffect(() => {
    if (ready && !signedIn) localStorage.setItem(storeKey('local'), JSON.stringify(state));
  }, [state, ready, signedIn]);

  useEffect(() => {
    let alive = true;
    const cacheKey = 'paperreef-discovery-cache-v1';
    let cached = [];
    try { cached = JSON.parse(localStorage.getItem(cacheKey) || '[]'); } catch { /* ignore */ }
    setDiscoveries(cached);
    fetchDiscoveries().then(items => {
      if (!alive) return;
      const byId = new Map([...cached, ...items].map(p => [p.id, p]));
      const merged = [...byId.values()].slice(-500);
      setDiscoveries(merged);
      localStorage.setItem(cacheKey, JSON.stringify(merged));
    }).catch(err => { if (alive) setFeedError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // A DB primary key arbitrates simultaneous first visits from multiple devices.
  useEffect(() => {
    if (!ready || !enabled || loading || catchOfDay || inFlight.current) return;
    const selected = chooseCatch({ saved: papers, discoveries, history, today });
    if (!selected) return;
    inFlight.current = true;
    if (!signedIn) {
      setState(prev => ({ ...prev, current: selected,
        history: [...(prev.history || []), { date: today, key: selected.key }].slice(-365) }));
      inFlight.current = false;
      return;
    }
    const identity = userId;
    createCatch(userId, selected).then(row => {
      if (identityRef.current === identity) setRows(prev => [row, ...prev.filter(r => r.catch_date !== today)].slice(0, 16));
    }).catch(err => { if (identityRef.current === identity) { setSyncError(err.message); setReady(false); } })
      .finally(() => { inFlight.current = false; });
  }, [ready, enabled, loading, catchOfDay, papers, discoveries, history, today, signedIn, userId]);

  async function commit(next) {
    if (!signedIn) {
      setState(prev => ({ ...prev, current: next,
        history: [...(prev.history || []), { date: today, key: next.key }].slice(-365) }));
      return next;
    }
    const identity = userId;
    const updated = await updateCatch(userId, today, next, currentRow.revision);
    if (identityRef.current === identity) setRows(prev => prev.map(r => r.catch_date === today ? updated : r));
    return updated.assignment;
  }

  async function reroll() {
    if (!catchOfDay || catchOfDay.rerolls >= 1 || done || busy) return;
    const candidate = chooseCatch({ saved: papers, discoveries,
      history: [...history, { date: today, key: catchOfDay.key }], today });
    if (!candidate) return;
    candidate.rerolls = catchOfDay.rerolls + 1;
    setBusy(true);
    try { const saved = await commit(candidate); if (saved.key !== candidate.key || saved.rerolls !== candidate.rerolls) setSyncError('Another device updated today’s catch. Showing the latest version.'); else setSyncError(''); }
    catch (err) { setSyncError(`Reroll was not saved: ${err.message}`); }
    finally { setBusy(false); }
  }

  async function markRead() {
    if (!paper || done || busy) return;
    setBusy(true);
    try {
      const updated = await commit({ ...catchOfDay, completed: true });
      if (!updated.completed || updated.key !== catchOfDay.key) { setSyncError('Catch changed on another device. Reload before marking read.'); return; }
      if (catchOfDay.category === 'backlog') onMarkRead(paper.id);
      else {
        const existing = papers.find(p => paperKey(p) === paperKey(paper));
        if (existing) onMarkRead(existing.id);
        else onSavePaper({ ...asLibraryPaper(paper), isRead: true });
      }
      setSyncError('');
    } catch (err) { setSyncError(`Read status was not saved: ${err.message}`); }
    finally { setBusy(false); }
  }

  function save() {
    if (!paper || busy || papers.some(p => paperKey(p) === paperKey(paper))) return;
    onSavePaper(asLibraryPaper(paper));
  }

  async function refresh() {
    if (!signedIn || busy) return;
    setBusy(true);
    try { setRows(await loadCatches(userId, localDay())); setSyncError(''); setReady(true); }
    catch (err) { setSyncError(err.message); }
    finally { setBusy(false); }
  }

  const label = { backlog: 'MY BACKLOG', trending: 'TRENDING NOW', forYou: 'FOR YOU', wild: 'WILD CARD' }[catchOfDay?.category];
  return <>
    <button type="button" className="dc-launcher" onClick={() => setOpen(v => !v)} aria-expanded={open}>🐠 Daily Catch {done ? '✓' : ''}</button>
    {open && <section className="daily-catch" aria-label="Today's Catch">
      <div className="dc-heading"><div><span className="dc-kicker">🐠 DAILY CATCH · {today}</span><h2>Today's Catch</h2></div><span className="dc-rule">50% saved · 50% new</span></div>
      <p className="dc-sync">{signedIn ? (ready ? '☁ Synced with account' : '☁ Connecting…') : '⌂ Local only · sign in to sync'} {signedIn && <button onClick={refresh} disabled={busy}>↻ Refresh</button>}</p>
      {syncError && <p className="dc-warning" role="alert">{syncError}</p>}
      {!catchOfDay && <div className="dc-empty">{!ready ? 'Loading today’s catch…' : loading ? 'Casting the net…' : 'No papers in the net yet. Save a paper or check the discovery feed.'}</div>}
      {paper && <div className="dc-paper">
        <div className="dc-top"><span className="dc-category">{label}</span><span className="dc-status">{done ? '✓ READ' : '○ TO READ'}</span></div>
        <h3>{paper.title}</h3>
        <p className="dc-meta">{paper.authors || 'Authors unavailable'} {paper.year ? `· ${paper.year}` : ''}</p>
        {paper.summary && <p className="dc-summary">{paper.summary.length > 450 ? `${paper.summary.slice(0, 450)}…` : paper.summary}</p>}
        <div className="dc-actions">
          {paper.url && <a className="dc-primary" href={paper.url} target="_blank" rel="noreferrer">↗ OPEN PAPER</a>}
          <button disabled={done || busy} onClick={markRead}>{done ? '✓ COMPLETED' : '✓ MARK AS READ'}</button>
          {catchOfDay.category !== 'backlog' && !papers.some(p => paperKey(p) === paperKey(paper)) && <button onClick={save} disabled={busy}>+ SAVE</button>}
          <button onClick={reroll} disabled={done || busy || catchOfDay.rerolls >= 1}>↻ REROLL {catchOfDay.rerolls ? '(0 LEFT)' : '(1 LEFT)'}</button>
        </div>
      </div>}
      {feedError && <p className="dc-warning">Discovery feed unavailable ({feedError}). Saved papers still work.</p>}
      <p className="dc-foot">One paper a day. Keep the reef growing.</p>
    </section>}
  </>;
}
