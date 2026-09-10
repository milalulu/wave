import { describe, expect, it } from "vitest";
import type { Track } from "../types";
import { getSuggestions } from "./suggest";

const t = (title: string, artist = "Artist", id?: string): Track => ({
  id: id ?? `${artist}:${title}`,
  provider: "youtube",
  uri: "u",
  title,
  artist,
});

const sources = {
  liked: [t("Ocean Eyes", "Billie Eilish"), t("Bad Guy", "Billie Eilish")],
  history: [t("Ocean Eyes", "Billie Eilish"), t("As It Was", "Harry Styles")],
  recent: ["ocean eyes live", "billie eilish", "rock"],
};

describe("getSuggestions", () => {
  it("пустой запрос даёт пусто", () => {
    expect(getSuggestions("", sources)).toEqual([]);
    expect(getSuggestions("   ", sources)).toEqual([]);
  });

  it("префиксные совпадения первые, дубли схлопываются", () => {
    const out = getSuggestions("ocean", sources);
    expect(out[0]).toMatchObject({ kind: "track", title: "Ocean Eyes" });
    // Ocean Eyes есть и в лайках, и в истории — только один раз
    expect(out.filter((s) => s.title === "Ocean Eyes")).toHaveLength(1);
  });

  it("подмешивает недавние запросы", () => {
    const out = getSuggestions("billie", sources, 10);
    expect(out.some((s) => s.kind === "track" && s.title === "Bad Guy")).toBe(true);
    expect(out.some((s) => s.kind === "query" && s.title === "billie eilish")).toBe(true);
  });

  it("уважает лимит", () => {
    const many = Array.from({ length: 20 }, (_, i) => t(`Song ${i}`, "Band", `id${i}`));
    const out = getSuggestions("song", { liked: many, history: [], recent: [] }, 5);
    expect(out).toHaveLength(5);
  });

  it("ничего не находит — пусто", () => {
    expect(getSuggestions("zzzqqq", sources)).toEqual([]);
  });
});
