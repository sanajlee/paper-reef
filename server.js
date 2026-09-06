import express from "express";
import * as cheerio from "cheerio";

const app = express();
const PORT = 3001;

app.use(express.json());

/* ========================================
   HELPERS
======================================== */

function cleanText(text = "") {
  return text
    .replace(/\s+/g, " ")
    .trim();
}

function extractDOI(input = "") {
  const decoded = decodeURIComponent(input);

  const match = decoded.match(
    /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i
  );

  return match
    ? match[0].replace(/[.,;)]$/, "")
    : null;
}

function extractArxivId(input = "") {
  // modern arXiv:
  // 1706.03762
  // https://arxiv.org/abs/1706.03762
  // https://arxiv.org/pdf/1706.03762.pdf

  const modern = input.match(
    /(?:arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?/i
  );

  if (modern) {
    return modern[1];
  }

  // old style IDs
  const old = input.match(
    /(?:arxiv\.org\/(?:abs|pdf)\/)?([a-z-]+\/\d{7})(?:v\d+)?(?:\.pdf)?/i
  );

  return old ? old[1] : null;
}

function extractACLId(input = "") {
  try {
    const url = new URL(input);

    if (
      url.hostname !== "aclanthology.org" &&
      url.hostname !== "www.aclanthology.org"
    ) {
      return null;
    }

    let id = url.pathname
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.(pdf|bib|xml)$/i, "");

    return id || null;
  } catch {
    // 사용자가 URL 대신 ACL ID만 넣은 경우
    if (
      /^[A-Za-z]\d{2}-\d{4}$/.test(input) ||
      /^\d{4}\.[A-Za-z0-9-]+\.\d+$/.test(input)
    ) {
      return input;
    }

    return null;
  }
}

/* ========================================
   CROSSREF
======================================== */

async function fetchCrossref(input) {
  const doi = extractDOI(input);

  if (!doi) {
    throw new Error("No DOI found.");
  }

  const response = await fetch(
    `https://api.crossref.org/works/${encodeURIComponent(doi)}`
  );

  if (!response.ok) {
    throw new Error("Crossref lookup failed.");
  }

  const data = await response.json();
  const item = data.message;

  const title =
    item.title?.[0] || "";

  const authors = (item.author || [])
    .map((author) =>
      [author.given, author.family]
        .filter(Boolean)
        .join(" ")
    )
    .join(", ");

  const venue =
    item["container-title"]?.[0] || "";

  const year =
    item.published?.["date-parts"]?.[0]?.[0] ||
    item.issued?.["date-parts"]?.[0]?.[0] ||
    "";

  return {
    source: "crossref",
    title,
    authors,
    venue,
    year: String(year),
    url: `https://doi.org/${doi}`,
    pdfUrl: "",
  };
}

/* ========================================
   NEURIPS
======================================== */

function getNeuripsAbstractURL(input) {
  const match = input.match(
    /proceedings\.neurips\.cc\/paper_files\/paper\/(\d{4})\/(?:file|hash)\/([a-f0-9]{32})-(?:Paper\.pdf|Abstract\.html)/i
  );

  if (!match) return null;

  const [, year, hash] = match;

  return (
    `https://proceedings.neurips.cc/` +
    `paper_files/paper/${year}/hash/` +
    `${hash}-Abstract.html`
  );
}

