const KEY = "wave:preferred-languages";

export const AVAILABLE_LANGUAGES = [
  { code: "en", label: "English", searchTerms: ["english", "british", "american"] },
  { code: "ru", label: "Русский", searchTerms: ["русский", "russian", "русскоязычный"] },
  { code: "es", label: "Español", searchTerms: ["spanish", "español", "latino"] },
  { code: "pt", label: "Português", searchTerms: ["portuguese", "português", "brazilian"] },
  { code: "ko", label: "한국어", searchTerms: ["korean", "k-pop", "кей-поп"] },
  { code: "ja", label: "日本語", searchTerms: ["japanese", "j-pop", "japanese pop"] },
  { code: "fr", label: "Français", searchTerms: ["french", "français", "chanson"] },
  { code: "de", label: "Deutsch", searchTerms: ["german", "deutsch", "deutsche"] },
  { code: "it", label: "Italiano", searchTerms: ["italian", "italiano"] },
  { code: "uk", label: "Українська", searchTerms: ["ukrainian", "український"] },
  { code: "pl", label: "Polski", searchTerms: ["polish", "polski"] },
  { code: "tr", label: "Türkçe", searchTerms: ["turkish", "türkçe"] },
  { code: "ar", label: "العربية", searchTerms: ["arabic", "عربي"] },
  { code: "hi", label: "हिन्दी", searchTerms: ["hindi", "bollywood", "hindustani"] },
] as const;

export type LanguageCode = (typeof AVAILABLE_LANGUAGES)[number]["code"];

export function getLanguageSearchTerms(codes: LanguageCode[]): string[] {
  const terms: string[] = [];
  for (const code of codes) {
    const lang = AVAILABLE_LANGUAGES.find((l) => l.code === code);
    if (lang) terms.push(...lang.searchTerms);
  }
  return [...new Set(terms)];
}

export function loadPreferredLanguages(): LanguageCode[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c): c is LanguageCode =>
      AVAILABLE_LANGUAGES.some((l) => l.code === c),
    );
  } catch {
    return [];
  }
}

export function savePreferredLanguages(codes: string[]): void {
  try {
    const valid = codes.filter((c): c is LanguageCode =>
      AVAILABLE_LANGUAGES.some((l) => l.code === c),
    );
    localStorage.setItem(KEY, JSON.stringify(valid));
  } catch {
    // ignore
  }
}
