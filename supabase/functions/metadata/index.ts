import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

function cleanText(text = "") {
  return text.replace(/\s+/g, " ").trim();
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
  const modern = input.match(
    /(?:arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?/i
  );

  if (modern) return modern[1];

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

    return url.pathname
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.(pdf|bib|xml)$/i, "") || null;
  } catch {
    return null;
  }
}

/* -----------------------------
   CROSSREF
----------------------------- */

async function fetchCrossref(input: string) {
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
    .map((author: any) =>
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
  };
}

/* -----------------------------
   NEURIPS
----------------------------- */

function getNeuripsAbstractURL(input: string) {
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

async function fetchNeurips(input: string) {
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

  function findMeta(name: string) {
    const regex = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      "i"
    );

    return html.match(regex)?.[1] || "";
  }

  let title =
    findMeta("citation_title") ||
    findMeta("og:title");

  if (!title) {
    const h4 =
      html.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i);

    if (h4) {
      title = cleanText(
        h4[1].replace(/<[^>]+>/g, "")
      );
    }
  }

  const authorMatches = [
    ...html.matchAll(
      /<meta[^>]+name=["']citation_author["'][^>]+content=["']([^"']+)["']/gi
    ),
  ];

  const authors = authorMatches
    .map((m) => cleanText(m[1]))
    .join(", ");

  const year =
    abstractURL.match(/paper\/(\d{4})\//)?.[1] || "";

  return {
    source: "neurips",
    title,
    authors,
    venue: "NeurIPS",
    year,
    url: abstractURL,
  };
}

/* -----------------------------
   ACL ANTHOLOGY
----------------------------- */

async function fetchACL(input: string) {
  const id = extractACLId(input);

  if (!id) {
    throw new Error(
      "Not a recognized ACL Anthology URL."
    );
  }

  const bibURL =
    `https://aclanthology.org/${id}.bib`;

  const response = await fetch(bibURL);

  if (!response.ok) {
    throw new Error(
      `ACL Anthology returned ${response.status}.`
    );
  }

  const authors = bibField("author")
    .replace(/[{}]/g, "")
    .split(/\s+and\s+/i)
    .map((author) => {
      const parts = author
        .split(",")
        .map((part) => part.trim());

      // ACL BibTeX: "Li, Qiming"
      // → "Qiming Li"
      if (parts.length >= 2) {
        const family = parts[0];
        const given = parts.slice(1).join(" ");

        return `${given} ${family}`;
      }

      return author.trim();
    })
    .filter(Boolean)
    .join(", ");

  const bib = await response.text();

  function bibField(name: string) {
    const regex = new RegExp(
      `${name}\\s*=\\s*[\\{"]([\\s\\S]*?)[\\}"]\\s*,?\\n`,
      "i"
    );

    const match = bib.match(regex);

    return match
      ? cleanText(match[1])
      : "";
  }

  return {
    source: "acl",
    title: bibField("title").replace(/[{}]/g, ""),
    authors,
    venue:
      (
        bibField("booktitle") ||
        bibField("journal")
      ).replace(/[{}]/g, ""),
    year: bibField("year"),
    url: `https://aclanthology.org/${id}/`,
  };
}

/* -----------------------------
   ARXIV
----------------------------- */

async function fetchArxiv(input: string) {
  const id = extractArxivId(input);

  if (!id) {
    throw new Error(
      "Not a recognized arXiv URL."
    );
  }

  const response = await fetch(
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`
  );

  if (!response.ok) {
    throw new Error(
      `arXiv returned ${response.status}.`
    );
  }

  const xml = await response.text();

  const entry =
    xml.match(/<entry>([\s\S]*?)<\/entry>/i)?.[1];

  if (!entry) {
    throw new Error("arXiv paper not found.");
  }

  function xmlField(name: string) {
    const match = entry.match(
      new RegExp(
        `<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,
        "i"
      )
    );

    return match
      ? cleanText(match[1])
      : "";
  }

  const title =
    xmlField("title");

  const published =
    xmlField("published");

  const year =
    published.match(/^(\d{4})/)?.[1] || "";

  const authors = [
    ...entry.matchAll(
      /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi
    ),
  ]
    .map((m) => cleanText(m[1]))
    .join(", ");

  return {
    source: "arxiv",
    title,
    authors,
    venue: "arXiv",
    year,
    url: `https://arxiv.org/abs/${id}`,
  };
}

/* -----------------------------
   GENERIC PAGE
----------------------------- */

async function fetchGenericPage(input: string) {
  const response = await fetch(input, {
    headers: {
      "User-Agent": "PaperReef/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Web page returned ${response.status}.`
    );
  }

  const contentType =
    response.headers.get("content-type") || "";

  if (
    contentType.includes("application/pdf")
  ) {
    throw new Error(
      "Direct PDF with unsupported provider."
    );
  }

  const html =
    await response.text();

  function meta(name: string) {
    const regex = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      "i"
    );

    return html.match(regex)?.[1] || "";
  }

  const title =
    meta("citation_title") ||
    meta("og:title") ||
    html.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    )?.[1] ||
    "";

  const authorMatches = [
    ...html.matchAll(
      /<meta[^>]+name=["']citation_author["'][^>]+content=["']([^"']+)["']/gi
    ),
  ];

  const authors =
    authorMatches
      .map((m) => cleanText(m[1]))
      .join(", ") ||
    meta("author");

  const venue =
    meta("citation_conference_title") ||
    meta("citation_journal_title");

  const date =
    meta("citation_publication_date") ||
    meta("citation_date");

  const year =
    date.match(/\b(19|20)\d{2}\b/)?.[0] || "";

  return {
    source: "generic",
    title: cleanText(title),
    authors,
    venue,
    year,
    url: input,
  };
}

/* -----------------------------
   RESOLVER
----------------------------- */

async function resolveMetadata(input: string) {
  const value = input.trim();

  if (!value) {
    throw new Error("URL is empty.");
  }

  if (value.includes("aclanthology.org")) {
    return fetchACL(value);
  }

  if (
    value.includes("proceedings.neurips.cc")
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

  if (/^https?:\/\//i.test(value)) {
    return fetchGenericPage(value);
  }

  throw new Error(
    "I don't recognize this URL yet."
  );
}

/* -----------------------------
   EDGE FUNCTION
----------------------------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    const { url } = await req.json();

    if (!url) {
      return Response.json(
        { error: "Missing URL" },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const metadata =
      await resolveMetadata(url);

    return Response.json(
      metadata,
      {
        headers: corsHeaders,
      }
    );
  } catch (error) {
    console.error(error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Metadata fetch failed.",
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
});