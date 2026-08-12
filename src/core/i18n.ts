export type Locale = "en" | "ru";

export interface Translations {
  app: {
    name: string;
    welcome: string;
    nowPlaying: string;
  };
  nav: {
    home: string;
    search: string;
    library: string;
    wave: string;
    playlist: string;
    queue: string;
    settings: string;
    localFiles: string;
  };
  player: {
    play: string;
    pause: string;
    next: string;
    previous: string;
    shuffle: string;
    repeat: string;
    repeatOne: string;
    volume: string;
    mute: string;
    queue: string;
    lyrics: string;
    sleepTimer: string;
    sleepTimerOptions: {
      off: string;
      afterTrack: string;
      minutes: (m: number) => string;
    };
    speed: string;
    equalizer: string;
    download: string;
    downloading: string;
  };
  home: {
    welcomeTitle: string;
    welcomeSubtitle: string;
    localFiles: string;
    localFilesDesc: string;
    wave: string;
    waveDesc: string;
    lyricsNotFound: string;
    lyricsInstrumental: string;
    lyricsLoading: string;
    lyricsSource: (src: string) => string;
  };
  search: {
    placeholder: string;
    noResults: string;
    artists: string;
    albums: string;
    tracks: string;
  };
  library: {
    liked: string;
    history: string;
    local: string;
    stats: string;
    emptyLiked: string;
    emptyHistory: string;
    emptyLocal: string;
    topArtists: string;
    topTracks: string;
    totalPlays: string;
    totalTime: string;
    periodDay: string;
    periodWeek: string;
    periodMonth: string;
    periodAll: string;
  };
  playlist: {
    title: string;
    newPlaylist: string;
    create: string;
    cancel: string;
    namePlaceholder: string;
    import: string;
    exportM3U: string;
    exportJSON: string;
    delete: string;
    play: string;
    shuffle: string;
    empty: string;
    emptyHint: string;
    tracksCount: (n: number) => string;
  };
  settings: {
    title: string;
    apiKeys: string;
    apiKeysDesc: string;
    localFiles: string;
    localFilesDesc: string;
    selectFolder: string;
    folderPlaceholder: string;
    choose: string;
    actions: string;
    save: string;
    load: string;
    accentFromCover: string;
    accentFromCoverDesc: string;
    notifications: string;
    notificationsDesc: string;
    theme: string;
    themeDesc: string;
    themeDark: string;
    themeLight: string;
    lastfmStatusEnabled: string;
    lastfmStatusDisabled: string;
    test: string;
    testing: string;
    testOK: string;
    testFailed: string;
    providerNotLoaded: string;
    updateYtDlp: string;
    updateYtDlpDesc: string;
    backup: string;
    backupDesc: string;
    restore: string;
    restoreDesc: string;
  };
  queue: {
    title: string;
    clear: string;
    empty: string;
  };
  wave: {
    title: string;
    start: string;
    empty: string;
  };
  toasts: {
    queueRestored: string;
    sleepTimerPaused: string;
    sleepTimerTrackEnd: string;
    settingsSaved: string;
    playlistCreated: string;
    playlistDeleted: string;
    trackAddedToPlaylist: string;
    trackRemovedFromPlaylist: string;
    importSuccess: (n: number) => string;
    importEmpty: string;
    exportSuccess: string;
    lyricsNotFound: string;
    error: string;
  };
  common: {
    save: string;
    cancel: string;
    delete: string;
    edit: string;
    play: string;
    shuffle: string;
    addToQueue: string;
    addToPlaylist: string;
    like: string;
    unlike: string;
    open: string;
    close: string;
    loading: string;
    error: string;
    minutes: string;
    seconds: string;
    hours: string;
    unknown: string;
  };
}

