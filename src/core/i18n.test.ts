import { describe, expect, it } from "vitest";
import { translations } from "./i18n";

function walkKeys(obj: unknown, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null) {
      out.push(...walkKeys(v, key));
    } else {
      out.push(key);
    }
  }
  return out.sort();
}

describe("i18n dictionaries", () => {
  it("en and ru have the same key structure", () => {
    expect(walkKeys(translations.en)).toEqual(walkKeys(translations.ru));
  });

  it("every locale has at least one translated value", () => {
    for (const locale of Object.keys(translations) as Array<keyof typeof translations>) {
      expect(Object.keys(translations[locale]).length).toBeGreaterThan(0);
    }
  });
});
