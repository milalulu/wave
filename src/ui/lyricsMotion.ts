import { reactions, type LyricsCue, type LyricsMood } from "./lyricsDirection";
import type { LyricsMotif } from "./lyricsMotifs";

type Point = readonly [inline: number, block: number, turn: number];
type Path = (lane: number, progress: number, index: number) => Point;

const lift = (progress: number) => progress * (2 - progress);
const paths = {
  fan: (lane, p, i) => [lane * (0.19 + 0.74 * lift(p)), 0.66 - (0.43 + i % 3 * 0.14) * lift(p), lane * 17 * p],
  arch: (lane, p) => [lane * 0.62 + (p - 0.5) * 0.47, 0.46 - Math.sin(p * Math.PI) * (0.33 + (1 - Math.abs(lane)) * 0.51), lane * 12],
  orbit: (lane, p, i) => [lane * 0.42 + Math.cos(i * 1.7 + p * 4.2) * 0.42, Math.sin(i * 1.7 + p * 4.2) * 0.49, 16 * p],
  fall: (lane, p, i) => [lane * 0.79, -0.71 + (1.12 + i % 3 * 0.14) * p * p, 0],
  slant: (lane, p, i) => [lane * 0.56 + (p - 0.5) * 0.62, -0.77 + (1.32 + i % 2 * 0.14) * p, -24],
  shower: (lane, p, i) => [lane * 0.63 - Math.sin(p * 2.6) * 0.2, -0.58 + (1.08 + i % 4 * 0.17) * Math.pow(p, 1.45), 12],
  drizzle: (lane, p, i) => [lane * 0.42 + (p - 0.5) * 0.69, -0.64 + (0.98 + i % 3 * 0.11) * p, -29],
  curtain: (lane, p, i) => [lane * (0.91 - p * 0.22), -0.76 + (1.13 + i % 2 * 0.2) * p * p, 0],
  sprinkle: (lane, p, i) => [lane * (0.52 + p * 0.28) + Math.sin(i * 10) * 0.12, -0.44 + (0.88 + i % 4 * 0.13) * p, lane * -12],
  flurry: (lane, p, i) => [lane * .65 + Math.sin(i + p * 5) * .22, -.63 + p * (1 + i % 3 * .17), p * 145 - i * 13],
  ripple: (lane, p, i) => [lane * (0.24 + 0.65 * lift(p)), 0.31 + Math.sin(p * 9 - i) * 0.28 * (1 - p), lane * 8],
  plume: (lane, p, i) => [lane * (0.28 + p * 0.48) + Math.sin(p * 4 + i) * 0.15, 0.69 - lift(p) * (0.71 + i % 3 * 0.22), lane * 28 * p],
  flare: (lane, p, i) => [lane * (0.26 + 0.67 * p), 0.52 - p * (0.55 + (2 - i % 3) * 0.25), 24 * lane],
  cinder: (lane, p, i) => [lane * 0.54 + Math.sin(p * 4.5 + i) * p * 0.28, 0.62 - (0.83 + i % 3 * 0.19) * p, 45 * p],
  glint: (lane, p, i) => [lane * 0.79 + (p - 0.5) * 0.17, (i % 3 - 1) * 0.42 - p * 0.13, 50 * p],
  trail: (lane, p, i) => [lane * 0.54 + (p - 0.5) * 0.64, 0.27 - lift(p) * (0.49 + i % 3 * 0.14), -24],
  breeze: (lane, p, i) => [lane * 0.53 + (p - 0.5) * 0.78, Math.sin(p * 5 + i * 0.7) * 0.4, -10],
  skip: (lane, p, i) => [lane * 0.61 + Math.sin(i * 10) * p * 0.22, 0.56 - lift(p) * (0.47 + i % 4 * 0.19), 0],
  signal: (lane, p, i) => [lane * 0.86, Math.sin(i * 1.2 - p * 6) * 0.52, 0],
  bounce: (lane, p, i) => [lane * .8, .62 - Math.abs(Math.sin(p * Math.PI * 2 + i * .6)) * 1.07, 0],
  drift: (lane, p, i) => [lane * 0.66 + Math.sin(p * 3 + i) * 0.2, 0.46 - p * (0.47 + i % 3 * 0.22), 0],
  dissolve: (lane, p, i) => [lane * (0.5 + 0.36 * p), 0.24 + Math.sin(p * 5 + i * 2) * 0.34, 0],
} satisfies Record<string, Path>;

// Each row orders the six variations used for consecutive occurrences of a word.
const choreography = {
  heart: ["fan", "arch", "orbit", "fall", "ripple", "trail"],
  rain: ["fall", "slant", "shower", "drizzle", "curtain", "sprinkle"],
  fire: ["plume", "flare", "fan", "cinder", "trail", "skip"],
  stars: ["glint", "trail", "orbit", "fall", "ripple", "flare"],
  quiet: ["drift", "dissolve", "glint", "ripple", "breeze", "arch"],
  code: ["signal", "skip", "glint", "fall", "ripple", "slant"],
  wind: ["breeze", "arch", "orbit", "slant", "ripple", "trail"],
  shadow: ["dissolve", "drift", "orbit", "fall", "ripple", "breeze"],
} satisfies Record<LyricsMood, (keyof typeof paths)[]>;

const motifPaths: Partial<Record<LyricsMotif, (keyof typeof paths)[]>> = {
  snow: ["flurry", "glint", "flurry", "sprinkle", "flurry", "curtain"],
  frost: ["glint", "fan", "ripple", "signal", "flare", "dissolve"],
  tears: ["fall", "curtain", "sprinkle", "fall", "curtain", "drizzle"],
  tide: ["ripple", "breeze", "signal", "ripple", "arch", "dissolve"],
  stream: ["breeze", "ripple", "signal", "arch", "breeze", "trail"],
  ash: ["drift", "dissolve", "breeze", "plume", "flurry", "drift"],
  moon: ["orbit", "glint", "arch", "orbit", "drift", "ripple"],
  kiss: ["arch", "fan", "ripple", "sprinkle", "dissolve", "trail"],
  flowers: ["flurry", "orbit", "drift", "breeze", "sprinkle", "fan"],
  music: ["signal", "skip", "ripple", "bounce", "arch", "glint"],
};

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smoother = (value: number) => value * value * (3 - 2 * value);

export const particleCount = 6;

export function sampleParticle(cue: Pick<LyricsCue, "mood" | "reaction" | "motif">, index: number, phase: number) {
  const variant = reactions.indexOf(cue.reaction);
  const lane = index / (particleCount - 1) * 2 - 1;
  const delay = cue.mood === "fire" || cue.mood === "stars" ? (index * 5 % particleCount) * 0.032 : index * 0.026;
  const progress = clamp((phase - delay) / ((1 - delay) * (0.88 + variant * 0.018)));
  const path = (cue.motif && motifPaths[cue.motif]) || choreography[cue.mood];
  const [x, y, turn] = paths[path[variant]](lane, progress, index);
  const fadeIn = smoother(clamp(progress / 0.24));
  const fadeOut = smoother(clamp((1 - progress) / 0.56));
  return {
    x: clamp(50 + 44 * x, 7, 93),
    y: clamp(50 + 38 * y, 16, 84),
    turn,
    size: 0.65 + index % 3 * 0.14 + 0.17 * Math.sin(Math.PI * progress),
    opacity: fadeIn * fadeOut * (0.93 - index * 0.035),
  };
}
