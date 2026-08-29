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
    dlRetry: string;
    dlAlreadyQueued: string;
    downloadedTracks: string;
    noDownloadedTracks: string;
    noDownloadedHint: string;
    removeFile: string;
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
    seek: string;
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
    sleepTimerExpired: string;
    sleepTimerAfterTrack: string;
  };
  home: {
    heroTitle: string;
    heroSubtitle: string;
    heroPlay: string;
    heroSearch: string;
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
    noResultsHint: string;
    allProviders: string;
    filterPlaceholder: string;
    artists: string;
    albums: string;
    tracks: string;
    previewsHidden: string;
    showPreviews: string;
    recentSearches: string;
    clearRecent: string;
  };
  library: {
    liked: string;
    history: string;
    local: string;
    stats: string;
    smart: string;
    emptyLiked: string;
    emptyHistory: string;
    emptyLocal: string;
    sort: { default: string; title: string; artist: string; album: string };
    topArtists: string;
    topTracks: string;
    totalPlays: string;
    totalTime: string;
    periodDay: string;
    periodWeek: string;
    periodMonth: string;
    periodAll: string;
  };
  smart: {
    empty: string;
    mostPlayed: string;
    mostPlayedDesc: string;
    recentlyPlayed: string;
    recentlyPlayedDesc: string;
    genreMix: string;
    genreMixDesc: string;
    deepCuts: string;
    deepCutsDesc: string;
    freshDiscoveries: string;
    freshDiscoveriesDesc: string;
    play: string;
    tracksCount: (n: number) => string;
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
    share: string;
    shareEmail: string;
    shareEmailPlaceholder: string;
    sharePermission: string;
    editor: string;
    viewer: string;
    sharedWith: string;
    shareSuccess: string;
    shareFailed: string;
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
    themeSystem: string;
    themeAmoled: string;
    accentColor: string;
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
    excludePreviews: string;
    excludePreviewsDesc: string;
    resetCaches: string;
    resetCachesDesc: string;
    testAll: string;
    lastfmStatusEnabled: string;
    lastfmStatusDisabled: string;
    lastfmScrobbleToggle: string;
    test: string;
    testing: string;
    testOK: string;
    testFailed: string;
    providerNotLoaded: string;
    updateYtDlp: string;
    updateYtDlpDesc: string;
    detectYtDlp: string;
    account: string;
    accountDesc: string;
    accountNotConfigured: string;
    accountNotConnected: string;
    accountConnected: string;
    signIn: string;
    signUp: string;
    email: string;
    password: string;
    noAccount: string;
    createAccount: string;
    hasAccount: string;
    signInInstead: string;
    signOut: string;
    oauthUnavailableAndroid: string;
    back: string;
    loading: string;
    emailPassword: string;
    tools: string;
    toolsDesc: string;
    toolsInstall: string;
    toolsDownloading: string;
    toolsReady: string;
    toolsMissing: string;
    ytQuality: string;
    ytQualityDesc: string;
    ytQualityLabels: Record<string, string>;
    backup: string;
    backupDesc: string;
    restore: string;
    restoreDesc: string;
    sectionSources: string;
    sectionAppearance: string;
    sectionPlayback: string;
    sectionRecommendations: string;
    sectionAccount: string;
    crossfade: string;
    crossfadeDesc: string;
    crossfadeOff: string;
    crossfadeDuration: string;
    recommendations: string;
    recommendationsDesc: string;
    discoveryRate: string;
    discoveryRateDesc: string;
    historyDecay: string;
    historyDecayDesc: string;
    days: string;
    autoGenerateThreshold: string;
    tracksRemaining: string;
    audioEffects: string;
    audioEffectsDesc: string;
    bassBoost: string;
    bassBoostDesc: string;
    reverb: string;
    reverbDesc: string;
    stereoWidth: string;
    stereoWidthDesc: string;
    lyrics: string;
    lyricsDesc: string;
    lyricsAutoOpen: string;
    lyricsAutoOpenDesc: string;
    lyricsAutoscroll: string;
    lyricsAutoscrollDesc: string;
    diagnostics: string;
    diagRefresh: string;
    diagPlatform: string;
    diagNetwork: string;
    diagTools: string;
    diagStorage: string;
    diagLogs: string;
    diagClearLogs: string;
    diagNoLogs: string;
    diagAndroid: string;
    diagReady: string;
    diagMissing: string;
    diagVersion: string;
    diagSize: (bytes: number) => string;
    diagPath: string;
    diagDatabase: string;
  };
  shortcuts: {
    title: string;
    playPause: string;
    next: string;
    prev: string;
    volumeUp: string;
    volumeDown: string;
    mute: string;
    like: string;
    shuffle: string;
    search: string;
    closeWindow: string;
    globalPlayPause: string;
    globalNext: string;
    globalPrev: string;
  };
  queue: {
    title: string;
    clear: string;
    empty: string;
    emptyHint: string;
    saveAsPlaylist: string;
    playlistNamePlaceholder: string;
  };
  wave: {
    title: string;
    start: string;
    empty: string;
    hint: string;
    preview: string;
    previewHint: string;
    previewEmpty: string;
    refresh: string;
    playPreview: string;
    blocked: string;
    blockedDesc: string;
    blockedEmpty: string;
    unblock: string;
    blockedTracks: string;
    unblockAll: string;
    autoContinue: string;
    autoContinueDesc: string;
    genres: string;
    genresDesc: string;
    topGenres: string;
    moods: string;
    moodsDesc: string;
    topMoods: string;
    recent: string;
    recentDesc: string;
    recentEmpty: string;
    languages: string;
    languagesDesc: string;
    languagesNone: string;
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
    trackRemovedFromQueue: string;
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
    queueAdded: string;
    playNextAdded: string;
    radioStarted: string;
    alreadyInQueue: string;
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
    playNext: string;
    addToPlaylist: string;
    like: string;
    unlike: string;
    open: string;
    close: string;
    loading: string;
    error: string;
    retry: string;
    search: string;
    minutes: string;
    seconds: string;
    hours: string;
    unknown: string;
    noPlaylists: string;
    actions: string;
    noAudio: string;
    errorTitle: string;
    reload: string;
    downloaded: string;
    undo: string;
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
  onboarding: {
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    selected: (n: number) => string;
    continueBtn: string;
    skip: string;
    suggestionTitle: string;
    suggestionDesc: string;
    minHint: string;
    alreadyPicked: string;
  };
}

