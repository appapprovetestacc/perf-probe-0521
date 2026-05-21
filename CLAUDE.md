# Perf Probe — FAQ

> Hand-built Shopify app, delivered ready-to-iterate. Live at https://perf-probe-0521.appapprove.app
>
> **Project facts:**
> - Blueprint: FAQ
> - Hosting: Cloudflare Worker (yours, you own it)
> - Repo: this one (yours, you own it)
> - Initial MVP: hand-built by AppApprove. Iterations from here are yours to drive.

## Architecture

- **Framework:** Remix on Cloudflare Workers
- **DB:** Cloudflare D1 (binding: `env.D1`)
- **Storage:** Cloudflare R2 (where declared in `wrangler.toml`)
- **Auth:** Shopify embedded admin + App Bridge React
- **UI:** Polaris React + App Bridge React (NOT raw HTML/CSS)
- **Deploy:** Push to `main` → GitHub Actions `deploy.yml` → `wrangler deploy`
- **Cron triggers:** see `wrangler.toml [triggers]`

## Domain

Manage categorized FAQ entries, publish as a dedicated /apps/faq page or embed via theme-app-embed accordion on any page. Client-side search. Per-question views + helpful/unhelpful votes.

**Shipped surfaces:**
- Categorized FAQ entries with rich-text answers (sanitized)
- Dedicated FAQ page at /apps/faq + embeddable accordion block
- Client-side search across questions
- Per-question analytics (views + helpful/unhelpful votes)
- Drag-to-reorder categories + entries

## Iteration cookbook

Open this repo in Claude Code or Cursor and try one of these:

- *"add a CSV import for bulk FAQ entries"*
- *"add a search bar to the storefront FAQ page"*
- *"add a 'helpful?' thumbs-up/down on each FAQ answer with analytics"*

## Environment variables

This app is hosted by AppApprove. Environment variables and secrets are managed by the project owner in the AppApprove dashboard (**Settings → Environment**) and injected into the Worker by the deploy pipeline on the next push.

When you add code that reads a new `env.X` variable, do NOT instruct the user to edit `.env`, edit `wrangler.toml`, or run `wrangler secret put` — they have no direct Worker access. Instead, tell them the exact variable name(s) to add under Settings → Environment.

## UI Conventions (apply to all AppApprove apps)

Every MANDATE below is enforced by reviewers + the AppApprove pre-submission checker. Don't ship code that violates a MANDATE.

