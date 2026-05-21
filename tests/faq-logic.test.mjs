import test from "node:test";
import assert from "node:assert/strict";

import {
  searchEntries,
  tallyVotes,
  helpfulRatio,
  slugify,
  ensureUniqueSlug,
  markdownToHtml,
  sanitizeHtml,
} from "../app/lib/faq-logic.js";

// ── search-filter ranking ────────────────────────────────────────────
test("searchEntries ranks a question match above an answer-only match", () => {
  const entries = [
    { id: 1, question: "How do payouts work?", answerText: "We pay weekly." },
    { id: 2, question: "When do I get paid?", answerText: "Payout runs Fridays." },
  ];
  const ranked = searchEntries(entries, "payout");
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].id, 1, "question-match entry should rank first");
});

test("searchEntries returns every entry for an empty query and drops non-matches", () => {
  const entries = [
    { id: 1, question: "Shipping times", answerText: "3-5 days." },
    { id: 2, question: "Return policy", answerText: "30 day window." },
  ];
  assert.equal(searchEntries(entries, "").length, 2);
  assert.equal(searchEntries(entries, "   ").length, 2);
  assert.deepEqual(
    searchEntries(entries, "warranty").map((e) => e.id),
    [],
  );
});

// ── vote-tally aggregation ───────────────────────────────────────────
test("tallyVotes aggregates up/down votes into counts and a ratio", () => {
  const tally = tallyVotes([
    { vote: "up" },
    { vote: "up" },
    { vote: "up" },
    { vote: "down" },
    { vote: "bogus" },
  ]);
  assert.equal(tally.helpful, 3);
  assert.equal(tally.unhelpful, 1);
  assert.equal(tally.total, 4);
  assert.equal(tally.ratio, 75);
});

test("tallyVotes / helpfulRatio report null when there are no votes", () => {
  assert.equal(tallyVotes([]).ratio, null);
  assert.equal(helpfulRatio(0, 0), null);
  assert.equal(helpfulRatio(7, 3), 70);
});

// ── slug uniqueness ──────────────────────────────────────────────────
test("ensureUniqueSlug keeps a free slug and suffixes a taken one", () => {
  assert.equal(slugify("Shipping & Delivery"), "shipping-delivery");
  assert.equal(ensureUniqueSlug("shipping", []), "shipping");
  assert.equal(
    ensureUniqueSlug("shipping", ["shipping"]),
    "shipping-2",
  );
  assert.equal(
    ensureUniqueSlug("shipping", ["shipping", "shipping-2", "shipping-3"]),
    "shipping-4",
  );
});

// ── rich-text safety ─────────────────────────────────────────────────
test("sanitizeHtml keeps whitelisted tags and strips scripts + bad hrefs", () => {
  const dirty =
    '<p>Safe <strong>bold</strong></p><script>alert(1)</script>' +
    '<a href="javascript:alert(1)">x</a><a href="https://shopify.com">ok</a>' +
    '<div onclick="evil()">drop me</div>';
  const clean = sanitizeHtml(dirty);
  assert.ok(clean.includes("<strong>bold</strong>"));
  assert.ok(!clean.includes("<script"));
  assert.ok(!clean.toLowerCase().includes("javascript:"));
  assert.ok(!clean.includes("<div"));
  assert.ok(!clean.includes("onclick"));
  assert.ok(clean.includes('href="https://shopify.com"'));
});

test("markdownToHtml renders the supported subset and stays sanitizable", () => {
  const html = sanitizeHtml(
    markdownToHtml("**Hi** there\n\n- one\n- two"),
  );
  assert.ok(html.includes("<strong>Hi</strong>"));
  assert.ok(html.includes("<ul><li>one</li><li>two</li></ul>"));
});
