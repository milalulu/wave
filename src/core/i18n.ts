export type Locale = "en" | "ru";

export interface Translations {
  app: {
    name: string;
    welcome: string;
    nowPlaying: string;
  };
  nav: {
    home: string;
    nowPlaying: string;
    search: string;
    library: string;
    wave: string;
    playlist: string;
    queue: string;
    settings: string;
    downloads: string;
    localFiles: string;
  };
  downloads: {
    empty: string;
    clearFinished: string;
    dlQueued: string;
    dlRunning: string;
    dlDone: string;
    dlFailed: string;
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
    spectrum: string;
    download: string;
    downloading: string;
    downloadDirRequired: string;
    radio: string;
    mini: string;
    variants: string;
    variantsEmpty: string;
    similar: string;
  };
  home: {
    welcomeTitle: string;
    welcomeSubtitle: string;
    localFiles: string;
    localFilesDesc: string;
    wave: string;
    waveDesc: string;
    radio: string;
    radioDesc: string;
    radioNoTrack: string;
    browse: string;
    searchDesc: string;
    libraryDesc: string;
    playlistsDesc: string;
    downloadsDesc: string;
    settingsDesc: string;
    recentlyPlayed: string;
    nothingPlaying: string;
    pickTrackHint: string;
    album: string;
    year: string;
    lyricsNotFound: string;
    lyricsInstrumental: string;
    lyricsLoading: string;
    lyricsSource: (src: string) => string;
    lyricsRetry: string;
  };
  search: {
    placeholder: string;
    noResults: string;
    allProviders: string;
    filterPlaceholder: string;
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
    dropHere: string;
    tracksCount: (n: number) => string;
  };
  settings: {
    title: string;
    language: string;
    languageDesc: string;
    behavior: string;
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
    theme: string;
    themeDesc: string;
    themeDark: string;
    themeLight: string;
    sources: string;
    sourcesDesc: string;
    blockedProviders: string;
    blockedProvidersDesc: string;
    preferredProviders: string;
    preferredProvidersDesc: string;
    moveUp: string;
    moveDown: string;
    autoContinue: string;
    autoContinueDesc: string;
    offlineMode: string;
    offlineModeDesc: string;
    resetCaches: string;
    resetCachesDesc: string;
    testAll: string;
    lastfmStatusEnabled: string;
    lastfmStatusDisabled: string;
    test: string;
    testing: string;
    testOK: string;
    testFailed: string;
    providerNotLoaded: string;
    updateYtDlp: string;
    updateYtDlpDesc: string;
    ytQuality: string;
    ytQualityDesc: string;
    ytQualityLabels: Record<string, string>;
    backup: string;
    backupDesc: string;
    restore: string;
    restoreDesc: string;
    crossfade: string;
    crossfadeDesc: string;
    crossfadeOff: string;
    lyrics: string;
    lyricsDesc: string;
    lyricsAutoOpen: string;
    lyricsAutoOpenDesc: string;
    lyricsAutoscroll: string;
    lyricsAutoscrollDesc: string;
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
    shuffleOn: string;
    shuffleOff: string;
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
    tagsSaved: string;
    similarAdded: (n: number) => string;
    similarEmpty: string;
    fallbackSwitched: (label: string) => string;
    trackBlocked: string;
    trackUnblocked: string;
    artistBlocked: string;
    artistUnblocked: string;
    cachesCleared: string;
    updateAvailable: (version: string) => string;
  };
  tagEditor: {
    title: string;
    artist: string;
    album: string;
    genre: string;
    year: string;
    trackNumber: string;
    cover: string;
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
    noPlaylists: string;
  };
  trackMenu: {
    editTags: string;
    removeFromPlaylist: string;
    save: string;
    cancel: string;
    blockTrack: string;
    unblockTrack: string;
    blockArtist: string;
    unblockArtist: string;
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
      home: "Home",
      nowPlaying: "Now Playing",
      search: "Search",
      library: "Library",
      wave: "Wave",
      playlist: "Playlists",
      queue: "Queue",
      settings: "Settings",
      downloads: "Downloads",
      localFiles: "Local Files",
    },
    downloads: {
      empty: "Nothing here yet. Use the menu on a track to download it.",
      clearFinished: "Clear finished",
      dlQueued: "Queued",
      dlRunning: "Downloading",
      dlDone: "Done",
      dlFailed: "Failed",
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
      spectrum: "Spectrum visualizer",
      download: "Download",
      downloading: "Downloading…",
      downloadDirRequired: "Choose a download folder first",
      radio: "Radio",
      mini: "Mini player",
      variants: "Variants",
      variantsEmpty: "No variants on other platforms",
      similar: "Similar",
    },
    home: {
      welcomeTitle: "Welcome to Wave",
      welcomeSubtitle: "Find music or open a local folder",
      localFiles: "Local Files",
      localFilesDesc: "Choose a folder with music",
      wave: "Wave",
      waveDesc: "Personal wave based on your taste",
      radio: "Radio by track",
      radioDesc: "Similar tracks from external sources",
      radioNoTrack: "Play a track first",
      browse: "Browse",
      searchDesc: "Find music on all platforms",
      libraryDesc: "Liked, history and statistics",
      playlistsDesc: "Your playlists and imports",
      downloadsDesc: "Tracks saved to disk",
      settingsDesc: "Appearance, sources and keys",
      recentlyPlayed: "Recently played",
      nothingPlaying: "Nothing is playing",
      pickTrackHint: "Open Search, Wave or a local folder and pick a track",
      album: "Album",
      year: "Year",
      lyricsNotFound: "Lyrics not found",
      lyricsInstrumental: "Instrumental track",
      lyricsLoading: "Loading lyrics...",
      lyricsSource: (src: string) => `via ${src}`,
      lyricsRetry: "Retry",
    },
    search: {
      placeholder: "Search...",
      noResults: "Nothing found",
      allProviders: "All sources",
      filterPlaceholder: "Filter tracks…",
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
      dropHere: "Drop to end of playlist",
      tracksCount: (n: number) => `${n} tracks`,
    },
    settings: {
      title: "Settings",
      language: "Language",
      languageDesc: "Interface language.",
      behavior: "Behavior",
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
      theme: "Theme",
      themeDesc: "Interface color scheme.",
      themeDark: "Dark",
      themeLight: "Light",
      sources: "Sources",
      sourcesDesc: "Choose which music platforms Wave uses. Changes apply on Save.",
      blockedProviders: "Blocked platforms",
      blockedProvidersDesc: "Blocked platforms are excluded from search, Wave, Radio and track variants.",
      preferredProviders: "Preferred platforms",
      preferredProvidersDesc: "Order matters: the top platform is used first when a track has several variants.",
      moveUp: "Move up",
      moveDown: "Move down",
      autoContinue: "Auto-continue queue",
      autoContinueDesc: "Fill the queue with the wave or similar tracks when it ends",
      offlineMode: "Offline mode",
      offlineModeDesc: "Play from downloaded files instead of streaming",
      resetCaches: "Reset caches",
      resetCachesDesc: "Clear search, variants, covers and lyrics caches.",
      testAll: "Test all platforms",
      lastfmStatusEnabled: "Last.fm scrobbling: enabled (now playing + scrobble)",
      lastfmStatusDisabled: "Last.fm scrobbling: disabled. Set Key, Secret and Session Key.",
      test: "Test",
      testing: "...",
      testOK: "✓ OK",
      testFailed: "✗ Failed",
      providerNotLoaded: "Provider not loaded",
      updateYtDlp: "Update yt-dlp",
      updateYtDlpDesc: "Updates the yt-dlp binary (when installed system-wide or bundled).",
      ytQuality: "YouTube quality",
      ytQualityDesc: "Audio bitrate cap for streams via yt-dlp.",
      ytQualityLabels: { low: "Low", medium: "Medium", high: "High", best: "Best" },
      backup: "Backup Database",
      backupDesc: "Export your library to a file. Copy this file to another device to migrate.",
      restore: "Restore Database",
      restoreDesc: "Import a database backup. Requires app restart to take effect.",
      crossfade: "Crossfade",
      crossfadeDesc: "Duration of the smooth transition between tracks. Applies from the next track change.",
      crossfadeOff: "Off",
      lyrics: "Lyrics",
      lyricsDesc: "How the lyrics panel behaves when the track changes.",
      lyricsAutoOpen: "Auto-open lyrics",
      lyricsAutoOpenDesc: "Open the lyrics panel automatically when a new track starts.",
      lyricsAutoscroll: "Auto-scroll lyrics",
      lyricsAutoscrollDesc: "Follow the current line while the song is playing.",
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
      shuffleOn: "Shuffle: on",
      shuffleOff: "Shuffle: off",
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
      tagsSaved: "Tags saved",
      similarAdded: (n: number) => `Added ${n} similar tracks to the queue`,
      similarEmpty: "No similar tracks found",
      fallbackSwitched: (label: string) => `Source failed — switched to ${label}`,
      trackBlocked: "Track won't appear in Wave anymore",
      trackUnblocked: "Track restored in Wave",
      artistBlocked: "Artist won't appear in Wave anymore",
      artistUnblocked: "Artist restored in Wave",
      cachesCleared: "Caches cleared",
      updateAvailable: (v: string) => `Update Wave to ${v}?`,
    },
    tagEditor: {
      title: "Title",
      artist: "Artist",
      album: "Album",
      genre: "Genre",
      year: "Year",
      trackNumber: "Track",
      cover: "Cover",
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
      noPlaylists: "No playlists",
    },
    trackMenu: {
      editTags: "Edit tags",
      removeFromPlaylist: "Remove from playlist",
      save: "Save",
      cancel: "Cancel",
      blockTrack: "Don't play in Wave",
      unblockTrack: "Allow in Wave",
      blockArtist: "Hide artist from Wave",
      unblockArtist: "Show artist in Wave",
    },
  },
  ru: {
    app: {
      name: "Wave",
      welcome: "Добро пожаловать в Wave",
      nowPlaying: "Сейчас играет",
    },
    nav: {
      home: "Главная",
      nowPlaying: "Сейчас играет",
      search: "Поиск",
      library: "Библиотека",
      wave: "Wave",
      playlist: "Плейлисты",
      queue: "Очередь",
      settings: "Настройки",
      downloads: "Загрузки",
      localFiles: "Локальные файлы",
    },
    downloads: {
      empty: "Пока пусто. Скачивайте треки через меню в списке.",
      clearFinished: "Очистить завершённые",
      dlQueued: "В очереди",
      dlRunning: "Скачивание",
      dlDone: "Готово",
      dlFailed: "Ошибка",
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
      spectrum: "Спектр-визуализатор",
      download: "Скачать",
      downloading: "Скачивание…",
      downloadDirRequired: "Сначала выберите папку для загрузок",
      radio: "Радио",
      mini: "Мини-плеер",
      variants: "Варианты",
      variantsEmpty: "На других площадках не найдено",
      similar: "Похожие",
    },
    home: {
      welcomeTitle: "Добро пожаловать в Wave",
      welcomeSubtitle: "Найдите музыку или откройте локальную папку",
      localFiles: "Локальные файлы",
      localFilesDesc: "Выбрать папку с музыкой",
      wave: "Wave",
      waveDesc: "Персональная волна по вашему вкусу",
      radio: "Радио по треку",
      radioDesc: "Похожие треки из внешних источников",
      radioNoTrack: "Сначала включите трек",
      browse: "Обзор",
      searchDesc: "Музыка со всех площадок",
      libraryDesc: "Понравившееся, история и статистика",
      playlistsDesc: "Плейлисты и импорт",
      downloadsDesc: "Треки, сохранённые на диск",
      settingsDesc: "Оформление, источники и ключи",
      recentlyPlayed: "Недавно играли",
      nothingPlaying: "Ничего не играет",
      pickTrackHint: "Откройте Поиск, Wave или локальную папку и выберите трек",
      album: "Альбом",
      year: "Год",
      lyricsNotFound: "Текст не найден",
      lyricsInstrumental: "Инструментальная композиция",
      lyricsLoading: "Загрузка текста…",
      lyricsSource: (src: string) => `via ${src}`,
      lyricsRetry: "Найти заново",
    },
    search: {
      placeholder: "Поиск...",
      noResults: "Ничего не найдено",
      allProviders: "Все источники",
      filterPlaceholder: "Фильтр треков…",
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
      dropHere: "Перетащите в конец плейлиста",
      tracksCount: (n: number) => `${n} треков`,
    },
    settings: {
      title: "Настройки",
      language: "Язык",
      languageDesc: "Язык интерфейса.",
      behavior: "Поведение",
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
      theme: "Тема",
      themeDesc: "Цветовая схема интерфейса.",
      themeDark: "Тёмная",
      themeLight: "Светлая",
      sources: "Источники",
      sourcesDesc: "Выберите музыкальные площадки, которые использует Wave. Изменения применяются по кнопке «Сохранить».",
      blockedProviders: "Заблокированные площадки",
      blockedProvidersDesc: "Заблокированные площадки исключаются из поиска, Wave, радио и вариантов трека.",
      preferredProviders: "Предпочтительные площадки",
      preferredProvidersDesc: "Порядок важен: верхняя площадка используется первой, когда у трека несколько вариантов.",
      moveUp: "Выше",
      moveDown: "Ниже",
      autoContinue: "Автопродолжение очереди",
      autoContinueDesc: "Дозаполнять очередь волной или похожими треками, когда она закончится",
      offlineMode: "Оффлайн-режим",
      offlineModeDesc: "Играть из скачанных файлов вместо стриминга",
      resetCaches: "Сбросить кеши",
      resetCachesDesc: "Очищает кеши поиска, вариантов, обложек и текстов.",
      testAll: "Проверить все площадки",
      lastfmStatusEnabled: "Last.fm скробблинг: включён (now playing + scrobble)",
      lastfmStatusDisabled: "Last.fm скробблинг: выключен. Укажите Key, Secret и Session Key.",
      test: "Тест",
      testing: "...",
      testOK: "✓ OK",
      testFailed: "✗ Ошибка",
      providerNotLoaded: "Провайдер не загружен",
      updateYtDlp: "Обновить yt-dlp",
      updateYtDlpDesc: "Обновляет бинарник yt-dlp (если установлен в системе или в комплекте).",
      ytQuality: "Качество YouTube",
      ytQualityDesc: "Максимальный битрейт аудио для стримов через yt-dlp.",
      ytQualityLabels: { low: "Низкое", medium: "Среднее", high: "Высокое", best: "Максимум" },
      backup: "Резервная копия БД",
      backupDesc: "Экспорт библиотеки в файл. Скопируйте файл на другое устройство для миграции.",
      restore: "Восстановить БД",
      restoreDesc: "Импорт резервной копии. Требуется перезапуск приложения.",
      crossfade: "Кроссфейд",
      crossfadeDesc: "Длительность плавного перехода между треками. Применится со следующей смены трека.",
      crossfadeOff: "Выкл",
      lyrics: "Тексты песен",
      lyricsDesc: "Поведение панели текстов при смене трека.",
      lyricsAutoOpen: "Автооткрытие текстов",
      lyricsAutoOpenDesc: "Открывать панель текстов автоматически при старте нового трека.",
      lyricsAutoscroll: "Автопрокрутка текстов",
      lyricsAutoscrollDesc: "Следить за текущей строкой во время воспроизведения.",
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
      shuffleOn: "Перемешивание: вкл",
      shuffleOff: "Перемешивание: выкл",
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
      tagsSaved: "Теги сохранены",
      similarAdded: (n: number) => `Добавлено похожих треков в очередь: ${n}`,
      similarEmpty: "Похожие треки не найдены",
      fallbackSwitched: (label: string) => `Источник недоступен — переключено на ${label}`,
      trackBlocked: "Трек больше не появится в Wave",
      trackUnblocked: "Трек снова в Wave",
      artistBlocked: "Артист больше не появится в Wave",
      artistUnblocked: "Артист снова в Wave",
      cachesCleared: "Кеши очищены",
      updateAvailable: (v: string) => `Обновить Wave до ${v}?`,
    },
    tagEditor: {
      title: "Название",
      artist: "Исполнитель",
      album: "Альбом",
      genre: "Жанр",
      year: "Год",
      trackNumber: "Трек",
      cover: "Обложка",
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
      noPlaylists: "Нет плейлистов",
    },
    trackMenu: {
      editTags: "Редактировать теги",
      removeFromPlaylist: "Убрать из плейлиста",
      save: "Сохранить",
      cancel: "Отмена",
      blockTrack: "Не играть в Wave",
      unblockTrack: "Разрешить в Wave",
      blockArtist: "Скрыть артиста из Wave",
      unblockArtist: "Показывать артиста в Wave",
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
    const sys = typeof navigator !== "undefined" ? navigator.language ?? "" : "";
    currentLocale = sys.toLowerCase().startsWith("ru") ? "ru" : "en";
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