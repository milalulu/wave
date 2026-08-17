import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { start, cancel, onUrl, onInvalidUrl } from "@fabianlars/tauri-plugin-oauth";
import { supabase } from "./supabase";

export type OAuthProvider = "google" | "github";

const OAUTH_PORTS = [12121, 12122, 12123];
const OAUTH_TIMEOUT_MS = 180_000;

export function oauthSupported(): "desktop" | "browser" | "android" {
  if (!isTauri()) return "browser";
  return /android/i.test(navigator.userAgent) ? "android" : "desktop";
}

export async function signInOAuthDesktop(provider: OAuthProvider): Promise<void> {
  const port = await start({ ports: OAUTH_PORTS });
  const redirectTo = `http://127.0.0.1:${port}`;

  let unlistenUrl: (() => void) | null = null;
  let unlistenInvalid: (() => void) | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    unlistenUrl?.();
    unlistenInvalid?.();
    cancel(port).catch(() => {});
  };

  const settleError = (err: unknown): never => {
    if (!settled) {
      settled = true;
      cleanup();
    }
    throw err instanceof Error ? err : new Error(String(err));
  };

  const result = new Promise<void>((resolve, reject) => {
    timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("OAuth: timeout, sign-in did not complete"));
    }, OAUTH_TIMEOUT_MS);

    onInvalidUrl((err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`OAuth: invalid callback URL: ${err}`));
    }).then((un) => {
      unlistenInvalid = un;
    });

    onUrl((url) => {
      try {
        const parsed = new URL(url);
        if (parsed.origin !== redirectTo) return;
        const code = parsed.searchParams.get("code");
        if (!code || settled) return;
        settled = true;
        cleanup();
        supabase.auth
          .exchangeCodeForSession(code)
          .then(({ error }) => (error ? reject(error) : resolve()))
          .catch(reject);
      } catch (e) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    }).then((un) => {
      unlistenUrl = un;
    });
  });

  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        skipBrowserRedirect: true,
        redirectTo,
      },
    });
    if (error) settleError(error);
    if (!data.url) throw new Error("OAuth: no authorization URL");
    await openUrl(data.url);
    await result;
  } catch (e) {
    settleError(e);
  }
}