- MANDATE: every admin route MUST wrap its content in Polaris `<Page>` with `title` AND `primaryAction` (or `backAction` on detail/edit screens). Routes that render a bare `<Card>` or `<Layout>` without `<Page>` fail review.
- MANDATE: index / list routes MUST render a top-row of 3-4 Polaris `<Card>` metric tiles (e.g. `Total subscribers`, `Active`, `MRR`, `Churn 30d`) BEFORE the main list. Each tile has a label, the big number (`<Text variant="heading2xl">`), and an optional delta indicator. See Pattern Library `METRIC_CARDS_ROW`.
- MANDATE: detail / edit routes MUST use Polaris `<Layout>` with `<Layout.Section>` (primary) + `<Layout.Section variant="oneThird">` (sidebar with metadata Card). Single-column edit screens fail review.
- MANDATE: list views with >5 rows MUST use Polaris `<IndexTable>` (NOT a bare `<table>` or `<DataTable>`). IndexTable MUST have: sortable column headers, row selection with bulk-action bar, sticky header, and `selectable` enabled. See Pattern Library `INDEX_TABLE_WITH_TABS`.
- MANDATE: every IndexTable MUST be wrapped in Polaris `<Tabs>` with at least 2 filter tabs (e.g. `All` + status-based: `Pending` / `Published` / `Archived`). Single-tab IndexTables fail review — show the structure even if one tab is empty.
- MANDATE: every IndexTable with potential >25 rows MUST use Polaris `<Pagination>` (cursor-based against the underlying query). No infinite-scroll, no client-side truncation.
- MANDATE: every IndexTable row that represents an entity (review, subscription, order) MUST be linkable to a detail route. Use IndexTable's `onClick` prop, not nested `<a>` tags (a11y).
- MANDATE: every list / table / collection route MUST render a Polaris `<EmptyState>` when zero rows, with: `image` (Polaris CDN illustration URL or local SVG), `heading` (action-oriented like 'Capture your first review'), one-sentence `<p>` body, primary `action` button (link to the create-flow), AND a secondary `learnMore` link (placeholder URL OK). Blank divs fail review.
- MANDATE: first-time admin visit MUST render a top-of-page Polaris `<Banner>` (tone='info') with onboarding next-steps — at minimum a 3-checkbox list ('Connect your shop', 'Configure settings', 'Install on a test page'). Dismiss state stored in localStorage. See Pattern Library `ONBOARDING_BANNER`.
- MANDATE: every settings / edit form MUST use the Polaris SaveBar pattern (`useSaveBar` from App Bridge): SaveBar appears as soon as a dirty change is detected, disappears on save or discard. NEVER a static 'Save' button at the bottom of a long form. See Pattern Library `SAVE_BAR_FORM`.
- MANDATE: forms use Polaris `<FormLayout>` + `<TextField>` / `<Select>` / `<Checkbox>` / `<RadioButton>` / `<ChoiceList>`. NEVER raw HTML `<input>` / `<textarea>` / styled `<button>` in the embedded admin.
- MANDATE: every Polaris `<TextField>` / `<Select>` / `<Checkbox>` MUST have a `label` prop (visible) or `labelHidden` + `label` (screen-reader-only). Bare `<TextField autoComplete="off" value=… />` is an a11y violation that breaks Shopify embedded-admin review + emits console warnings on every render. Same rule for `<Select>` and `<Checkbox>`. There are no acceptable label-less variants.
- MANDATE: every form's primary button uses Polaris `<Button variant="primary">` with `loading={isSubmitting}` AND `disabled={isSubmitting || !isDirty}`. Inline per-field validation via Polaris `<InlineError>`. Submit failures via top-of-form `<Banner tone="critical">` with the API error text + retry button.
- MANDATE: the App Bridge CDN script (`<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />`) MUST live in root.tsx `<head>`, MUST be the first `<script>` tag, and MUST NOT use `defer`, `async`, or `type="module"`. Loading it from `<body>` or with `defer` aborts App Bridge initialization with a console error and leaves `window.shopify` undefined.
- MANDATE: embedded-admin `<Link>` elements to sibling/child admin routes MUST NOT use `prefetch` (`prefetch="intent"` / `"render"` / `"viewport"`). Remix prefetch fires a speculative loader request that carries neither the `?shop=` query param nor the App Bridge `Authorization: Bearer` session token, so the target route's admin auth throws 401 — `Failed to load resource: 401` console spam on hover. Use the default (no `prefetch` prop) for admin-to-admin navigation. Storefront / non-embedded routes may still use prefetch.
- MANDATE: any async data load >200 ms MUST render a Polaris `<SkeletonPage>` (full route) or `<SkeletonBodyText>` / `<SkeletonDisplayText>` (in-Card) in its place. NEVER a bare `<Spinner>` centered on a blank page, NEVER blank-then-pop. See Pattern Library `SKELETON_PAGE`.
- MANDATE: every server-action mutation (claim, save, delete) shows immediate feedback: optimistic UI when reversible, Polaris Toast via `useAppBridge().toast.show()` on success, top `<Banner tone="critical">` on failure. Never silent successes.
- Storefront blocks: use only theme CSS variables (`var(--color-foreground)`, `var(--color-background)`, `var(--color-button)`, `var(--color-button-text)`, `var(--font-body-family)`). NEVER hardcoded colors / fonts / brand tokens.
- Storefront blocks: mobile-first responsive — verify the layout at 320 px width. No horizontal scroll, no overlapping elements on touch targets.
- Storefront blocks: a11y baseline — `<label>` on every input, ARIA roles (`role="status"` for live regions, `role="alert"` for errors), focus-visible outlines, keyboard-navigable controls (no mouse-only handlers).
- Storefront blocks: progressive enhancement — server-rendered HTML must be meaningful before JS hydrates (no `<div>` shells that only fill in on JS load).
- Storefront toast / success feedback: polite `<div role="status" aria-live="polite">`. Never `alert()` / native dialogs.
- Date / number formatting: use `Intl.DateTimeFormat` and `Intl.NumberFormat` with the merchant shop's locale (`shop.primary_locale` on storefront, `useI18n()` from Polaris in admin). Never hardcode `MM/DD/YYYY` or `$1,234.56`.
- All user-visible copy in English by default. Scope-up may extend to other languages, otherwise English-only.
- No third-party brand imagery / logos in storefront blocks unless the integration explicitly requires it (e.g. payment-method icons). Never embed an `<img>` from a CDN you don't control.
- MANDATE: NEVER use unsubstantiated marketing claims in app copy, button labels, badges, headlines, docs, or comments visible to merchants. Forbidden tokens: `best`, `100%`, `always`, `never`, `instant`, `guaranteed`, `#1`, `world's`, `most`. Use concrete language instead: "recommended" not "best", "helpful" not "100% helpful", "every Monday" not "always on Monday". Shopify trust-asset-checklist blocks listing on these.
- MANDATE: Theme-app-embed blocks (`extensions/*/blocks/*.liquid`) MUST NOT persist state in `localStorage` / `sessionStorage` without an uninstall-cleanup path. Either (a) gate writes on `block.settings.enabled` and `removeItem`/`clear` when disabled, or (b) use cookies with `max-age` you can shorten on disable, or (c) keep state server-side. Pure ephemeral runtime state (no persistence) is always fine.

