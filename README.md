# Wave

![Wave Screenshot](assets/screenshot.png)

Минималистичный десктопный музыкальный клиент: поиск по множеству источников, собственная волна (My Wave), лайки/история, HTTP API для интеграции с голосовыми ассистентами (Jarvis).

**Стек:** Tauri 2 (Rust) + React 19 + TypeScript + Zustand + SQLite (tauri-plugin-sql) + axum HTTP API.

---

## Фичи

| Категория | Детали |
|---|---|
| **Поиск** | iTunes, YouTube Music (через yt-dlp), SoundCloud, Deezer, MusicBrainz, Last.fm, Spotify (preview), VK, локальные файлы |
| **Воспроизведение** | Очередь, shuffle/repeat, громкость, сик, переключение треков, медиаклавиши (MPRIS) |
| **Моя волна** | Персональный микс на основе лайков, истории, топ-жанров; кандидаты со всех провайдеров |
| **Лайки / История** | SQLite-персистентность, синхронизация между запусками |
| **Локальные файлы** | Рекурсивное сканирование папки, чтение ID3/FLAC/MP4 тегов (lofty), длительность |
| **HTTP API** | REST endpoints для управления плеером, поиска, волны, лайков — для Jarvis / внешних скриптов |
| **Тексты песен** | LRCLIB (синхронизированные LRC + обычные), опционально Genius API |
| **Настройки (UI)** | Ввод токенов провайдеров, выбор папки локальных файлов, тема, язык |
| **Интернационализация** | English (default) / Русский |

---

## Архитектура

```
src/
├── core/                 # Music Core — независимый от Tauri TS-ядер
│   ├── player/           # PlayerEngine, адаптеры (WebAudioAdapter)
│   ├── queue/            # Queue (shuffle/repeat/history)
│   ├── library/          # WaveEngine, HistoryService, LibraryService
│   ├── database/         # Storage интерфейс + SqliteStorage
│   ├── providers/        # MusicProvider + реализации (iTunes, YouTube, SC, Deezer, MB, LF, Spotify, VK, Local)
│   └── types.ts          # Track, Album, Artist, SearchResults...
├── app/                  # Tauri-слой: compose, bridge, stores, SqliteStorage
├── ui/                   # React компоненты (Sidebar, PlayerBar, Views…)
├── main.tsx              # Entry, error forwarding
└── styles.css            # Global styles, dark theme
src-tauri/
├── src/
│   ├── lib.rs            # Commands: app_config, yt_search, yt_stream, vk_search, http_fetch_json, list_music_files
│   └── http/             # axum HTTP server + auth middleware (token)
└── Cargo.toml
```

**Принцип:** бизнес-логика в `core/` (чистый TS, тестируется в Node), Tauri-специфика — только в `app/` и `src-tauri/`.

---

## Установка

### Зависимости

| Инструмент | Версия | Установка |
|---|---|---|
| Node.js | 20+ | `nvm install 20` |
| pnpm | 9+ | `corepack enable && corepack prepare pnpm@latest --activate` |
| Rust | 1.75+ | `rustup default stable` |
| yt-dlp | 2024+ | `pipx install yt-dlp` или скачать бинарник в `~/.local/bin/yt-dlp` |
| (Linux) WebKit2GTK | 2.40+ | `sudo apt install libwebkit2gtk-4.1-dev` / `pacman -S webkit2gtk-4.1` |

> **Важно:** на Wayland запускайте с переменными окружения:
> ```bash
> env WEBKIT_DISABLE_DMABUF_RENDERER=1 GDK_BACKEND=x11 pnpm tauri dev
> ```

### Сборка и запуск

```bash
git clone https://github.com/yourname/wave
cd wave
pnpm install
pnpm tauri dev          # разработка
pnpm tauri build        # релиз (в src-tauri/target/release/bundle)
```

---

## Конфигурация (переменные окружения)

Создайте `.env` в корне проекта (см. `.env.example`):

| Переменная | Описание | Обязательна |
|---|---|---|
| `WAVE_YTDLP_PATH` | Путь к yt-dlp (если не в PATH) | Нет |
| `WAVE_SOUNDCLOUD_CLIENT_ID` | Client ID для SoundCloud API v2 (достать из браузера на soundcloud.com) | Для SC |
| `WAVE_SPOTIFY_CLIENT_ID` | Spotify Client ID (developer.spotify.com) | Для Spotify |
| `WAVE_SPOTIFY_CLIENT_SECRET` | Spotify Client Secret | Для Spotify |
| `WAVE_VK_TOKEN` | VK user token с правами `audio` | Для VK |
| `WAVE_LASTFM_API_KEY` | Last.fm API key (last.fm/api/account/create) | Для Last.fm / скробблинга |
| `WAVE_GENIUS_TOKEN` | Genius Client Access Token (genius.com/api-clients) | Для текстов Genius |
| `WAVE_API_TOKEN` | Токен для HTTP API (если не задан — генерируется случайный, пишется в `~/.config/com.wave.desktop/api-token`) | Для Jarvis |

**Токен HTTP API:** при первом запуске генерируется случайный 32-символьный токен, сохраняется в конфиг и логируется в консоль (`[wave-http] api token: ...`). Передайте его в заголовке `X-Api-Token`.

