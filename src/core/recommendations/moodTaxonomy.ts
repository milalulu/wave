export type Mood = "chill" | "sad" | "happy" | "energetic" | "dark" | "dreamy" | "aggressive" | "romantic" | "focus" | "party";

interface MoodProfile {
  energy: number[];
  valence: number[];
  acousticness: number[];
  tempo: number[];
}

interface MoodDef {
  keywords: string[];
  relatedGenres: string[];
  relatedMoods: Mood[];
  spotifyGenres: string[];
  profile: MoodProfile;
}

export const MOOD_TAXONOMY: Record<Mood, MoodDef> = {
  chill: {
    keywords: ["chill", "lo-fi", "lofi", "downtempo", "relax", "mellow", "smooth", "easy listening", "laid back", "chillhop", "chillhop", "lo fi", "study beats", "ambient chill"],
    relatedGenres: ["lo-fi", "downtempo", "ambient", "chillhop", "trip hop", "chill", "indie pop", "bedroom pop", "neo soul", "jazz hop"],
    relatedMoods: ["dreamy", "sad", "focus"],
    spotifyGenres: ["chill", "lo-fi", "downtempo", "trip-hop", "chillhop", "study", "ambient"],
    profile: { energy: [0.1, 0.4], valence: [0.2, 0.6], acousticness: [0.3, 0.9], tempo: [60, 110] },
  },
  sad: {
    keywords: ["sad", "melancholy", "heartbreak", "lonely", "grief", "tearful", "emotional", "sorrow", "gloomy", "depressive", "crying"],
    relatedGenres: ["emo", "indie folk", "singer-songwriter", "slowcore", "sadcore", "post-punk", "shoegaze", "dream pop", "ambient"],
    relatedMoods: ["chill", "dreamy", "dark"],
    spotifyGenres: ["sad", "singer-songwriter", "indie-folk", "emo", "slowcore", "acoustic"],
    profile: { energy: [0.05, 0.35], valence: [0.0, 0.3], acousticness: [0.2, 0.9], tempo: [55, 100] },
  },
  happy: {
    keywords: ["happy", "feel good", "upbeat", "joyful", "sunny", "bright", "cheerful", "fun", "summer", "positive"],
    relatedGenres: ["indie pop", "synth pop", "funk", "disco", "reggae", "ska", "j-pop", "electropop"],
    relatedMoods: ["energetic", "party", "romantic"],
    spotifyGenres: ["happy", "feel-good", "pop", "indie-pop", "summer", "disco", "funk"],
    profile: { energy: [0.5, 0.9], valence: [0.6, 1.0], acousticness: [0.0, 0.5], tempo: [100, 140] },
  },
  energetic: {
    keywords: ["energetic", "hype", "pump", "workout", "intense", "power", "adrenaline", "fast", "driving", "up-tempo"],
    relatedGenres: ["drum and bass", "edm", "hardstyle", "punk", "metal", "hardcore", "techno", "trap", "dubstep"],
    relatedMoods: ["party", "aggressive", "happy"],
    spotifyGenres: ["edm", "drum-and-bass", "punk", "workout", "hardcore", "metal", "dubstep"],
    profile: { energy: [0.7, 1.0], valence: [0.3, 0.9], acousticness: [0.0, 0.15], tempo: [120, 180] },
  },
  dark: {
    keywords: ["dark", "goth", "industrial", "noir", "eerie", "creepy", "haunting", "ominous", "menacing", "underground"],
    relatedGenres: ["darkwave", "gothic", "industrial", "post-punk", "witch house", "dark ambient", "death ambient", "drone", "doom"],
    relatedMoods: ["sad", "aggressive", "dreamy"],
    spotifyGenres: ["dark", "goth", "industrial", "post-punk", "darkwave", "doom"],
    profile: { energy: [0.2, 0.7], valence: [0.0, 0.3], acousticness: [0.0, 0.4], tempo: [70, 130] },
  },
  dreamy: {
    keywords: ["dreamy", "ethereal", "atmospheric", "floating", "spacious", "reverberant", "shoegaze", "hazy", "psychedelic", "otherworldly"],
    relatedGenres: ["shoegaze", "dream pop", "ambient", "post-rock", "space rock", "psychedelic", "new age", "ethereal wave"],
    relatedMoods: ["chill", "sad", "focus"],
    spotifyGenres: ["dream-pop", "shoegaze", "ambient", "post-rock", "psychedelic", "ethereal"],
    profile: { energy: [0.1, 0.5], valence: [0.2, 0.6], acousticness: [0.1, 0.7], tempo: [60, 120] },
  },
  aggressive: {
    keywords: ["aggressive", "heavy", "brutal", "crushing", "slam", "breakdown", "screamo", "screaming", "harsh", "abrasive"],
    relatedGenres: ["metalcore", "deathcore", "hardcore", "grindcore", "sludge", "noise", "power electronics", "no wave"],
    relatedMoods: ["energetic", "dark"],
    spotifyGenres: ["metal", "hardcore", "metalcore", "death-metal", "grindcore", "noise"],
    profile: { energy: [0.8, 1.0], valence: [0.0, 0.3], acousticness: [0.0, 0.05], tempo: [100, 200] },
  },
  romantic: {
    keywords: ["romantic", "love", "passion", "intimate", "sensual", "tender", "sweet", "valentine", "devotion"],
    relatedGenres: ["r&b", "soul", "jazz", "bossa nova", "bolero", "latin pop", "indie folk"],
    relatedMoods: ["happy", "sad", "chill"],
    spotifyGenres: ["romantic", "r-n-b", "soul", "jazz", "bossa-nova", "latin"],
    profile: { energy: [0.2, 0.6], valence: [0.4, 0.8], acousticness: [0.2, 0.8], tempo: [60, 120] },
  },
  focus: {
    keywords: ["focus", "study", "concentration", "productivity", "deep work", "meditation", "brain waves", "binaural", "white noise"],
    relatedGenres: ["ambient", "minimal", "classical", "drone", "new age", "electronic", "instrumental"],
    relatedMoods: ["chill", "dreamy"],
    spotifyGenres: ["focus", "study", "ambient", "classical", "minimal", "new-age"],
    profile: { energy: [0.05, 0.3], valence: [0.3, 0.6], acousticness: [0.1, 0.9], tempo: [50, 100] },
  },
  party: {
    keywords: ["party", "club", "dance", "banger", "bop", "drop", "festival", "rave", "mix", "set"],
    relatedGenres: ["house", "techno", "trance", "edm", "dance", "disco", "funk", "hip hop", "reggaeton"],
    relatedMoods: ["energetic", "happy"],
    spotifyGenres: ["party", "dance", "club", "house", "techno", "edm", "disco"],
    profile: { energy: [0.6, 1.0], valence: [0.5, 1.0], acousticness: [0.0, 0.2], tempo: [110, 150] },
  },
};

