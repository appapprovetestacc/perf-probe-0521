import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
  json,
} from "@remix-run/cloudflare";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Card,
  Checkbox,
  FormLayout,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useEffect, useRef, useState } from "react";
import { SaveBar, useAppBridge } from "~/lib/app-bridge";
import { getSettings, listCategories, saveSettings } from "~/lib/faq-db.server";
import { ensureSchema, getDb } from "~/lib/faq-schema.server";
import { embeddedMeta } from "~/lib/embedded-meta";
import { authenticate } from "~/lib/shopify.server";

const MIN_ANSWER_LENGTH = 200;
const MAX_ANSWER_LENGTH = 20000;
const SAVE_BAR_ID = "faq-settings-save-bar";

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { shop } = await authenticate.admin(request, context);
  const apiKey = context.cloudflare?.env?.SHOPIFY_API_KEY ?? "";
  const db = getDb(context);
  if (!db) {
    return json({
      apiKey,
      settings: {
        defaultCategoryId: null,
        searchEnabled: true,
        maxAnswerLength: 4000,
      },
      categories: [],
    });
  }
  await ensureSchema(db);
  const [settings, categories] = await Promise.all([
    getSettings(db, shop),
    listCategories(db, shop),
  ]);
  return json({ apiKey, settings, categories });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const { shop } = await authenticate.admin(request, context);
  const db = getDb(context);
  if (!db) {
    return json({ ok: false, error: "Database is not available yet." });
  }
  await ensureSchema(db);
  const form = await request.formData();
  const maxAnswerLength = Number(form.get("maxAnswerLength"));
  if (
    !Number.isInteger(maxAnswerLength) ||
    maxAnswerLength < MIN_ANSWER_LENGTH ||
    maxAnswerLength > MAX_ANSWER_LENGTH
  ) {
    return json({
      ok: false,
      error: `Maximum answer length must be between ${MIN_ANSWER_LENGTH} and ${MAX_ANSWER_LENGTH}.`,
    });
  }
  const defaultRaw = String(form.get("defaultCategoryId") ?? "");
  await saveSettings(db, shop, {
    defaultCategoryId: defaultRaw ? Number(defaultRaw) : null,
    searchEnabled: form.get("searchEnabled") === "on",
    maxAnswerLength,
  });
  return json({ ok: true });
}

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  embeddedMeta("FAQ settings — Perf Probe", data?.apiKey);

interface FormState {
  defaultCategoryId: string;
  searchEnabled: boolean;
  maxAnswerLength: string;
}

export default function FaqSettings() {
  const { settings, categories } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const shopify = useAppBridge();

  const initial: FormState = {
    defaultCategoryId: settings.defaultCategoryId
      ? String(settings.defaultCategoryId)
      : "",
    searchEnabled: settings.searchEnabled,
    maxAnswerLength: String(settings.maxAnswerLength),
  };
  const [form, setForm] = useState<FormState>(initial);
  const initialRef = useRef<FormState>(initial);
  const wasSaving = useRef(false);

  const isDirty =
    JSON.stringify(form) !== JSON.stringify(initialRef.current);
  const submitting = fetcher.state !== "idle";

  const lengthNum = Number(form.maxAnswerLength);
  const lengthError =
    !Number.isInteger(lengthNum) ||
    lengthNum < MIN_ANSWER_LENGTH ||
    lengthNum > MAX_ANSWER_LENGTH
      ? `Enter a whole number between ${MIN_ANSWER_LENGTH} and ${MAX_ANSWER_LENGTH}.`
      : undefined;

  useEffect(() => {
    if (isDirty) shopify.saveBar.show(SAVE_BAR_ID);
    else shopify.saveBar.hide(SAVE_BAR_ID);
  }, [isDirty, shopify]);

  useEffect(() => {
    if (fetcher.state !== "idle") {
      wasSaving.current = true;
      return;
    }
    if (!wasSaving.current) return;
    wasSaving.current = false;
    if (fetcher.data?.ok) {
      initialRef.current = form;
      shopify.saveBar.hide(SAVE_BAR_ID);
      shopify.toast.show("Settings saved");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  function handleSave() {
    if (lengthError) return;
    fetcher.submit(
      {
        intent: "settings.save",
        defaultCategoryId: form.defaultCategoryId,
        searchEnabled: form.searchEnabled ? "on" : "off",
        maxAnswerLength: form.maxAnswerLength,
      },
      { method: "post" },
    );
  }

  function handleDiscard() {
    setForm(initialRef.current);
  }

  return (
    <Page
      backAction={{ content: "FAQ", url: "/app/faq" }}
      title="FAQ settings"
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              {fetcher.data?.error ? (
                <Banner tone="critical" title="Could not save settings">
                  <p>{fetcher.data.error}</p>
                </Banner>
              ) : null}
              <FormLayout>
                <Select
                  label="Default category"
                  helpText="Used by the storefront accordion block when no category is set on the block."
                  options={[
                    { label: "None", value: "" },
                    ...categories.map((c) => ({
                      label: c.name,
                      value: String(c.id),
                    })),
                  ]}
                  value={form.defaultCategoryId}
                  onChange={(value) =>
                    setForm((p) => ({ ...p, defaultCategoryId: value }))
                  }
                />
                <Checkbox
                  label="Show the search bar on the storefront FAQ page"
                  checked={form.searchEnabled}
                  onChange={(checked) =>
                    setForm((p) => ({ ...p, searchEnabled: checked }))
                  }
                />
                <TextField
                  label="Maximum answer length"
                  type="number"
                  autoComplete="off"
                  suffix="characters"
                  min={MIN_ANSWER_LENGTH}
                  max={MAX_ANSWER_LENGTH}
                  value={form.maxAnswerLength}
                  onChange={(value) =>
                    setForm((p) => ({ ...p, maxAnswerLength: value }))
                  }
                  error={lengthError}
                />
              </FormLayout>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                About these settings
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                The default category is the fallback the accordion block renders
                when a merchant leaves its category field blank.
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Turning the search bar off hides the client-side search field on
                the dedicated FAQ page; categories and entries still render.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <SaveBar
        id={SAVE_BAR_ID}
        loading={submitting}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    </Page>
  );
}
