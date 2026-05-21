import {
  type LoaderFunctionArgs,
  type MetaFunction,
  json,
} from "@remix-run/cloudflare";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Card,
  DescriptionList,
  Layout,
  Modal,
  Page,
  Text,
} from "@shopify/polaris";
import { useEffect, useRef, useState } from "react";
import { EntryFormModal } from "~/components/EntryFormModal";
import { useAppBridge } from "~/lib/app-bridge";
import {
  getEntry,
  getEntryAnalytics,
  getSettings,
  listCategories,
} from "~/lib/faq-db.server";
import { ensureSchema, getDb } from "~/lib/faq-schema.server";
import { STATUS_LABEL, type FaqStatus } from "~/lib/faq-types";
import { embeddedMeta } from "~/lib/embedded-meta";
import { authenticate } from "~/lib/shopify.server";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { shop } = await authenticate.admin(request, context);
  const apiKey = context.cloudflare?.env?.SHOPIFY_API_KEY ?? "";
  const id = Number(params.id);
  const db = getDb(context);
  if (!db || !Number.isFinite(id)) {
    throw new Response("FAQ entry not found", { status: 404 });
  }
  await ensureSchema(db);
  const entry = await getEntry(db, shop, id);
  if (!entry) {
    throw new Response("FAQ entry not found", { status: 404 });
  }
  const [analytics, categories, settings] = await Promise.all([
    getEntryAnalytics(db, id),
    listCategories(db, shop),
    getSettings(db, shop),
  ]);
  return json({ apiKey, entry, analytics, categories, settings });
}

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  embeddedMeta(
    data ? `${data.entry.question} — FAQ` : "FAQ entry",
    data?.apiKey,
  );

const STATUS_TONE: Record<FaqStatus, "success" | "info" | undefined> = {
  published: "success",
  draft: "info",
  hidden: undefined,
};

export default function FaqEntryDetail() {
  const { entry, analytics, categories, settings } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const deleteFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const wasDeleting = useRef(false);

  const dateFmt = new Intl.DateTimeFormat(shopify.locale, {
    dateStyle: "medium",
  });

  useEffect(() => {
    if (deleteFetcher.state !== "idle") {
      wasDeleting.current = true;
      return;
    }
    if (!wasDeleting.current) return;
    wasDeleting.current = false;
    if (deleteFetcher.data?.ok) {
      shopify.toast.show("Entry deleted");
      navigate("/app/faq");
    }
  }, [deleteFetcher.state, deleteFetcher.data, navigate, shopify]);

  const { tally, sparkline } = analytics;
  const totalViews = sparkline.reduce((sum, d) => sum + d.views, 0);

  return (
    <Page
      backAction={{ content: "FAQ", url: "/app/faq" }}
      title={entry.question}
      titleMetadata={
        <Badge tone={STATUS_TONE[entry.status]}>
          {STATUS_LABEL[entry.status]}
        </Badge>
      }
      primaryAction={{
        content: "Edit entry",
        onAction: () => setEditOpen(true),
      }}
      secondaryActions={[
        {
          content: "Delete",
          destructive: true,
          onAction: () => setDeleteOpen(true),
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Answer
                </Text>
                {entry.answerHtml ? (
                  <Box
                    background="bg-surface-secondary"
                    padding="400"
                    borderRadius="200"
                  >
                    <div
                      dangerouslySetInnerHTML={{ __html: entry.answerHtml }}
                    />
                  </Box>
                ) : (
                  <Text as="p" tone="subdued">
                    This entry has no answer yet. Edit it to add one.
                  </Text>
                )}
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Views over the last 30 days
                </Text>
                <Sparkline data={sparkline.map((d) => d.views)} />
                <Text as="p" variant="bodySm" tone="subdued">
                  {totalViews} {totalViews === 1 ? "view" : "views"} in the last
                  30 days · {entry.viewCount} all-time
                </Text>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Details
                </Text>
                <DescriptionList
                  items={[
                    { term: "Category", description: entry.categoryName },
                    {
                      term: "Status",
                      description: STATUS_LABEL[entry.status],
                    },
                    {
                      term: "Created",
                      description: dateFmt.format(new Date(entry.createdAt)),
                    },
                    {
                      term: "Updated",
                      description: dateFmt.format(new Date(entry.updatedAt)),
                    },
                  ]}
                />
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Vote distribution
                </Text>
                <DescriptionList
                  items={[
                    {
                      term: "Helpful",
                      description: String(tally.helpful),
                    },
                    {
                      term: "Unhelpful",
                      description: String(tally.unhelpful),
                    },
                    {
                      term: "Helpful ratio",
                      description:
                        tally.ratio == null ? "No votes yet" : `${tally.ratio}%`,
                    },
                  ]}
                />
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      <EntryFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        entry={entry}
        categories={categories}
        maxAnswerLength={settings.maxAnswerLength}
      />
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this FAQ entry?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          loading: deleteFetcher.state !== "idle",
          onAction: () =>
            deleteFetcher.submit(
              { intent: "entry.delete", id: String(entry.id) },
              { method: "post", action: "/app/faq" },
            ),
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setDeleteOpen(false) },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            “{entry.question}” will be permanently removed, along with its votes
            and view history.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

/** Minimal inline-SVG sparkline — avoids pulling in a charting dependency. */
function Sparkline({ data }: { data: number[] }) {
  const width = 480;
  const height = 64;
  const pad = 4;
  const max = Math.max(1, ...data);
  const step =
    data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;
  const points = data
    .map((value, i) => {
      const x = pad + i * step;
      const y = height - pad - (value / max) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label="Daily views for the last 30 days"
      >
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </Box>
  );
}