const translations: Record<Locale, Translations> = {
  en: {
    app: {
      name: "Wave",
      welcome: "Welcome to Wave",
      nowPlaying: "Now Playing",
    },
    nav: {
      home: "Now Playing",
      search: "Search",
      library: "Library",
      wave: "Wave",
      playlist: "Playlists",
      queue: "Queue",
      settings: "Settings",
      localFiles: "Local Files",
    },
    player: {
      play: "Play",
      pause: "Pause",
      next: "Next",
      previous: "Previous",
      shuffle: "Shuffle",
      repeat: "Repeat",
      repeatOne: "Repeat One",
      volume: "Volume",
      mute: "Mute",
      queue: "Queue",
      lyrics: "Lyrics",
      sleepTimer: "Sleep Timer",
      sleepTimerOptions: {
        off: "Off",
        afterTrack: "After Current Track",
        minutes: (m: number) => `${m} min`,
      },
      speed: "Speed",
      equalizer: "Equalizer",
      download: "Download",
      downloading: "Downloading…",
    },
    home: {
      welcomeTitle: "Welcome to Wave",
      welcomeSubtitle: "Find music or open a local folder",
      localFiles: "Local Files",
      localFilesDesc: "Choose a folder with music",
      wave: "Wave",
      waveDesc: "Personal wave based on your taste",
      lyricsNotFound: "Lyrics not found",
      lyricsInstrumental: "Instrumental track",
      lyricsLoading: "Loading lyrics...",
      lyricsSource: (src: string) => `via ${src}`,
    },
    search: {
      placeholder: "Search...",
      noResults: "Nothing found",
      artists: "Artists",
      albums: "Albums",
      tracks: "Tracks",
    },
    library: {
      liked: "Liked",
      history: "History",
      local: "Local Files",
      stats: "Statistics",
      emptyLiked: "No liked tracks yet",
      emptyHistory: "History is empty",
      emptyLocal: "Open a music folder (sidebar → Local Files)",
      topArtists: "Top Artists",
      topTracks: "Top Tracks",
      totalPlays: "Total Plays",
      totalTime: "Total Time",
      periodDay: "Day",
      periodWeek: "Week",
      periodMonth: "Month",
      periodAll: "All",
    },
    playlist: {
      title: "Playlists",
      newPlaylist: "New",
      create: "Create",
      cancel: "Cancel",
      namePlaceholder: "Name",
      import: "Import",
      exportM3U: "M3U",
      exportJSON: "JSON",
      delete: "Delete",
      play: "Play",
      shuffle: "Shuffle",
      empty: "No playlists",
      emptyHint: "Create a playlist or import from file",
      tracksCount: (n: number) => `${n} tracks`,
    },
    settings: {
      title: "Settings",
      apiKeys: "API Keys",
      apiKeysDesc: "Changes apply after restart. Test button checks key via search.",
      localFiles: "Local Files",
      localFilesDesc: "Supported: mp3, m4a, flac, ogg, opus, wav, aac, wma. Tags read automatically (lofty).",
      selectFolder: "Music Folder",
      folderPlaceholder: "Select folder...",
      choose: "Choose",
      actions: "Actions",
      save: "Save",
      load: "Load from file",
      accentFromCover: "Accent from cover",
      accentFromCoverDesc: "UI accent color adapts to current track cover (works for CORS-free images).",
      notifications: "System notifications",
      notificationsDesc: "Show a system notification when a new track starts playing.",
      theme: "Theme",
      themeDesc: "Interface color scheme.",
      themeDark: "Dark",
      themeLight: "Light",
      lastfmStatusEnabled: "Last.fm scrobbling: enabled (now playing + scrobble)",
      lastfmStatusDisabled: "Last.fm scrobbling: disabled. Set Key, Secret and Session Key.",
      test: "Test",
      testing: "...",
      testOK: "✓ OK",
      testFailed: "✗ Failed",
      providerNotLoaded: "Provider not loaded",
      updateYtDlp: "Update yt-dlp",
      updateYtDlpDesc: "Updates the yt-dlp binary (when installed system-wide or bundled).",
      backup: "Backup Database",
      backupDesc: "Export your library to a file. Copy this file to another device to migrate.",
      restore: "Restore Database",
      restoreDesc: "Import a database backup. Requires app restart to take effect.",
    },
    queue: {
      title: "Queue",
      clear: "Clear",
      empty: "Queue is empty",
    },
    wave: {
      title: "Wave",
      start: "Start Wave",
      empty: "Wave is empty (no liked tracks or history)",
    },
    toasts: {
      queueRestored: "Queue restored — press play",
      sleepTimerPaused: "Sleep timer: paused",
      sleepTimerTrackEnd: "Sleep timer: end of track",
      settingsSaved: "Settings saved",
      playlistCreated: "Playlist created",
      playlistDeleted: "Playlist deleted",
      trackAddedToPlaylist: "Added to playlist",
      trackRemovedFromPlaylist: "Removed from playlist",
      importSuccess: (n: number) => `Imported ${n} tracks`,
      importEmpty: "File has no tracks",
      exportSuccess: "Playlist saved",
      lyricsNotFound: "Lyrics not found",
      error: "Error",
    },
    common: {
      save: "Save",
      cancel: "Cancel",
      delete: "Delete",
      edit: "Edit",
      play: "Play",
      shuffle: "Shuffle",
      addToQueue: "Add to queue",
      addToPlaylist: "Add to playlist",
      like: "Like",
      unlike: "Unlike",
      open: "Open",
      close: "Close",
      loading: "Loading...",
      error: "Error",
      minutes: "min",
      seconds: "sec",
      hours: "h",
      unknown: "Unknown",
    },
  },
  ru: {
    app: {
      name: "Wave",
      welcome: "Добро пожаловать в Wave",
      nowPlaying: "Сейчас играет",
    },
    nav: {
      home: "Сейчас играет",
      search: "Поиск",
      library: "Библиотека",
      wave: "Wave",
      playlist: "Плейлисты",
      queue: "Очередь",
      settings: "Настройки",
      localFiles: "Локальные файлы",
    },
    player: {
      play: "Играть",
      pause: "Пауза",
      next: "Следующий",
      previous: "Предыдущий",
      shuffle: "Перемешать",
      repeat: "Повтор",
      repeatOne: "Повтор одной",
      volume: "Громкость",
      mute: "Без звука",
      queue: "Очередь",
      lyrics: "Текст",
      sleepTimer: "Таймер сна",
      sleepTimerOptions: {
        off: "Выкл",
        afterTrack: "После текущего трека",
        minutes: (m: number) => `${m} мин`,
      },
      speed: "Скорость",
      equalizer: "Эквалайзер",
      download: "Скачать",
      downloading: "Скачивание…",
    },
    home: {
      welcomeTitle: "Добро пожаловать в Wave",
      welcomeSubtitle: "Найдите музыку или откройте локальную папку",
      localFiles: "Локальные файлы",
      localFilesDesc: "Выбрать папку с музыкой",
      wave: "Wave",
      waveDesc: "Персональная волна по вашему вкусу",
      lyricsNotFound: "Текст не найден",
      lyricsInstrumental: "Инструментальная композиция",
      lyricsLoading: "Загрузка текста…",
      lyricsSource: (src: string) => `via ${src}`,
    },
    search: {
      placeholder: "Поиск...",
      noResults: "Ничего не найдено",
      artists: "Исполнители",
      albums: "Альбомы",
      tracks: "Треки",
    },
    library: {
      liked: "Понравившееся",
      history: "История",
      local: "Локальные файлы",
      stats: "Статистика",
      emptyLiked: "Пока нет понравившихся треков",
      emptyHistory: "История пуста",
      emptyLocal: "Откройте папку с музыкой (кнопка «Локальные файлы» в сайдбаре)",
      topArtists: "Топ исполнителей",
      topTracks: "Топ треков",
      totalPlays: "Всего прослушиваний",
      totalTime: "Общее время",
      periodDay: "День",
      periodWeek: "Неделя",
      periodMonth: "Месяц",
      periodAll: "Всё",
    },
    playlist: {
      title: "Плейлисты",
      newPlaylist: "Новый",
      create: "Создать",
      cancel: "Отмена",
      namePlaceholder: "Название",
      import: "Импорт",
      exportM3U: "M3U",
      exportJSON: "JSON",
      delete: "Удалить",
      play: "Воспроизвести",
      shuffle: "Перемешать",
      empty: "Плейлистов нет",
      emptyHint: "Создайте плейлист или импортируйте из файла",
      tracksCount: (n: number) => `${n} треков`,
    },
    settings: {
      title: "Настройки",
      apiKeys: "API ключи провайдеров",
      apiKeysDesc: "Изменения применяются после перезапуска. Кнопка «Тест» проверяет ключ через поиск.",
      localFiles: "Локальные файлы",
      localFilesDesc: "Поддерживаются: mp3, m4a, flac, ogg, opus, wav, aac, wma. Теги читаются автоматически (lofty).",
      selectFolder: "Папка с музыкой",
      folderPlaceholder: "Выберите папку...",
      choose: "Выбрать",
      actions: "Действия",
      save: "Сохранить",
      load: "Загрузить из файла",
      accentFromCover: "Акцент из обложки",
      accentFromCoverDesc: "Цвет интерфейса подстраивается под обложку текущего трека (доступно для обложек без CORS-ограничений).",
      notifications: "Системные уведомления",
      notificationsDesc: "Показывать системное уведомление при смене трека.",
      theme: "Тема",
      themeDesc: "Цветовая схема интерфейса.",
      themeDark: "Тёмная",
      themeLight: "Светлая",
      lastfmStatusEnabled: "Last.fm скробблинг: включён (now playing + scrobble)",
      lastfmStatusDisabled: "Last.fm скробблинг: выключен. Укажите Key, Secret и Session Key.",
      test: "Тест",
      testing: "...",
      testOK: "✓ OK",
      testFailed: "✗ Ошибка",
      providerNotLoaded: "Провайдер не загружен",
      updateYtDlp: "Обновить yt-dlp",
      updateYtDlpDesc: "Обновляет бинарник yt-dlp (если установлен в системе или в комплекте).",
      backup: "Резервная копия БД",
      backupDesc: "Экспорт библиотеки в файл. Скопируйте файл на другое устройство для миграции.",
      restore: "Восстановить БД",
      restoreDesc: "Импорт резервной копии. Требуется перезапуск приложения.",
    },
    queue: {
      title: "Очередь",
      clear: "Очистить",
      empty: "Очередь пуста",
    },
    wave: {
      title: "Wave",
      start: "Запустить Wave",
      empty: "Wave пуст (нет лайков или истории)",
    },
    toasts: {
      queueRestored: "Очередь восстановлена — нажмите play",
      sleepTimerPaused: "Таймер сна: пауза",
      sleepTimerTrackEnd: "Таймер сна: конец трека",
      settingsSaved: "Настройки сохранены",
      playlistCreated: "Плейлист создан",
      playlistDeleted: "Плейлист удалён",
      trackAddedToPlaylist: "Добавлено в плейлист",
      trackRemovedFromPlaylist: "Удалено из плейлиста",
      importSuccess: (n: number) => `Импортировано треков: ${n}`,
      importEmpty: "В файле нет треков",
      exportSuccess: "Плейлист сохранён",
      lyricsNotFound: "Текст не найден",
      error: "Ошибка",
    },
    common: {
      save: "Сохранить",
      cancel: "Отмена",
      delete: "Удалить",
      edit: "Правка",
      play: "Играть",
      shuffle: "Перемешать",
      addToQueue: "В очередь",
      addToPlaylist: "В плейлист",
      like: "Нравится",
      unlike: "Убрать",
      open: "Открыть",
      close: "Закрыть",
      loading: "Загрузка…",
      error: "Ошибка",
      minutes: "мин",
      seconds: "сек",
      hours: "ч",
      unknown: "Неизвестно",
    },
  },
};

let currentLocale: Locale = "en";
let listeners: Array<() => void> = [];

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  localStorage.setItem("wave-locale", locale);
  listeners.forEach((fn) => fn());
}

export function initLocale(): void {
  const saved = localStorage.getItem("wave-locale") as Locale | null;
  if (saved && (saved === "en" || saved === "ru")) {
    currentLocale = saved;
  } else {
    currentLocale = "en";
  }
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export function t<K extends keyof Translations>(key: K): Translations[K] {
  return translations[currentLocale][key];
}

export function tf<K extends keyof Translations>(key: K): Translations[K] {
  return translations[currentLocale][key];
}