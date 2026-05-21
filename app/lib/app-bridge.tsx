import { useRef } from "react";

// Thin typed wrapper over the global `window.shopify` object that the
// App Bridge CDN script (loaded first in root.tsx <head>) installs. Using
// the global directly keeps the dependency surface unchanged — no
// @shopify/app-bridge-react package is needed for toast + SaveBar.

interface ShopifyGlobal {
  toast?: {
    show?: (message: string, options?: ToastOptions) => void;
  };
  saveBar?: {
    show?: (id: string) => void;
    hide?: (id: string) => void;
  };
  config?: { shop?: string; locale?: string; host?: string };
}

export interface ToastOptions {
  isError?: boolean;
  duration?: number;
}

export interface AppBridge {
  toast: { show: (message: string, options?: ToastOptions) => void };
  saveBar: { show: (id: string) => void; hide: (id: string) => void };
  readonly config: ShopifyGlobal["config"];
  readonly locale: string;
}

declare global {
  interface Window {
    shopify?: ShopifyGlobal;
  }

  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "ui-save-bar": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & { id: string },
        HTMLElement
      >;
    }
  }
}

function shopifyGlobal(): ShopifyGlobal | undefined {
  return typeof window !== "undefined" ? window.shopify : undefined;
}

function createAppBridge(): AppBridge {
  return {
    toast: {
      show(message, options) {
        try {
          shopifyGlobal()?.toast?.show?.(message, options);
        } catch {
          /* App Bridge not ready — non-fatal */
        }
      },
    },
    saveBar: {
      show(id) {
        try {
          shopifyGlobal()?.saveBar?.show?.(id);
        } catch {
          /* non-fatal */
        }
      },
      hide(id) {
        try {
          shopifyGlobal()?.saveBar?.hide?.(id);
        } catch {
          /* non-fatal */
        }
      },
    },
    get config() {
      return shopifyGlobal()?.config;
    },
    get locale() {
      return shopifyGlobal()?.config?.locale || "en";
    },
  };
}

/**
 * Returns a stable App Bridge facade. Stable identity across renders means
 * it is safe to list in useEffect dependency arrays. All methods read the
 * global lazily, so calling the hook during SSR is safe.
 */
export function useAppBridge(): AppBridge {
  const ref = useRef<AppBridge>();
  if (!ref.current) ref.current = createAppBridge();
  return ref.current;
}

// `loading` / `variant` on the App Bridge SaveBar buttons are non-standard
// attributes — render them through an untyped tag so JSX stays clean.
const RawButton = "button" as unknown as React.FC<
  Record<string, unknown> & { children: React.ReactNode }
>;

/**
 * App Bridge SaveBar. Pair with useAppBridge().saveBar.show(id)/.hide(id)
 * driven by a form's dirty state (see SAVE_BAR_FORM pattern).
 */
export function SaveBar({
  id,
  onSave,
  onDiscard,
  loading,
}: {
  id: string;
  onSave: () => void;
  onDiscard: () => void;
  loading?: boolean;
}) {
  return (
    <ui-save-bar id={id}>
      <RawButton
        variant="primary"
        loading={loading ? "" : undefined}
        onClick={onSave}
      >
        Save
      </RawButton>
      <RawButton onClick={onDiscard}>Discard</RawButton>
    </ui-save-bar>
  );
}
