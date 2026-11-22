import { expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => db }));
vi.mock("./supabaseConfig", () => ({
  isSupabaseConfigured: true, SUPABASE_URL: "https://example.org", SUPABASE_ANON_KEY: "test",
}));

import { syncLikes, syncPlaylists } from "./supabase";

it("never sends a write for an empty local catalog", async () => {
  await syncLikes("user", [], new Map());
  await syncPlaylists("user", []);
  expect(db.from).not.toHaveBeenCalled();
});

it("leaves an unseen cloud playlist alone and requires the observed version for edits", async () => {
  const updatedAt = "2026-01-01T00:00:00.000Z";
  const rows = [{ id: "elsewhere", updated_at: updatedAt }, { id: "edited", updated_at: updatedAt }];
  const eq = vi.fn().mockImplementation(() => updateQuery);
  const updateQuery = { eq, then: (resolve: (result: { error: null }) => unknown) => Promise.resolve(resolve({ error: null })) };
  const update = vi.fn(() => updateQuery);
  db.from.mockReturnValue({ select: () => ({ eq: async () => ({ data: rows, error: null }) }), update });
  await syncPlaylists("user", [{ id: "edited", name: "Edited", trackIds: [], createdAt: 50, updatedAt: Date.parse(updatedAt) + 1000 }]);
  expect(update).toHaveBeenCalledTimes(1);
  expect(eq.mock.calls).toEqual([["user_id", "user"], ["id", "edited"], ["updated_at", updatedAt]]);
});
