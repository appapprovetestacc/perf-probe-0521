import {
  ensureUniqueSlug,
  markdownToHtml,
  sanitizeHtml,
  slugify,
  tallyVotes,
} from "~/lib/faq-logic.js";
import { DEFAULT_MAX_ANSWER_LENGTH, ENTRIES_PAGE_SIZE } from "~/lib/faq-types";
import type {
  EntrySort,
  FaqCategory,
  FaqEntry,
  FaqMetrics,
  FaqSettings,
  FaqStatus,
} from "~/lib/faq-types";

// D1 query layer for the FAQ blueprint. Every function takes an explicit
// D1Database so callers resolve the binding once (getDb) and stay testable.
// Domain types + constants live in faq-types.ts (browser-safe).

export type {
  EntrySort,
  FaqCategory,
  FaqEntry,
  FaqMetrics,
  FaqSettings,
  FaqStatus,
} from "~/lib/faq-types";

interface CategoryRow {
  id: number;
  name: string;
  slug: string;
  position: number;
  entryCount: number;
}

interface EntryRow {
  id: number;
  category_id: number;
  categoryName: string;
  question: string;
  answer_md: string;
  answer_html: string;
  status: string;
  position: number;
  view_count: number;
  helpful_count: number;
  unhelpful_count: number;
  created_at: number;
  updated_at: number;
}

function toEntry(row: EntryRow): FaqEntry {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.categoryName ?? "",
    question: row.question,
    answerMd: row.answer_md ?? "",
    answerHtml: row.answer_html ?? "",
    status: normalizeStatus(row.status),
    position: row.position,
    viewCount: row.view_count ?? 0,
    helpfulCount: row.helpful_count ?? 0,
    unhelpfulCount: row.unhelpful_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeStatus(value: unknown): FaqStatus {
  return value === "draft" || value === "hidden" ? value : "published";
}

/** UTC YYYY-MM-DD key for daily view bucketing. */
export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

// ── Categories ───────────────────────────────────────────────────────

export async function listCategories(
  db: D1Database,
  shop: string,
): Promise<FaqCategory[]> {
  const res = await db
    .prepare(
      `SELECT c.id, c.name, c.slug, c.position,
              (SELECT COUNT(*) FROM faq_entries e WHERE e.category_id = c.id) AS entryCount
       FROM faq_categories c
       WHERE c.shop_domain = ?
       ORDER BY c.position, c.id`,
    )
    .bind(shop)
    .all<CategoryRow>();
  return (res.results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    position: r.position,
    entryCount: r.entryCount ?? 0,
  }));
}

