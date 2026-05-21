import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
  json,
} from "@remix-run/cloudflare";
import { useFetcher, useNavigate, useSearchParams } from "@remix-run/react";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  EmptyState,
  IndexTable,
  InlineGrid,
  InlineStack,
  Layout,
  Modal,
  Page,
  Pagination,
  Select,
  Tabs,
  Text,
  TextField,
  useIndexResourceState,
} from "@shopify/polaris";
import { useEffect, useMemo, useRef, useState } from "react";
import { EntryFormModal } from "~/components/EntryFormModal";
import { useAppBridge } from "~/lib/app-bridge";
import {
  createCategory,
  createEntry,
  deleteCategory,
  deleteEntries,
  getMetrics,
  getSettings,
  getStatusCounts,
  listCategories,
  listEntries,
  setEntriesStatus,
  updateCategory,
  updateEntry,
} from "~/lib/faq-db.server";
import { helpfulRatio } from "~/lib/faq-logic.js";
import { ensureSchema, ensureSeeded, getDb } from "~/lib/faq-schema.server";
import {
  type EntrySort,
  type FaqCategory,
  type FaqEntry,
  type FaqStatus,
  STATUS_LABEL,
} from "~/lib/faq-types";
import { embeddedMeta } from "~/lib/embedded-meta";
import { authenticate } from "~/lib/shopify.server";