const GENRE_TO_MOOD: Record<string, Mood[]> = {
  "lo-fi": ["chill"],
  "lofi": ["chill"],
  "lo fi": ["chill"],
  "chillhop": ["chill"],
  "downtempo": ["chill", "dreamy"],
  "trip hop": ["chill", "dark", "dreamy"],
  "ambient": ["chill", "dreamy", "focus"],
  "shoegaze": ["dreamy", "sad"],
  "dream pop": ["dreamy", "sad"],
  "post-punk": ["dark", "sad"],
  "goth": ["dark"],
  "gothic": ["dark"],
  "darkwave": ["dark"],
  "industrial": ["dark", "aggressive"],
  "emo": ["sad"],
  "slowcore": ["sad"],
  "sadcore": ["sad"],
  "indie folk": ["sad", "romantic"],
  "singer-songwriter": ["sad", "romantic"],
  "r&b": ["romantic", "chill"],
  "neo soul": ["romantic", "chill"],
  "soul": ["romantic", "chill"],
  "jazz": ["romantic", "chill", "focus"],
  "jazz hop": ["chill", "focus"],
  "bossa nova": ["romantic", "chill"],
  "house": ["party", "energetic"],
  "techno": ["party", "energetic", "dark"],
  "edm": ["party", "energetic"],
  "drum and bass": ["energetic", "party"],
  "dubstep": ["energetic", "dark"],
  "trance": ["party", "energetic", "dreamy"],
  "disco": ["happy", "party"],
  "funk": ["happy", "party"],
  "reggae": ["happy", "chill"],
  "synth pop": ["happy", "energetic"],
  "indie pop": ["happy", "chill"],
  "bedroom pop": ["chill", "sad"],
  "classical": ["focus", "romantic"],
  "minimal": ["focus", "chill"],
  "new age": ["focus", "dreamy"],
  "post-rock": ["dreamy", "energetic"],
  "metal": ["aggressive", "energetic"],
  "punk": ["aggressive", "energetic"],
  "hardcore": ["aggressive", "energetic"],
  "deathcore": ["aggressive"],
  "metalcore": ["aggressive", "energetic"],
  "doom": ["dark", "aggressive"],
  "sludge": ["dark", "aggressive"],
  "noise": ["dark", "aggressive"],
  "witch house": ["dark", "chill"],
  "trap": ["energetic", "party"],
  "hip hop": ["energetic", "party"],
  "pop": ["happy", "energetic"],
  "latin": ["happy", "party", "romantic"],
  "reggaeton": ["party", "energetic"],
};