export async function createCategory(
  db: D1Database,
  shop: string,
  name: string,
): Promise<FaqCategory> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Category name is required.");
  const existing = await db
    .prepare("SELECT slug FROM faq_categories WHERE shop_domain = ?")
    .bind(shop)
    .all<{ slug: string }>();
  const slug = ensureUniqueSlug(
    slugify(trimmed),
    (existing.results ?? []).map((r) => r.slug),
  );
  const posRow = await db
    .prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM faq_categories WHERE shop_domain = ?",
    )
    .bind(shop)
    .first<{ pos: number }>();
  const inserted = await db
    .prepare(
      `INSERT INTO faq_categories (shop_domain, name, slug, position, created_at)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(shop, trimmed, slug, posRow?.pos ?? 0, Date.now())
    .first<{ id: number }>();
  return {
    id: inserted!.id,
    name: trimmed,
    slug,
    position: posRow?.pos ?? 0,
    entryCount: 0,
  };
}

/** Rename a category. The slug is intentionally left stable so storefront
 *  accordion blocks that reference it keep working after a rename. */
export async function updateCategory(
  db: D1Database,
  shop: string,
  id: number,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Category name is required.");
  await db
    .prepare("UPDATE faq_categories SET name = ? WHERE id = ? AND shop_domain = ?")
    .bind(trimmed, id, shop)
    .run();
}

export async function deleteCategory(
  db: D1Database,
  shop: string,
  id: number,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `DELETE FROM faq_votes WHERE entry_id IN
           (SELECT id FROM faq_entries WHERE category_id = ? AND shop_domain = ?)`,
      )
      .bind(id, shop),
    db
      .prepare(
        `DELETE FROM faq_view_daily WHERE entry_id IN
           (SELECT id FROM faq_entries WHERE category_id = ? AND shop_domain = ?)`,
      )
      .bind(id, shop),
    db
      .prepare("DELETE FROM faq_entries WHERE category_id = ? AND shop_domain = ?")
      .bind(id, shop),
    db
      .prepare("DELETE FROM faq_categories WHERE id = ? AND shop_domain = ?")
      .bind(id, shop),
  ]);
}

// ── Entries ──────────────────────────────────────────────────────────

const ENTRY_SELECT = `SELECT e.id, e.category_id, e.question, e.answer_md, e.answer_html,
         e.status, e.position, e.view_count, e.helpful_count, e.unhelpful_count,
         e.created_at, e.updated_at, c.name AS categoryName
  FROM faq_entries e
  JOIN faq_categories c ON c.id = e.category_id`;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => "\\" + c);
}

const SORT_SQL: Record<EntrySort, string> = {
  question: "e.question",
  views: "e.view_count",
  helpful: "e.helpful_count",
};

export interface ListEntriesOptions {
  status?: FaqStatus | "all";
  categoryId?: number | null;
  query?: string;
  page?: number;
  pageSize?: number;
  sort?: EntrySort | null;
  dir?: "asc" | "desc";
}

export interface ListEntriesResult {
  rows: FaqEntry[];
  page: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export async function listEntries(
  db: D1Database,
  shop: string,
  opts: ListEntriesOptions = {},
): Promise<ListEntriesResult> {
  const pageSize = opts.pageSize ?? ENTRIES_PAGE_SIZE;
  const page = Math.max(1, opts.page ?? 1);
  const where: string[] = ["e.shop_domain = ?"];
  const binds: unknown[] = [shop];
  if (opts.status && opts.status !== "all") {
    where.push("e.status = ?");
    binds.push(opts.status);
  }
  if (opts.categoryId != null) {
    where.push("e.category_id = ?");
    binds.push(opts.categoryId);
  }
  const q = (opts.query ?? "").trim();
  if (q) {
    where.push("e.question LIKE ? ESCAPE '\\'");
    binds.push("%" + escapeLike(q) + "%");
  }
  const dir = opts.dir === "desc" ? "DESC" : "ASC";
  const sortCol = opts.sort ? SORT_SQL[opts.sort] : null;
  const orderBy = sortCol
    ? `${sortCol} ${dir}, e.id ${dir}`
    : "c.position, e.position, e.id";
  const sql =
    ENTRY_SELECT +
    ` WHERE ${where.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?`;
  const res = await db
    .prepare(sql)
    .bind(...binds, pageSize + 1, (page - 1) * pageSize)
    .all<EntryRow>();
  const rows = (res.results ?? []).map(toEntry);
  const hasNext = rows.length > pageSize;
  return {
    rows: hasNext ? rows.slice(0, pageSize) : rows,
    page,
    hasNext,
    hasPrev: page > 1,
  };
}

export async function getStatusCounts(
  db: D1Database,
  shop: string,
): Promise<Record<"all" | FaqStatus, number>> {
  const res = await db
    .prepare(
      "SELECT status, COUNT(*) AS n FROM faq_entries WHERE shop_domain = ? GROUP BY status",
    )
    .bind(shop)
    .all<{ status: string; n: number }>();
  const counts = { all: 0, published: 0, draft: 0, hidden: 0 };
  for (const row of res.results ?? []) {
    const status = normalizeStatus(row.status);
    counts[status] += row.n;
    counts.all += row.n;
  }
  return counts;
}

export async function getEntry(
  db: D1Database,
  shop: string,
  id: number,
): Promise<FaqEntry | null> {
  const row = await db
    .prepare(ENTRY_SELECT + " WHERE e.id = ? AND e.shop_domain = ?")
    .bind(id, shop)
    .first<EntryRow>();
  return row ? toEntry(row) : null;
}

export interface EntryInput {
  question: string;
  answerMd: string;
  categoryId: number;
  status: FaqStatus;
}

async function categoryBelongsToShop(
  db: D1Database,
  shop: string,
  categoryId: number,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM faq_categories WHERE id = ? AND shop_domain = ?")
    .bind(categoryId, shop)
    .first<{ ok: number }>();
  return !!row;
}

export async function createEntry(
  db: D1Database,
  shop: string,
  input: EntryInput,
): Promise<number> {
  const question = input.question.trim();
  if (!question) throw new Error("Question is required.");
  if (!(await categoryBelongsToShop(db, shop, input.categoryId))) {
    throw new Error("Choose a category for this entry.");
  }
  const answerHtml = sanitizeHtml(markdownToHtml(input.answerMd));
  const posRow = await db
    .prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM faq_entries WHERE category_id = ?",
    )
    .bind(input.categoryId)
    .first<{ pos: number }>();
  const now = Date.now();
  const inserted = await db
    .prepare(
      `INSERT INTO faq_entries
         (shop_domain, category_id, question, answer_md, answer_html,
          status, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      shop,
      input.categoryId,
      question,
      input.answerMd,
      answerHtml,
      input.status,
      posRow?.pos ?? 0,
      now,
      now,
    )
    .first<{ id: number }>();
  return inserted!.id;
}

export async function updateEntry(
  db: D1Database,
  shop: string,
  id: number,
  input: EntryInput,
): Promise<void> {
  const question = input.question.trim();
  if (!question) throw new Error("Question is required.");
  if (!(await categoryBelongsToShop(db, shop, input.categoryId))) {
    throw new Error("Choose a category for this entry.");
  }
  const answerHtml = sanitizeHtml(markdownToHtml(input.answerMd));
  await db
    .prepare(
      `UPDATE faq_entries
         SET question = ?, answer_md = ?, answer_html = ?, category_id = ?,
             status = ?, updated_at = ?
       WHERE id = ? AND shop_domain = ?`,
    )
    .bind(
      question,
      input.answerMd,
      answerHtml,
      input.categoryId,
      input.status,
      Date.now(),
      id,
      shop,
    )
    .run();
}

export async function deleteEntries(
  db: D1Database,
  shop: string,
  ids: number[],
): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  await db.batch([
    db
      .prepare(
        `DELETE FROM faq_votes WHERE entry_id IN
           (SELECT id FROM faq_entries WHERE shop_domain = ? AND id IN (${placeholders}))`,
      )
      .bind(shop, ...ids),
    db
      .prepare(
        `DELETE FROM faq_view_daily WHERE entry_id IN
           (SELECT id FROM faq_entries WHERE shop_domain = ? AND id IN (${placeholders}))`,
      )
      .bind(shop, ...ids),
    db
      .prepare(
        `DELETE FROM faq_entries WHERE shop_domain = ? AND id IN (${placeholders})`,
      )
      .bind(shop, ...ids),
  ]);
}

