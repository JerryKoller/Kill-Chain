# Kill Chain — Download Site

Share `Kill-Chain-Setup-1.0.0.exe` via a permanent public URL.

---

## Recommended: GitHub Pages + Releases (free, always on)

Best balance of free, reliable, and mobile-friendly. GitHub hosts the page on a CDN; the 77 MB installer lives on Releases (up to 2 GB per file).

### One-time setup (~10 minutes)

1. **Create a GitHub repo** (public), e.g. `kill-chain-download`

2. **Push only the site files** (not the EXE — it's in `.gitignore`):

   ```bash
   cd "Kill-Chain V1.0"
   git init
   git add index.html config.js .gitignore README.md server.js
   git commit -m "Add Kill Chain download page"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/kill-chain-download.git
   git push -u origin main
   ```

3. **Enable GitHub Pages**
   - Repo → **Settings** → **Pages**
   - Source: **Deploy from branch** → `main` → `/ (root)` → Save
   - Your page will be at: `https://YOUR_USERNAME.github.io/kill-chain-download/`

4. **Upload the installer as a Release**
   - Repo → **Releases** → **Create a new release**
   - Tag: `v1.0.0`
   - Attach `Kill-Chain-Setup-1.0.0.exe`
   - Publish

5. **Point the download button at the release**
   - Edit `config.js`:
     ```js
     window.DOWNLOAD_URL = "https://github.com/YOUR_USERNAME/kill-chain-download/releases/download/v1.0.0/Kill-Chain-Setup-1.0.0.exe";
     ```
   - Commit and push:
     ```bash
     git add config.js && git commit -m "Link download to release" && git push
     ```

**Share this URL:** `https://YOUR_USERNAME.github.io/kill-chain-download/`

---

## Other options

| Option | Cost | Stays up? | Mobile | Notes |
|--------|------|-----------|--------|-------|
| **GitHub Pages + Releases** | Free | Yes | Yes | **Best pick** — see above |
| **itch.io** | Free | Yes | Yes | Built for indie software; upload EXE + screenshots |
| **Cloudflare R2 + Pages** | ~Free* | Yes | Yes | R2 stores EXE; Pages hosts HTML. Slight setup. |
| **Render / Railway** | Free tier | Mostly | Yes | Web service with EXE bundled; free tier may sleep |
| **VPS** (Hetzner, DO) | ~$4–6/mo | Yes | Yes | Run `node server.js` with pm2; full control |
| **localtunnel / ngrok** | Free | No | Spotty | PC must stay on; bad on mobile |

\* Cloudflare R2: no egress fees through Cloudflare; storage is pennies/month for 77 MB.

### itch.io (quick alternative)

1. Create account at [itch.io](https://itch.io)
2. Create a new project → upload the EXE
3. Set pricing to free, publish
4. Share your itch page URL (e.g. `https://yourname.itch.io/kill-chain`)

No code needed; itch handles hosting and downloads.

### Cloudflare R2 (if you want your own domain later)

1. Create R2 bucket, upload the EXE, enable public access
2. Copy the public object URL
3. Put `index.html` on Cloudflare Pages, set `DOWNLOAD_URL` in `config.js` to the R2 URL

---

## Local testing

```bash
node server.js
```

Open http://localhost:3000

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | Download landing page |
| `config.js` | Download URL (change when deploying) |
| `Kill-Chain-Setup-1.0.0.exe` | Windows installer (upload to Releases, not git) |
| `server.js` | Local dev server only |
