import type { AppLoadContext } from "@remix-run/cloudflare";
import type { Env } from "../../load-context";
import { markdownToHtml, sanitizeHtml, slugify } from "~/lib/faq-logic.js";

// D1 schema for the FAQ blueprint. These statements mirror
// drizzle/migrations/0000_faq_init.sql exactly. The migration file is the
// canonical path (deploy.yml applies it with `wrangler d1 migrations
// apply`); ensureSchema() re-runs the same idempotent DDL at request time
// so the app self-heals if the migration step (continue-on-error in CI)
// ever soft-fails on a fresh database.

export const FAQ_SCHEMA_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS faq_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_domain TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_faq_categories_shop ON faq_categories (shop_domain, position)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_faq_categories_slug ON faq_categories (shop_domain, slug)`,
  `CREATE TABLE IF NOT EXISTS faq_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_domain TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    question TEXT NOT NULL,
    answer_md TEXT NOT NULL DEFAULT '',
    answer_html TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'published',
    position INTEGER NOT NULL DEFAULT 0,
    view_count INTEGER NOT NULL DEFAULT 0,
    helpful_count INTEGER NOT NULL DEFAULT 0,
    unhelpful_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_faq_entries_shop ON faq_entries (shop_domain, status, position)`,
  `CREATE INDEX IF NOT EXISTS idx_faq_entries_category ON faq_entries (category_id, position)`,
  `CREATE TABLE IF NOT EXISTS faq_votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    vote TEXT NOT NULL,
    voted_at INTEGER NOT NULL,
    customer_id TEXT,
    anon_token TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_faq_votes_entry ON faq_votes (entry_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_faq_votes_dedup ON faq_votes (entry_id, anon_token)`,
  `CREATE TABLE IF NOT EXISTS faq_view_daily (
    entry_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (entry_id, day)
  )`,
  `CREATE TABLE IF NOT EXISTS faq_settings (
    shop_domain TEXT PRIMARY KEY,
    default_category_id INTEGER,
    search_enabled INTEGER NOT NULL DEFAULT 1,
    max_answer_length INTEGER NOT NULL DEFAULT 4000,
    updated_at INTEGER NOT NULL
  )`,
];

/** Resolve the D1 binding from the load context, or null when unbound. */
export function getDb(context: AppLoadContext): D1Database | null {
  const env = (context.cloudflare?.env ?? {}) as Env;
  return env.D1 ?? null;
}

let schemaReady = false;

/** Create the FAQ tables if missing. Runs once per Worker isolate. */
export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.batch(FAQ_SCHEMA_SQL.map((sql) => db.prepare(sql)));
  schemaReady = true;
}

const seededShops = new Set<string>();

interface SeedCategory {
  name: string;
  entries: { question: string; answer: string }[];
}

// First-run content so a freshly installed shop has a usable FAQ page +
// accordion immediately. Answers are authored in the Markdown subset the
// editor accepts; copy avoids superlative claims (trust-asset checklist).
const SEED: SeedCategory[] = [
  {
    name: "Shipping & Delivery",
    entries: [
      {
        question: "How long does delivery take?",
        answer:
          "Orders are usually processed within **1-2 business days**. Delivery then takes:\n\n- Domestic: 3-5 business days\n- International: 7-14 business days\n\nYou'll get a tracking link by email once your order ships.",
      },
      {
        question: "Do you ship internationally?",
        answer:
          "Yes — we ship to many countries. Duties and import taxes are calculated at checkout where available, otherwise they may be collected by your local carrier on delivery.",
      },
      {
        question: "Can I change my shipping address after ordering?",
        answer:
          "If your order has not shipped yet, contact us as soon as possible and we'll update it. Once a parcel is in transit the address can no longer be changed.",
      },
    ],
  },
  {
    name: "Returns & Refunds",
    entries: [
      {
        question: "What is your return policy?",
        answer:
          "Unworn items in original condition can be returned within **30 days** of delivery. Start a return from your account page or contact support for a prepaid label.",
      },
      {
        question: "How long do refunds take?",
        answer:
          "Once we receive and inspect your return, refunds are issued to the original payment method within 5-7 business days. Your bank may take a little longer to post it.",
      },
      {
        question: "Can I exchange an item for a different size?",
        answer:
          "Yes. The quickest route is to return the original item and place a new order for the size you want, so the replacement is reserved straight away.",
      },
    ],
  },
  {
    name: "Products & Sizing",
    entries: [
      {
        question: "How do I find the right size?",
        answer:
          "Each product page has a size guide with measurements in cm and inches. If you are between sizes, the guide notes whether that style runs small or large.",
      },
      {
        question: "Are your products covered by a warranty?",
        answer:
          "Products are covered against manufacturing defects for 12 months. Reach out with your order number and a photo and we'll help with a repair or replacement.",
      },
    ],
  },
  {
    name: "Orders & Payment",
    entries: [
      {
        question: "Which payment methods do you accept?",
        answer:
          "We accept major credit and debit cards, Shop Pay, Apple Pay, Google Pay, and PayPal. Available options are shown at checkout based on your region.",
      },
      {
        question: "Can I use more than one discount code?",
        answer:
          "Only one discount code can be applied per order. If a code does not work, check that it has not expired and that your cart meets any minimum-spend requirement.",
      },
      {
        question: "How do I check my order status?",
        answer:
          "Open the confirmation email and use the tracking link, or sign in to your account and open **Order history** for the latest status.",
      },
    ],
  },
];

/**
 * Seed starter categories + entries for a shop that has none yet. Guarded
 * by an isolate-local cache and a row count, so it runs at most once per
 * shop. A failure is swallowed by callers — an empty FAQ is still valid.
 */
export async function ensureSeeded(db: D1Database, shop: string): Promise<void> {
  if (seededShops.has(shop)) return;
  try {
    const existing = await db
      .prepare("SELECT COUNT(*) AS n FROM faq_categories WHERE shop_domain = ?")
      .bind(shop)
      .first<{ n: number }>();
    if (existing && existing.n > 0) {
      seededShops.add(shop);
      return;
    }
    const now = Date.now();
    for (let c = 0; c < SEED.length; c++) {
      const cat = SEED[c]!;
      const inserted = await db
        .prepare(
          `INSERT INTO faq_categories (shop_domain, name, slug, position, created_at)
           VALUES (?, ?, ?, ?, ?) RETURNING id`,
        )
        .bind(shop, cat.name, slugify(cat.name), c, now)
        .first<{ id: number }>();
      if (!inserted) continue;
      for (let e = 0; e < cat.entries.length; e++) {
        const entry = cat.entries[e]!;
        const html = sanitizeHtml(markdownToHtml(entry.answer));
        await db
          .prepare(
            `INSERT INTO faq_entries
               (shop_domain, category_id, question, answer_md, answer_html,
                status, position, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'published', ?, ?, ?)`,
          )
          .bind(shop, inserted.id, entry.question, entry.answer, html, e, now, now)
          .run();
      }
    }
    seededShops.add(shop);
  } catch (err) {
    // A concurrent first request can seed the same shop and trip the
    // unique slug index — harmless, the data exists either way. Never
    // let seeding break the page that triggered it.
    console.warn("[faq] seed skipped for", shop, err);
  }
}
