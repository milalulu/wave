# IMPLEMENTATION_PLAN — музыкальный клиент «Wave»

Отдельный проект рядом с Jarvis. Desktop: **Tauri 2** (без Electron).
Android — позже, но архитектура сразу готова к нему.

---

## 1. Референс: Muffon (анализ, без копирования)

Изучено: github.com/staniel359/muffon, v2.4.0.

- **Лицензия: AGPL-3.0.** Мы НЕ копируем код, компоненты или дизайн —
  только концепции. Пишем всё с нуля (стек другой: Tauri 2 + React/TS vs их Vue+Electron).
- **Архитектурная идея:** единый слой источников (providers) поверх API
  (Last.FM, SoundCloud, YouTube Music, Yandex, VK, Bandcamp...). Наш вариант —
  тот же паттерн `MusicProvider`.
- **Возможности Muffon (концепт):**
  - плеер: play/pause, next/prev, seek, громкость, shuffle, repeat, очередь;
  - поиск по всем источникам одновременно;
  - артисты / альбомы / треки / теги / плейлисты;
  - библиотека: избранное, лайки, история, подписки;
  - рекомендации на основе вкуса (у нас — «My Wave»);
  - тёмная/светлая тема;
  - нижняя панель плеера + сайдбар-навигация.
- **UX-паттерны, которые берём:**
  - поиск вызывается из любой точки (глобальный поиск);
  - панель плеера всегда снизу, с прогресс-баром и временем;
  - навигация через левый сайдбар (Сейчас играет / Поиск / Библиотека / My Wave / Очередь).

## 2. v1 Scope (по приоритетам)

1. **PLAYER** — play/pause, next/prev, seek, volume, shuffle, repeat, очередь,
   отображение текущего трека, прогресс, продолжение работы при закрытии/сворачивании окна.
2. **MUSIC** — поиск, список результатов, воспроизведение найденного,
   альбомы/артисты/треки, обложки, метаданные.
3. **LIBRARY** — лайки, история прослушиваний, сохранённые альбомы/артисты,
   локальная очередь, избранное.
4. **MY WAVE** — персональная «волна»: псевдослучайная очередь на основе
   истории/лайков/жанров. Архитектурно расширяется до рекомендательной машины
   (интерфейс `WaveSource`, дальше можно добавить `SmartWaveSource`).
5. **DATABASE** — локальная БД (SQLite), без внешних СУБД.
6. **PROVIDERS** — абстракция `MusicProvider`; провайдеры подключаемые
   (iTunes + Local в v1, дальше любые). Проект не привязан к одному источнику.
7. **JARVIS INTEGRATION** — локальный HTTP API на 127.0.0.1 с токеном.
   Jarvis работает ТОЛЬКО через публичный API, не трогает файлы/БД напрямую.
8. **DESKTOP/MOBILE** — Tauri 2 desktop; Android-архитектура заложена, не делается сейчас.

## 3. Стек

| Слой | Технология |
|---|---|
| Shell | Tauri 2 (Rust), webkit2gtk-4.1 (проверено в окружении) |
| UI | React 18 + TypeScript + Vite, zustand (состояние) |
| Audio | HTML5 `<audio>` через `PlayerAdapter` (WebAudioAdapter) |
| Music Core | Чистый TS, без импортов Tauri — тестируем в Node |
| Providers | `MusicProvider` (интерфейс); v1: `iTunesProvider` (поиск+превью 30с), `LocalProvider` (локальные файлы через asset-протокол) |
| DB | SQLite через `@tauri-apps/plugin-sql` за интерфейсом `Storage`; в тестах/Node — `MemoryStorage` |
| HTTP API | Rust (axum) на 127.0.0.1, токен в заголовке, мост в TS-ядро через Tauri events |
| Сборка | pnpm (npm в системе отсутствует — используем pnpm), `@tauri-apps/cli` |

Почему HTML5 audio: кросс-платформенно, работает и в Tauri desktop, и в
webview Android; за абстракцией легко подменить на MediaSession/ExoPlayer
для фонового воспроизведения на Android.

## 4. Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│  UI (React, webview)                                          │
│  - сейчас играет, поиск, библиотека, my wave, очередь         │
├─────────────────────────────────────────────────────────────┤
│  Music Core (TS, без Tauri)                                   │
│  ├─ PlayerEngine   : стейт-машина, очередь, shuffle/repeat,   │
│  │                   seek/volume/position, адаптер аудио      │
│  ├─ Queue          : up-next, история, режимы repeat          │
│  ├─ Providers      : MusicProvider + iTunesProvider + Local   │
│  ├─ LibraryService : лайки, сохранённые, избранное            │
│  ├─ HistoryService : история прослушиваний                    │
│  ├─ WaveEngine     : My Wave (WeightedRandomWaveSource)       │
│  ├─ Database       : Storage (интерфейс)                      │
│  │    ├─ SqliteStorage (tauri-plugin-sql, desktop)            │
│  │    └─ MemoryStorage (тесты, Node)                          │
│  └─ ApiBridge      : клиентская часть моста к Rust HTTP       │
├─────────────────────────────────────────────────────────────┤
│  Tauri 2 (Rust shell)                                         │
│  ├─ http/           : axum-сервер (127.0.0.1) + токен        │
│  ├─ bridge.rs       : мост Rust-запрос ↔ JS-ядро (commands)   │
│  └─ permissions/capabilities: asset-протокол, sql             │
└─────────────────────────────────────────────────────────────┘
```

Принципы:
- **Music Core не знает о Tauri** — всё платформенное инжектируется адаптерами
  (аудио, хранилище, bridge). Поэтому Android = новый адаптер + новый UI, ядро то же.
- **Storage** — интерфейс (get/put/query/exec + типизированные таблицы),
  чтобы тесты гонялись без SQLite.
- **Providers** — интерфейс с методами `search`, `getTrack`, `resolveStream`,
  `getAlbum`, `getArtist`. Подключение через реестр по `providerId`.
- **Jarvis API** — единственная точка доступа для внешних программ.

## 5. Jarvis API (spec)

Базовый URL: `http://127.0.0.1:8299/api/v1` (порт настраивается).
Auth: заголовок `X-Api-Token: <token>` (если задан в конфиге).