export async function setEntriesStatus(
  db: D1Database,
  shop: string,
  ids: number[],
  status: FaqStatus,
): Promise<void> {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(", ");
  await db
    .prepare(
      `UPDATE faq_entries SET status = ?, updated_at = ?
       WHERE shop_domain = ? AND id IN (${placeholders})`,
    )
    .bind(status, Date.now(), shop, ...ids)
    .run();
}

// ── Metrics + analytics ──────────────────────────────────────────────

export async function getMetrics(
  db: D1Database,
  shop: string,
): Promise<FaqMetrics> {
  const totals = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(helpful_count), 0) AS h,
              COALESCE(SUM(unhelpful_count), 0) AS u
       FROM faq_entries WHERE shop_domain = ?`,
    )
    .bind(shop)
    .first<{ total: number; h: number; u: number }>();
  const cutoff = dayKey(Date.now() - 29 * 86_400_000);
  const views = await db
    .prepare(
      `SELECT COALESCE(SUM(views), 0) AS v FROM faq_view_daily
       WHERE day >= ? AND entry_id IN
         (SELECT id FROM faq_entries WHERE shop_domain = ?)`,
    )
    .bind(cutoff, shop)
    .first<{ v: number }>();
  const helpful = totals?.h ?? 0;
  const unhelpful = totals?.u ?? 0;
  const voteTotal = helpful + unhelpful;
  return {
    totalEntries: totals?.total ?? 0,
    views30d: views?.v ?? 0,
    helpfulRatio: voteTotal === 0 ? null : Math.round((helpful / voteTotal) * 100),
  };
}

export interface EntryAnalytics {
  tally: ReturnType<typeof tallyVotes>;
  sparkline: { day: string; views: number }[];
}

export async function getEntryAnalytics(
  db: D1Database,
  entryId: number,
): Promise<EntryAnalytics> {
  const votes = await db
    .prepare("SELECT vote FROM faq_votes WHERE entry_id = ?")
    .bind(entryId)
    .all<{ vote: string }>();
  const cutoff = dayKey(Date.now() - 29 * 86_400_000);
  const daily = await db
    .prepare(
      "SELECT day, views FROM faq_view_daily WHERE entry_id = ? AND day >= ?",
    )
    .bind(entryId, cutoff)
    .all<{ day: string; views: number }>();
  const byDay = new Map<string, number>();
  for (const row of daily.results ?? []) byDay.set(row.day, row.views);
  const sparkline: { day: string; views: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = dayKey(Date.now() - i * 86_400_000);
    sparkline.push({ day, views: byDay.get(day) ?? 0 });
  }
  return { tally: tallyVotes(votes.results ?? []), sparkline };
}

// ── Settings ─────────────────────────────────────────────────────────

export async function getSettings(
  db: D1Database,
  shop: string,
): Promise<FaqSettings> {
  const row = await db
    .prepare(
      "SELECT default_category_id, search_enabled, max_answer_length FROM faq_settings WHERE shop_domain = ?",
    )
    .bind(shop)
    .first<{
      default_category_id: number | null;
      search_enabled: number;
      max_answer_length: number;
    }>();
  return {
    defaultCategoryId: row?.default_category_id ?? null,
    searchEnabled: row ? row.search_enabled !== 0 : true,
    maxAnswerLength: row?.max_answer_length ?? DEFAULT_MAX_ANSWER_LENGTH,
  };
}

export async function saveSettings(
  db: D1Database,
  shop: string,
  settings: FaqSettings,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO faq_settings
         (shop_domain, default_category_id, search_enabled, max_answer_length, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(shop_domain) DO UPDATE SET
         default_category_id = excluded.default_category_id,
         search_enabled = excluded.search_enabled,
         max_answer_length = excluded.max_answer_length,
         updated_at = excluded.updated_at`,
    )
    .bind(
      shop,
      settings.defaultCategoryId,
      settings.searchEnabled ? 1 : 0,
      settings.maxAnswerLength,
      Date.now(),
    )
    .run();
}

