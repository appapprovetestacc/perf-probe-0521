import type { LinksFunction } from "@remix-run/cloudflare";
import { Link as RemixLink, Outlet } from "@remix-run/react";
import { AppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

// Layout for every /app/* admin route — provides the Polaris stylesheet +
// AppProvider (i18n + link routing). It exports no loader so the first
// top-level navigation from Shopify admin (which carries no session token)
// renders without a 401; child routes do the real auth.
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: polarisStyles },
];

// Routes Polaris `url` actions through Remix client-side navigation.
// Admin-to-admin links deliberately omit `prefetch`: a speculative loader
// fetch would carry neither ?shop= nor the App Bridge session token and
// the target route's auth would 401.
function PolarisLink({
  url = "",
  external,
  target,
  children,
  ...rest
}: {
  url?: string;
  external?: boolean;
  target?: string;
  children?: React.ReactNode;
  [key: string]: unknown;
}) {
  const isExternal =
    external || target === "_blank" || /^(https?:|mailto:|tel:)/i.test(url);
  if (isExternal) {
    return (
      <a href={url} target={target ?? "_blank"} rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  return (
    <RemixLink to={url} {...rest}>
      {children}
    </RemixLink>
  );
}

export default function AppLayout() {
  return (
    <AppProvider i18n={enTranslations} linkComponent={PolarisLink}>
      <Outlet />
    </AppProvider>
  );
}
