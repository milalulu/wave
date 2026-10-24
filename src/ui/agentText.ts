import type { ModelErrorCode } from "../core/agent/model";
import type { AgentErrorCode, ToolName } from "../core/agent/contract";

const ru = {
  title: "Агент Wave", intro: "Управляйте музыкой через подключённую модель. Диалог хранится только до закрытия приложения.",
  settings: "Подключение модели", local: "На этом ПК", cloud: "Облако", server: "Адрес API", model: "Имя модели",
  localHint: "Нужен запущенный локальный сервер, например Ollama, и установленная в нём модель. Wave не скачивает и не запускает модели автоматически. Используйте 127.0.0.1 или [::1]. Выберите локальную модель: сам сервер может пересылать запросы в облако.",
  cloudHint: "Совместимый Chat Completions API. Адрес должен оканчиваться базовым путём API, например /v1. Поддержка JSON и параметров зависит от модели.",
  consent: "Отправлять мои сообщения и результаты команд Wave выбранному облачному серверу. Запросы могут быть платными.",
  readOnly: "Только просмотр: запретить изменения плеера и библиотеки", jsonMode: "Запрашивать ответ в формате JSON", tokenParameter: "Параметр лимита ответа",
  save: "Применить и начать новый диалог", test: "Проверить подключение", tested: "Подключение и формат ответа проверены. Качество управления ещё требует проверки.",
  key: "Ключ API", keyHint: "Ключ хранится в системном хранилище секретов для этого адреса API. В диалог он не передаётся.",
  keySave: "Сохранить ключ", keyDelete: "Удалить ключ", keyPresent: "Ключ сохранён для этого адреса", keyAbsent: "Для этого адреса ключ не сохранён",
  newChat: "Новый диалог", empty: "Например: «Что сейчас играет?» или «Установи громкость 30%».", placeholder: "Что сделать в Wave?",
  send: "Отправить", stop: "Остановить", busy: "Агент работает…", preparing: "Подготовка…", user: "Вы", assistant: "Модель", tool: "Wave",
  success: "Выполнено", failed: "Команда не выполнена", unknown: "Исход изменения пока неизвестен. Проверьте состояние Wave перед повтором.",
  details: "Подробности команды", draft: "Настройки изменены. Примените их перед отправкой сообщения.", read: "Только просмотр", control: "Управление Wave",
  refresh: "Проверить исход команды", saved: "Настройки применены", keyDeleted: "Ключ удалён", stopHint: "Остановка прекращает дальнейшие шаги. Уже выполненные изменения сохраняются.",
};
type Text = { [K in keyof typeof ru]: string };
const en: Text = {
  title: "Wave agent", intro: "Control music through a connected model. The conversation stays in memory until the app closes.",
  settings: "Model connection", local: "On this PC", cloud: "Cloud", server: "API base URL", model: "Model name",
  localHint: "Requires a running local server, such as Ollama, with a model installed. Wave does not download or start models automatically. Use 127.0.0.1 or [::1]. Choose a local model: the server itself may forward requests to the cloud.",
  cloudHint: "Compatible Chat Completions API. Include the API base path, such as /v1. JSON and parameter support depend on the model.",
  consent: "Send my messages and Wave tool results to this cloud server. Requests may incur charges.",
  readOnly: "Read only: prevent player and library changes", jsonMode: "Request JSON output", tokenParameter: "Output limit parameter",
  save: "Apply and start a new conversation", test: "Test connection", tested: "Connection and response format verified. Control quality still needs evaluation.",
  key: "API key", keyHint: "The key is stored in your system credential store for this API URL. It is never included in the conversation.",
  keySave: "Save key", keyDelete: "Delete key", keyPresent: "Key saved for this URL", keyAbsent: "No key saved for this URL",
  newChat: "New conversation", empty: 'Try “What is playing?” or “Set the volume to 30%”.', placeholder: "What should Wave do?",
  send: "Send", stop: "Stop", busy: "Agent is working…", preparing: "Preparing…", user: "You", assistant: "Model", tool: "Wave",
  success: "Completed", failed: "Command failed", unknown: "The outcome of this change is uncertain. Check Wave before repeating it.",
  details: "Command details", draft: "Settings have changed. Apply them before sending a message.", read: "Read only", control: "Control Wave",
  refresh: "Check command outcome", saved: "Settings applied", keyDeleted: "Key deleted", stopHint: "Stopping prevents further steps. Completed changes remain in place.",
};
export const agentText = (locale: string): Text => locale === "ru" ? ru : en;

