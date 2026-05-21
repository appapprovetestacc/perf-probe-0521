import { useFetcher } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Box,
  FormLayout,
  Modal,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useEffect, useRef, useState } from "react";
import { useAppBridge } from "~/lib/app-bridge";
import { markdownToHtml, sanitizeHtml } from "~/lib/faq-logic.js";
import {
  FAQ_STATUSES,
  STATUS_LABEL,
  type FaqCategory,
  type FaqEntry,
  type FaqStatus,
} from "~/lib/faq-types";

interface SaveResponse {
  ok?: boolean;
  error?: string;
}

/**
 * Create / edit modal for a FAQ entry. Posts intent=entry.save to the
 * /app/faq action, so it works from both the index and the detail route.
 * Question + Markdown answer (with live preview) + category + status.
 */
export function EntryFormModal({
  open,
  onClose,
  entry,
  categories,
  maxAnswerLength,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  entry: FaqEntry | null;
  categories: FaqCategory[];
  maxAnswerLength: number;
  onSaved?: () => void;
}) {
  const fetcher = useFetcher<SaveResponse>();
  const shopify = useAppBridge();
  const [question, setQuestion] = useState("");
  const [answerMd, setAnswerMd] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<FaqStatus>("published");
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const initialRef = useRef("");
  const wasSubmitting = useRef(false);

  useEffect(() => {
    if (!open) return;
    const cid = entry
      ? String(entry.categoryId)
      : categories[0]
        ? String(categories[0].id)
        : "";
    setQuestion(entry?.question ?? "");
    setAnswerMd(entry?.answerMd ?? "");
    setCategoryId(cid);
    setStatus(entry?.status ?? "published");
    setShowErrors(false);
    setServerError(null);
    initialRef.current = JSON.stringify([
      entry?.question ?? "",
      entry?.answerMd ?? "",
      cid,
      entry?.status ?? "published",
    ]);
  }, [open, entry, categories]);

  const submitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle") {
      wasSubmitting.current = true;
      return;
    }
    if (!wasSubmitting.current) return;
    wasSubmitting.current = false;
    if (fetcher.data?.ok) {
      shopify.toast.show(entry ? "Entry updated" : "Entry created");
      onSaved?.();
      onClose();
    } else if (fetcher.data?.error) {
      setServerError(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data, entry, onClose, onSaved, shopify]);

  const current = JSON.stringify([question, answerMd, categoryId, status]);
  const isDirty = current !== initialRef.current;
  const questionError = !question.trim() ? "Enter a question." : undefined;
  const categoryError = !categoryId ? "Choose a category." : undefined;
  const hasError = !!(questionError || categoryError);

  function handleSubmit() {
    if (hasError || categories.length === 0) {
      setShowErrors(true);
      return;
    }
    setServerError(null);
    fetcher.submit(
      {
        intent: "entry.save",
        id: entry ? String(entry.id) : "",
        question,
        answerMd,
        categoryId,
        status,
      },
      { method: "post", action: "/app/faq" },
    );
  }

  const previewHtml = sanitizeHtml(markdownToHtml(answerMd));

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={entry ? "Edit FAQ entry" : "New FAQ entry"}
      primaryAction={{
        content: "Save & close",
        onAction: handleSubmit,
        loading: submitting,
        disabled: submitting || !isDirty || categories.length === 0,
      }}
      secondaryActions={[
        { content: "Cancel", onAction: onClose, disabled: submitting },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {serverError ? (
            <Banner
              tone="critical"
              title="Could not save entry"
              onDismiss={() => setServerError(null)}
            >
              <p>{serverError}</p>
            </Banner>
          ) : null}
          {categories.length === 0 ? (
            <Banner tone="warning" title="Add a category first">
              <p>
                FAQ entries belong to a category. Create a category, then add
                entries to it.
              </p>
            </Banner>
          ) : null}
          <FormLayout>
            <TextField
              label="Question"
              value={question}
              onChange={setQuestion}
              autoComplete="off"
              requiredIndicator
              error={showErrors ? questionError : undefined}
              placeholder="How long does delivery take?"
            />
            <FormLayout.Group>
              <Select
                label="Category"
                options={categories.map((c) => ({
                  label: c.name,
                  value: String(c.id),
                }))}
                value={categoryId}
                onChange={setCategoryId}
                disabled={categories.length === 0}
                error={showErrors ? categoryError : undefined}
              />
              <Select
                label="Status"
                options={FAQ_STATUSES.map((s) => ({
                  label: STATUS_LABEL[s],
                  value: s,
                }))}
                value={status}
                onChange={(v) => setStatus(v as FaqStatus)}
              />
            </FormLayout.Group>
            <TextField
              label="Answer"
              value={answerMd}
              onChange={setAnswerMd}
              autoComplete="off"
              multiline={6}
              maxLength={maxAnswerLength}
              showCharacterCount
              helpText="Markdown supported: **bold**, *italic*, `code`, [links](https://example.com), and - or 1. lists."
            />
          </FormLayout>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">
              Answer preview
            </Text>
            <Box
              background="bg-surface-secondary"
              padding="400"
              borderRadius="200"
              borderWidth="025"
              borderColor="border"
            >
              {previewHtml ? (
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
              ) : (
                <Text as="p" tone="subdued">
                  Start typing the answer to see a formatted preview.
                </Text>
              )}
            </Box>
          </BlockStack>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
