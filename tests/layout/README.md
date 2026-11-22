# Layout regression checks

Start the existing Vite dev server on port 1420. Install Playwright in a separate tooling directory (or make it available to Node), then run:

```powershell
$env:WAVE_PLAYWRIGHT_PACKAGE = 'F:/tools/wave-audit/layout-test/package.json'
node tests/layout/check.mjs
```

`WAVE_PLAYWRIGHT_PACKAGE` points to the tooling package.json used for module resolution; omit it if Playwright is resolvable normally. Install Chromium with Playwright's CLI first.

The fixture is an independent Vite entry point. It imports actual UI components and styles, uses an isolated browser context, never starts the app composition/audio engine, and is not an entry point in the production build. Its 1000 synthetic tracks test long strings and virtualized scrolling without changing the user's collection.

Screenshots and measured bounds are written to docs/design/layout-recovery. Window dimensions include an assumed 24px native title bar, subtracted only in the test viewport, never in production CSS.
