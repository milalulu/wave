<p align="center">
  <a href="https://milalulu.github.io/wave/">
    <img src="https://raw.githubusercontent.com/milalulu/wave/master/public/logo.svg" width="120" />
  </a>
</p>

<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/milalulu/wave/master/public/title.svg" />
    <img alt="Wave" src="https://raw.githubusercontent.com/milalulu/wave/master/public/title_black_to_white.svg" width="360" />
  </picture>
</h1>

<p align="center">
  <em>Музыкальный плеер, который слушает тебя</em>
</p>

<p align="center">
  <a href="https://github.com/milalulu/wave/releases/latest"><img src="https://img.shields.io/badge/download-v0.2.1-00aad4?style=for-the-badge&logo=windows&logoColor=white" /></a>
  <a href="https://github.com/milalulu/wave/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-gray?style=for-the-badge" /></a>
  <a href="https://github.com/milalulu/wave/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/milalulu/wave/ci.yml?branch=master&label=CI&style=for-the-badge&logo=githubactions&logoColor=white" /></a>
</p>

---

<p align="center">
<svg width="600" height="80" viewBox="0 0 600 80" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="waveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00aad4" stop-opacity="0">
        <animate attributeName="stop-opacity" values="0;1;0" dur="3s" repeatCount="indefinite" />
      </stop>
      <stop offset="50%" stop-color="#00aad4" stop-opacity="1" />
      <stop offset="100%" stop-color="#00aad4" stop-opacity="0">
        <animate attributeName="stop-opacity" values="0;1;0" dur="3s" repeatCount="indefinite" />
      </stop>
    </linearGradient>
  </defs>
  <path fill="none" stroke="url(#waveGrad)" stroke-width="2.5" stroke-linecap="round">
    <animate attributeName="d"
      values="M0,40 C30,40 50,10 80,10 C110,10 130,70 160,70 C190,70 210,10 240,10 C270,10 290,70 320,70 C350,70 370,10 400,10 C430,10 450,70 480,70 C510,70 530,10 560,10 C590,10 600,40 600,40;
              M0,40 C30,40 50,70 80,70 C110,70 130,10 160,10 C190,10 210,70 240,70 C270,70 290,10 320,10 C350,10 370,70 400,70 C430,70 450,10 480,10 C510,10 530,70 560,70 C590,70 600,40 600,40;
              M0,40 C30,40 50,10 80,10 C110,10 130,70 160,70 C190,70 210,10 240,10 C270,10 290,70 320,70 C350,70 370,10 400,10 C430,10 450,70 480,70 C510,70 530,10 560,10 C590,10 600,40 600,40"
      dur="4s" repeatCount="indefinite" />
  </path>
  <path fill="none" stroke="url(#waveGrad)" stroke-width="1.5" stroke-linecap="round" opacity="0.4">
    <animate attributeName="d"
      values="M0,40 C40,40 60,15 90,15 C120,15 140,65 170,65 C200,65 220,15 250,15 C280,15 300,65 330,65 C360,65 380,15 410,15 C440,15 460,65 490,65 C520,65 540,15 570,15 C600,15 600,40 600,40;
              M0,40 C40,40 60,65 90,65 C120,65 140,15 170,15 C200,15 220,65 250,65 C280,65 300,15 330,15 C360,15 380,65 410,65 C440,65 460,15 490,15 C520,15 540,65 570,65 C600,65 600,40 600,40;
              M0,40 C40,40 60,15 90,15 C120,15 140,65 170,65 C200,65 220,15 250,15 C280,15 300,65 330,65 C360,65 380,15 410,15 C440,15 460,65 490,65 C520,65 540,15 570,15 C600,15 600,40 600,40"
      dur="4s" repeatCount="indefinite" />
  </path>
</svg>
</p>

---

## Скачать

<table align="center">
<tr>
  <td align="center"><b>Windows</b></td>
  <td align="center"><b>Linux</b></td>
  <td align="center"><b>Android</b></td>
</tr>
<tr>
  <td align="center">

