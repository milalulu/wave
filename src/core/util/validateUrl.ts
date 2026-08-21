const VALIDATE_TIMEOUT_MS = 3000;

// CDN, ссылки которых подписаны и одноразовы: HEAD-проверка перед стартом только
// добавляет round-trip к клику, а протухание всё равно ловится по ошибке плеера.
const SKIP_VALIDATION_HOSTS = [
  "googlevideo.com",
  "youtube.com",
  "youtu.be",
  "ytimg.com",
  "sndcdn.com",
  "media-streaming.soundcloud.cloud",
];

function skipValidation(url: string): boolean {
  return SKIP_VALIDATION_HOSTS.some((host) => url.includes(host));
}

export async function validateStreamUrl(url: string): Promise<void> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) return;
  if (skipValidation(url)) return;
  if (url.includes("127.0.0.1:8299/audio")) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VALIDATE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`stream URL returned ${res.status}`);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return;
    }
    throw err instanceof Error
      ? err
      : new Error("stream URL validation failed");
  } finally {
    clearTimeout(timer);
  }
}
