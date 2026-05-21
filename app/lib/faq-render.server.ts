import { searchEntries, stripHtml, truncate } from "~/lib/faq-logic.js";
import type { PublicCategory } from "~/lib/faq-db.server";

// Server-side renderer for the dedicated storefront FAQ page served via the
// app proxy at /apps/faq. Output is a complete, crawlable HTML document:
// the full FAQ is in the markup before any JS runs (progressive
// enhancement). JS then layers on client-side search, view tracking and
// helpful/unhelpful voting.

function esc(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escAttr(value: string): string {
  return esc(value).replace(/"/g, "&quot;");
}

// searchEntries is authored self-contained in faq-logic.js precisely so it
// can be serialised and run unchanged in the browser — the same code the
// unit tests exercise.
const SEARCH_FN_SOURCE = searchEntries.toString();

interface RenderOptions {
  categories: PublicCategory[];
  searchEnabled: boolean;
}

export function renderFaqPage(opts: RenderOptions): string {
  const { categories, searchEnabled } = opts;

  const searchData = categories.flatMap((cat) =>
    cat.entries.map((e) => ({
      id: e.id,
      question: e.question,
      answerText: truncate(stripHtml(e.answerHtml), 600),
    })),
  );
  const searchJson = JSON.stringify(searchData).replace(/</g, "\\u003c");

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: categories.flatMap((cat) =>
      cat.entries.map((e) => ({
        "@type": "Question",
        name: e.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: e.answerHtml || e.question,
        },
      })),
    ),
  }).replace(/</g, "\\u003c");

  const nav =
    categories.length > 1
      ? `<nav class="faq-nav" aria-label="FAQ categories">${categories
          .map(
            (c) =>
              `<a class="faq-nav__link" href="#faq-cat-${escAttr(
                c.slug,
              )}">${esc(c.name)}</a>`,
          )
          .join("")}</nav>`
      : "";

  const sections = categories
    .map(
      (cat) => `
      <section class="faq-cat" id="faq-cat-${escAttr(cat.slug)}" data-faq-cat>
        <h2 class="faq-cat__title">${esc(cat.name)}</h2>
        <div class="faq-entries">
          ${cat.entries
            .map(
              (entry) => `
            <details class="faq-entry" data-entry-id="${entry.id}">
              <summary class="faq-entry__q">
                <span class="faq-entry__q-text">${esc(entry.question)}</span>
                <span class="faq-entry__icon" aria-hidden="true"></span>
              </summary>
              <div class="faq-entry__a">
                <div class="faq-entry__answer">${entry.answerHtml}</div>
                <div class="faq-vote" data-faq-vote>
                  <span class="faq-vote__label">Was this helpful?</span>
                  <button type="button" class="faq-vote__btn" data-vote="up" aria-pressed="false">
                    Yes <span class="faq-vote__count" data-up>${entry.helpfulCount}</span>
                  </button>
                  <button type="button" class="faq-vote__btn" data-vote="down" aria-pressed="false">
                    No <span class="faq-vote__count" data-down>${entry.unhelpfulCount}</span>
                  </button>
                  <span class="faq-vote__msg" role="status" aria-live="polite"></span>
                </div>
              </div>
            </details>`,
            )
            .join("")}
        </div>
      </section>`,
    )
    .join("");

  const body = categories.length
    ? `${
        searchEnabled
          ? `<div class="faq-search">
        <label class="faq-search__label" for="faq-q">Search the FAQ</label>
        <input class="faq-search__input" id="faq-q" type="search"
               placeholder="Search questions" autocomplete="off" />
      </div>`
          : ""
      }
      ${nav}
      <p class="faq-noresults" id="faq-noresults" role="status" hidden>
        No questions match your search.
      </p>
      ${sections}`
    : `<p class="faq-empty">No FAQ entries have been published yet. Please check back soon.</p>`;

  const script = `(function(){
  "use strict";
  var DATA = ${searchJson};
  var searchEntries = ${SEARCH_FN_SOURCE};
  function entryEl(id){
    return document.querySelector('.faq-entry[data-entry-id="' + id + '"]');
  }
  function updateCategoryVisibility(){
    var cats = document.querySelectorAll('[data-faq-cat]');
    for (var i = 0; i < cats.length; i++){
      var visible = cats[i].querySelectorAll('.faq-entry:not([hidden])').length;
      cats[i].hidden = visible === 0;
    }
  }
  var input = document.getElementById('faq-q');
  var noResults = document.getElementById('faq-noresults');
  function applySearch(){
    var q = input ? input.value : '';
    var hasQuery = !!q.replace(/^\\s+|\\s+$/g, '');
    var ranked = searchEntries(DATA, q);
    var matched = {};
    for (var i = 0; i < ranked.length; i++){
      matched[ranked[i].id] = true;
      var el = entryEl(ranked[i].id);
      if (el && el.parentNode){ el.parentNode.appendChild(el); el.hidden = false; }
    }
    var all = document.querySelectorAll('.faq-entry');
    for (var j = 0; j < all.length; j++){
      var id = parseInt(all[j].getAttribute('data-entry-id'), 10);
      all[j].hidden = hasQuery && !matched[id];
    }
    updateCategoryVisibility();
    if (noResults) noResults.hidden = !(hasQuery && ranked.length === 0);
  }
  if (input) input.addEventListener('input', applySearch);

  function post(url, body){
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      credentials: 'same-origin'
    }).then(function(r){ return r.ok ? r.json() : null; })
      .catch(function(){ return null; });
  }

  var viewed = {};
  document.addEventListener('toggle', function(e){
    var d = e.target;
    if (!d || !d.classList || !d.classList.contains('faq-entry') || !d.open) return;
    var id = d.getAttribute('data-entry-id');
    if (id && !viewed[id]){ viewed[id] = true; post('/apps/faq/' + id + '/view'); }
  }, true);

  document.addEventListener('click', function(e){
    var btn = e.target && e.target.closest ? e.target.closest('button[data-vote]') : null;
    if (!btn) return;
    var entry = btn.closest('.faq-entry');
    if (!entry) return;
    var id = entry.getAttribute('data-entry-id');
    var vote = btn.getAttribute('data-vote');
    var buttons = entry.querySelectorAll('button[data-vote]');
    var msg = entry.querySelector('.faq-vote__msg');
    for (var i = 0; i < buttons.length; i++){ buttons[i].disabled = true; }
    post('/apps/faq/' + id + '/vote', { vote: vote }).then(function(res){
      if (res && res.ok){
        var up = entry.querySelector('[data-up]');
        var down = entry.querySelector('[data-down]');
        if (up) up.textContent = res.helpful;
        if (down) down.textContent = res.unhelpful;
        for (var k = 0; k < buttons.length; k++){
          buttons[k].setAttribute('aria-pressed',
            buttons[k].getAttribute('data-vote') === vote ? 'true' : 'false');
        }
        if (msg) msg.textContent = 'Thanks for your feedback.';
      } else if (msg){
        msg.textContent = 'Sorry, your vote could not be recorded.';
      }
    }).then(function(){
      for (var m = 0; m < buttons.length; m++){ buttons[m].disabled = false; }
    });
  });
})();`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Frequently asked questions</title>
<meta name="description" content="Answers to common questions about orders, shipping, returns and more." />
<style>
*{box-sizing:border-box}
.faq-page{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  max-width:760px;margin:0 auto;padding:24px 16px 64px;color:#1f2329;line-height:1.55}
.faq-page__title{font-size:1.9rem;margin:0 0 8px}
.faq-page__intro{margin:0 0 24px;color:#5c6370}
.faq-search{margin:0 0 16px}
.faq-search__label{display:block;font-size:.85rem;font-weight:600;margin-bottom:6px}
.faq-search__input{width:100%;padding:11px 14px;font-size:1rem;border:1px solid #c9ced6;
  border-radius:8px;font-family:inherit}
.faq-search__input:focus-visible{outline:2px solid #2b6cb0;outline-offset:1px;border-color:#2b6cb0}
.faq-nav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 24px}
.faq-nav__link{display:inline-block;padding:6px 12px;font-size:.85rem;text-decoration:none;
  color:#1f2329;background:#f1f2f4;border-radius:999px}
.faq-nav__link:hover,.faq-nav__link:focus-visible{background:#e2e4e8}
.faq-cat{margin:0 0 28px}
.faq-cat__title{font-size:1.2rem;margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid #e3e5e9}
.faq-entry{border:1px solid #e3e5e9;border-radius:10px;margin-bottom:10px;background:#fff;overflow:hidden}
.faq-entry__q{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:14px 16px;cursor:pointer;font-weight:600;list-style:none}
.faq-entry__q::-webkit-details-marker{display:none}
.faq-entry__q:focus-visible{outline:2px solid #2b6cb0;outline-offset:-2px}
.faq-entry__icon{flex:none;width:14px;height:14px;position:relative}
.faq-entry__icon::before,.faq-entry__icon::after{content:"";position:absolute;background:#5c6370;
  left:50%;top:50%;transform:translate(-50%,-50%)}
.faq-entry__icon::before{width:14px;height:2px}
.faq-entry__icon::after{width:2px;height:14px;transition:transform .15s ease}
.faq-entry[open] .faq-entry__icon::after{transform:translate(-50%,-50%) scaleY(0)}
.faq-entry__a{padding:0 16px 16px}
.faq-entry__answer{color:#3a3f47}
.faq-entry__answer a{color:#2b6cb0}
.faq-entry__answer ul,.faq-entry__answer ol{padding-left:22px}
.faq-vote{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:14px;
  padding-top:12px;border-top:1px solid #eef0f2}
.faq-vote__label{font-size:.85rem;color:#5c6370}
.faq-vote__btn{font:inherit;font-size:.85rem;padding:5px 12px;border:1px solid #c9ced6;
  border-radius:999px;background:#fff;cursor:pointer}
.faq-vote__btn:hover{background:#f1f2f4}
.faq-vote__btn:focus-visible{outline:2px solid #2b6cb0;outline-offset:1px}
.faq-vote__btn[aria-pressed="true"]{background:#1f2329;color:#fff;border-color:#1f2329}
.faq-vote__btn[disabled]{opacity:.55;cursor:default}
.faq-vote__count{font-variant-numeric:tabular-nums}
.faq-vote__msg{font-size:.82rem;color:#2f7a3f}
.faq-noresults,.faq-empty{padding:16px;background:#f1f2f4;border-radius:8px;color:#5c6370}
@media (max-width:480px){.faq-page__title{font-size:1.55rem}}
</style>
<script type="application/ld+json">${jsonLd}</script>
</head>
<body>
<main class="faq-page">
<h1 class="faq-page__title">Frequently asked questions</h1>
<p class="faq-page__intro">Find answers to common questions below.</p>
${body}
</main>
<script>${script}</script>
</body>
</html>`;
}