const TABS: { id: "all" | FaqStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "published", label: "Published" },
  { id: "draft", label: "Draft" },
  { id: "hidden", label: "Hidden" },
];
const SORT_COLUMNS: (EntrySort | null)[] = [
  "question",
  null,
  null,
  "views",
  "helpful",
];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { shop } = await authenticate.admin(request, context);
  const apiKey = context.cloudflare?.env?.SHOPIFY_API_KEY ?? "";
  const url = new URL(request.url);
  const tab = (url.searchParams.get("tab") ?? "all") as "all" | FaqStatus;
  const categoryParam = url.searchParams.get("category");
  const categoryId =
    categoryParam && categoryParam !== "all" ? Number(categoryParam) : null;
  const q = url.searchParams.get("q") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const sortParam = url.searchParams.get("sort");
  const sort = (
    sortParam === "question" || sortParam === "views" || sortParam === "helpful"
      ? sortParam
      : null
  ) as EntrySort | null;
  const dir = url.searchParams.get("dir") === "desc" ? "desc" : "asc";

  const db = getDb(context);
  if (!db) {
    return json({
      ready: false as const,
      apiKey,
      shop,
      metrics: { totalEntries: 0, views30d: 0, helpfulRatio: null as number | null },
      categories: [] as FaqCategory[],
      entries: [] as FaqEntry[],
      counts: { all: 0, published: 0, draft: 0, hidden: 0 },
      settings: { defaultCategoryId: null, searchEnabled: true, maxAnswerLength: 4000 },
      tab,
      categoryId,
      q,
      page,
      sort,
      dir,
      hasNext: false,
      hasPrev: false,
    });
  }

  await ensureSchema(db);
  await ensureSeeded(db, shop);
  const [entryPage, categories, counts, metrics, settings] = await Promise.all([
    listEntries(db, shop, {
      status: tab,
      categoryId,
      query: q,
      page,
      sort,
      dir,
    }),
    listCategories(db, shop),
    getStatusCounts(db, shop),
    getMetrics(db, shop),
    getSettings(db, shop),
  ]);

  return json({
    ready: true as const,
    apiKey,
    shop,
    metrics,
    categories,
    entries: entryPage.rows,
    counts,
    settings,
    tab,
    categoryId,
    q,
    page: entryPage.page,
    sort,
    dir,
    hasNext: entryPage.hasNext,
    hasPrev: entryPage.hasPrev,
  });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { shop } = await authenticate.admin(request, context);
  const db = getDb(context);
  if (!db) {
    return json({ ok: false, error: "Database is not available yet." });
  }
  await ensureSchema(db);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    switch (intent) {
      case "entry.save": {
        const idRaw = String(form.get("id") ?? "").trim();
        const question = String(form.get("question") ?? "");
        const answerMd = String(form.get("answerMd") ?? "");
        const categoryId = Number(form.get("categoryId"));
        const statusRaw = String(form.get("status") ?? "published");
        const status: FaqStatus =
          statusRaw === "draft" || statusRaw === "hidden"
            ? statusRaw
            : "published";
        if (!question.trim()) {
          return json({ ok: false, error: "Enter a question." });
        }
        if (!Number.isFinite(categoryId) || categoryId <= 0) {
          return json({ ok: false, error: "Choose a category." });
        }
        const settings = await getSettings(db, shop);
        if (answerMd.length > settings.maxAnswerLength) {
          return json({
            ok: false,
            error: `Answer exceeds the ${settings.maxAnswerLength}-character limit.`,
          });
        }
        const input = { question, answerMd, categoryId, status };
        if (idRaw) {
          await updateEntry(db, shop, Number(idRaw), input);
        } else {
          await createEntry(db, shop, input);
        }
        return json({ ok: true });
      }
      case "entry.delete": {
        const id = Number(form.get("id"));
        if (Number.isFinite(id)) await deleteEntries(db, shop, [id]);
        return json({ ok: true });
      }
      case "entry.bulk": {
        const op = String(form.get("op") ?? "");
        const ids = String(form.get("ids") ?? "")
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (ids.length === 0) return json({ ok: true });
        if (op === "delete") {
          await deleteEntries(db, shop, ids);
        } else if (op === "published" || op === "draft" || op === "hidden") {
          await setEntriesStatus(db, shop, ids, op);
        }
        return json({ ok: true });
      }
      case "category.save": {
        const idRaw = String(form.get("id") ?? "").trim();
        const name = String(form.get("name") ?? "");
        if (!name.trim()) {
          return json({ ok: false, error: "Enter a category name." });
        }
        if (idRaw) {
          await updateCategory(db, shop, Number(idRaw), name);
        } else {
          await createCategory(db, shop, name);
        }
        return json({ ok: true });
      }
      case "category.delete": {
        const id = Number(form.get("id"));
        if (Number.isFinite(id)) await deleteCategory(db, shop, id);
        return json({ ok: true });
      }
      default:
        return json({ ok: false, error: "Unknown action." });
    }
  } catch (err) {
    return json({
      ok: false,
      error: err instanceof Error ? err.message : "Could not complete the action.",
    });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  embeddedMeta("FAQ — Perf Probe", data?.apiKey);

const STATUS_TONE: Record<FaqStatus, "success" | "info" | undefined> = {
  published: "success",
  draft: "info",
  hidden: undefined,
};

export default function FaqIndex() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();

  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [categoryModal, setCategoryModal] = useState<{
    open: boolean;
    category: FaqCategory | null;
  }>({ open: false, category: null });
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [searchInput, setSearchInput] = useState(data.q);

  const bulkFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const bulkWasRunning = useRef(false);

  const numberFmt = useMemo(
    () => new Intl.NumberFormat(shopify.locale),
    [shopify.locale],
  );

  const tableRows = useMemo(
    () => data.entries.map((e) => ({ id: String(e.id) })),
    [data.entries],
  );
  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } =
    useIndexResourceState(tableRows);

  // Sync the debounced search box into the ?q= param.
  useEffect(() => {
    if (searchInput === data.q) return;
    const t = setTimeout(() => {
      updateParams({ q: searchInput || null, page: null });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // Toast + selection reset once a bulk action finishes.
  useEffect(() => {
    if (bulkFetcher.state !== "idle") {
      bulkWasRunning.current = true;
      return;
    }
    if (!bulkWasRunning.current) return;
    bulkWasRunning.current = false;
    if (bulkFetcher.data?.ok) {
      clearSelection();
      shopify.toast.show("Entries updated");
    } else if (bulkFetcher.data?.error) {
      shopify.toast.show(bulkFetcher.data.error, { isError: true });
    }
  }, [bulkFetcher.state, bulkFetcher.data, clearSelection, shopify]);

  function updateParams(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value == null || value === "") next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  }

  function runBulk(op: "published" | "draft" | "hidden" | "delete") {
    bulkFetcher.submit(
      { intent: "entry.bulk", op, ids: selectedResources.join(",") },
      { method: "post" },
    );
  }

  const selectedTab = Math.max(
    0,
    TABS.findIndex((t) => t.id === data.tab),
  );
  const sortColumnIndex = data.sort
    ? SORT_COLUMNS.findIndex((c) => c === data.sort)
    : undefined;

  const hasAnyEntries = data.metrics.totalEntries > 0;

  return (
    <Page
      title="FAQ"
      subtitle="Manage categorized FAQ entries shown on your storefront."
      primaryAction={{
        content: "New entry",
        onAction: () => setEntryModalOpen(true),
        disabled: data.categories.length === 0,
      }}
      secondaryActions={[
        { content: "FAQ settings", url: "/app/faq/settings" },
        {
          content: "View FAQ page",
          url: `https://${data.shop}/apps/faq`,
          external: true,
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <OnboardingBanner hasEntries={hasAnyEntries} />

            {/* Metric tiles */}
            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
              <MetricCard
                label="Total entries"
                value={numberFmt.format(data.metrics.totalEntries)}
              />
              <MetricCard
                label="Views, last 30 days"
                value={numberFmt.format(data.metrics.views30d)}
              />
              <MetricCard
                label="Helpful ratio"
                value={
                  data.metrics.helpfulRatio == null
                    ? "—"
                    : `${data.metrics.helpfulRatio}%`
                }
              />
            </InlineGrid>

            {/* Category cards */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Categories
                  </Text>
                  <Button
                    onClick={() =>
                      setCategoryModal({ open: true, category: null })
                    }
                  >
                    Add category
                  </Button>
                </InlineStack>
                {data.categories.length === 0 ? (
                  <Text as="p" tone="subdued">
                    Create a category to start grouping FAQ entries.
                  </Text>
                ) : (
                  <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="300">
                    {data.categories.map((category) => (
                      <Box
                        key={category.id}
                        background="bg-surface-secondary"
                        padding="400"
                        borderRadius="200"
                        borderWidth="025"
                        borderColor="border"
                      >
                        <BlockStack gap="100">
                          <Text as="h3" variant="headingSm">
                            {category.name}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {category.entryCount}{" "}
                            {category.entryCount === 1 ? "entry" : "entries"}
                            {" · slug: "}
                            {category.slug}
                          </Text>
                          <Box>
                            <Button
                              variant="plain"
                              onClick={() =>
                                setCategoryModal({ open: true, category })
                              }
                            >
                              Edit category
                            </Button>
                          </Box>
                        </BlockStack>
                      </Box>
                    ))}
                  </InlineGrid>
                )}
              </BlockStack>
            </Card>

            {/* Entries table */}
            <Card padding="0">
              <Tabs
                tabs={TABS.map((t) => ({
                  id: t.id,
                  content: `${t.label} (${data.counts[t.id]})`,
                }))}
                selected={selectedTab}
                onSelect={(index) =>
                  updateParams({
                    tab: TABS[index]!.id === "all" ? null : TABS[index]!.id,
                    page: null,
                  })
                }
              />
              {hasAnyEntries ? (
                <>
                  <Box padding="300">
                    <InlineGrid columns={{ xs: 1, md: 2 }} gap="300">
                      <TextField
                        label="Search questions"
                        labelHidden
                        placeholder="Search questions"
                        value={searchInput}
                        onChange={setSearchInput}
                        autoComplete="off"
                        clearButton
                        onClearButtonClick={() => setSearchInput("")}
                      />
                      <Select
                        label="Filter by category"
                        labelHidden
                        options={[
                          { label: "All categories", value: "all" },
                          ...data.categories.map((c) => ({
                            label: c.name,
                            value: String(c.id),
                          })),
                        ]}
                        value={
                          data.categoryId == null
                            ? "all"
                            : String(data.categoryId)
                        }
                        onChange={(value) =>
                          updateParams({
                            category: value === "all" ? null : value,
                            page: null,
                          })
                        }
                      />
                    </InlineGrid>
                  </Box>
                  <IndexTable
                    resourceName={{ singular: "entry", plural: "entries" }}
                    itemCount={data.entries.length}
                    selectedItemsCount={
                      allResourcesSelected ? "All" : selectedResources.length
                    }
                    onSelectionChange={handleSelectionChange}
                    sortable={[true, false, false, true, true]}
                    sortColumnIndex={sortColumnIndex}
                    sortDirection={
                      data.dir === "desc" ? "descending" : "ascending"
                    }
                    onSort={(index, direction) => {
                      const col = SORT_COLUMNS[index];
                      if (!col) return;
                      updateParams({
                        sort: col,
                        dir: direction === "descending" ? "desc" : "asc",
                      });
                    }}
                    promotedBulkActions={[
                      {
                        content: "Publish",
                        onAction: () => runBulk("published"),
                      },
                      {
                        content: "Set as draft",
                        onAction: () => runBulk("draft"),
                      },
                      { content: "Hide", onAction: () => runBulk("hidden") },
                    ]}
                    bulkActions={[
                      {
                        content: "Delete entries",
                        onAction: () => setBulkDeleteOpen(true),
                      },
                    ]}
                    headings={[
                      { title: "Question" },
                      { title: "Category" },
                      { title: "Status" },
                      { title: "Views", alignment: "end" },
                      { title: "Helpful", alignment: "end" },
                    ]}
                    emptyState={
                      <Box padding="500">
                        <Text as="p" alignment="center" tone="subdued">
                          No entries match these filters.
                        </Text>
                      </Box>
                    }
                  >
                    {data.entries.map((entry, index) => {
                      const ratio = helpfulRatio(
                        entry.helpfulCount,
                        entry.unhelpfulCount,
                      );
                      return (
                        <IndexTable.Row
                          id={String(entry.id)}
                          key={entry.id}
                          position={index}
                          selected={selectedResources.includes(
                            String(entry.id),
                          )}
                          onClick={() => navigate(`/app/faq/${entry.id}`)}
                        >
                          <IndexTable.Cell>
                            <Text as="span" fontWeight="medium">
                              {entry.question}
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            {entry.categoryName}
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Badge tone={STATUS_TONE[entry.status]}>
                              {STATUS_LABEL[entry.status]}
                            </Badge>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text as="span" numeric alignment="end">
                              {numberFmt.format(entry.viewCount)}
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text as="span" numeric alignment="end">
                              {ratio == null ? "—" : `${ratio}%`}
                            </Text>
                          </IndexTable.Cell>
                        </IndexTable.Row>
                      );
                    })}
                  </IndexTable>
                  {data.hasNext || data.hasPrev ? (
                    <Box padding="300" borderBlockStartWidth="025" borderColor="border">
                      <InlineStack align="center">
                        <Pagination
                          hasNext={data.hasNext}
                          hasPrevious={data.hasPrev}
                          onNext={() =>
                            updateParams({ page: String(data.page + 1) })
                          }
                          onPrevious={() =>
                            updateParams({
                              page: String(Math.max(1, data.page - 1)),
                            })
                          }
                          label={`Page ${data.page}`}
                        />
                      </InlineStack>
                    </Box>
                  ) : null}
                </>
              ) : (
                <Box padding="400">
                  <EmptyState
                    heading="Write your first FAQ entry"
                    action={{
                      content: "New entry",
                      onAction: () => setEntryModalOpen(true),
                      disabled: data.categories.length === 0,
                    }}
                    secondaryAction={{
                      content: "FAQ writing tips",
                      url: "https://help.shopify.com/manual/online-store/themes/theme-structure/pages",
                      external: true,
                    }}
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>
                      FAQ entries you add appear on your storefront FAQ page and
                      in the accordion block. Group them into categories so
                      shoppers can scan quickly.
                    </p>
                  </EmptyState>
                </Box>
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      <EntryFormModal
        open={entryModalOpen}
        onClose={() => setEntryModalOpen(false)}
        entry={null}
        categories={data.categories}
        maxAnswerLength={data.settings.maxAnswerLength}
      />
      <CategoryModal
        state={categoryModal}
        onClose={() => setCategoryModal({ open: false, category: null })}
      />
      <Modal
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        title="Delete selected entries?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: () => {
            runBulk("delete");
            setBulkDeleteOpen(false);
          },
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setBulkDeleteOpen(false) },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            {selectedResources.length}{" "}
            {selectedResources.length === 1 ? "entry" : "entries"} will be
            permanently removed, along with their votes and view history.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="heading2xl" fontWeight="bold">
          {value}
        </Text>
      </BlockStack>
    </Card>
  );
}

const ONBOARDING_KEY = "faq-onboarding-dismissed";

function OnboardingBanner({ hasEntries }: { hasEntries: boolean }) {
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    setDismissed(
      typeof window !== "undefined" &&
        window.localStorage.getItem(ONBOARDING_KEY) === "1",
    );
  }, []);
  const steps = [
    { label: "Review your starter FAQ entries", done: hasEntries },
    { label: "Set your FAQ preferences in Settings", done: false },
    {
      label: "Add the FAQ accordion block to a storefront page",
      done: false,
    },
  ];
  if (dismissed || steps.every((s) => s.done)) return null;
  return (
    <Banner
      title="Finish setting up your FAQ"
      tone="info"
      onDismiss={() => {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(ONBOARDING_KEY, "1");
        }
        setDismissed(true);
      }}
    >
      <BlockStack gap="100">
        <Text as="p">A few steps get the storefront FAQ ready for shoppers:</Text>
        {steps.map((step) => (
          <Checkbox
            key={step.label}
            label={step.label}
            checked={step.done}
            disabled
          />
        ))}
      </BlockStack>
    </Banner>
  );
}

function CategoryModal({
  state,
  onClose,
}: {
  state: { open: boolean; category: FaqCategory | null };
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const shopify = useAppBridge();
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showError, setShowError] = useState(false);
  const wasRunning = useRef(false);
  const category = state.category;

  useEffect(() => {
    if (state.open) {
      setName(category?.name ?? "");
      setConfirmDelete(false);
      setShowError(false);
    }
  }, [state.open, category]);

  const submitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle") {
      wasRunning.current = true;
      return;
    }
    if (!wasRunning.current) return;
    wasRunning.current = false;
    if (fetcher.data?.ok) {
      shopify.toast.show("Category saved");
      onClose();
    }
  }, [fetcher.state, fetcher.data, onClose, shopify]);

  function save() {
    if (!name.trim()) {
      setShowError(true);
      return;
    }
    fetcher.submit(
      {
        intent: "category.save",
        id: category ? String(category.id) : "",
        name,
      },
      { method: "post" },
    );
  }

  function remove() {
    if (!category) return;
    fetcher.submit(
      { intent: "category.delete", id: String(category.id) },
      { method: "post" },
    );
  }

  return (
    <Modal
      open={state.open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={category ? "Edit category" : "New category"}
      primaryAction={{
        content: "Save",
        onAction: save,
        loading: submitting && !confirmDelete,
        disabled: submitting,
      }}
      secondaryActions={[
        { content: "Cancel", onAction: onClose, disabled: submitting },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {fetcher.data?.error ? (
            <Banner tone="critical">
              <p>{fetcher.data.error}</p>
            </Banner>
          ) : null}
          <TextField
            label="Category name"
            value={name}
            onChange={setName}
            autoComplete="off"
            requiredIndicator
            error={showError && !name.trim() ? "Enter a category name." : undefined}
            helpText={
              category
                ? `Storefront slug: ${category.slug} (stays the same when you rename)`
                : "A URL slug is generated from the name."
            }
          />
          {category ? (
            <Box>
              {confirmDelete ? (
                <Banner tone="critical" title="Delete this category?">
                  <BlockStack gap="200">
                    <Text as="p">
                      Deleting “{category.name}” also removes its{" "}
                      {category.entryCount}{" "}
                      {category.entryCount === 1 ? "entry" : "entries"}.
                    </Text>
                    <InlineStack gap="200">
                      <Button
                        variant="primary"
                        tone="critical"
                        loading={submitting}
                        onClick={remove}
                      >
                        Delete category
                      </Button>
                      <Button onClick={() => setConfirmDelete(false)}>
                        Keep category
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Banner>
              ) : (
                <Button
                  variant="plain"
                  tone="critical"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete category
                </Button>
              )}
            </Box>
          ) : null}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