## Engineering Conventions (apply to all AppApprove apps)

- Tests: `node:test` + `tsx`, files under `app/**/__tests__/*.test.ts` or `app/lib/__tests__/*.test.ts`. Pure helpers only — no DB/network. Aim 5-8 tests per blueprint covering business-logic edges (rate-limits, state machines, validation).
- Migrations: every new SQL file in `drizzle/` requires a matching entry in `drizzle/meta/_journal.json` with monotonically incrementing `idx` and current `when` timestamp. Drizzle silently skips otherwise (caused F-124/F-126 P0s in AppApprove core).
- Webhooks: each `[[webhooks.subscriptions]]` in `shopify.app.toml` requires a matching `app/routes/webhooks.<topic>.ts` handler. Validate HMAC via the existing `app/shopify.server.ts` helper.
- App-proxy routes (`/apps/<prefix>/<subpath>/*`) require an `[app_proxy]` block in `shopify.app.toml` (subpath, prefix, url placeholder — AppApprove deploy overwrites url with the live Worker URL).
- Cron triggers: declare in `wrangler.toml [triggers].crons` AND register the handler in `app/router.ts` scheduled handler. AppApprove deploys the cron schedule automatically.
- Secrets: never commit. Reference via `env.RESEND_API_KEY` etc. AppApprove pushes managed secrets at deploy; merchant-BYOK env vars come via the Phase 7.1 Settings UI.
- Self-review pass at end: re-read the diff once before committing — look for race conditions, missing transaction wrapping, leaked secrets, missing error handling on awaited promises. Fix found issues in the same commit.
- Final commit message: 1 paragraph diff summary — surfaces shipped, tests written, edge cases deferred. Helps QA review + future maintainer.
- NEVER use Vite-style `?raw` imports for SQL/text files in code that runs on the Worker (`import sql from './x.sql?raw'`). Cloudflare Workers' esbuild has no .sql/.txt loader configured — the deploy fails with `No loader is configured for '.sql' files`. Inline SQL migrations as TypeScript const strings (e.g. `export const MIGRATION_0000 = \`CREATE TABLE …\`;`) so the bundle is pure JS. Caused Phase 11 Validation-Build #2 to fail 2026-05-15.
- Declaring `[[r2_buckets]]` in wrangler.toml: AppApprove's deploy.yml auto-creates the buckets (Sprint 11I), but only if the Cloudflare API token has 'Workers R2 Storage: Edit' scope. Otherwise deploy fails with `Authentication error [code: 10000]`.
- R2-using features should degrade gracefully at runtime when the binding is absent (`if (env.MY_R2_BUCKET) { ... } else { skip }`), so customers without R2 scope still get a working app — just without that one feature. Reviews blueprint takes this path — photo upload silently disabled if R2 unavailable.
- Resource bindings (D1, KV, R2, Queues, Vectorize) in `wrangler.toml`: AppApprove's deploy pipeline auto-creates the underlying resource and patches the `id` field on first deploy. The pipeline detects placeholders by UUID-format check — any value that is NOT a valid UUID is treated as a placeholder and will be replaced. You don't need a specific magic string; `database_id = "pending"` or `database_id = ""` both work. The post-deploy file has the real UUID. Do NOT commit wrangler.toml with a real UUID — it'd skip the auto-create + fail on a different account.

## Project-specific reminders

- All currency stored as integer cents
- Webhooks subscribed in `shopify.app.toml [[webhooks.subscriptions]]` + handlers in `app/routes/webhooks.<topic>.ts`

## Don't

- Don't modify `deploy.yml` structure, `wrangler.toml` schema, or `load-context.ts` beyond adding new bindings
- Don't replace AppApprove scaffold/auth helpers — extend them
- Don't introduce a new top-level dependency if a similar one already exists in `package.json` (check first)
- Don't break the existing `pnpm tsc + pnpm test` gates — both must stay green for deploy to succeed

## Deploy

```bash
git push origin main
```

→ `deploy.yml` runs install + tsc + test + `wrangler deploy`. Live URL is `perf-probe-0521.appapprove.app`.
