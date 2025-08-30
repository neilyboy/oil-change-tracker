# Oil Change Tracker – Docker Install Guide

This guide covers building and running the app on a Linux server with Docker. It explains where data is stored, how to change ports, and includes Docker Compose and reverse proxy examples.

---

## 1) Prerequisites
- Docker installed (and optionally Docker Compose)
- Server firewall open for your chosen host port

Project internals:
- App listens on `process.env.PORT || 3000` (see `server.js`)
- Container exposes `3000` (see `Dockerfile`)
- Persistent paths inside container:
  - Database: `/app/data`
  - Uploads (images/PDFs): `/app/uploads`

---

## 2) Clone on your server
Example path: `/home/neil/docker/oil-tracker`
```bash
mkdir -p /home/neil/docker
cd /home/neil/docker
# replace with your repo URL
git clone <YOUR_REPO_URL> oil-tracker
cd oil-tracker
```

---

## 3) Build the image
From the cloned project directory:
```bash
docker build -t oil-change-tracker:latest .
```

---

## 4) Choose storage strategy (volumes)
You have two good options for persisting data:

- Option A — Named volumes (simple, Docker-managed):
  - Docker stores data under `/var/lib/docker/volumes/...`
  - You do NOT need to pick a host path.

- Option B — Bind mounts (store under your folder, e.g., `/home/neil/docker/oil-tracker`):
  - You explicitly map host directories to the container.
  - Example host folders: `/home/neil/docker/oil-tracker/data` and `/home/neil/docker/oil-tracker/uploads`
  - Tip: keep these paths outside your Git-tracked files or add to `.gitignore`.

Create host directories if using bind mounts:
```bash
mkdir -p /home/neil/docker/oil-tracker/data
mkdir -p /home/neil/docker/oil-tracker/uploads
```

---

## 5) Run the container

### A) Using named volumes (recommended for most):
```bash
docker run -d \
  --name oiltracker \
  -p 8080:3000 \
  -v oil_data:/app/data \
  -v oil_uploads:/app/uploads \
  --restart unless-stopped \
  oil-change-tracker:latest
```
Open: http://YOUR_SERVER_IP:8080

### B) Using bind mounts (store data under your clone folder):
```bash
docker run -d \
  --name oiltracker \
  -p 8080:3000 \
  -v /home/neil/docker/oil-tracker/data:/app/data \
  -v /home/neil/docker/oil-tracker/uploads:/app/uploads \
  --restart unless-stopped \
  oil-change-tracker:latest
```
Open: http://YOUR_SERVER_IP:8080

Notes:
- Change the left side of `-p HOST:CONTAINER` to adjust the host port (e.g., `-p 3001:3000`).
- To change the app’s internal port too, set `-e PORT=4000` and map `-p 8080:4000`.

Firewall (Ubuntu ufw example):
```bash
sudo ufw allow 8080/tcp
```

Verify the container:
```bash
docker ps
docker logs -f oiltracker
```

---

## 6) Upgrading the app later
```bash
cd /home/neil/docker/oil-tracker
git pull  # get latest code (or copy new files)
docker build -t oil-change-tracker:latest .
docker stop oiltracker && docker rm oiltracker
# Re-run with the SAME volume flags you used before (named or bind)
docker run -d \
  --name oiltracker \
  -p 8080:3000 \
  -v oil_data:/app/data \
  -v oil_uploads:/app/uploads \
  --restart unless-stopped \
  oil-change-tracker:latest
```

Your database and uploads are preserved by the volumes.

---

## 7) Backups and restore
In-app (recommended): Settings → Backup (JSON) or Full Backup (ZIP).

API examples:
```bash
# JSON backup
curl -o backup.json http://YOUR_SERVER_IP:8080/api/backup

# Full ZIP backup (db + uploads)
curl -o backup.zip http://YOUR_SERVER_IP:8080/api/backup/full

# JSON restore
curl -X POST -H 'Content-Type: application/json' --data @backup.json \
  http://YOUR_SERVER_IP:8080/api/restore

# Full ZIP restore
curl -X POST -F 'file=@backup.zip' \
  http://YOUR_SERVER_IP:8080/api/restore/full
```

---

## 8) Docker Compose (optional)
Create `docker-compose.yml` next to the project:
```yaml
version: "3.8"
services:
  app:
    build: .
    image: oil-change-tracker:latest
    ports:
      - "8080:3000"    # change left side to pick host port
    environment:
      - PORT=3000       # change if you want a different internal port
    # Option A: named volumes
    volumes:
      - oil_data:/app/data
      - oil_uploads:/app/uploads
    # Option B: bind mounts (comment out above and use these instead)
    # volumes:
    #   - /home/neil/docker/oil-tracker/data:/app/data
    #   - /home/neil/docker/oil-tracker/uploads:/app/uploads
    restart: unless-stopped
volumes:
  oil_data:
  oil_uploads:
```
Run it:
```bash
docker compose up -d
```

---

## 9) Reverse proxy + HTTPS (optional)
Example Nginx server block (serving TLS via certbot-managed certs):
```nginx
server {
  listen 80;
  server_name oiltracker.example.com;
  location / {
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:3000;  # app container port exposed on host
  }
}
```
Then run certbot (outside the scope here). Adjust to your host port if not 3000.

---

## 10) Troubleshooting
- Port in use: pick a different host port, e.g., `-p 8081:3000`
- Permissions: ensure your bind-mounted folders are writable by Docker
- Stale UI after deploy: hard refresh to update the service worker cache

---

## 11) FAQs
- Q: If I cloned to `/home/neil/docker/oil-tracker`, do I need to store data there?
  - A: No, not required. If you use named volumes, Docker manages storage. If you prefer your path, use bind mounts:
    ```bash
    -v /home/neil/docker/oil-tracker/data:/app/data \
    -v /home/neil/docker/oil-tracker/uploads:/app/uploads
    ```
- Q: How do I change ports?
  - A: Change host port via `-p HOST:CONTAINER` (e.g., `-p 8080:3000`). To change the app’s internal port, add `-e PORT=XXXX` and map to that container port.

---

You can now build, run, and maintain the app with either named volumes or bind mounts depending on your preference for where to store data.
