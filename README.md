# StreamPulse - Next-Gen Modern IPTV Web Player & Stream Engine

A high-performance, modern web application for watching free-to-air IPTV, live sports, and multi-source TV streams with zero CORS restrictions, automated geo-bypass, multi-server failover, and real-time stream health monitoring.

Live Demo: https://mddaf.github.io/Streaming/

---

## 🚀 Key Features

- **Multi-Source M3U/M3U8 Merging**: Aggregates multiple remote and local playlists into a unified channel catalog. Channels that exist across multiple providers are merged with clickable on-screen server buttons (`S1`, `S2`, `S3`).
- **Live Stream Health Monitoring**: Channels show real-time availability badges before clicking:
  - 🟢 **Live** (Verified video stream)
  - 🔗 **Dead (404)** (Provider link expired / rotated)
  - 🌍 **Geo (403)** (Restricted to domestic broadcast region)
  - 🔴 **Offline** (Connection timed out or host unreachable)
- **CORS & Geo-Bypass Proxy Engine**: Cloudflare Worker reverse-proxy (`sports-proxy.md-daf001.workers.dev`) strips CORS restrictions, rewrites child HLS segments dynamically, anonymizes IP headers, and emulates media players (VLC) to prevent blocking.
- **Local ISP / BDIX Server Integration (`http://172.16.15.5/`)**: Automatically extracts and plays all 77 live channels directly from your local ISP FTV server with ultra-low latency, zero buffering, and automated token self-healing.
- **⚡ Local BDIX & FTP Media Hub**: Discovered and cataloged local ISP media clusters (`172.16.50.4`, `10.1.1.1`) and popular high-speed BDIX FTP servers (CircleFTP, SunPlex, FastPlex, MathaNosto, AmaderFTP, etc.) directly in the app.
- **Smart Automated Extractor (`clean_iptv_extractor.js`)**: Scans any [iptv-org](https://github.com/iptv-org/iptv) playlist, concurrent tests all streams, discards dead/broken 404 links, and exports a 100% verified, clean `.m3u` playlist!

---

## ⚡ Local BDIX & FTP Media Hub (`bdix_ftp_servers.json`)

The app includes an integrated **BDIX & FTP Hub** modal with instant search and category filtering for:
1. **Local LAN Servers (Zero-Buffer 1 Gbps)**:
   - **FTV Live TV**: `http://172.16.15.5/` (77 channels, T Sports, Sony Ten, Star Sports, etc.)
   - **FTPmedia.net**: `http://10.1.1.1/` (Local ISP gateway to media, TV & FTP)
   - **DhakaFlix Portal**: `http://172.16.50.4/`
   - **DhakaFlix-7**: `http://172.16.50.7/DHAKA-FLIX-7/` (English & Kolkata Bangla Movies)
   - **DhakaFlix-8**: `http://172.16.50.8/DHAKA-FLIX-8/` (PC Games & Software)
   - **DhakaFlix-10**: `http://172.16.50.10/DHAKA-FLIX-10/` (Anime, Cartoons, Documentaries & WWE)
   - **DhakaFlix-12**: `http://172.16.50.12/DHAKA-FLIX-12/` (TV & Web Series)
   - **DhakaFlix-14**: `http://172.16.50.14/DHAKA-FLIX-14/` (1080p Movies & South/Korean Series)
2. **Top BDIX FTP & Streaming Servers (Verified Active)**:
   - **CircleFTP**: `https://circleftp.net/`
   - **SunPlex Media**: `https://sunplex.net/`
   - **FastPlex Server**: `https://fastplex.net/`
   - **MathaNosto FTP**: `http://mathanosto.top/`
   - **AmaderFTP**: `http://amaderftp.net/`
   - **FlixHub Streaming**: `https://flixhub.net/`
   - **MovieBox BD**: `http://movieboxbd.com/`
   - **MyMovieBazar**: `https://mymoviebazar.net/`
   - **MovieMaja**: `http://moviemaja.net/`
   - **PollyFlix**: `http://pollyflix.com/`
   - **Dhaka Download**: `http://www.dhakadownload.com/`
   - **CineFlix BD**: `http://cineflixbd.xyz/`
   - **GeniousNet Downloads**: `http://downloads.geniousnet.com/`
   - **BossBD Live**: `http://bossbd.live/`
   - **CTG Hub**: `https://www.ctghub.com/`

---

## ⚡ Local BDIX / FTV Server Extractor (`http://172.16.15.5/`)

To extract or refresh all 77 channels directly from your local ISP FTV server:
```bash
node extract_ftv_channels.js
```
*Outputs: `ftv_channels.m3u` & `ftv_channels.json` (Includes TSports, Sony TEN 1-5, Star Sports 1-3 & Select HD, Somoy TV, Maasranga, Star Jalsha, Zee Bangla HD, etc.)*
* **Self-Healing Tokens**: When played in StreamPulse, expired tokens on `http://172.16.15.5/` are automatically refreshed on the fly.

---

## 🛠️ Automated iptv-org Stream Extractor

To extract and verify only working streams from [iptv-org](https://github.com/iptv-org/iptv):

### 1. Extract Working Bangladesh Channels:
```bash
node clean_iptv_extractor.js --country bd
```
*Outputs: `working_iptv_org_bd.m3u` (30+ verified live channels including Maasranga, ATN Bangla, Ekushey, RTV, Bangla Vision, etc.)*

### 2. Extract Working Live Sports Channels:
```bash
node clean_iptv_extractor.js --category sports --concurrency 15
```
*Outputs: `working_iptv_org_sports.m3u` (245+ verified live sports streams including Star Sports Select, Willow, WWE Network, Tennis Channel, Fox Sports, SporTV, etc.)*

### 3. Extract Working Channels for Any Country or Category:
```bash
# United States
node clean_iptv_extractor.js --country us

# India
node clean_iptv_extractor.js --country in

# News
node clean_iptv_extractor.js --category news

# Custom M3U URL
node clean_iptv_extractor.js --url https://example.com/playlist.m3u
```

---

## 🌐 Deploying the Cloudflare Worker Proxy

1. Open [Cloudflare Dashboard](https://dash.cloudflare.com/) -> **Workers & Pages**.
2. Select your worker (or create one, e.g. `sports-proxy`).
3. Click **Edit Code**.
4. Paste the contents of [`cloudflare_worker.js`](./cloudflare_worker.js) and click **Deploy**.
5. StreamPulse will automatically route through your worker to play any stream without CORS or mixed-content errors!

---

## 💻 Running Locally

```bash
# Start local development server
node -e "
const http = require('http');
const fs = require('fs');
const path = require('path');
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.m3u': 'audio/x-mpegurl',
  '.m3u8': 'application/vnd.apple.mpegurl'
};
http.createServer((req, res) => {
  let filePath = path.join(__dirname, req.url.split('?')[0]);
  if (filePath.endsWith(path.sep) || req.url === '/') filePath = path.join(filePath, 'index.html');
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not found'); }
    else {
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end(content);
    }
  });
}).listen(4173, () => console.log('Listening on http://localhost:4173'));
"
```
Open [http://localhost:4173](http://localhost:4173) in your browser.
