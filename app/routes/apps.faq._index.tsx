import type { LoaderFunctionArgs } from "@remix-run/cloudflare";
import { getPublicFaq, getSettings } from "~/lib/faq-db.server";
import {
  anonCookie,
  newAnonToken,
  readAnonToken,
  resolveProxy,
} from "~/lib/faq-proxy.server";
import { renderFaqPage } from "~/lib/faq-render.server";
import { ensureSchema, ensureSeeded, getDb } from "~/lib/faq-schema.server";
import { isValidShop } from "~/lib/shopify.server";

// GET /apps/faq — the dedicated, server-rendered storefront FAQ page
// (app proxy). Resource route: the loader returns the HTML Response
// directly, so the embedded-admin React shell is never involved.
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { shop } = await resolveProxy(request, context);
  const db = getDb(context);
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });

  if (!isValidShop(shop) || !db) {
    return new Response(
      renderFaqPage({ categories: [], searchEnabled: true }),
      { headers },
    );
  }

  try {
    await ensureSchema(db);
    await ensureSeeded(db, shop);
    const [categories, settings] = await Promise.all([
      getPublicFaq(db, shop),
      getSettings(db, shop),
    ]);
    if (!readAnonToken(request)) {
      headers.append("Set-Cookie", anonCookie(newAnonToken()));
    }
    return new Response(
      renderFaqPage({ categories, searchEnabled: settings.searchEnabled }),
      { headers },
    );
  } catch (err) {
    // The storefront FAQ must never surface a 500 page to shoppers.
    console.error("[faq] storefront page render failed", err);
    return new Response(
      renderFaqPage({ categories: [], searchEnabled: true }),
      { headers },
    );
  }
}
