import type { MetaDescriptor } from "@remix-run/cloudflare";

/**
 * Meta tags for an embedded admin route. The `shopify-api-key` tag is what
 * the App Bridge CDN script reads to bootstrap; rendering it on every
 * embedded route keeps App Bridge initialised regardless of entry path.
 */
export function embeddedMeta(
  title: string,
  apiKey: string | undefined,
): MetaDescriptor[] {
  return [
    { title },
    { name: "shopify-api-key", content: apiKey ?? "" },
  ];
}
