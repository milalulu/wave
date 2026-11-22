import { motifForWord, motifs, normalizeLyricWord, type LyricsMotif } from "./lyricsMotifs";

const vocabulary = {
  heart: "love loves lover lovers loved loving beloved kiss kisses kissed kissing adore adores sweetheart hug hugs люблю любишь любит любим любите любят любил любила любили любовь любви любовью любимый любимая поцелуй поцелуи целуй целую обними обнять",
  rain: "rain rains raining raindrops rainfall tears tear ocean oceans sea seas river rivers water waves wave snow snowfall дождь дождя дождём ливень ливня капли слеза слезы слёзы океан океана море моря река реки волна волны вода воды снег снега",
  fire: "fire fires flame flames burning burn burns blaze ashes ash heat fever огонь огня огнём гори горю горим горит горят гореть пламя пламенем искра искры жара жар пепел пепла",
  stars: "star stars starlight moon moonlight sky heavens sun sunlight sunrise sunset galaxies galaxy cosmos звезда звезды звёзды звёзд звезд луна луны луной небо неба небеса солнце солнца закат рассвет космос галактика",
  quiet: "silence silent softly whisper whispers quiet hush sleep asleep dream dreams dreaming stillness тишина тишины тихо тише шепот шёпот шепчет безмолвие молчишь молчим сон сны спи мечта мечты далеко",
  code: "code codes coding script scripts pixel pixels glitch glitches binary static код кода кодом коде скрипт скрипта скриптом скрипте пиксель пиксели глитч сигнал сигналы",
  wind: "wind winds breeze storm thunder lightning fly flying flight wings wing ветер ветра ветром буря бури гроза молния гром лети лететь лечу крыло крылья",
  shadow: "shadow shadows dark darkness night midnight ghost ghosts broken goodbye farewell тень тени темнота темноте ночь ночи полночь призрак призраки прощай прощание разбит разбита",
} as const;

