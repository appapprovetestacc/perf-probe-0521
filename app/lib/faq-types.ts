// Shared FAQ types + constants. Pure (no server imports) so both the D1
// layer and client components can depend on it without pulling server
// code into the browser bundle.

export type FaqStatus = "published" | "draft" | "hidden";
export const FAQ_STATUSES: FaqStatus[] = ["published", "draft", "hidden"];
export const DEFAULT_MAX_ANSWER_LENGTH = 4000;
export const ENTRIES_PAGE_SIZE = 25;

export type EntrySort = "question" | "views" | "helpful";

export interface FaqCategory {
  id: number;
  name: string;
  slug: string;
  position: number;
  entryCount: number;
}

export interface FaqEntry {
  id: number;
  categoryId: number;
  categoryName: string;
  question: string;
  answerMd: string;
  answerHtml: string;
  status: FaqStatus;
  position: number;
  viewCount: number;
  helpfulCount: number;
  unhelpfulCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface FaqSettings {
  defaultCategoryId: number | null;
  searchEnabled: boolean;
  maxAnswerLength: number;
}

export interface FaqMetrics {
  totalEntries: number;
  views30d: number;
  helpfulRatio: number | null;
}

export const STATUS_LABEL: Record<FaqStatus, string> = {
  published: "Published",
  draft: "Draft",
  hidden: "Hidden",
};
