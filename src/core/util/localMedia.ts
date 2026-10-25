/** Tauri file URIs, never an arbitrary remote provider URL. */
export function isLocalMediaUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === "file:" || (url.protocol === "asset:" && url.hostname === "localhost")
      || (["http:", "https:"].includes(url.protocol) && url.hostname === "asset.localhost");
  } catch {
    return false;
  }
}