| Метод | Путь | Действие |
|---|---|---|
| GET | `/status` | Снимок плеера: текущий трек, state, позиция, громкость, queue info, shuffle/repeat |
| POST | `/play` | Воспроизвести трек/результат: `{track}` или `{provider, uri, title, artist, ...}` |
| POST | `/pause` | Пауза |
| POST | `/resume` | Продолжить |
| POST | `/next` | Следующий трек |
| POST | `/previous` | Предыдущий трек |
| POST | `/seek` | `{position_seconds}` |
| POST | `/volume` | `{percent}` |
| POST | `/shuffle` | `{enabled}` |
| POST | `/repeat` | `{mode: "off"|"all"|"one"}` |
| GET | `/queue` | Список очереди |
| POST | `/queue/add` | `{track}` — добавить в очередь |
| POST | `/queue/clear` | Очистить очередь |
| POST | `/search` | `{query}` → результаты поиска по всем провайдерам |
| POST | `/play_search` | `{query, index?}` — играть первый/указанный результат |
| POST | `/like` | `{track_id?}` — лайк текущего или указанного трека |
| GET | `/history` | История прослушиваний |
| POST | `/wave/start` | Запустить My Wave |
| GET | `/health` | liveness |

Все ответы — JSON. Ошибки — `{error: "..."}` со статусом 4xx/5xx.

**Интеграция с Jarvis** (описательно, код в отдельном шаге): в Jarvis
добавляются инструменты `media.next/prev/playpause/volume/...`, которые
дергают эти роуты (curl). В v1 достаточно совместимости роутов.

## 6. Desktop / Mobile

- **Desktop (Tauri 2):** окно с webview-UI, системная интеграция через
  tauri-plugin-* (sql, dialog для локальных файлов, opener). «Работа при
  закрытии» — настройка close-to-tray/скрытие в системный трей.
- **Mobile (Android, позже):** тот же webview UI + тот же Music Core.
  Аудио-адаптер меняется на Android MediaSession/ExoPlayer для фоновой
  работы и media controls; storage — sqlite в app-dir. Ничего из Music Core
  не переписывается.
- **Rust-код минимален:** только shell, HTTP-мост, плагины. Вся логика в TS.

## 7. Этапы и критерии приёмки

| Этап | Содержание | Критерий приёмки |
|---|---|---|
| **0. Scaffold** | Tauri 2 + React/TS + Vite, pnpm, базовая сборка | `pnpm tauri dev` открывает окно; dev/build не падает |
| **1. Music Core** | types, Queue, PlayerEngine, WebAudioAdapter, Storage, MemoryStorage | Юнит-тесты в Node (vitest): очередь, shuffle/repeat, seek/volume, история |
| **2. Playback** | Сборка ядра в приложение: базовый UI (плей/пауза/next/prev/seek/volume/прогресс/текущий трек) | Реальный аудиофайл играет/паузится, прогресс движется, громкость меняется |
| **3. Поиск** | iTunesProvider (search + 30s preview) + экран поиска и результатов | Поиск «…» возвращает треки, найденное реально играет, видны обложки |
| **4. Библиотека** | SqliteStorage, лайки, история, сохранённые альбомы/артисты, локальная очередь | Лайк/история переживают рестарт; данные в SQLite |
| **5. My Wave** | WaveEngine + WeightedRandomWaveSource (веса по лайкам/истории/жанрам) | Волна стартует, треки соответствуют вкусу (проверка по жанру) |
| **6. Jarvis API** | Rust axum-сервер + токен + мост к ядру | curl-тест каждого роута; управление плеером снаружи |
| **7. UI-полировка** | Тёмная тема, сайдбар, панель плеера, клавиатура, tray | Визуальная целостность, close-to-tray |
| **8. Android** | НЕ в этом цикле; архитектурная заметка | — |

Порядок исполнения = порядок приоритетов пользователя.

## 8. TODO / контрольные точки

- [x] Исследование Muffon (лицензия, фичи, UX)
- [x] Проверка окружения (rustc 1.97, webkit2gtk-4.1, gtk3, pkg-config OK; npm отсутствует → pnpm)
- [x] Этот план
- [ ] Stage 0: scaffold
- [ ] Stage 1: Music Core + тесты
- [ ] Stage 2: реальное воспроизведение
- [ ] Stage 3: поиск
- [ ] Stage 4: библиотека/SQLite
- [ ] Stage 5: My Wave
- [ ] Stage 6: Jarvis HTTP API
- [ ] Stage 7: UI-полировка
- [ ] Финальный проход: тесты + сборка + ручная проверка воспроизведения