const errors: Record<ModelErrorCode, [string, string]> = {
  cancelled: ["Запрос остановлен.", "Request stopped."],
  timeout: ["Время ожидания истекло. Уже выполненные команды не отменены.", "Request timed out. Completed commands have not been undone."],
  connection_failed: ["Не удалось подключиться. Проверьте адрес и запущен ли сервер модели.", "Could not connect. Check the URL and whether the model server is running."],
  authentication_failed: ["Сервер отклонил ключ или доступ к модели.", "The server rejected the key or access to the model."],
  rate_limited: ["Сервер ограничил число запросов. Повторите позже.", "The server rate limited requests. Try again later."],
  provider_error: ["Сервер отклонил запрос. Проверьте имя модели, формат JSON и параметр лимита ответа.", "The server rejected the request. Check the model name, JSON support and output limit parameter."],
  invalid_response: ["Сервер вернул неполный или неподдерживаемый ответ. Команды из него не выполнялись.", "The server returned an incomplete or unsupported response. No commands from it were executed."],
  response_too_large: ["Ответ сервера превышает допустимый размер.", "The server response exceeds the size limit."],
  invalid_config: ["Проверьте адрес API, имя модели и разрешение на облачные запросы.", "Check the API URL, model name and cloud permission."],
  key_missing: ["Сохраните ключ API для этого адреса сервера.", "Save an API key for this server URL."],
  key_store_unavailable: ["Системное хранилище секретов недоступно или заблокировано. Разблокируйте его и повторите.", "The system credential store is unavailable or locked. Unlock it and try again."],
  context_limit: ["Достигнут лимит контекста. Начните новый диалог.", "Context limit reached. Start a new conversation."],
  invalid_decision: ["Модель нарушила формат команды. Ответ не исполнен.", "The model did not follow the command format. Its response was not executed."],
  step_limit: ["Достигнут лимит шагов. Проверьте выполненные команды ниже.", "Step limit reached. Review completed commands below."],
  repeated_action: ["Модель попыталась повторить изменение. Повтор остановлен.", "The model tried to repeat a change. The repeat was stopped."],
  effect_unknown: ["Исход предыдущего изменения неизвестен. Проверьте состояние Wave; автоматического повтора не будет.", "The previous change has an unknown outcome. Check Wave; it will not be retried automatically."],
  session_limit: ["Достигнут лимит сессии. Начните новый диалог.", "Session limit reached. Start a new conversation."],
  internal_error: ["Не удалось завершить запрос. Проверьте результаты команд перед повтором.", "Could not finish the request. Check command results before trying again."],
};
export function agentErrorText(code: ModelErrorCode, locale: string): string { return errors[code][locale === "ru" ? 0 : 1]; }

const tools: Record<ToolName, [string, string]> = {
  wave_status: ["Состояние плеера", "Player status"], wave_search: ["Поиск музыки", "Music search"],
  wave_play: ["Воспроизведение", "Play track"], wave_pause: ["Пауза", "Pause"], wave_resume: ["Продолжение воспроизведения", "Resume"],
  wave_next: ["Следующий трек", "Next track"], wave_previous: ["Предыдущий трек", "Previous track"],
  wave_seek: ["Перемотка", "Seek"], wave_volume: ["Громкость", "Volume"], wave_queue: ["Просмотр очереди", "View queue"],
  wave_queue_add: ["Добавление в очередь", "Add to queue"], wave_queue_clear: ["Очистка очереди", "Clear queue"],
  wave_playlists: ["Список плейлистов", "List playlists"], wave_playlist_get: ["Просмотр плейлиста", "View playlist"],
  wave_playlist_create: ["Создание плейлиста", "Create playlist"], wave_playlist_add: ["Добавление в плейлист", "Add to playlist"],
  wave_playlist_play: ["Воспроизведение плейлиста", "Play playlist"], wave_liked: ["Любимые треки", "Liked tracks"],
  wave_like: ["Изменение отметки «нравится»", "Update like"], wave_radio: ["Радио по исполнителю", "Artist radio"],
  wave_shuffle: ["Перемешивание", "Shuffle"], wave_repeat: ["Повтор", "Repeat"], wave_speed: ["Скорость", "Speed"], wave_equalizer: ["Эквалайзер", "Equalizer"],
};
export function agentToolLabel(name: ToolName, locale: string): string { return tools[name][locale === "ru" ? 0 : 1]; }
const toolErrors: Record<AgentErrorCode, [string, string]> = {
  invalid_arguments: ["Модель передала неверные параметры.", "The model supplied invalid arguments."],
  unknown_tool: ["Такой команды нет.", "Unknown command."],
  unknown_reference: ["Нужно заново найти трек или плейлист.", "Search or list the track or playlist again."],
  not_found: ["Трек или плейлист больше не найден.", "The track or playlist was not found."],
  not_playable: ["Этот трек недоступен для воспроизведения.", "This track cannot be played."],
  empty_queue: ["Нет треков для воспроизведения.", "There are no tracks to play."],
  out_of_range: ["Указанная позиция за пределами трека.", "The requested position is outside the track."],
  provider_unavailable: ["Источник музыки недоступен.", "The music source is unavailable."],
  cancelled: errors.cancelled, timeout: errors.timeout,
  platform_unavailable: ["Агент доступен только в настольном приложении.", "The agent is available only in the desktop app."],
  internal_error: errors.internal_error,
  request_conflict: ["Повторный запрос конфликтует с предыдущим.", "This request conflicts with an earlier one."],
  session_limit: errors.session_limit,
  permission_denied: ["Эта команда запрещена в выбранном режиме.", "This command is disabled in the selected mode."],
  playback_failed: ["Wave не удалось запустить воспроизведение.", "Wave could not start playback."],
};
export function agentToolError(code: AgentErrorCode, locale: string): string { return toolErrors[code][locale === "ru" ? 0 : 1]; }
