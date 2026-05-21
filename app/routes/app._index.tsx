import {
  type LoaderFunctionArgs,
  type MetaFunction,
  json,
} from "@remix-run/cloudflare";
import { useNavigate } from "@remix-run/react";
import {
  Card,
  InlineGrid,
  Layout,
  SkeletonBodyText,
  SkeletonDisplayText,
  SkeletonPage,
} from "@shopify/polaris";
import { useEffect } from "react";
import { embeddedMeta } from "~/lib/embedded-meta";

// Auth-free embedded entry. Shopify always opens the app here (top-level
// navigation, no Authorization header). Once App Bridge boots we hand off
// client-side to /app/faq, whose loader runs the real admin auth with the
// session token App Bridge attaches to the loader fetch.
export async function loader({ context }: LoaderFunctionArgs) {
  const env = context.cloudflare?.env;
  return json({ apiKey: env?.SHOPIFY_API_KEY ?? "" });
}

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  embeddedMeta("FAQ — Perf Probe", data?.apiKey);

export default function AppIndex() {
  const navigate = useNavigate();
  useEffect(() => {
    const search = typeof window !== "undefined" ? window.location.search : "";
    navigate("/app/faq" + search, { replace: true });
  }, [navigate]);

  // Skeleton mirrors the FAQ index: three metric tiles + the entries table.
  return (
    <SkeletonPage primaryAction title="FAQ">
      <Layout>
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
            {[0, 1, 2].map((i) => (
              <Card key={i}>
                <SkeletonBodyText lines={1} />
                <SkeletonDisplayText size="large" />
              </Card>
            ))}
          </InlineGrid>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <SkeletonBodyText lines={12} />
          </Card>
        </Layout.Section>
      </Layout>
    </SkeletonPage>
  );
}
