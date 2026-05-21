// FAQ pure helpers — no DB, no env, no DOM. Safe to import from both the
// server bundle and (via .toString() embedding) the storefront page.
//
// Covered by tests/faq-logic.test.mjs. Types live in faq-logic.d.ts so
// TypeScript callers stay strict without `allowJs`.

const ALLOWED_TAGS = new Set(["p", "ul", "ol", "li", "a", "strong", "em", "code", "br"]);

/**
 * searchEntries — client-side fuzzy ranking for the storefront FAQ search.
 *
 * MUST stay fully self-contained (only its parameters + locally-declared
 * names): the storefront route serialises it with `.toString()` and inlines
 * it into the server-rendered page so the exact tested implementation runs
 * in the browser.
 */
export function searchEntries(entries, query) {
  const q = String(query == null ? "" : query).trim().toLowerCase();
  const list = Array.isArray(entries) ? entries : [];
  if (!q) return list.slice();
  const terms = q.split(/\s+/).filter(Boolean);
  const scored = [];
  for (let idx = 0; idx < list.length; idx++) {
    const e = list[idx];
    const question = String((e && e.question) || "").toLowerCase();
    const answer = String((e && e.answerText) || "").toLowerCase();
    let score = 0;
    if (question.indexOf(q) !== -1) score += 100;
    if (question.indexOf(q) === 0) score += 50;
    if (answer.indexOf(q) !== -1) score += 20;
    for (let t = 0; t < terms.length; t++) {
      if (question.indexOf(terms[t]) !== -1) score += 10;
      if (answer.indexOf(terms[t]) !== -1) score += 3;
    }
    if (score > 0) scored.push({ entry: e, score: score, idx: idx });
  }
  scored.sort(function (a, b) {
    return b.score - a.score || a.idx - b.idx;
  });
  return scored.map(function (s) {
    return s.entry;
  });
}

/** Aggregate raw vote rows into helpful / unhelpful counts + a ratio %. */
export function tallyVotes(votes) {
  let helpful = 0;
  let unhelpful = 0;
  for (const v of Array.isArray(votes) ? votes : []) {
    const val = typeof v === "string" ? v : v && v.vote;
    if (val === "up") helpful++;
    else if (val === "down") unhelpful++;
  }
  const total = helpful + unhelpful;
  return {
    helpful,
    unhelpful,
    total,
    ratio: total === 0 ? null : Math.round((helpful / total) * 100),
  };
}

/** Percentage of votes that were "helpful", or null when there are none. */
export function helpfulRatio(helpful, unhelpful) {
  const h = Number(helpful) || 0;
  const u = Number(unhelpful) || 0;
  const total = h + u;
  if (total === 0) return null;
  return Math.round((h / total) * 100);
}

/** Lower-case, hyphenated, URL-safe slug derived from a category name. */
export function slugify(name) {
  const slug = String(name == null ? "" : name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug || "category";
}

/**
 * Return `base` if free, otherwise the first `base-2`, `base-3`, … not
 * already present in `existingSlugs`.
 */
export function ensureUniqueSlug(base, existingSlugs) {
  const taken = new Set(existingSlugs || []);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(base + "-" + n)) n++;
  return base + "-" + n;
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMarkdown(text) {
  let t = escapeHtml(text);
  t = t.replace(/`([^`]+)`/g, function (_m, code) {
    return "<code>" + code + "</code>";
  });
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_m, label, url) {
    return '<a href="' + escapeAttr(url) + '">' + label + "</a>";
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  t = t.replace(/(^|[^_\w])_([^_\n]+)_/g, "$1<em>$2</em>");
  return t;
}

/**
 * Convert the supported Markdown subset (paragraphs, bold, italic, inline
 * code, links, ordered/unordered lists) to HTML. The result is NOT trusted —
 * always pass it through sanitizeHtml before storing or rendering.
 */
export function markdownToHtml(md) {
  const src = String(md == null ? "" : md).replace(/\r\n?/g, "\n");
  const lines = src.split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === "") {
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(lines[i])) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        "<ul>" +
          items.map((t) => "<li>" + inlineMarkdown(t) + "</li>").join("") +
          "</ul>",
      );
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(lines[i])) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push(
        "<ol>" +
          items.map((t) => "<li>" + inlineMarkdown(t) + "</li>").join("") +
          "</ol>",
      );
      continue;
    }
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push("<p>" + para.map((t) => inlineMarkdown(t)).join("<br>") + "</p>");
  }
  return blocks.join("");
}

function safeHref(attrs) {
  const m = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs || "");
  if (!m) return null;
  const raw = (m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] || "").trim();
  const collapsed = raw.toLowerCase().replace(/\s+/g, "");
  if (
    collapsed.indexOf("javascript:") === 0 ||
    collapsed.indexOf("data:") === 0 ||
    collapsed.indexOf("vbscript:") === 0
  ) {
    return null;
  }
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(raw) || /^[a-z0-9._~%-]/i.test(raw)) {
    return escapeAttr(raw);
  }
  return null;
}

/**
 * Strip HTML down to the tag whitelist (p, ul, ol, li, a, strong, em, code,
 * br). Dangerous elements are removed with their content; every attribute is
 * dropped except a protocol-checked href on <a>.
 */
export function sanitizeHtml(html) {
  if (html == null || html === "") return "";
  let s = String(html);
  s = s.replace(
    /<\s*(script|style|iframe|object|embed|template|noscript|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi,
    "",
  );
  s = s.replace(/<\s*(script|style|iframe|object|embed|svg|math)\b[^>]*>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(
    /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\s*(\/?)>/g,
    function (_match, closing, rawName, rawAttrs) {
      const name = rawName.toLowerCase();
      if (!ALLOWED_TAGS.has(name)) return "";
      if (closing) return "</" + name + ">";
      if (name === "br") return "<br>";
      if (name === "a") {
        const href = safeHref(rawAttrs);
        if (!href) return "<a>";
        return (
          '<a href="' + href + '" rel="nofollow noopener noreferrer" target="_blank">'
        );
      }
      return "<" + name + ">";
    },
  );
  return s.trim();
}

/** Collapse HTML to readable plain text (used for search + previews). */
export function stripHtml(html) {
  return String(html == null ? "" : html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Truncate plain text to `max` chars on a word boundary with an ellipsis. */
export function truncate(text, max) {
  const t = String(text == null ? "" : text);
  const limit = Number(max) || 0;
  if (limit <= 0 || t.length <= limit) return t;
  const cut = t.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}