// ── Storefront (app-proxy) reads ─────────────────────────────────────

export interface PublicEntry {
  id: number;
  question: string;
  answerHtml: string;
  helpfulCount: number;
  unhelpfulCount: number;
}

export interface PublicCategory {
  id: number;
  name: string;
  slug: string;
  entries: PublicEntry[];
}

export async function getPublicFaq(
  db: D1Database,
  shop: string,
): Promise<PublicCategory[]> {
  const cats = await db
    .prepare(
      "SELECT id, name, slug FROM faq_categories WHERE shop_domain = ? ORDER BY position, id",
    )
    .bind(shop)
    .all<{ id: number; name: string; slug: string }>();
  const entries = await db
    .prepare(
      `SELECT id, category_id, question, answer_html, helpful_count, unhelpful_count
       FROM faq_entries
       WHERE shop_domain = ? AND status = 'published'
       ORDER BY position, id`,
    )
    .bind(shop)
    .all<{
      id: number;
      category_id: number;
      question: string;
      answer_html: string;
      helpful_count: number;
      unhelpful_count: number;
    }>();
  const byCat = new Map<number, PublicEntry[]>();
  for (const e of entries.results ?? []) {
    const list = byCat.get(e.category_id) ?? [];
    list.push({
      id: e.id,
      question: e.question,
      answerHtml: e.answer_html,
      helpfulCount: e.helpful_count ?? 0,
      unhelpfulCount: e.unhelpful_count ?? 0,
    });
    byCat.set(e.category_id, list);
  }
  return (cats.results ?? [])
    .map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      entries: byCat.get(c.id) ?? [],
    }))
    .filter((c) => c.entries.length > 0);
}

