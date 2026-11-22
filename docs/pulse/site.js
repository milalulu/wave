const repository = "https://github.com/milalulu/wave";
const text = {
  en: {
    skip: "Skip to content",
    navigation: "Site navigation",
    navFeatures: "Features",
    navDownload: "Download",
    headlineStart: "Music",
    headlineEnd: "at your pace.",
    heroText: "YouTube Music, SoundCloud, and your own files in one player. Explore mixes, listen offline, and watch lyrics come to life.",
    download: "Get Wave",
    releaseNotes: "What's new ↗",
    heroPlatforms: "Windows and Linux · open source",
    playerAlt: "Wave Pulse with album art, the queue, and playback controls",
    featuresTitle: "What you can do with Wave",
    findTitle: "Find it in one search",
    findText: "Search YouTube Music and SoundCloud, add your own files, and bring everything into one library.",
    discoverTitle: "Mixes for your taste",
    discoverText: "My Wave uses your likes and listening history. Tell it what you want to hear more or less often.",
    soundTitle: "Make it sound like you",
    soundText: "Tune the 10-band equalizer, save headphone and speaker profiles, and level the volume of local tracks.",
    lyricsText: "Lines and words light up as the track plays when timing data is available. Add an .lrc file for your own music.",
    lyricsAlt: "Lyrics Live highlighting a word in a demo track",
    downloadsTitle: "Download Wave",
    downloadsIntro: "Choose the installer for your system.",
    allFiles: "All files ↗",
    androidNote: "Android is being tested separately. This release includes desktop packages.",
    stable: "Latest stable release ↗",
    releases: "Release history ↗",
    issues: "Report an issue",
    preview: "Release candidate",
    stableLabel: "Release",
    title: "Wave — music at your pace",
  },
  ru: {
    preview: "Релиз-кандидат",
    stableLabel: "Релиз",
    title: "Wave — музыка в твоём ритме",
  },
};

const translations = [
  ["data-i18n", "textContent"],
  ["data-i18n-label", "aria-label"],
  ["data-i18n-alt", "alt"],
].flatMap(([attribute, property]) =>
  Array.from(document.querySelectorAll(`[${attribute}]`), element => ({
    element,
    property,
    key: element.getAttribute(attribute),
    fallback: property === "textContent" ? element.textContent : element.getAttribute(property),
  })),
);
const languageButton = document.querySelector("[data-language]");
const releaseLabels = document.querySelectorAll("[data-release]");
let version = { number: "1.0.0-rc.3", preview: true };

function getLanguage() {
  const fromUrl = new URLSearchParams(location.search).get("lang");
  if (fromUrl === "ru" || fromUrl === "en") return fromUrl;
  try {
    const saved = localStorage.getItem("wave-pages-language");
    if (saved === "ru" || saved === "en") return saved;
  } catch { /* The system language is still available. */ }
  return navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en";
}

let language = getLanguage();

function renderVersion() {
  const name = text[language][version.preview ? "preview" : "stableLabel"];
  for (const label of releaseLabels) label.textContent = `${name} ${version.number}`;
}

function renderLanguage() {
  document.documentElement.lang = language;
  document.title = text[language].title;
  for (const { element, property, key, fallback } of translations) {
    const value = text[language][key] ?? fallback;
    if (property === "textContent") element.textContent = value;
    else element.setAttribute(property, value);
  }
  languageButton.textContent = language === "ru" ? "EN" : "RU";
  languageButton.setAttribute("aria-label", language === "ru" ? "English" : "Русский");
  renderVersion();
}

languageButton.hidden = false;
languageButton.addEventListener("click", () => {
  language = language === "ru" ? "en" : "ru";
  try { localStorage.setItem("wave-pages-language", language); } catch { /* Use this language until reload. */ }
  const url = new URL(location.href);
  url.searchParams.set("lang", language);
  history.replaceState(null, "", url);
  renderLanguage();
});
renderLanguage();

const platforms = [
  { name: "windows", file: /_x64-setup\.exe$/i },
  { name: "linux", file: /_amd64\.AppImage$/i },
  { name: "android", file: /-arm64\.apk$/i },
].map(platform => ({ ...platform, link: document.querySelector(`[data-asset="${platform.name}"]`) }));

async function updateDownloads() {
  try {
    const response = await fetch("https://api.github.com/repos/milalulu/wave/releases?per_page=12", {
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) return;
    const published = (await response.json()).filter(release => !release.draft && Date.parse(release.published_at)
      && /^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(release.tag_name));
    const featured = published.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
      .find(release => platforms.some(platform => release.assets?.some(asset => platform.file.test(asset.name))));
    if (!featured) return;

    const downloadBase = `${repository}/releases/download/${featured.tag_name}/`;
    const available = platforms.map(platform => ({
      ...platform,
      asset: featured.assets.find(asset => asset.state === "uploaded" && platform.file.test(asset.name)
        && asset.browser_download_url === downloadBase + asset.name),
    }));
    if (!available.some(platform => platform.asset)) return;

    version = { number: featured.tag_name.slice(1), preview: featured.prerelease };
    for (const link of document.querySelectorAll("[data-release-page]")) {
      link.href = `${repository}/releases/tag/${featured.tag_name}`;
    }
    for (const { asset, link } of available) {
      link.hidden = !asset;
      if (asset) link.href = asset.browser_download_url;
    }
    document.querySelector("[data-android-note]").hidden = available.some(platform => platform.name === "android" && platform.asset);
    renderVersion();
  } catch { /* The verified static download links also work without the API. */ }
}

void updateDownloads();
