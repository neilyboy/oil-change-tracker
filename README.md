# 🛢️ Oil Change Tracker

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-20.x-43853d?logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-ready-5a0fc8)

A mobile-first, dark-themed web app to track oil changes for family and friends. No auth. Runs as a single Docker container with persistent volumes.

## ✨ Features

- Track vehicles with photo, VIN, owner, mileage, oil specs, and intervals
- VIN decode via NHTSA (no API key)
- Log service entries (date, mileage, oil brand/weight/quarts, filter brand/part, notes, receipt upload)
- Calculate next due by miles and/or months; status badges: OK / Soon / Due
- Edit/delete vehicles and service entries
- Backup/restore database (JSON). Full ZIP backup/restore includes database + all uploads (images/PDFs)
- Mobile UI with camera capture on file inputs

## 🐳 Docker Compose (recommended)

1) Optional: configure ports

```bash
cp .env.example .env
# Edit .env if you want a different port
# HOST_PORT=3000  # port on your machine
# APP_PORT=3000   # app's internal port
```

2) Build and run

```bash
docker compose up -d --build
```

Open http://localhost:3000 (or your HOST_PORT). Data and uploads persist in named volumes.

Stop:

```bash
docker compose down
```

Update (pull latest code and rebuild):

```bash
git pull
docker compose up -d --build
```

## 🐋 Docker (manual)

1) Build image

```bash
docker build -t oil-change-tracker:latest .
```

2) Run container with persistent volumes

```bash
docker run -d \
  --name oiltracker \
  -p 3000:3000 \
  -v oil_data:/app/data \
  -v oil_uploads:/app/uploads \
  oil-change-tracker:latest
```

Open http://localhost:3000 on the server. From another device on your network (phone/tablet), use http://YOUR_SERVER_IP:3000.

To stop/remove:

```bash
docker stop oiltracker && docker rm oiltracker
```

To update image: rebuild, then recreate container using the same named volumes to keep data/uploads.

### 🔌 If port 3000 is already in use

Option A — change only the host port mapping (recommended):

```bash
docker stop oiltracker && docker rm oiltracker
docker run -d \
  --name oiltracker \
  -p 8080:3000 \
  -v oil_data:/app/data \
  -v oil_uploads:/app/uploads \
  oil-change-tracker:latest
```

Then open http://YOUR_SERVER_IP:8080

Option B — change the app's internal port as well:

```bash
docker stop oiltracker && docker rm oiltracker
docker run -d \
  --name oiltracker \
  -e PORT=4000 \
  -p 8080:4000 \
  -v oil_data:/app/data \
  -v oil_uploads:/app/uploads \
  oil-change-tracker:latest
```

Tip: find your server's LAN IP with:

```bash
hostname -I
```

## 🧪 Development (optional)

```bash
npm install
npm run dev
# open http://localhost:3000
```

## 🔗 API Notes

- GET `/api/vin/:vin` – Decode VIN via NHTSA
- Vehicles: CRUD at `/api/vehicles` and `/api/vehicles/:id`
- Service entries: `/api/vehicles/:id/service-entries`, `/api/service-entries/:entryId`
- Backup (JSON): GET `/api/backup` -> JSON
- Restore (JSON): POST `/api/restore` with JSON body
- Full Backup (ZIP): GET `/api/backup/full` -> ZIP containing `db.json` and `uploads/`
- Restore Full (ZIP): POST `/api/restore/full` as `multipart/form-data` with field `file` (the ZIP)

## 💾 Backup & Restore

There are two backup modes available under Settings:

- JSON Backup: database only. Small and fast. Does not include uploaded images/PDF receipts.
- Full ZIP Backup: includes database and the entire `uploads/` directory.

UI steps (recommended):

1. Open Settings → choose Backup (JSON) or Full Backup (ZIP).
2. To restore, pick the matching Restore option and select your file.

API examples:

```bash
# JSON backup
curl -o backup.json http://localhost:3000/api/backup

# Full ZIP backup
curl -o backup.zip http://localhost:3000/api/backup/full

# JSON restore
curl -X POST -H 'Content-Type: application/json' --data @backup.json http://localhost:3000/api/restore

# Full ZIP restore
curl -X POST -F 'file=@backup.zip' http://localhost:3000/api/restore/full
```

Notes:

- During full restore, the server replaces the `uploads/` directory with the archive contents and restores the database snapshot.
- Large ZIPs may take time to download/upload depending on your network.

## 📦 Data Persistence

- SQLite DB at `/app/data/app.db` (mounted via `-v oil_data:/app/data`)
- Uploads under `/app/uploads` (mounted via `-v oil_uploads:/app/uploads`)

## ℹ️ Notes

- Placeholder image is used when no photo is uploaded.
- The app is unauthenticated; keep it on a trusted LAN.

## 📲 PWA (Install & Offline)

- Install on Android (Chrome): open the app, tap the three-dot menu → Add to Home screen.
- Install on iOS (Safari): tap Share → Add to Home Screen.
- Offline behavior: static assets (`/index.html`, `/styles.css`, `/app.js`, manifest, placeholder image) are cached on first load. API calls use network-first with cached fallback when offline. Navigations fallback to cached `index.html`.
- Service worker: see `public/service-worker.js` (caches `STATIC_ASSETS`, cleans old caches, strategies for API/uploads/3rd-party).
- Icons: the manifest currently uses `public/placeholder-vehicle.svg` (maskable). For best results, also provide PNGs (192x192, 512x512) and an Apple touch icon (180x180).
  - Built-in generator: `npm run gen:icons` (creates `public/icons/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`).

Optional icon generation from SVG (examples):

```bash
# Using ImageMagick (ensure 'magick' installed on host)
magick -background none public/placeholder-vehicle.svg -resize 192x192 public/icon-192.png
magick -background none public/placeholder-vehicle.svg -resize 512x512 public/icon-512.png
magick -background none public/placeholder-vehicle.svg -resize 180x180 public/apple-touch-icon.png
```

Then update `public/manifest.webmanifest` icons and `public/index.html` Apple icon link if you add PNGs. Already wired to look for files in `public/icons/`.

### ♻️ Updating the app

- The service worker updates automatically when `service-worker.js` or cached files change. If you get a stale UI, do a hard refresh or clear site data in your browser settings.

## 📱 Mobile Tips

- Camera capture: image inputs are set with `accept="image/*" capture="environment"` to open the rear camera on mobile when possible.
- Client-side image optimization: photos and receipts are auto-rotated using EXIF and compressed before upload to reduce size.
- Skeleton loading: lists and detail pages render placeholders during data fetch for smoother UX; images are lazy-loaded.

## 📝 License

MIT — see [LICENSE](./LICENSE).
