import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { recordView } from "~/lib/faq-db.server";
import { resolveProxy } from "~/lib/faq-proxy.server";
import { ensureSchema, getDb } from "~/lib/faq-schema.server";
import { isValidShop } from "~/lib/shopify.server";

// POST /apps/faq/<id>/view — increment the view counter for an entry
// (app proxy). Fired when a shopper expands a question. Requires a valid
// Shopify app-proxy signature.
export async function action({ request, context, params }: ActionFunctionArgs) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
  });
  const proxy = await resolveProxy(request, context);
  if (!proxy.signatureValid) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 403,
      headers,
    });
  }
  const db = getDb(context);
  const id = Number(params.id);
  if (!isValidShop(proxy.shop) || !db || !Number.isFinite(id)) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 503,
      headers,
    });
  }
  await ensureSchema(db);
  const ok = await recordView(db, proxy.shop, id);
  return new Response(JSON.stringify({ ok }), { headers });
}
