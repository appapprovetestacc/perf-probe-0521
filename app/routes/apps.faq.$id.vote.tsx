import type { ActionFunctionArgs } from "@remix-run/cloudflare";
import { recordVote } from "~/lib/faq-db.server";
import {
  anonCookie,
  newAnonToken,
  readAnonToken,
  resolveProxy,
} from "~/lib/faq-proxy.server";
import { ensureSchema, getDb } from "~/lib/faq-schema.server";
import { isValidShop } from "~/lib/shopify.server";

// POST /apps/faq/<id>/vote — record a helpful/unhelpful vote (app proxy).
// Requires a valid Shopify app-proxy signature; deduped per browser via
// the faq_anon cookie so re-voting updates rather than double-counts.
function jsonResponse(body: unknown, status: number, extra?: Headers) {
  const headers = extra ?? new Headers();
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const proxy = await resolveProxy(request, context);
  if (!proxy.signatureValid) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 403);
  }
  const db = getDb(context);
  if (!isValidShop(proxy.shop) || !db) {
    return jsonResponse({ ok: false, error: "unavailable" }, 503);
  }

  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return jsonResponse({ ok: false, error: "bad_id" }, 400);
  }

  let vote = "";
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { vote?: unknown };
      vote = String(body?.vote ?? "");
    } else {
      const form = await request.formData();
      vote = String(form.get("vote") ?? "");
    }
  } catch {
    /* fall through to validation */
  }
  if (vote !== "up" && vote !== "down") {
    return jsonResponse({ ok: false, error: "bad_vote" }, 400);
  }

  await ensureSchema(db);
  const headers = new Headers();
  let token = readAnonToken(request);
  if (!token) {
    token = newAnonToken();
    headers.append("Set-Cookie", anonCookie(token));
  }

  const result = await recordVote(db, proxy.shop, id, vote, token);
  return jsonResponse(result, result.ok ? 200 : 404, headers);
}