export const translations: Record<Locale, Translations> = {
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
      dlRetry: "Retry",
      dlAlreadyQueued: "Already in the download queue",
      downloadedTracks: "Downloaded tracks",
      noDownloadedTracks: "No downloaded tracks yet",
      noDownloadedHint: "Tap the download icon on any track to keep it offline",
      removeFile: "Remove file",
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
      seek: "Seek",
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
      sleepTimerExpired: "Sleep timer: paused",
      sleepTimerAfterTrack: "Sleep timer: end of track",
    },
    home: {
      heroTitle: "Music. Without borders.",
      heroSubtitle: "A modern music player with intelligent waves, cross-provider search and perfect sound.",
      heroPlay: "Listen to Wave",
      heroSearch: "Find Track",
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
      lyricsSource: (src: string) => {
        const names: Record<string, string> = {
          lrclib: "lrclib",
          netease: "NetEase Cloud Music",
          qq: "QQ Music",
          megalobiz: "Megalobiz",
        };
        return `via ${names[src] ?? src}`;
      },
      lyricsRetry: "Retry",
    },
    search: {
      placeholder: "Search...",
      noResults: "Nothing found",
      noResultsHint: "Try a different spelling or check the provider filters",
      allProviders: "All sources",
      filterPlaceholder: "Filter tracks…",
      artists: "Artists",
      albums: "Albums",
      tracks: "Tracks",
      previewsHidden: "Tracks that only play as a short preview are hidden.",
      showPreviews: "Show previews",
      recentSearches: "Recent searches",
      clearRecent: "Clear",
    },
    library: {
      liked: "Liked",
      history: "History",
      local: "Local Files",
      stats: "Statistics",
      smart: "Smart",
      emptyLiked: "No liked tracks yet",
      emptyHistory: "History is empty",
      emptyLocal: "Open a music folder (sidebar → Local Files)",
      sort: {
        default: "Default",
        title: "Title",
        artist: "Artist",
        album: "Album",
      },
      topArtists: "Top Artists",
      topTracks: "Top Tracks",
      totalPlays: "Total Plays",
      totalTime: "Total Time",
      periodDay: "Day",
      periodWeek: "Week",
      periodMonth: "Month",
      periodAll: "All",
    },
    smart: {
      empty: "Listen to some music first to generate smart playlists",
      mostPlayed: "Most Played",
      mostPlayedDesc: "Your top tracks by play count",
      recentlyPlayed: "Recently Played",
      recentlyPlayedDesc: "Tracks you listened to recently",
      genreMix: "Genre Mix",
      genreMixDesc: "A mix from your top genres",
      deepCuts: "Deep Cuts",
      deepCutsDesc: "Liked tracks you haven't heard in a while",
      freshDiscoveries: "Fresh Discoveries",
      freshDiscoveriesDesc: "One track from each of your top artists",
      play: "Play",
      tracksCount: (n: number) => `${n} tracks`,
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
      share: "Share",
      shareEmail: "Collaborator email",
      shareEmailPlaceholder: "user@example.com",
      sharePermission: "Permission",
      editor: "Can edit",
      viewer: "Can view",
      sharedWith: "Shared with",
      shareSuccess: "Playlist shared",
      shareFailed: "User not found",
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
      themeSystem: "System",
      themeAmoled: "AMOLED",
      accentColor: "Accent color",
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
      excludePreviews: "Exclude preview-only tracks from search",
      excludePreviewsDesc: "Tracks that can only play as a short preview (iTunes, Deezer, Spotify) won't appear in search results.",
      resetCaches: "Reset caches",
      resetCachesDesc: "Clear search, variants, covers and lyrics caches.",
      testAll: "Test all platforms",
      lastfmStatusEnabled: "Last.fm scrobbling: enabled (now playing + scrobble)",
      lastfmStatusDisabled: "Last.fm scrobbling: disabled. Set Key, Secret and Session Key.",
      lastfmScrobbleToggle: "Send now-playing and scrobble plays to Last.fm",
      test: "Test",
      testing: "...",
      testOK: "✓ OK",
      testFailed: "✗ Failed",
      providerNotLoaded: "Provider not loaded",
      updateYtDlp: "Update yt-dlp",
      updateYtDlpDesc: "Updates the yt-dlp binary (when installed system-wide or bundled).",
      detectYtDlp: "Detect",
      account: "Account",
      accountDesc: "Sign in to sync likes, playlists, and settings across devices via Supabase.",
      accountNotConfigured: "Cloud sync is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY at build time.",
      accountNotConnected: "Not connected. Sign in to enable cloud sync.",
      accountConnected: "Connected to Supabase",
      signIn: "Sign In",
      signUp: "Create Account",
      email: "Email",
      password: "Password",
      noAccount: "Don't have an account?",
      createAccount: "Create one",
      hasAccount: "Already have an account?",
      signInInstead: "Sign In",
      signOut: "Sign Out",
      oauthUnavailableAndroid: "OAuth is not available on Android — use email and password",
      back: "Back",
      loading: "Loading…",
      emailPassword: "Email / Password",
      tools: "Dependencies",
      toolsDesc: "yt-dlp and ffmpeg are downloaded automatically on first launch into the app data folder.",
      toolsInstall: "Download",
      toolsDownloading: "Downloading…",
      toolsReady: "Ready",
      toolsMissing: "Missing",
      ytQuality: "YouTube quality",
      ytQualityDesc: "Audio bitrate cap for streams via yt-dlp.",
      ytQualityLabels: { low: "Low", medium: "Medium", high: "High", best: "Best" },
      backup: "Backup Database",
      backupDesc: "Export your library to a file. Copy this file to another device to migrate.",
      restore: "Restore Database",
      restoreDesc: "Import a database backup. Requires app restart to take effect.",
      sectionSources: "Sources",
      sectionAppearance: "Appearance",
      sectionPlayback: "Playback",
      sectionRecommendations: "Recommendations",
      sectionAccount: "Account",
      crossfade: "Crossfade",
      crossfadeDesc: "Duration of the smooth transition between tracks. Applies from the next track change.",
      crossfadeOff: "Off",
      crossfadeDuration: "Crossfade Duration",
      recommendations: "Recommendations",
      recommendationsDesc: "Fine-tune how the Wave recommendations are generated.",
      discoveryRate: "Discovery Rate",
      discoveryRateDesc: "Higher = more new artists, Lower = more of your liked tracks.",
      historyDecay: "History Decay",
      historyDecayDesc: "How quickly your listening history loses influence (7-90 days).",
      days: "days",
      autoGenerateThreshold: "Auto-Generate Threshold",
      tracksRemaining: "tracks remaining before auto-fill",
      audioEffects: "Audio Effects",
      audioEffectsDesc: "Enhance your listening with bass boost, reverb and stereo width.",
      bassBoost: "Bass Boost",
      bassBoostDesc: "Boost low frequencies (0–15 dB).",
      reverb: "Reverb",
      reverbDesc: "Add room ambiance (0–100%).",
      stereoWidth: "Stereo Width",
      stereoWidthDesc: "Widen or narrow the stereo image.",
      lyrics: "Lyrics",
      lyricsDesc: "How the lyrics panel behaves when the track changes.",
      lyricsAutoOpen: "Auto-open lyrics",
      lyricsAutoOpenDesc: "Open the lyrics panel automatically when a new track starts.",
      lyricsAutoscroll: "Auto-scroll lyrics",
      lyricsAutoscrollDesc: "Follow the current line while the song is playing.",
      diagnostics: "Diagnostics",
      diagRefresh: "Run checks",
      diagPlatform: "Platform",
      diagNetwork: "Network",
      diagTools: "Dependencies",
      diagStorage: "Storage",
      diagLogs: "Event log",
      diagClearLogs: "Clear log",
      diagNoLogs: "No events logged yet",
      diagAndroid: "Android",
      diagReady: "Ready",
      diagMissing: "Missing",
      diagVersion: "Version",
      diagSize: (bytes: number) =>
        bytes >= 1024 * 1024
          ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
          : `${(bytes / 1024).toFixed(1)} KB`,
      diagPath: "Path",
      diagDatabase: "Database",
    },
    shortcuts: {
      title: "Keyboard Shortcuts",
      playPause: "Play / Pause",
      next: "Next track",
      prev: "Previous track",
      volumeUp: "Volume up",
      volumeDown: "Volume down",
      mute: "Mute / Unmute",
      like: "Like current track",
      shuffle: "Toggle shuffle",
      search: "Open search",
      closeWindow: "Close window",
      globalPlayPause: "Global play / pause",
      globalNext: "Global next track",
      globalPrev: "Global previous track",
    },
    queue: {
      title: "Queue",
      clear: "Clear",
      empty: "Queue is empty",
      emptyHint: "Play a track to start building your queue",
      saveAsPlaylist: "Save as playlist",
      playlistNamePlaceholder: "Playlist name",
    },
    wave: {
      title: "Wave",
      start: "Start Wave",
      empty: "Wave is empty (no liked tracks or history)",
      hint: "Every launch is a fresh mix: likes and frequently played genres get more weight",
      preview: "Preview Wave",
      previewHint: "See what Wave would generate before playing",
      previewEmpty: "Nothing to preview — like some tracks or listen to music first",
      refresh: "Refresh",
      playPreview: "Play",
      blocked: "Blocked",
      blockedDesc: "Tracks and artists excluded from Wave",
      blockedEmpty: "No blocked tracks or artists",
      unblock: "Unblock",
      blockedTracks: "Blocked tracks",
      unblockAll: "Unblock all",
      autoContinue: "Auto-continue",
      autoContinueDesc: "Fill the queue when it ends",
      genres: "Genres",
      genresDesc: "Top genres in your library based on play history",
      topGenres: "Top Genres",
      moods: "Moods",
      moodsDesc: "Mood profile based on your listening patterns",
      topMoods: "Top Moods",
      recent: "Recent Waves",
      recentDesc: "Tracks from your last wave sessions",
      recentEmpty: "Start your first wave to see history here",
      languages: "Preferred Languages",
      languagesDesc: "Boost tracks in selected languages in recommendations",
      languagesNone: "All languages",
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
      trackRemovedFromQueue: "Removed from queue",
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
      queueAdded: "Added to queue",
      playNextAdded: "Will play next",
      radioStarted: "Radio started",
      alreadyInQueue: "Already in queue",
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
      playNext: "Play next",
      addToPlaylist: "Add to playlist",
      like: "Like",
      unlike: "Unlike",
      open: "Open",
      close: "Close",
      loading: "Loading...",
      error: "Error",
      retry: "Retry",
      search: "Search",
      minutes: "min",
      seconds: "sec",
      hours: "h",
      unknown: "Unknown",
      noPlaylists: "No playlists",
      actions: "Actions",
      noAudio: "No audio available",
      errorTitle: "Something went wrong",
      reload: "Reload",
      downloaded: "Downloaded",
      undo: "Undo",
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
    onboarding: {
      title: "Pick your favorite artists",
      subtitle: "We'll use them to build your personal Wave. Select at least 3 to get started.",
      searchPlaceholder: "Search artists...",
      selected: (n: number) => `${n} selected`,
      continueBtn: "Start listening",
      skip: "Skip for now",
      suggestionTitle: "Similar artists you might like",
      suggestionDesc: "Based on your picks",
      minHint: "Pick at least 3 artists",
      alreadyPicked: "Already picked",
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
      dlRetry: "Повторить",
      dlAlreadyQueued: "Уже в очереди загрузок",
      downloadedTracks: "Скачанные треки",
      noDownloadedTracks: "Нет скачанных треков",
      noDownloadedHint: "Нажмите на иконку загрузки у трека, чтобы сохранить его офлайн",
      removeFile: "Удалить файл",
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
      seek: "Перемотка",
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
      sleepTimerExpired: "Таймер сна: пауза",
      sleepTimerAfterTrack: "Таймер сна: конец трека",
    },
    home: {
      heroTitle: "Музыка. Без границ.",
      heroSubtitle: "Современный музыкальный плеер с интеллектуальной волной, кросс-провайдерным поиском и идеальным звуком.",
      heroPlay: "Слушать волну",
      heroSearch: "Найти трек",
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
      lyricsSource: (src: string) => {
        const names: Record<string, string> = {
          lrclib: "lrclib",
          netease: "NetEase Cloud Music",
          qq: "QQ Music",
          megalobiz: "Megalobiz",
        };
        return `via ${names[src] ?? src}`;
      },
      lyricsRetry: "Найти заново",
    },
    search: {
      placeholder: "Поиск...",
      noResults: "Ничего не найдено",
      noResultsHint: "Попробуйте другое написание или проверьте фильтры источников",
      allProviders: "Все источники",
      filterPlaceholder: "Фильтр треков…",
      artists: "Исполнители",
      albums: "Альбомы",
      tracks: "Треки",
      previewsHidden: "Треки, которые проигрываются только как короткое превью, скрыты.",
      showPreviews: "Показать превью",
      recentSearches: "Недавние запросы",
      clearRecent: "Очистить",
    },
    library: {
      liked: "Понравившееся",
      history: "История",
      local: "Локальные файлы",
      stats: "Статистика",
      smart: "Умные",
      emptyLiked: "Пока нет понравившихся треков",
      emptyHistory: "История пуста",
      emptyLocal: "Откройте папку с музыкой (кнопка «Локальные файлы» в сайдбаре)",
      sort: {
        default: "По умолчанию",
        title: "Название",
        artist: "Исполнитель",
        album: "Альбом",
      },
      topArtists: "Топ исполнителей",
      topTracks: "Топ треков",
      totalPlays: "Всего прослушиваний",
      totalTime: "Общее время",
      periodDay: "День",
      periodWeek: "Неделя",
      periodMonth: "Месяц",
      periodAll: "Всё",
    },
    smart: {
      empty: "Сначала послушайте музыку — умные плейлисты появятся здесь",
      mostPlayed: "Часто слушаемые",
      mostPlayedDesc: "Ваши топ-треки по количеству прослушиваний",
      recentlyPlayed: "Недавние",
      recentlyPlayedDesc: "Треки, которые вы недавно слушали",
      genreMix: "Микс жанров",
      genreMixDesc: "Подборка из ваших любимых жанров",
      deepCuts: "Глубокие cuts",
      deepCutsDesc: "Понравившиеся треки, которые давно не слушали",
      freshDiscoveries: "Новые открытия",
      freshDiscoveriesDesc: "Один трек от каждого из ваших топ-исполнителей",
      play: "Воспроизвести",
      tracksCount: (n: number) => `${n} треков`,
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
      share: "Поделиться",
      shareEmail: "Email участника",
      shareEmailPlaceholder: "user@example.com",
      sharePermission: "Права",
      editor: "Может редактировать",
      viewer: "Только просмотр",
      sharedWith: "Доступ у",
      shareSuccess: "Плейлист расшарен",
      shareFailed: "Пользователь не найден",
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
      themeSystem: "Системная",
      themeAmoled: "AMOLED",
      accentColor: "Цвет акцента",
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
      excludePreviews: "Не искать треки-превью в поиске",
      excludePreviewsDesc: "Треки, которые могут проигрываться только как короткое превью (iTunes, Deezer, Spotify), не будут попадать в результаты поиска.",
      resetCaches: "Сбросить кеши",
      resetCachesDesc: "Очищает кеши поиска, вариантов, обложек и текстов.",
      testAll: "Проверить все площадки",
      lastfmStatusEnabled: "Last.fm скробблинг: включён (now playing + scrobble)",
      lastfmStatusDisabled: "Last.fm скробблинг: выключен. Укажите Key, Secret и Session Key.",
      lastfmScrobbleToggle: "Отправлять now-playing и скробблить прослушивания на Last.fm",
      test: "Тест",
      testing: "...",
      testOK: "✓ OK",
      testFailed: "✗ Ошибка",
      providerNotLoaded: "Провайдер не загружен",
      updateYtDlp: "Обновить yt-dlp",
      updateYtDlpDesc: "Обновляет бинарник yt-dlp (если установлен в системе или в комплекте).",
      detectYtDlp: "Найти",
      account: "Аккаунт",
      accountDesc: "Войдите, чтобы синхронизировать лайки, плейлисты и настройки через Supabase.",
      accountNotConfigured: "Облачная синхронизация не настроена. Укажите VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY при сборке.",
      accountNotConnected: "Не подключено. Войдите для включения облачной синхронизации.",
      accountConnected: "Подключено к Supabase",
      signIn: "Войти",
      signUp: "Создать аккаунт",
      email: "Email",
      password: "Пароль",
      noAccount: "Нет аккаунта?",
      createAccount: "Создать",
      hasAccount: "Уже есть аккаунт?",
      signInInstead: "Войти",
      signOut: "Выйти",
      oauthUnavailableAndroid: "OAuth недоступен на Android — используйте email и пароль",
      back: "Назад",
      loading: "Загрузка…",
      emailPassword: "Email / Пароль",
      tools: "Зависимости",
      toolsDesc: "yt-dlp и ffmpeg скачиваются автоматически при первом запуске в папку данных приложения.",
      toolsInstall: "Скачать",
      toolsDownloading: "Скачивание…",
      toolsReady: "Установлено",
      toolsMissing: "Нет",
      ytQuality: "Качество YouTube",
      ytQualityDesc: "Максимальный битрейт аудио для стримов через yt-dlp.",
      ytQualityLabels: { low: "Низкое", medium: "Среднее", high: "Высокое", best: "Максимум" },
      backup: "Резервная копия БД",
      backupDesc: "Экспорт библиотеки в файл. Скопируйте файл на другое устройство для миграции.",
      restore: "Восстановить БД",
      restoreDesc: "Импорт резервной копии. Требуется перезапуск приложения.",
      sectionSources: "Источники",
      sectionAppearance: "Внешний вид",
      sectionPlayback: "Воспроизведение",
      sectionRecommendations: "Рекомендации",
      sectionAccount: "Аккаунт",
      crossfade: "Кроссфейд",
      crossfadeDesc: "Длительность плавного перехода между треками. Применится со следующей смены трека.",
      crossfadeOff: "Выкл",
      crossfadeDuration: "Длительность кроссфейда",
      recommendations: "Рекомендации",
      recommendationsDesc: "Настройте, как генерируются рекомендации Wave.",
      discoveryRate: "Уровень открытий",
      discoveryRateDesc: "Выше = больше новых исполнителей, ниже = больше ваших лайкнутых треков.",
      historyDecay: "Затухание истории",
      historyDecayDesc: "Как быстро история прослушиваний теряет влияние (7–90 дней).",
      days: "дней",
      autoGenerateThreshold: "Порог автозаполнения",
      tracksRemaining: "треков осталось до автозаполнения",
      audioEffects: "Аудиоэффекты",
      audioEffectsDesc: "Улучшите звук с помощью бас-буста, реверберации и ширины стерео.",
      bassBoost: "Бас-буст",
      bassBoostDesc: "Усиление низких частот (0–15 дБ).",
      reverb: "Реверберация",
      reverbDesc: "Добавить эффект пространства (0–100%).",
      stereoWidth: "Ширина стерео",
      stereoWidthDesc: "Расширить или сузить стереообраз.",
      lyrics: "Тексты песен",
      lyricsDesc: "Поведение панели текстов при смене трека.",
      lyricsAutoOpen: "Автооткрытие текстов",
      lyricsAutoOpenDesc: "Открывать панель текстов автоматически при старте нового трека.",
      lyricsAutoscroll: "Автопрокрутка текстов",
      lyricsAutoscrollDesc: "Следить за текущей строкой во время воспроизведения.",
      diagnostics: "Диагностика",
      diagRefresh: "Проверить",
      diagPlatform: "Платформа",
      diagNetwork: "Сеть",
      diagTools: "Зависимости",
      diagStorage: "Хранилище",
      diagLogs: "Журнал событий",
      diagClearLogs: "Очистить журнал",
      diagNoLogs: "Событий пока не было",
      diagAndroid: "Android",
      diagReady: "Установлено",
      diagMissing: "Нет",
      diagVersion: "Версия",
      diagSize: (bytes: number) =>
        bytes >= 1024 * 1024
          ? `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
          : `${(bytes / 1024).toFixed(1)} КБ`,
      diagPath: "Путь",
      diagDatabase: "База данных",
    },
    shortcuts: {
      title: "Горячие клавиши",
      playPause: "Воспроизведение / Пауза",
      next: "Следующий трек",
      prev: "Предыдущий трек",
      volumeUp: "Громкость +",
      volumeDown: "Громкость -",
      mute: "Включить / Выключить звук",
      like: "Нравится текущий трек",
      shuffle: "Перемешать",
      search: "Открыть поиск",
      closeWindow: "Закрыть окно",
      globalPlayPause: "Глобальное воспроизведение / пауза",
      globalNext: "Глобальный следующий трек",
      globalPrev: "Глобальный предыдущий трек",
    },
    queue: {
      title: "Очередь",
      clear: "Очистить",
      empty: "Очередь пуста",
      emptyHint: "Включите трек, чтобы собрать очередь",
      saveAsPlaylist: "Сохранить как плейлист",
      playlistNamePlaceholder: "Название плейлиста",
    },
    wave: {
      title: "Wave",
      start: "Запустить Wave",
      empty: "Wave пуст (нет лайков или истории)",
      hint: "Каждый запуск — свежая подборка: лайки и часто слушаемые жанры получают больший вес",
      preview: "Предпросмотр Wave",
      previewHint: "Посмотрите, что сгенерирует Wave, перед воспроизведением",
      previewEmpty: "Нечего предпросматривать — сначала добавьте лайки или послушайте музыку",
      refresh: "Обновить",
      playPreview: "Воспроизвести",
      blocked: "Заблокировано",
      blockedDesc: "Треки и исполнители, исключённые из Wave",
      blockedEmpty: "Нет заблокированных треков или исполнителей",
      unblock: "Разблокировать",
      blockedTracks: "Заблокированные треки",
      unblockAll: "Разблокировать все",
      autoContinue: "Автопродолжение",
      autoContinueDesc: "Заполнять очередь, когда она заканчивается",
      genres: "Жанры",
      genresDesc: "Топ жанров в вашей библиотеке по истории прослушиваний",
      topGenres: "Топ жанров",
      moods: "Настроение",
      moodsDesc: "Профиль настроения на основе ваших моделей прослушивания",
      topMoods: "Топ настроений",
      recent: "Недавние волны",
      recentDesc: "Треки из ваших последних сессий Wave",
      recentEmpty: "Запустите первую волну, чтобы увидеть историю здесь",
      languages: "Предпочтительные языки",
      languagesDesc: "Усиливать треки на выбранных языках в рекомендациях",
      languagesNone: "Все языки",
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
      trackRemovedFromQueue: "Удалено из очереди",
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
      queueAdded: "Добавлено в очередь",
      playNextAdded: "Будет следующим",
      radioStarted: "Радио запущено",
      alreadyInQueue: "Уже в очереди",
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
      playNext: "Следующим",
      addToPlaylist: "В плейлист",
      like: "Нравится",
      unlike: "Убрать",
      open: "Открыть",
      close: "Закрыть",
      loading: "Загрузка…",
      error: "Ошибка",
      retry: "Повторить",
      search: "Поиск",
      minutes: "мин",
      seconds: "сек",
      hours: "ч",
      unknown: "Неизвестно",
      noPlaylists: "Нет плейлистов",
      actions: "Действия",
      noAudio: "Аудио недоступно",
      errorTitle: "Что-то пошло не так",
      reload: "Перезагрузить",
      downloaded: "Скачано",
      undo: "Отменить",
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
    onboarding: {
      title: "Выберите любимых артистов",
      subtitle: "Мы используем их для персональных рекомендаций. Выберите минимум 3.",
      searchPlaceholder: "Поиск артистов…",
      selected: (n: number) => `Выбрано: ${n}`,
      continueBtn: "Начать слушать",
      skip: "Пропустить",
      suggestionTitle: "Похожие артисты",
      suggestionDesc: "На основе ваших выборов",
      minHint: "Выберите минимум 3 артистов",
      alreadyPicked: "Уже выбран",
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