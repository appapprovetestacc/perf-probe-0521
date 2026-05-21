import type { AppLoadContext } from "@remix-run/cloudflare";
import type { Env } from "../../load-context";
import { nonce, verifyAppProxySignature } from "~/lib/shopify.server";

// Shared helpers for the storefront app-proxy routes (/apps/faq/*).

export interface ProxyContext {
  shop: string;
  /** A `signature` query param was present on the request. */
  signaturePresent: boolean;
  /** The signature was present AND verified against SHOPIFY_API_SECRET. */
  signatureValid: boolean;
}

/** Read the shop + verify the Shopify app-proxy signature. */
export async function resolveProxy(
  request: Request,
  context: AppLoadContext,
): Promise<ProxyContext> {
  const url = new URL(request.url);
  const env = (context.cloudflare?.env ?? {}) as Env;
  const shop = url.searchParams.get("shop") ?? "";
  const signaturePresent = url.searchParams.has("signature");
  let signatureValid = false;
  if (signaturePresent && env.SHOPIFY_API_SECRET) {
    signatureValid = await verifyAppProxySignature(url, env.SHOPIFY_API_SECRET);
  }
  return { shop, signaturePresent, signatureValid };
}

const ANON_COOKIE = "faq_anon";
const ANON_MAX_AGE = 180 * 86_400;

/** Read the per-browser anonymous vote token from the request cookie. */
export function readAnonToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)faq_anon=([^;]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

/** Generate a fresh anonymous vote token. */
export function newAnonToken(): string {
  return nonce();
}

/**
 * Set-Cookie value for the anonymous vote token. Scoped to the proxy path,
 * with an explicit Max-Age — no localStorage is used anywhere, so shortening
 * this value is the only cleanup lever needed on uninstall.
 */
export function anonCookie(token: string): string {
  return (
    `${ANON_COOKIE}=${encodeURIComponent(token)}; Path=/apps/faq; ` +
    `Max-Age=${ANON_MAX_AGE}; SameSite=Lax; Secure; HttpOnly`
  );
}