export type LyricsMood = keyof typeof vocabulary;
const tokenPattern = /[\p{L}\p{M}]+(?:['’\-‑][\p{L}\p{M}]+)*/gu;
const hardBreak = /[.!?;:…]/u;
const clauseBreak = /[,—.!?;:…]/u;

export const sceneLooks = ["ribbon", "eclipse", "prism", "horizon"] as const;
export const reactions = ["bloom", "sweep", "orbit", "cascade", "echo", "comet"] as const;
const additionalWords: Record<LyricsMood, string> = {
  heart: "romance romantic affection desire darling honey angel angels tenderness passion embrace embraces embracing adored romance soulmate soulmates crush infatuation целовать целуешь целует целовал целовала целоваться поцелуя поцелуем обнимаю обнимаешь обнимает обнимал обнимала объятья объятия обниму влюбился влюбилась влюблён влюблена влюбленный влюблённый нежность нежности нежно ласка ласки страсть страсти дорогая дорогой родная родной милая милый сердечко сердечки",
  rain: "drizzle downpour shower showers puddle puddles flood floods flooded tidal tide tides stream streams ripple ripples foam riverbank waterfall waterfalls lake lakes weep weeping cry crying cried icy frost drizzle дождик дождиком дождливый дождливые морось моросит лужа лужи лужах потоп наводнение ручей ручьи ручьями водопад водопады озеро озера озёра льёт льет течёт течет текут слезами слёзами слезах слёзах мокрый мокрая мокрые промок промокла плачу плачешь плачет выплакать лёд льда лед льдом иней",
  fire: "ignite ignites ignition flare flares fiery smolder smoulder ember embers sparks spark scorched scorch inferno bonfire wildfire torch torches smoke smoky smoking melt melting hotter костёр костер костра костром костры горел горела горело горели сгорел сгорела сгораю сгорает сгореть зажги зажечь зажигаю зажигает зажигай вспыхнул вспыхнула вспышка вспышки вспыхнуть пылает пылала пылать раскалённый раскаленный тлеет угли уголь дым дымом дымится пожарище пожар",
  stars: "starlit constellation constellations comet comets meteor meteors planetary planet planets orbit orbits nebula universe solar lunar eclipse dawn dusk twilight daylight sunshine horizon horizons celestial сияю сияешь сияет сияют сияние сияния светится светятся звёздный звездный звёздная звездная звездами звёздами созвездие созвездия комета кометы метеор метеоры планета планеты орбита орбиты вселенная вселенной лунный лунная солнечный солнечная затмение луч лучи лучами светил светило светила светят горизонт горизонтом",
  quiet: "whispering whispered murmurs murmur muted mute serene serenity calm calmer tranquil peace peaceful lullaby lullabies rest resting sleeping slumber asleep dozing drift drifting fading fade fades faint distant distance засыпай засыпаю засыпает усну уснёшь уснешь уснул уснула уснуть сплю спишь спит спят снилось снится снятся приснился приснилась приснилось сновидение сновидения дремлет шепчу шепчешь шептать шепнула шепнул шёпотом шепотом тихий тихая тихие молчание молчал молчала молчат замолчи беззвучно бесшумно спокойно покой покоя колыбельная",
  code: "algorithm algorithms program programs software data matrix cyber circuit circuits reboot buffer bytes byte bits bit hologram neon digital electric electricity voltage frequency frequencies render rendering network networks terminal console transistor modulate алгоритм алгоритмы программа программы данные матрица матрицы байт байты битовый перезагрузка перезагрузи буфер сеть сети процессор транзистор терминал консоль частота частоты частот напряжение электричество электрический голограмма голограммы неон неоновый неоновая",
  wind: "gust gusts hurricane hurricanes tornado tornadoes cyclone turbulence gale tempest storms stormy thunderstorm breezes airborne soaring soar swoop falling fall fallen feather feathers ветры ветру ветре ветерок ветрище ураган ураганы вихрь вихри смерч шторм шторма штормит воздушный воздушная порыв порывы дует дуло развевает улетаю улетай улетел улетела взлетаю взлетай взлетел полёт полет полёта полета летаю летишь летит крылом крыльями перо перья",
  shadow: "shadows darkness darker darkest eclipse phantom phantoms haunt haunted haunting fog mist foggy gloom gloomy hollow abyss void lost loss grief sorrow lonely loneliness alone ghosts grief ashes farewell forgotten forgetting blackened тенями тенью темнеет темно мрак мраке мраком тьма тьмы тьмой бездна бездны пропасть пустота пустоты пустоте сумрак сумраке сумерки ушёл ушел ушла исчез исчезла исчезаю исчезает исчезнуть исчезли одинокий одинокая одиночество печаль тоска туман тумане мгла мгле",
};
const dictionary = new Map<string, LyricsMood>();
for (const mood of Object.keys(vocabulary) as LyricsMood[]) {
  for (const word of `${vocabulary[mood]} ${additionalWords[mood]}`.split(" ")) {
    const normalized = normalizeLyricWord(word);
    if (!dictionary.has(normalized)) dictionary.set(normalized, mood);
  }
}
export type LyricsCue = { start: number; end: number; mood: LyricsMood; reaction: typeof reactions[number]; motif?: LyricsMotif };

const ambiguousAddress = /^(?:дорог(?:ой|ая|ие|ую)|родн(?:ой|ая|ые|ую)|мил(?:ый|ая|ые|ую)|dear|darling|honey|angel|angels|crush|desire)$/u;
const addressClues = /(?:^| )(?:люблю (?:я )?тебя|тебя люблю|скучаю по тебе|скучаю без тебя|ты моя любовь|я твой|я твоя|love you|miss you|hold me|my love)(?: |$)/gu;
const addressBlockers = /(?:^| )(?:цен\p{L}*|стои\p{L}*|куп\p{L}*|рубл\p{L}*|деньг\p{L}*|лома\p{L}*|слом\p{L}*|уби\p{L}*|удар\p{L}*|кров\p{L}*|школ\p{L}*|двор\p{L}*|дом\p{L}*|город\p{L}*|край|стран\p{L}*|земл\p{L}*|мам\p{L}*|сестр\p{L}*|брат\p{L}*|friend|friends|brother|sister|home|price|cost|money|buy|kill|break|blood)(?: |$)/u;
const vocative = /^(?:(?:мой|моя|my) )?(?:дорогой|дорогая|родной|родная|милый|милая|dear|darling|honey|angel)$/u;
const negated = /(?:^| )(?:не|нет|без|никогда|not|never|don't|can't|won't|without|no)(?: (?:очень|так|больше|уже|вовсе|совсем|даже|тебя|ее|его|я|идет|идет ли|будет|было|you|really|ever|even|quite|more)){0,2}$/u;

// These homographs need a cue from the surrounding words to choose a visual motif.
const contextualWords: Record<string, RegExp> = {
  плачу: /(?:^| )(?:слез\p{L}*|глаз\p{L}*|рыда\p{L}*|плака\p{L}*)(?: |$)/u,
  tear: /(?:^| )(?:eyes?|cheeks?|cry|crying|cried|weep|weeping|sadness)(?: |$)/u,
  wind: /(?:^| )(?:blow\p{L}*|cold|warm|north|south|east|west|breeze|sky|gust\p{L}*|storm\p{L}*|sail\p{L}*|leaves)(?: |$)/u,
  fall: /(?:^| )(?:sky|wings|flight|fly|flying|airborne|feathers?)(?: |$)/u,
  falling: /(?:^| )(?:sky|wings|flight|fly|flying|airborne|feathers?)(?: |$)/u,
  bit: /(?:^| )(?:binary|data|byte|digital|code|memory)(?: |$)/u,
  static: /(?:^| )(?:radio|signal|screen|frequency|noise|television)(?: |$)/u,
  shower: /(?:^| )(?:rain|clouds?|storms?|drizzle|weather|thunder)(?: |$)/u,
  leaves: /(?:^| )(?:tree\p{L}*|autumn|foliage|amber|golden|green|branches|forest|wind)(?: |$)/u,
  drop: /(?:^| )(?:rain\p{L}*|tears?|water|puddle\p{L}*|drizzle)(?: |$)/u,
  drops: /(?:^| )(?:rain\p{L}*|tears?|water|puddle\p{L}*|drizzle)(?: |$)/u,
  wave: /(?:^| )(?:ocean|sea|water|surf|tide|shore\p{L}*|beach)(?: |$)/u,
  waves: /(?:^| )(?:ocean|sea|water|surf|tide|shore\p{L}*|beach)(?: |$)/u,
  волна: /(?:^| )(?:вод\p{L}*|мор\p{L}*|океан\p{L}*|берег\p{L}*|прилив\p{L}*|прибой)(?: |$)/u,
  волны: /(?:^| )(?:вод\p{L}*|мор\p{L}*|океан\p{L}*|берег\p{L}*|прилив\p{L}*|прибой)(?: |$)/u,
  светила: /(?:^| )(?:неб\p{L}*|звезд\p{L}*|солнеч\p{L}*|солнц\p{L}*|лун\p{L}*)(?: |$)/u,
};

function clauseAt(text: string, start: number, end: number, separator: RegExp) {
  const parts = text.slice(0, start).split(separator);
  const before = parts[parts.length - 1];
  const after = text.slice(end).split(separator)[0];
  return before + text.slice(start, end) + after;
}

const contextText = (text: string) => Array.from(text.matchAll(tokenPattern), (match) => normalizeLyricWord(match[0])).join(" ");

function contextMood(text: string, word: string, start: number, end: number, mood: LyricsMood): LyricsMood | undefined {
  const parts = text.slice(0, start).split(clauseBreak);
  const prefix = contextText(parts[parts.length - 1]);
  if (ambiguousAddress.test(word) && mood === "heart") {
    const phrase = contextText(clauseAt(text, start, end, hardBreak));
    const address = contextText(clauseAt(text, start, end, clauseBreak));
    const affectionate = Array.from(phrase.matchAll(addressClues)).some((match) => !negated.test(phrase.slice(0, match.index).trim()));
    if (!vocative.test(address) || !affectionate || addressBlockers.test(phrase)) return;
  } else {
    const rule = contextualWords[word];
    if (rule && !rule.test(contextText(clauseAt(text, start, end, hardBreak)))) return;
  }
  return negated.test(prefix) ? "quiet" : mood;
}

export function directLyrics(trackId: string, lines: readonly { text: string }[]) {
  const seed = Array.from(trackId).reduce((hash, char) => Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0, 2166136261);
  const occurrences = new Map<string, number>();
  return lines.map(({ text: raw }) => {
    const text = raw.trim();
    const cues: LyricsCue[] = [];
    for (const token of text.matchAll(tokenPattern)) {
      const start = token.index!;
      const end = start + token[0].length;
      const word = normalizeLyricWord(token[0]);
      const motif = motifForWord(word);
      const literal = (motif && motifs[motif].mood) || dictionary.get(word) || (ambiguousAddress.test(word) ? "heart" : undefined);
      const mood = literal && contextMood(text, word, start, end, literal);
      if (!mood) continue;
      const key = motif ?? word;
      const occurrence = occurrences.get(key) ?? 0;
      occurrences.set(key, occurrence + 1);
      const wordSeed = Array.from(key).reduce((sum, letter) => sum + letter.codePointAt(0)!, 0);
      cues.push({ start, end, mood, reaction: reactions[(seed + wordSeed + occurrence) % reactions.length], motif: mood === literal ? motif : undefined });
      if (cues.length === 2) break;
    }
    return cues;
  });
}

export function lyricsLook(trackId: string, index: number) {
  const start = Array.from(trackId).reduce((sum, char) => sum + char.codePointAt(0)!, 0);
  return sceneLooks[(start + Math.floor(Math.max(0, index) / 8)) % sceneLooks.length];
}

export const moodGlyphs: Record<LyricsMood, string> = {
  heart: "♥", rain: "•", fire: "✦", stars: "✧", quiet: "·", code: "+", wind: "⌁", shadow: "◌",
};
