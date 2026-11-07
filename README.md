# ROI Tracker

Offline PWA to see whether things you buy pay for themselves. Local-only data (localStorage), no accounts, no build.

- **ROI items** (bike): capex + add-ons; each use logs a saving (quick-tap presets or custom). Shows net and break-even progress.
- **Tracking items** (coffee, home meals): a baseline cost per use; log running costs (beans, groceries) and uses. Shows cost per use vs baseline and total saved.
- One formula underneath: net = sum(use value x qty) - sum(all costs). Each use stores its own value, so later baseline changes don't rewrite history.

## Run
```
npx --yes http-server@14.1.1 . -p 8080 -c-1
```
Open http://localhost:8080. Tests: `node test/core.test.js` (expect `all core tests passed`).

## Deploy
Static files; enable GitHub Pages on the main branch root. Bump `CACHE` in `sw.js` each release.

## Privacy
Data never leaves the device. Backup JSON (menu > Export) contains personal data and is git-ignored; never commit it.
