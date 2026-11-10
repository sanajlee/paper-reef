export const CATCH_WEIGHTS = Object.freeze({ backlog: 0.5, trending: 0.25, forYou: 0.24, wild: 0.01 });

export function localDay(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function normalizedTitle(title = '') {
  return String(title).toLowerCase().replace(/[^a-z0-9\p{L}\p{N}]+/gu, ' ').trim();
}

export function paperKey(paper) {
  const url = paper?.url || paper?.link || '';
  const arxiv = String(url).match(/(?:arxiv\.org\/(?:abs|pdf)\/|^)(\d{4}\.\d{4,5})/i);
  return arxiv ? `arxiv:${arxiv[1]}` : `title:${normalizedTitle(paper?.title)}`;
}

const STOP_WORDS = new Set('a an and are as at be by can does for from how in into is it its language languages learning model models neural of on or our paper study that the their this to using via we what when where which with without'.split(' '));
export function tokens(text) {
  return normalizedTitle(text).split(' ').filter(word => word.length >= 4 && !STOP_WORDS.has(word));
}

export function makeProfile(papers) {
  const weights = new Map();
  for (const paper of papers) {
    // Saved titles give an uncomplicated, privacy-preserving interest signal.
    for (const word of new Set(tokens(paper.title || ''))) {
      weights.set(word, (weights.get(word) || 0) + 1);
    }
  }
  return weights;
}

export function relevance(paper, profile) {
  return [...new Set(tokens(`${paper.title || ''} ${paper.summary || ''}`))]
    .reduce((score, word) => score + (profile.get(word) || 0), 0);
}

export function weightedPick(items, weight, random = Math.random) {
  if (!items.length) return null;
  const values = items.map(item => Math.max(0.01, Number(weight(item)) || 0));
  const total = values.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= values[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

export function chooseCatch({ saved = [], discoveries = [], history = [], today = localDay(), random = Math.random }) {
  const previous = new Set(history.filter(h => h.date >= previousDay(today, 14)).map(h => h.key));
  const readKeys = new Set(saved.filter(p => p.isRead).map(paperKey));
  const storedKeys = new Set(saved.map(paperKey));
  const backlog = saved.filter(p => !p.isRead && p.title && !previous.has(paperKey(p)));
  const fresh = discoveries.filter(p => p.title && !readKeys.has(paperKey(p)) && !storedKeys.has(paperKey(p)) && !previous.has(paperKey(p)));
  const profile = makeProfile(saved);
  // Within discoveries: a higher popularity sample, an interest sample, and rare exploratory choice.
  const sortedTrending = [...fresh].sort((a,b) => (b.upvotes || 0) - (a.upvotes || 0));
  const trending = sortedTrending.slice(0, Math.max(10, Math.ceil(sortedTrending.length * 0.4)));
  const ranked = [...fresh].sort((a,b) => relevance(b,profile) - relevance(a,profile));
  const forYou = profile.size ? ranked.slice(0, Math.max(10, Math.ceil(ranked.length * 0.4))) : fresh;
  const pools = [
    { category: 'backlog', weight: CATCH_WEIGHTS.backlog, items: backlog },
    { category: 'trending', weight: CATCH_WEIGHTS.trending, items: trending },
    { category: 'forYou', weight: CATCH_WEIGHTS.forYou, items: forYou },
    { category: 'wild', weight: CATCH_WEIGHTS.wild, items: fresh },
  ].filter(p => p.items.length);
  if (!pools.length) return null;
  // Re-normalize weights if an external feed fails or the backlog is empty.
  const category = weightedPick(pools, p => p.weight, random);
  const pick = weightedPick(category.items, p => {
    if (category.category === 'backlog') return 1 + Math.min(2, (Date.now() - (p.createdAt || Date.now())) / 86400000 / 365);
    if (category.category === 'trending') return 1 + Math.sqrt(Math.max(0, p.upvotes || 0));
    if (category.category === 'forYou') return 1 + relevance(p,profile);
    return 1;
  }, random);
  return { date: today, category: category.category, paper: { ...pick }, key: paperKey(pick), rerolls: 0, completed: false };
}

export function previousDay(day, offset) {
  const [y,m,d] = day.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d-offset)).toISOString().slice(0,10);
}

export function asLibraryPaper(p) {
  return {
    id: crypto.randomUUID(), title: p.title || 'Untitled paper',
    authors: Array.isArray(p.authors) ? p.authors.join(', ') : (p.authors || ''),
    venue: p.venue || 'arXiv', year: p.year || new Date().getFullYear(),
    url: p.url || '', note: '', isRead: false, isUseful: false,
    topicIds: [], createdAt: Date.now(),
  };
}
