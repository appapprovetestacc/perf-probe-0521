/* FAQ accordion block — fetches one FAQ category from the app proxy and
   renders it as an accessible accordion. Vanilla JS, no dependencies, no
   localStorage / sessionStorage (runtime state only). Supports multiple
   block instances on a page + the theme editor's section reload event. */
(function () {
  "use strict";

  function post(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      credentials: "same-origin",
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  function voteButton(vote, text, count) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "faq-accordion__vote-btn";
    button.setAttribute("data-vote", vote);
    button.setAttribute("aria-pressed", "false");
    button.textContent = text + " ";
    var span = document.createElement("span");
    span.setAttribute("data-count", vote);
    span.textContent = count != null ? String(count) : "0";
    button.appendChild(span);
    return button;
  }

  function buildVote(entry) {
    var wrap = document.createElement("div");
    wrap.className = "faq-accordion__vote";
    var label = document.createElement("span");
    label.className = "faq-accordion__vote-label";
    label.textContent = "Was this helpful?";
    var msg = document.createElement("span");
    msg.className = "faq-accordion__vote-msg";
    msg.setAttribute("role", "status");
    msg.setAttribute("aria-live", "polite");
    wrap.appendChild(label);
    wrap.appendChild(voteButton("up", "Yes", entry.helpful));
    wrap.appendChild(voteButton("down", "No", entry.unhelpful));
    wrap.appendChild(msg);
    return wrap;
  }

  function buildEntry(entry, showVotes) {
    var details = document.createElement("details");
    details.className = "faq-accordion__item";
    details.setAttribute("data-entry-id", entry.id);

    var summary = document.createElement("summary");
    summary.className = "faq-accordion__q";
    var qText = document.createElement("span");
    qText.className = "faq-accordion__q-text";
    qText.textContent = entry.question;
    var icon = document.createElement("span");
    icon.className = "faq-accordion__icon";
    icon.setAttribute("aria-hidden", "true");
    summary.appendChild(qText);
    summary.appendChild(icon);

    var panel = document.createElement("div");
    panel.className = "faq-accordion__a";
    var answer = document.createElement("div");
    answer.className = "faq-accordion__answer";
    // answerHtml is sanitized server-side against a strict tag whitelist.
    answer.innerHTML = entry.answerHtml || "";
    panel.appendChild(answer);
    if (showVotes) panel.appendChild(buildVote(entry));

    details.appendChild(summary);
    details.appendChild(panel);
    return details;
  }

  function wireBlock(root) {
    var viewed = {};

    root.addEventListener(
      "toggle",
      function (e) {
        var d = e.target;
        if (
          !d ||
          !d.classList ||
          !d.classList.contains("faq-accordion__item") ||
          !d.open
        ) {
          return;
        }
        var id = d.getAttribute("data-entry-id");
        if (id && !viewed[id]) {
          viewed[id] = true;
          post("/apps/faq/" + id + "/view");
        }
      },
      true,
    );

    root.addEventListener("click", function (e) {
      var btn =
        e.target && e.target.closest
          ? e.target.closest("button[data-vote]")
          : null;
      if (!btn || !root.contains(btn)) return;
      var item = btn.closest(".faq-accordion__item");
      if (!item) return;
      var id = item.getAttribute("data-entry-id");
      var vote = btn.getAttribute("data-vote");
      var buttons = item.querySelectorAll("button[data-vote]");
      var msg = item.querySelector(".faq-accordion__vote-msg");
      for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;
      post("/apps/faq/" + id + "/vote", { vote: vote })
        .then(function (res) {
          if (res && res.ok) {
            var up = item.querySelector('[data-count="up"]');
            var down = item.querySelector('[data-count="down"]');
            if (up) up.textContent = String(res.helpful);
            if (down) down.textContent = String(res.unhelpful);
            for (var k = 0; k < buttons.length; k++) {
              buttons[k].setAttribute(
                "aria-pressed",
                buttons[k].getAttribute("data-vote") === vote
                  ? "true"
                  : "false",
              );
            }
            if (msg) msg.textContent = "Thanks for your feedback.";
          } else if (msg) {
            msg.textContent = "Sorry, your vote could not be recorded.";
          }
        })
        .then(function () {
          for (var m = 0; m < buttons.length; m++) buttons[m].disabled = false;
        });
    });
  }

  function initBlock(root) {
    var slug = (root.getAttribute("data-category") || "").trim() || "default";
    var showVotes = root.getAttribute("data-show-votes") !== "false";
    var expandFirst = root.getAttribute("data-expand-first") === "true";
    var listEl = root.querySelector("[data-faq-list]");
    var statusEl = root.querySelector("[data-faq-status]");
    if (!listEl) return;

    wireBlock(root);

    fetch("/apps/faq/category/" + encodeURIComponent(slug), {
      credentials: "same-origin",
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !data.entries || data.entries.length === 0) {
          if (statusEl) {
            statusEl.textContent = "No FAQ entries are available yet.";
          }
          return;
        }
        if (statusEl) statusEl.hidden = true;
        for (var i = 0; i < data.entries.length; i++) {
          var el = buildEntry(data.entries[i], showVotes);
          if (i === 0 && expandFirst) el.open = true;
          listEl.appendChild(el);
        }
      })
      .catch(function () {
        if (statusEl) {
          statusEl.textContent =
            "The FAQ could not be loaded. Please try again later.";
        }
      });
  }

  function initAll() {
    var blocks = document.querySelectorAll("[data-faq-accordion]");
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].getAttribute("data-faq-ready")) continue;
      blocks[i].setAttribute("data-faq-ready", "1");
      initBlock(blocks[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }
  // Theme editor: a block can be added/reloaded without a full page load.
  document.addEventListener("shopify:section:load", initAll);
})();
