import type { LyricsMood } from "./lyricsDirection";

export type Atmosphere = "rain" | "snow" | "storm" | "ocean" | "embers" | "cosmos" | "dawn" | "fog" | "leaves";

type Motif = {
  mood: LyricsMood;
  glyph: string;
  color: string;
  words: string;
  atmosphere?: Atmosphere;
};

export const motifs = {
  downpour: { mood: "rain", glyph: "", color: "#b4e5ff", atmosphere: "rain",
    words: "rain rains raining rainfall rainstorm rainstorms downpour downpours cloudburst raindrop raindrops дождь дождя дождю дождем дожде дожди дождей дождями дождям дождях дождик дождиком дождичек дождливый дождливая дождливое дождливые ливень ливня ливню ливнем ливни ливней ливнями проливной проливные" },
  drizzle: { mood: "rain", glyph: "", color: "#9ed7ff",
    words: "drizzle drizzles drizzling droplets droplet drop drops splash splashes splashing puddle puddles морось мороси моросит моросил моросило капля капли капель каплями капелька капельки капельках лужа лужи лужах лужиц лужица" },
  snow: { mood: "rain", glyph: "✻", color: "#e0f4ff", atmosphere: "snow",
    words: "snow snows snowing snowfall snowfalls snowflake snowflakes blizzard blizzards snowstorm snowstorms flurries snowdrift snowdrifts снег снега снегу снегом снеге снега снегов снежок снежком снежинка снежинки снежинок снежинками снежинках снегопад снегопада снегопадом снегопады метель метели метелью метелей метелями вьюга вьюги вьюгой вьюгами пурга пурги пургой поземка снежный снежная снежное снежные завьюжило" },
  frost: { mood: "rain", glyph: "❄", color: "#c8ecff",
    words: "frost frosty frostbite ice icy icicle icicles frozen freezing thaw мороз морозы морозом морозный морозная замерз замерзла замерзаю замерзаешь замерзает замерзли замерзнуть оттепель льда льдом лед ледяной ледяная ледяные льдины льдина льдинки сосулька сосульки иней инеем изморозь" },
  tears: { mood: "rain", glyph: "", color: "#b7cfff",
    words: "tear tears teardrop teardrops cry crying cried weep weeping sob sobbing sobbed слеза слезы слезу слезою слезой слезам слезами слезах потекли слезинка слезинки слезинок плачу плачешь плачет плакала плакал плакали заплакал заплакала рыдать рыдаю рыдаешь рыдает рыдание рыдания выплакать" },
  tide: { mood: "rain", glyph: "∿", color: "#8fe7e4", atmosphere: "ocean",
    words: "ocean oceans sea seas tides tide tidal tsunami tsunamis surf shoreline shipwreck oceanic foam seafoam море морем морю морях моря морской морская морские океан океану океаном океане океана океаны океанов океанском прилив прилива приливы отлив отливы прибой прибоем цунами штиль" },
  stream: { mood: "rain", glyph: "∿", color: "#a9edee",
    words: "wave waves river rivers waterfall waterfalls brook brooks creek creeks ripple ripples lake lakes stream streams волна волны волной волною волнами волн волнах река реки реку рекой рекам реках ручей ручьи ручьем ручьями водопад водопаде водопадом водопады озеро озера озере озером" },
  flame: { mood: "fire", glyph: "◆", color: "#ffbd7f", atmosphere: "embers",
    words: "fire fires flame flames blaze bonfire bonfires wildfire wildfires inferno infernos campfire campfires огонь огня огню огнем огне огни огнями костер костра костру костром костре костры костров пламя пламени пламенем пылающий пылающая пылают пожар пожара пожаром пожары пожаров пожарище" },
  sparks: { mood: "fire", glyph: "✦", color: "#ffe0ab",
    words: "spark sparks sparking flicker flickers flickering ember embers torch torches candle candles candlelight искра искры искрой искрами искрится искрятся искрился вспыхивает вспыхнул вспыхнула вспышка вспышки вспышкой уголек угольки свеча свечи свечой свечами факел факелы факелом" },
  ash: { mood: "fire", glyph: "·", color: "#c5afbd",
    words: "ash ashes smoke smoky smolder smoulder smoldering smouldering soot cinder cinders дым дыме дыма дымом дымится дымился задымился дымный дымная дымовые пепел пепле пеплом пепла зола золой золы тлеть тлеет тлеют тлел тлела угли уголь" },
  sun: { mood: "stars", glyph: "✷", color: "#ffdfa2",
    words: "sun suns sunshine sunlight sunbeam sunbeams sunlit daylight sunshine солнце солнца солнцем солнцу солнечного солнечный солнечная солнечное солнечные луч лучи лучом лучами сияет сияю сияют сияла сияло сияющий сияющая" },
  dawn: { mood: "stars", glyph: "✧", color: "#ffd39a", atmosphere: "dawn",
    words: "sunrise sunrises sunset sunsets dawn dawns daybreak dusk twilight goldenhour рассвет рассвета рассветом рассвете рассветы расцветало рассветает заря заре зарю зарей зорька закат заката закатом закате закаты сумеречный сумеречная вечерело" },
  moon: { mood: "stars", glyph: "☾", color: "#e2d5ff",
    words: "moon moons moonlight moonlit moonbeam moonbeams lunar crescent crescents eclipse eclipses луна луны луне луну луной луною лунный лунная лунные лунного полумесяц полумесяца полумесяцем затмение затмения затмением новолуние полнолуние полнолуния" },
  cosmos: { mood: "stars", glyph: "✧", color: "#eed4ff", atmosphere: "cosmos",
    words: "galaxy galaxies nebula nebulae cosmos universe interstellar planet planets planetary orbit orbits constellation constellations starlight starfield supernova supernovas галактика галактики галактику галактикой галактик галактике туманность туманности туманностью космос космоса космосу космосом космосе планета планеты планете планету планетой планет планетам планетах орбита орбите орбиты марс марса марсе сатурн сатурна юпитер юпитера нептун нептуна вселенная вселенную вселенной вселенные созвездие созвездия созвездий созвездиях сверхновая сверхновой звездопад звездопада звездопадом" },
  meteor: { mood: "stars", glyph: "✧", color: "#e4deff",
    words: "star stars starlit meteor meteors meteorite meteorites comet comets asteroid asteroids звезда звезды звездой звездами звездам звездах звезд метеор метеоры метеором метеорит метеориты метеоритами комета кометы кометой кометами астероид астероиды астероидов" },
  storm: { mood: "wind", glyph: "ϟ", color: "#d7cfff", atmosphere: "storm",
    words: "storm storms stormy thunder thunderstorm thunderstorms lightning tempest tempests cyclone cyclones hurricane hurricanes гроза грозы грозу грозой грозами грозовая грозовое грозовые гром громом грома раскат раскаты молния молнии молнией молниями молниеносный шторм штормы штормом штормит ураган ураганы урагана ураганом ураганный циклон циклоны" },
  leaves: { mood: "wind", glyph: "", color: "#eac594", atmosphere: "leaves",
    words: "leaves leaf foliage autumnal fallwind petals лепесток лепестки лепестков лепестками лепестком лепестках листья листва листвой листвою листвы листве листьев листопад листопада листопадом листопаде листочки листочками" },
  wings: { mood: "wind", glyph: "⌁", color: "#baeddd",
    words: "wing wings winged feather feathers feathery flight soaring glide gliding крыло крыла крылом крылу крылья крыльев крыльями крыльях крылатый крылатая крылатые перо пера пером перья перьями перышко перышки взмах взмахом полет полета полетом парю паришь парит" },
  fog: { mood: "shadow", glyph: "·", color: "#d9c6ef", atmosphere: "fog",
    words: "fog foggy mist misty haze hazy fogbank misted туман тумана туманом тумане туманы туманов туманный туманная туманные дымка дымки дымкой мгла мгле мглой мглу марево пелена пеленой пелену" },
  void: { mood: "shadow", glyph: "◌", color: "#c3a4f4",
    words: "void abyss hollow shadows darkness pitchdark blackness phantom phantoms ghosts ghostly shadowed бездна бездну бездне бездной пустота пустоты пустоту пустотой омут омуте омутом тень тени тенью тенями темень темнота темноты темноте темнотой мрак мраком мраке призрак призрака призраком призраки призраков" },
  kiss: { mood: "heart", glyph: "", color: "#ffb8cb",
    words: "kiss kisses kissed kissing lips lipstick smooch поцелуй поцелуя поцелуев поцелуями поцелуях поцелуем поцелуи целуй целую целует целуешь целовать целоваться поцеловать поцелуемся расцелую губы губами губах помада помады" },
  tenderness: { mood: "heart", glyph: "♥", color: "#ffc4d6",
    words: "love loves loved loving lover lovers lovely beloved beloveds sweetheart sweethearts soulmate soulmates romance romantic romances tenderness люблю любишь любит любите любим любят любил любила любили любовь любви любовью любимый любимая любимые влюбился влюбилась влюбились влюблен влюблена влюбленные влюбленность нежность нежностью нежности сердечко сердечки сердечками" },
  flowers: { mood: "heart", glyph: "", color: "#ffbce3",
    words: "flower flowers blossom blossoms blossoming bloom blooms bouquet bouquets rose roses rosegarden petals цветок цветка цветком цветы цветов цветами цветах цветение цветении цветет цветут зацвел зацвела букет букета букетом букеты роза розы розой розами розах розочку сирень сирени сиренью сакура сакуры" },
  whisper: { mood: "quiet", glyph: "", color: "#e4d9ff",
    words: "silence silent hush whisper whispers whispering whispered lullaby lullabies murmur murmurs murmuring тишина тишину тишины тишиной тишине тихо тише шепот шепотом шепота шепчет шепчешь шепчу шепчут шептать зашептала зашептал безмолвие безмолвием безмолвный безмолвная колыбельная колыбельные убаюкивает убаюкивай" },
  clock: { mood: "quiet", glyph: "·", color: "#e9d8b5",
    words: "clock clocks clockwork ticking ticktock tick-tock hourglass hourglasses stopwatch часики часами часах циферблат циферблате маятник маятником маятника секундомер секундомером тикает тикают тик-так песочные" },
  digital: { mood: "code", glyph: "", color: "#9fe6ff",
    words: "code codes coding coder coders pixel pixels pixelated glitch glitches glitching byte bytes kilobyte kilobytes cyber cyberspace binary algorithm algorithms hologram holograms holographic neon neonlight код кода коде кодом кодами кодирует алгоритм алгоритма алгоритмом алгоритмы пиксель пикселя пиксели пикселями пиксельный байт байта байтом байты глитч глитчи цифровой цифровая цифровые киберпанк киберпространство голограмма голограммы голограмму голограммой голографический неон неона неоном неоновый неоновая неоновые" },
  music: { mood: "code", glyph: "", color: "#c9b9ff",
    words: "melody melodies melodic harmony harmonies symphony symphonies guitar guitars piano pianos violin violins chord chords synth synths synthesizer synthesizers rhythm rhythms melody мелодия мелодию мелодии мелодией мелодиях гармония гармонии симфония симфонии симфонию ритм ритма ритмом ритмы аккорд аккорды аккордами гитара гитаре гитару гитары пианино фортепиано скрипка скрипки скрипку скрипкой синтезатор синтезаторы синтезатором" },
} satisfies Record<string, Motif>;

export type LyricsMotif = keyof typeof motifs;
export const normalizeLyricWord = (word: string) => word.normalize("NFC").toLowerCase().replace(/’/gu, "'").replace(/ё/gu, "е");
const byWord = new Map<string, LyricsMotif>();
for (const [key, motif] of Object.entries(motifs)) {
  for (const word of motif.words.split(" ")) {
    const normalized = normalizeLyricWord(word);
    if (!byWord.has(normalized)) byWord.set(normalized, key as LyricsMotif);
  }
}
export const motifForWord = (word: string) => byWord.get(word);

export function motifAtmosphere(motif?: LyricsMotif) {
  return motif ? (motifs[motif] as Motif).atmosphere : undefined;
}