async function fetchNeurips(input) {
  const abstractURL =
    getNeuripsAbstractURL(input);

  if (!abstractURL) {
    throw new Error(
      "Not a recognized NeurIPS proceedings URL."
    );
  }

  const response = await fetch(abstractURL);

  if (!response.ok) {
    throw new Error(
      `NeurIPS page returned ${response.status}.`
    );
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  /* NeurIPS pages are simple enough that
     the visible page structure is useful. */

  const title =
    cleanText($("h4").first().text()) ||
    cleanText($("h1").first().text()) ||
    cleanText($("title").text())
      .replace(/[-|]\s*NeurIPS.*$/i, "");

  let authors = "";

  // Current/older NeurIPS page layouts
  const authorCandidates = [
    $("h4").first().next().text(),
    $(".authors").first().text(),
  ];

  for (const candidate of authorCandidates) {
    if (cleanText(candidate)) {
      authors = cleanText(candidate);
      break;
    }
  }

  /*
    Fallback:
    Find text near the title before Abstract.
  */

  if (!authors) {
    const bodyLines = $("body")
      .text()
      .split("\n")
      .map(cleanText)
      .filter(Boolean);

    const titleIndex =
      bodyLines.findIndex((line) =>
        line.toLowerCase() ===
        title.toLowerCase()
      );

    if (
      titleIndex >= 0 &&
      bodyLines[titleIndex + 1]
    ) {
      authors =
        bodyLines[titleIndex + 1];
    }
  }

  const yearMatch =
    abstractURL.match(/paper\/(\d{4})\//);

  const year =
    yearMatch?.[1] || "";

  // PDF URL은 abstract URL에서 다시 만들어낼 수 있음.
  const pdfUrl = abstractURL
    .replace("/hash/", "/file/")
    .replace("-Abstract.html", "-Paper.pdf");

  return {
    source: "neurips",
    title,
    authors,
    venue: "NeurIPS",
    year,
    url: abstractURL,
    pdfUrl,
  };
}

/* ========================================
   ACL ANTHOLOGY
======================================== */

async function fetchACL(input) {
  const id = extractACLId(input);

  if (!id) {
    throw new Error(
      "Not a recognized ACL Anthology URL."
    );
  }

  /*
   * ACL Anthology officially exposes
   * per-paper BibTeX as <paper-id>.bib
   */
  const bibURL =
    `https://aclanthology.org/${id}.bib`;

  const response = await fetch(bibURL);

  if (!response.ok) {
    throw new Error(
      `ACL Anthology returned ${response.status}.`
    );
  }

  const bib = await response.text();

  function bibField(name) {
    const regex = new RegExp(
      `${name}\\s*=\\s*[\\{"]([\\s\\S]*?)[\\}"]\\s*,?\\n`,
      "i"
    );

    const match = bib.match(regex);

    return match
      ? cleanText(match[1])
      : "";
  }

  let title = bibField("title");
  let authors = bibField("author");
  let venue =
    bibField("booktitle") ||
    bibField("journal");

  const year =
    bibField("year");

  // BibTeX braces 좀 정리
  title = title
    .replace(/[{}]/g, "");

  authors = authors
    .replace(/[{}]/g, "")
    .replace(/\s+and\s+/gi, ", ");

  venue = venue
    .replace(/[{}]/g, "");

  return {
    source: "acl",
    title,
    authors,
    venue,
    year,
    url: `https://aclanthology.org/${id}/`,
    pdfUrl:
      `https://aclanthology.org/${id}.pdf`,
  };
}

/* ========================================
   ARXIV
======================================== */

async function fetchArxiv(input) {
  const id = extractArxivId(input);

  if (!id) {
    throw new Error(
      "Not a recognized arXiv URL."
    );
  }

  const apiURL =
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`;

  const response = await fetch(apiURL);

  if (!response.ok) {
    throw new Error(
      `arXiv returned ${response.status}.`
    );
  }

  const xml = await response.text();

  const entryMatch =
    xml.match(/<entry>([\s\S]*?)<\/entry>/i);

  if (!entryMatch) {
    throw new Error(
      "arXiv paper not found."
    );
  }

  const entry = entryMatch[1];

  function xmlField(name) {
    const match = entry.match(
      new RegExp(
        `<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,
        "i"
      )
    );

    if (!match) return "";

    return cleanText(
      match[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
    );
  }

  const title =
    xmlField("title");

  const published =
    xmlField("published");

  const year =
    published.match(/^(\d{4})/)?.[1] || "";

  const authorMatches =
    [...entry.matchAll(
      /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi
    )];

  const authors = authorMatches
    .map((match) =>
      cleanText(match[1])
    )
    .join(", ");

  return {
    source: "arxiv",
    title,
    authors,
    venue: "arXiv",
    year,
    url:
      `https://arxiv.org/abs/${id}`,
    pdfUrl:
      `https://arxiv.org/pdf/${id}.pdf`,
  };
}

/* ========================================
   GENERIC WEB PAGE
======================================== */

async function fetchGenericPage(input) {
  const response = await fetch(input, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 PaperReef/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Web page returned ${response.status}.`
    );
  }

  const contentType =
    response.headers.get("content-type") || "";

  // PDF 자체는 HTML metadata를 뽑을 수 없음.
  if (
    contentType.includes("application/pdf")
  ) {
    throw new Error(
      "Direct PDF with no supported provider."
    );
  }

  const html =
    await response.text();

  const $ = cheerio.load(html);

  function meta(...names) {
    for (const name of names) {
      const value =
        $(`meta[name="${name}"]`).attr("content") ||
        $(`meta[property="${name}"]`).attr("content");

      if (value) {
        return cleanText(value);
      }
    }

    return "";
  }

  const title =
    meta(
      "citation_title",
      "og:title",
      "twitter:title"
    ) ||
    cleanText($("title").text());

  const authorMeta =
    $('meta[name="citation_author"]')
      .map((_, element) =>
        $(element).attr("content")
      )
      .get()
      .filter(Boolean);

  const authors =
    authorMeta.length
      ? authorMeta.join(", ")
      : meta("author");

  const venue =
    meta(
      "citation_conference_title",
      "citation_journal_title"
    );

  const date =
    meta(
      "citation_publication_date",
      "citation_date"
    );

  const year =
    date.match(/\b(19|20)\d{2}\b/)?.[0] ||
    "";

  const pdfUrl =
    meta("citation_pdf_url");

  return {
    source: "generic",
    title,
    authors,
    venue,
    year,
    url: input,
    pdfUrl,
  };
}

/* ========================================
   RESOLVER
======================================== */

async function resolveMetadata(input) {
  const value = input.trim();

  if (!value) {
    throw new Error("URL is empty.");
  }

  /* ACL before DOI because some ACL pages
     themselves also contain DOI metadata. */

  if (
    value.includes("aclanthology.org") ||
    extractACLId(value)
  ) {
    return fetchACL(value);
  }

  if (
    value.includes(
      "proceedings.neurips.cc"
    )
  ) {
    return fetchNeurips(value);
  }

  if (
    value.includes("arxiv.org") ||
    extractArxivId(value)
  ) {
    return fetchArxiv(value);
  }

  if (extractDOI(value)) {
    return fetchCrossref(value);
  }

  if (
    /^https?:\/\//i.test(value)
  ) {
    return fetchGenericPage(value);
  }

  throw new Error(
    "I don't recognize this URL yet."
  );
}

/* ========================================
   API
======================================== */

app.get("/api/metadata", async (req, res) => {
  try {
    const url = req.query.url;

    if (!url) {
      return res.status(400).json({
        error: "Missing ?url=",
      });
    }

    const metadata =
      await resolveMetadata(url);

    res.json(metadata);

  } catch (error) {
    console.error(error);

    res.status(404).json({
      error:
        error.message ||
        "Could not fetch metadata.",
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `🐟 Paper Reef metadata server: http://localhost:${PORT}`
  );
});