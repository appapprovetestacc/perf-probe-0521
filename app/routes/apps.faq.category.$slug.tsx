import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { getPublicCategory } from "~/lib/faq-db.server";
import {
  anonCookie,
  newAnonToken,
  readAnonToken,
  resolveProxy,
} from "~/lib/faq-proxy.server";
import { ensureSchema, ensureSeeded, getDb } from "~/lib/faq-schema.server";
import { isValidShop } from "~/lib/shopify.server";

// GET /apps/faq/category/<slug> — JSON for the storefront accordion block
// (app proxy). Returns the category and its published entries; the block
// renders them client-side as an accordion.
export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { shop } = await resolveProxy(request, context);
  const db = getDb(context);
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });

  if (!isValidShop(shop) || !db) {
    return new Response(
      JSON.stringify({ ok: false, category: null, entries: [] }),
      { headers },
    );
  }

  try {
    await ensureSchema(db);
    await ensureSeeded(db, shop);
    const category = await getPublicCategory(db, shop, params.slug ?? "");

    if (!readAnonToken(request)) {
      headers.append("Set-Cookie", anonCookie(newAnonToken()));
    }

    if (!category) {
      return new Response(
        JSON.stringify({ ok: true, category: null, entries: [] }),
        { headers },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        category: {
          id: category.id,
          name: category.name,
          slug: category.slug,
        },
        entries: category.entries.map((e) => ({
          id: e.id,
          question: e.question,
          answerHtml: e.answerHtml,
          helpful: e.helpfulCount,
          unhelpful: e.unhelpfulCount,
        })),
      }),
      { headers },
    );
  } catch (err) {
    console.error("[faq] category proxy failed", err);
    return new Response(
      JSON.stringify({ ok: false, category: null, entries: [] }),
      { headers },
    );
  }
}
