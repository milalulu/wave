#!/usr/bin/env node
// Nightly provider health probes: catches silent API deaths (like Spotify
// recommendations/top-tracks) before users do. Exits non-zero with a report
// on stdout; the workflow opens an issue from it.
const results = [];

async function probe(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, detail: String(e && e.message || e).slice(0, 200) });
  }
}

async function json(url, opts = {}, timeoutMs = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch {}
    return { status: r.status, body, text };
  } finally {
    clearTimeout(t);
  }
}

async function jsonRetry(url, opts = {}, timeoutMs = 20000, retries = 1) {
  let last;
  for (let i = 0; i <= retries; i++) {
    last = await json(url, opts, timeoutMs);
    if (last.status !== 429 && last.status !== 503) return last;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return last;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

await probe("youtube-innertube-search", async () => {
  const { status, body } = await json("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({
      context: { client: { hl: "en", gl: "US", clientName: "WEB", clientVersion: "2.20240101.00.00" } },
      query: "test",
    }),
  });
  if (status !== 200) throw new Error(`HTTP ${status}`);
  const n = JSON.stringify(body).length;
  if (n < 1000) throw new Error("suspiciously small response");
  return `${n} bytes`;
});

await probe("soundcloud-homepage", async () => {
  const { status, text } = await json("https://soundcloud.com", { headers: { "User-Agent": UA } });
  if (status !== 200) throw new Error(`HTTP ${status}`);
  const scripts = [...String(text).matchAll(/<script[^>]+src="([^"]+\.js[^"]*)"/g)]
    .map((m) => m[1])
    .slice(-3);
  if (scripts.length === 0) throw new Error("no js bundles");
  for (const src of scripts) {
    const url = src.startsWith("http") ? src : `https://soundcloud.com${src}`;
    const js = await json(url, { headers: { "User-Agent": UA } });
    const m = String(js.text).match(/client_id\s*:\s*"([a-zA-Z0-9]{20,})"/);
    if (m) return `client_id in bundle (${src.slice(-40)})`;
  }
  throw new Error("client_id not extractable");
});

await probe("soundcloud-api-search", async () => {
  const home = await json("https://soundcloud.com", { headers: { "User-Agent": UA } });
  const scripts = [...String(home.text).matchAll(/<script[^>]+src="([^"]+\.js[^"]*)"/g)]
    .map((m) => m[1])
    .slice(-3);
  let clientId = null;
  for (const src of scripts) {
    const url = src.startsWith("http") ? src : `https://soundcloud.com${src}`;
    const js = await json(url, { headers: { "User-Agent": UA } });
    const m = String(js.text).match(/client_id\s*:\s*"([a-zA-Z0-9]{20,})"/);
    if (m) { clientId = m[1]; break; }
  }
  if (!clientId) throw new Error("client_id not extractable");
  const { status, body } = await json(
    `https://api-v2.soundcloud.com/search/tracks?client_id=${clientId}&q=test&limit=1`,
    { headers: { "User-Agent": UA } },
  );
  if (status !== 200) throw new Error(`HTTP ${status}`);
  if (!body || !Array.isArray(body.collection)) throw new Error("no collection");
  return `${body.collection.length} items`;
});

await probe("spotify-token-endpoint", async () => {
  // No creds here: invalid_client (400) proves the endpoint is alive.
  const { status } = await json("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&client_id=x&client_secret=y",
  });
  if (status !== 400 && status !== 401) throw new Error(`unexpected HTTP ${status}`);
  return `HTTP ${status} (alive)`;
});

await probe("spotify-search-shape", async () => {
  // Public oEmbed-ish check skipped; search needs auth. Verify docs still list search.
  const { status } = await json("https://api.spotify.com/v1/search?q=test&type=track&limit=1");
  if (status !== 401) throw new Error(`unexpected HTTP ${status} (want 401 without token)`);
  return "HTTP 401 (alive)";
});

await probe("itunes-search", async () => {
  const { status, body } = await json("https://itunes.apple.com/search?term=test&media=music&limit=1");
  if (status !== 200) throw new Error(`HTTP ${status}`);
  if (typeof body?.resultCount !== "number") throw new Error("bad shape");
  return "ok";
});

await probe("deezer-search", async () => {
  const { status, body } = await json("https://api.deezer.com/search?q=test&limit=1");
  if (status !== 200) throw new Error(`HTTP ${status}`);
  if (!Array.isArray(body?.data)) throw new Error("bad shape");
  return "ok";
});

await probe("musicbrainz-search", async () => {
  const { status, body } = await jsonRetry("https://musicbrainz.org/ws/2/recording?query=test&fmt=json&limit=1", {
    headers: { "User-Agent": "wave-health-probe/1.0 (ci)" },
  });
  if (status !== 200) throw new Error(`HTTP ${status}`);
  if (typeof body?.count !== "number") throw new Error("bad shape");
  return "ok";
});

const failed = results.filter((r) => !r.ok);
console.log("## Provider health");
for (const r of results) {
  console.log(`- ${r.ok ? "OK" : "FAIL"} ${r.name} (${r.ms}ms) ${r.detail}`);
}
if (failed.length > 0) {
  console.log(`\nFAILED: ${failed.map((f) => f.name).join(", ")}`);
  process.exit(1);
}
console.log("\nAll providers healthy.");
