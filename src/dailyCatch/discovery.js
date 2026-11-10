// Public, no-key candidate feed. Failure is nonfatal: the backlog still works.
// Upvotes are a coarse popularity proxy, not proof of scientific importance.
const API = 'https://huggingface.co/api/daily_papers';

function mapPaper(item) {
  const p = item.paper || item;
  const id = p.id || item.id;
  if (!id || !p.title) return null;
  const authorNames = (p.authors || []).map(a => typeof a === 'string' ? a : a.name).filter(Boolean);
  return {
    id, title: p.title, summary: p.summary || p.abstract || '',
    authors: authorNames.join(', '), year: Number((p.publishedAt || item.publishedAt || '').slice(0,4)) || new Date().getFullYear(),
    url: `https://arxiv.org/abs/${encodeURIComponent(id)}`,
    upvotes: Number(p.upvotes ?? item.upvotes ?? 0), source: 'Hugging Face Daily Papers',
  };
}

export async function fetchDiscoveries({ days = 30, max = 250 } = {}) {
  const result = new Map();
  // This endpoint serves a current daily feed. We do not pretend it is a 90-day archive.
  // We retain a local cache of observed items and append recent ones as the user revisits.
  const response = await fetch(API, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Discovery feed returned ${response.status}`);
  const json = await response.json();
  if (!Array.isArray(json)) throw new Error('Unexpected discovery response');
  for (const item of json) {
    const paper = mapPaper(item);
    if (paper) result.set(paperKeyFromId(paper), paper);
  }
  return [...result.values()].slice(0, max);
}

function paperKeyFromId(paper) { return paper.id; }
