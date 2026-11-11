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

// Exclude primarily visual-model research from NEW DISCOVERIES only.
// Check titles first, then explicit visual-model phrases in abstracts. Avoid
// excluding language papers merely because they mention a figure or visualization.
const VISUAL_TITLE = /\b(?:computer vision|vision[- ]language|visual[- ]language|vision[- ]centric|visual (?:reasoning|grounding|understanding|recognition|question answering)|image[- ](?:to[- ])?(?:text|generation|editing|understanding|captioning|classification|retrieval|segmentation|recognition)|text[- ]to[- ]image|video[- ](?:generation|understanding|reasoning|editing|captioning|retrieval)|text[- ]to[- ]video|image synthesis|object detection|object tracking|visual object|image encoder|vision encoder|visual encoder|vision transformer|diffusion (?:model|models) for images|multimodal (?:large )?(?:language )?models? for (?:images?|videos?|vision)|vlms?\b|lvms?\b)\b/i;
const VISUAL_ABSTRACT = /\b(?:vision[- ]language models?|visual[- ]language models?|vision[- ]language foundation models?|visual foundation models?|visual encoders?|vision encoders?|text[- ]to[- ]image(?: generation)?|text[- ]to[- ]video(?: generation)?|image generation models?|video generation models?|image understanding models?|video understanding models?|visual question answering|image captioning|video captioning|image segmentation|semantic segmentation of images|object detection in images)\b/i;

export function isVisualModelPaper(paper) {
  const title = String(paper?.title || '');
  const abstract = String(paper?.summary || paper?.abstract || '');
  return VISUAL_TITLE.test(title) || VISUAL_ABSTRACT.test(abstract);
}

export function excludeVisualModels(papers) {
  return papers.filter(paper => !isVisualModelPaper(paper));
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
  return excludeVisualModels([...result.values()]).slice(0, max);
}

function paperKeyFromId(paper) { return paper.id; }
