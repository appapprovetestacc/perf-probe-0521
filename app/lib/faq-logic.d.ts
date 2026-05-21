// Type declarations for faq-logic.js (plain ESM kept JS so node:test can
// import it directly without a TS loader).

export interface SearchableEntry {
  id?: number | string;
  question?: string;
  answerText?: string;
  [key: string]: unknown;
}

export interface VoteTally {
  helpful: number;
  unhelpful: number;
  total: number;
  ratio: number | null;
}

export type VoteRow = { vote: string } | "up" | "down" | string;

export function searchEntries<T extends SearchableEntry>(
  entries: T[],
  query: string,
): T[];

export function tallyVotes(votes: VoteRow[]): VoteTally;

export function helpfulRatio(
  helpful: number | null | undefined,
  unhelpful: number | null | undefined,
): number | null;

export function slugify(name: string): string;

export function ensureUniqueSlug(
  base: string,
  existingSlugs: Iterable<string>,
): string;

export function markdownToHtml(md: string | null | undefined): string;

export function sanitizeHtml(html: string | null | undefined): string;

export function stripHtml(html: string | null | undefined): string;

export function truncate(text: string | null | undefined, max: number): string;