export function detectMoods(genres: string[], title?: string, artist?: string): Mood[] {
  const text = [title, artist, ...genres].join(" ").toLowerCase();
  const detected = new Map<Mood, number>();
  for (const [genre, moods] of Object.entries(GENRE_TO_MOOD)) {
    if (text.includes(genre)) {
      for (const mood of moods) {
        detected.set(mood, (detected.get(mood) ?? 0) + 2);
      }
    }
  }
  for (const [mood, def] of Object.entries(MOOD_TAXONOMY)) {
    for (const kw of def.keywords) {
      if (text.includes(kw)) {
        detected.set(mood as Mood, (detected.get(mood as Mood) ?? 0) + 1);
      }
    }
  }
  return [...detected.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([mood]) => mood);
}

export function expandSearchQueries(moods: Mood[], genres: string[]): string[] {
  const queries: string[] = [];
  const seen = new Set<string>();
  const add = (q: string): void => {
    const k = q.toLowerCase().trim();
    if (!seen.has(k)) {
      seen.add(k);
      queries.push(q);
    }
  };
  for (const mood of moods) {
    const def = MOOD_TAXONOMY[mood];
    for (const kw of def.keywords.slice(0, 3)) add(kw);
    for (const g of def.relatedGenres.slice(0, 2)) add(g);
  }
  for (const genre of genres) {
    const normalized = normalizeGenre(genre);
    add(normalized);
    const moods = GENRE_TO_MOOD[normalized] ?? GENRE_TO_MOOD[genre.toLowerCase()];
    if (moods) {
      for (const mood of moods) {
        for (const kw of MOOD_TAXONOMY[mood].keywords.slice(0, 2)) add(kw);
      }
    }
  }
  return queries;
}

export function getSpotifyGenres(moods: Mood[]): string[] {
  const genres = new Set<string>();
  for (const mood of moods) {
    for (const g of MOOD_TAXONOMY[mood].spotifyGenres) genres.add(g);
  }
  return [...genres];
}

export function getMoodProfile(moods: Mood[]): MoodProfile {
  if (moods.length === 0) return { energy: [0.3, 0.7], valence: [0.3, 0.7], acousticness: [0.2, 0.7], tempo: [70, 130] };
  let minE = 1, maxE = 0, minV = 1, maxV = 0, minA = 1, maxA = 0;
  let minT = 300, maxT = 0;
  for (const mood of moods) {
    const p = MOOD_TAXONOMY[mood].profile;
    minE = Math.min(minE, p.energy[0]); maxE = Math.max(maxE, p.energy[1]);
    minV = Math.min(minV, p.valence[0]); maxV = Math.max(maxV, p.valence[1]);
    minA = Math.min(minA, p.acousticness[0]); maxA = Math.max(maxA, p.acousticness[1]);
    minT = Math.min(minT, p.tempo[0]); maxT = Math.max(maxT, p.tempo[1]);
  }
  return {
    energy: [minE, maxE],
    valence: [minV, maxV],
    acousticness: [minA, maxA],
    tempo: [minT, maxT],
  };
}

const GENRE_ALIASES: Record<string, string> = {
  "lo-fi": "lo-fi", "lofi": "lo-fi", "lo fi": "lo-fi", "lo_fi": "lo-fi",
  "hip-hop": "hip hop", "hiphop": "hip hop", "hip hop music": "hip hop",
  "r&b": "r&b", "rnb": "r&b", "r and b": "r&b", "rhythm and blues": "r&b",
  "dnb": "drum and bass", "d&b": "drum and bass", "drum & bass": "drum and bass",
  "dub step": "dubstep", "dub-step": "dubstep",
  "electronic": "electronic", "edm": "edm", "electronica": "electronic",
  "synthwave": "synth wave", "synth wave": "synth wave", "retrowave": "synth wave",
  "heavy metal": "metal", "death metal": "metal", "black metal": "metal",
  "rock": "rock", "alt rock": "rock", "alternative rock": "rock", "indie rock": "rock",
  "pop": "pop", "indie pop": "pop", "synth pop": "pop", "bedroom pop": "pop",
  "jazz": "jazz", "jazz hop": "jazz", "jazzy": "jazz",
  "classical": "classical", "orchestral": "classical", "piano": "classical",
  "russian rap": "rap", "russian hip hop": "hip hop", "русскоязычный": "rap",
};

export function normalizeGenre(genre: string): string {
  const lower = genre.toLowerCase().trim();
  return GENRE_ALIASES[lower] ?? lower;
}
