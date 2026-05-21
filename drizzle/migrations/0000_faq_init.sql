-- FAQ blueprint — initial schema.
-- Applied by deploy.yml ("Apply D1 migrations" step) via
-- `wrangler d1 migrations apply D1 --remote`. The identical statements
-- are also kept inline in app/lib/faq-schema.server.ts (FAQ_SCHEMA_SQL)
-- and run at request time as a defensive net — every statement is
-- IF NOT EXISTS so running both paths is idempotent.

CREATE TABLE IF NOT EXISTS faq_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_domain TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_faq_categories_shop ON faq_categories (shop_domain, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_faq_categories_slug ON faq_categories (shop_domain, slug);

CREATE TABLE IF NOT EXISTS faq_entries (
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
);

CREATE INDEX IF NOT EXISTS idx_faq_entries_shop ON faq_entries (shop_domain, status, position);
CREATE INDEX IF NOT EXISTS idx_faq_entries_category ON faq_entries (category_id, position);

CREATE TABLE IF NOT EXISTS faq_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  vote TEXT NOT NULL,
  voted_at INTEGER NOT NULL,
  customer_id TEXT,
  anon_token TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_faq_votes_entry ON faq_votes (entry_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_faq_votes_dedup ON faq_votes (entry_id, anon_token);

CREATE TABLE IF NOT EXISTS faq_view_daily (
  entry_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entry_id, day)
);

CREATE TABLE IF NOT EXISTS faq_settings (
  shop_domain TEXT PRIMARY KEY,
  default_category_id INTEGER,
  search_enabled INTEGER NOT NULL DEFAULT 1,
  max_answer_length INTEGER NOT NULL DEFAULT 4000,
  updated_at INTEGER NOT NULL
);
