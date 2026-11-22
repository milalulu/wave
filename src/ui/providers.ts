export const PROVIDER_LABELS: Record<string, string> = {
  youtube: "YT Music",
  soundcloud: "SoundCloud",
};

export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}