[`.msi`](https://github.com/milalulu/wave/releases/latest/download/Wave_0.2.1_x64_en-US.msi)
&middot;
[`.exe`](https://github.com/milalulu/wave/releases/latest/download/Wave_0.2.1_x64-setup.exe)

  </td>
  <td align="center">

[`.deb`](https://github.com/milalulu/wave/releases/latest/download/Wave_0.2.1_amd64.deb)
&middot;
[`.rpm`](https://github.com/milalulu/wave/releases/latest/download/Wave-0.2.1-1.x86_64.rpm)
&middot;
[AppImage](https://github.com/milalulu/wave/releases/latest/download/Wave_0.2.1_amd64.AppImage)

  </td>
  <td align="center">

[APK (arm64)](https://github.com/milalulu/wave/releases/latest/download/wave-android.apk)

  </td>
</tr>
</table>

<p align="center"><sub>Автообновления встроены (Tauri updater). <a href="https://github.com/milalulu/wave/releases">Все релизы &rarr;</a></sub></p>

---

## Что это

**Wave** — десктопный музыкальный плеер, который агрегирует несколько источников в один интерфейс. Поиск по iTunes, YouTube Music, SoundCloud, Deezer, Spotify, VK и локальным файлам. Умный микс «Моя волна» на основе твоих вкусов. Полный REST API для интеграции с голосовыми ассистентами.

**Стек:** Tauri 2 (Rust) &middot; React 19 &middot; TypeScript &middot; Zustand &middot; SQLite &middot; axum HTTP API

---

## Возможности

<details open>
<summary><b>Поиск и источники</b></summary>
<br>

| Источник | Поиск | Воспроизведение | Примечание |
|---|:---:|:---:|---|
| YouTube Music | :white_check_mark: | :white_check_mark: полные треки | через yt-dlp, стримы с авто-перерезолвом |
| SoundCloud | :white_check_mark: | :white_check_mark: 128k mp3 | API v2 через Rust-прокси |
| iTunes | :white_check_mark: | :white_check_mark: превью 30с | официальный API |
| Deezer | :white_check_mark: | :white_check_mark: превью 30с | публичный API |
| Spotify | :white_check_mark: | :white_check_mark: превью 30с | Client Credentials flow |
| VK | :white_check_mark: | :white_check_mark: | недокументированный API |
| MusicBrainz / Last.fm | :white_check_mark: | :x: метаданные | обогащение тегов |
| Локальные файлы | :white_check_mark: | :white_check_mark: полные файлы | ID3/FLAC/MP4 через lofty |

</details>

<details open>
<summary><b>Плеер</b></summary>
<br>

- Очередь с drag-and-drop, **Play Next**, shuffle / repeat
- Кроссфейд, эквалайзер (10 полос + пресеты), bass boost, reverb
- Перемотка, громкость, горячие клавиши, медиаклавиши (MPRIS)
- Авто-фолбэк: при ошибке загрузки пробует другой источник
- **Варианты трека** (Musixmatch-style): тот же трек на других площадках
- **Похожие треки** в очередь

</details>

<details open>
<summary><b>Моя волна</b></summary>
<br>

Персональный микс на основе лайков, истории и топ-жанров. Кандидаты со всех провайдеров. Блокировка отдельных треков и артистов. Смарт-рекомендации с RollingContext, TransitionScoring и балансом queue 70/20/10.

</details>

<details open>
<summary><b>Ещё</b></summary>
<br>

- Тексты песен (LRCLIB, синхронизированные LRC)
- Лайки / история (SQLite, персистентность)
- Тёмная / светлая / AMOLED темы
- i18n: English / Русский
- Android: MediaSession + notification + foreground service
- HTTP REST API для Jarvis / внешних скриптов
- Облачная синхронизация (Supabase)

</details>

---

## Архитектура

```
src/
├── core/                 # Music Core — чистый TS, независимый от Tauri
│   ├── player/           # PlayerEngine, WebAudioAdapter, стриминг
│   ├── queue/            # Queue (shuffle/repeat/history)
│   ├── library/          # WaveEngine, рекомендации, enrichment
│   ├── providers/        # iTunes, YouTube, SoundCloud, Deezer, Spotify, VK, Local...
│   ├── lyrics/           # LRCLIB
│   └── types.ts          # Track, Album, Artist, SearchResults...
├── app/                  # Tauri-слой: stores, bridge, compose
├── ui/                   # React компоненты
└── styles.css            # CSS custom properties, темы
src-tauri/
├── src/lib.rs            # Tauri commands, yt-dlp, стриминг
├── src/http/             # axum HTTP server + audio proxy
└── Cargo.toml
```

**Принцип:** бизнес-логика в `core/` (чистый TS, тестируется в Node). Tauri-специфика — только в `app/` и `src-tauri/`.

---

## Установка для разработки

### Зависимости

| Инструмент | Версия | Установка |
|---|---|---|
| Node.js | 24+ | `nvm install 24` |
| pnpm | 11+ | `corepack enable && corepack prepare pnpm@latest --activate` |
| Rust | 1.75+ | `rustup default stable` |
| yt-dlp | 2024+ | `pipx install yt-dlp` |
| (Linux) WebKit2GTK | 2.40+ | `sudo apt install libwebkit2gtk-4.1-dev` |

```bash
git clone https://github.com/milalulu/wave
cd wave
pnpm install
pnpm tauri dev          # разработка
pnpm tauri build        # релиз
```

---

## HTTP API

**Base:** `http://127.0.0.1:8299` &nbsp; | &nbsp; **Auth:** `X-Api-Token: <token>`

```
POST /api/v1/play          {track} или {queue[], index?}
POST /api/v1/pause
POST /api/v1/next
POST /api/v1/search        {query: "..."}
POST /api/v1/play_search   {query: "...", index?}
GET  /api/v1/queue         очередь + индекс
POST /api/v1/like          лайк/дизлайк
GET  /api/v1/history       история
POST /api/v1/wave/start    запустить My Wave (20 треков)
```

```bash
TOKEN="$(cat ~/.config/com.wave.desktop/api-token)"
curl -H "X-Api-Token: $TOKEN" http://127.0.0.1:8299/api/v1/status | jq
curl -H "X-Api-Token: $TOKEN" -X POST -d '{"query":"Daft Punk"}' \
  http://127.0.0.1:8299/api/v1/play_search
```

[Полный список эндпоинтов &rarr;](https://github.com/milalulu/wave/blob/master/README.md#http-api-для-jarvis)

---

## Roadmap

- [x] Music Core (queue, player, providers, wave, storage)
- [x] SQLite persistence (likes, history, albums, artists)
- [x] HTTP API + auth + yt-dlp / SoundCloud / Deezer / Spotify / VK
- [x] Lyrics (LRCLIB) + Track variants + Similar
- [x] Android (MediaSession + notification + foreground service)
- [x] Keyboard shortcuts, loading skeletons, blocking
- [x] **My Wave** smart recommendations (RollingContext, TransitionScoring, queue balance)
- [x] **Streaming proxy** (YouTube через localhost, CORS-free, streaming)
- [x] **Fast yt-dlp** (параллельные клиенты, глобальный кеш стримов)
- [ ] Albums / Artists UI
- [ ] User playlists (create, M3U import/export, drag-to-queue)
- [ ] Last.fm scrobbling
- [ ] Radio by track from external sources

---

## Вклад

PR welcome. Перед коммитом:

```bash
pnpm test && pnpm build
cd src-tauri && cargo fmt --check && cargo clippy && cargo build
```

---

## Лицензия

Apache 2.0 License — см. [LICENSE](LICENSE).

**Disclaimer:** проект использует недокументированные API (SoundCloud, VK, YouTube через yt-dlp). Авторы не несут ответственности за нарушение ToS сторонних сервисов.

---

<p align="center">
  <svg width="200" height="30" viewBox="0 0 200 30" xmlns="http://www.w3.org/2000/svg">
    <circle cx="15" cy="15" r="3" fill="#00aad4">
      <animate attributeName="r" values="3;5;3" dur="1.5s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite" />
    </circle>
    <circle cx="55" cy="15" r="3" fill="#00aad4">
      <animate attributeName="r" values="3;5;3" dur="1.5s" begin="0.2s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" begin="0.2s" repeatCount="indefinite" />
    </circle>
    <circle cx="95" cy="15" r="3" fill="#00aad4">
      <animate attributeName="r" values="3;5;3" dur="1.5s" begin="0.4s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" begin="0.4s" repeatCount="indefinite" />
    </circle>
    <circle cx="135" cy="15" r="3" fill="#00aad4">
      <animate attributeName="r" values="3;5;3" dur="1.5s" begin="0.6s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" begin="0.6s" repeatCount="indefinite" />
    </circle>
    <circle cx="175" cy="15" r="3" fill="#00aad4">
      <animate attributeName="r" values="3;5;3" dur="1.5s" begin="0.8s" repeatCount="indefinite" />
      <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" begin="0.8s" repeatCount="indefinite" />
    </circle>
  </svg>
</p>