---

## HTTP API (для Jarvis)

**Base:** `http://127.0.0.1:8299`  
**Auth:** `X-Api-Token: <token>`

| Метод | Путь | Описание |
|---|---|---|
| GET | `/health` | Проверка живости (без auth) |
| GET | `/api/v1/status` | Сnapshot плеера (state, current, position, queue…) |
| POST | `/api/v1/play` | `{track}` или `{queue[], index?}` — играть |
| POST | `/api/v1/pause` | Пауза |
| POST | `/api/v1/resume` | Продолжить |
| POST | `/api/v1/next` | Следующий |
| POST | `/api/v1/previous` | Предыдущий |
| POST | `/api/v1/seek` | `{position_seconds: 42}` |
| POST | `/api/v1/volume` | `{percent: 50}` |
| POST | `/api/v1/shuffle` | `{enabled: true}` |
| POST | `/api/v1/repeat` | `{mode: "off"|"all"|"one"}` |
| GET | `/api/v1/queue` | Очередь + индекс |
| POST | `/api/v1/queue/add` | `{track}` |
| POST | `/api/v1/queue/clear` | Очистить очередь |
| POST | `/api/v1/search` | `{query: "..."}` — поиск по всем провайдерам |
| POST | `/api/v1/play_search` | `{query: "...", index?}` — поиск + играть |
| POST | `/api/v1/like` | `{track?}` — лайк/дизлайк текущего или указанного |
| GET | `/api/v1/history` | История прослушиваний |
| POST | `/api/v1/wave/start` | Запустить My Wave (20 треков) |

**Пример (curl):**
```bash
TOKEN="$(cat ~/.config/com.wave.desktop/api-token)"
curl -H "X-Api-Token: $TOKEN" http://127.0.0.1:8299/api/v1/status | jq
curl -H "X-Api-Token: $TOKEN" -X POST -d '{"query":"Daft Punk"}' http://127.0.0.1:8299/api/v1/play_search
```

---

## Провайдеры — заметки

| Провайдер | Ключ | Воспроизведение | Примечание |
|---|---|---|---|
| iTunes | — | ✅ превью 30с | Официальный поиск |
| YouTube Music | `WAVE_YTDLP_PATH` | ✅ полные треки | Через yt-dlp (стримы истекают ~6ч, авто-перерезолв) |
| SoundCloud | `WAVE_SOUNDCLOUD_CLIENT_ID` | ✅ 128к mp3 | API v2 без CORS → через Rust-прокси |
| Deezer | — | ✅ превью 30с | Публичный API, нет CORS → через Rust-прокси |
| MusicBrainz | — | ❌ метаданные | Только поиск, User-Agent обязателен |
| Last.fm | `WAVE_LASTFM_API_KEY` | ❌ метаданные | Трек/альбом/артист поиск + скробблинг |
| Spotify | ID + Secret | ✅ превью 30с | Client Credentials flow, только треки с preview_url |
| VK | `WAVE_VK_TOKEN` | ✅ (если есть прямые ссылки) | al_audio.php, недокументированный |
| Local | — | ✅ полные файлы | ID3/FLAC/MP4 теги через lofty |

> ⚠️ **SoundCloud / VK / YouTube** используют недокументированные эндпоинты — могут ломаться. Используйте на свой страх.

---

## Лицензия

MIT License — см. [LICENSE](LICENSE).

**Disclaimer:** этот проект использует недокументированные API (SoundCloud, VK, YouTube через yt-dlp). Авторы не несут ответственности за нарушение ToS сторонних сервисов. Используйте для личных целей.

---

## Roadmap

- [x] Music Core (queue, player, providers, wave, storage)
- [x] SQLite persistence (likes, history, albums, artists)
- [x] HTTP API + auth
- [x] yt-dlp / SoundCloud / Deezer / MusicBrainz / Last.fm / Spotify / VK providers
- [x] Re-resolve expired streams, error toasts, local file metadata, random API token
- [ ] **Albums/Artists UI** (view tracks, bio)
- [ ] **User playlists** (create, M3U import/export, drag-to-queue)
- [ ] **MPRIS / media keys** + system notifications
- [ ] **i18n** (en/ru) + Settings UI (tokens, providers, local dir)
- [ ] **Last.fm scrobbling** (now playing + scrobble)
- [ ] **Lyrics** (LRCLIB + optional Genius)
- [ ] **Similar/Radio** for My Wave
- [ ] Cross-platform (Windows/macOS asset paths, yt-dlp discovery)
- [ ] Android (Capacitor / Tauri mobile)

---

## Вклад

PR welcome. Перед коммитом:
```bash
pnpm test
pnpm build
cd src-tauri && cargo fmt --check && cargo clippy && cargo build
```

---

## Благодарности

- [Muffon](https://github.com/staniel359/muffon) — концепция провайдеров и UI (AGPL-3.0, код не копировался)
- [tauri-plugin-sql](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/sql) — SQLite в вебвью
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — YouTube стримы
- [lofty](https://github.com/open-rs/lofty) — аудио метаданные
- [LRCLIB](https://lrclib.net/) — открытые тексты песен