export async function getPublicCategory(
  db: D1Database,
  shop: string,
  slug: string,
): Promise<PublicCategory | null> {
  const all = await getPublicFaq(db, shop);
  const direct = all.find((c) => c.slug === slug);
  if (direct) return direct;
  // Unknown / blank slug — fall back to the shop's configured default
  // category, then to the first category with published entries.
  const settings = await getSettings(db, shop);
  if (settings.defaultCategoryId != null) {
    const fallback = all.find((c) => c.id === settings.defaultCategoryId);
    if (fallback) return fallback;
  }
  return all[0] ?? null;
}

// ── Voting + views ───────────────────────────────────────────────────

export interface VoteResult {
  ok: boolean;
  helpful: number;
  unhelpful: number;
  error?: string;
}

export async function recordVote(
  db: D1Database,
  shop: string,
  entryId: number,
  vote: "up" | "down",
  anonToken: string,
): Promise<VoteResult> {
  const entry = await db
    .prepare(
      "SELECT id FROM faq_entries WHERE id = ? AND shop_domain = ? AND status = 'published'",
    )
    .bind(entryId, shop)
    .first<{ id: number }>();
  if (!entry) return { ok: false, helpful: 0, unhelpful: 0, error: "not_found" };
  await db
    .prepare(
      `INSERT INTO faq_votes (entry_id, vote, voted_at, customer_id, anon_token)
       VALUES (?, ?, ?, NULL, ?)
       ON CONFLICT(entry_id, anon_token)
         DO UPDATE SET vote = excluded.vote, voted_at = excluded.voted_at`,
    )
    .bind(entryId, vote, Date.now(), anonToken)
    .run();
  const counts = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN vote = 'up' THEN 1 ELSE 0 END), 0) AS helpful,
         COALESCE(SUM(CASE WHEN vote = 'down' THEN 1 ELSE 0 END), 0) AS unhelpful
       FROM faq_votes WHERE entry_id = ?`,
    )
    .bind(entryId)
    .first<{ helpful: number; unhelpful: number }>();
  const helpful = counts?.helpful ?? 0;
  const unhelpful = counts?.unhelpful ?? 0;
  await db
    .prepare(
      "UPDATE faq_entries SET helpful_count = ?, unhelpful_count = ? WHERE id = ?",
    )
    .bind(helpful, unhelpful, entryId)
    .run();
  return { ok: true, helpful, unhelpful };
}

export async function recordView(
  db: D1Database,
  shop: string,
  entryId: number,
): Promise<boolean> {
  const entry = await db
    .prepare(
      "SELECT id FROM faq_entries WHERE id = ? AND shop_domain = ? AND status = 'published'",
    )
    .bind(entryId, shop)
    .first<{ id: number }>();
  if (!entry) return false;
  const day = dayKey(Date.now());
  await db.batch([
    db
      .prepare("UPDATE faq_entries SET view_count = view_count + 1 WHERE id = ?")
      .bind(entryId),
    db
      .prepare(
        `INSERT INTO faq_view_daily (entry_id, day, views) VALUES (?, ?, 1)
         ON CONFLICT(entry_id, day) DO UPDATE SET views = views + 1`,
      )
      .bind(entryId, day),
  ]);
  return true;
}
