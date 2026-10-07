const fs = require('fs');
const path = require('path');

const FTV_BASE = 'http://172.16.15.5';

(async () => {
  try {
    console.log(`Connecting to FTV server: ${FTV_BASE}...`);
    const pageRes = await fetch(`${FTV_BASE}/`);
    if (!pageRes.ok) throw new Error(`HTTP ${pageRes.status}`);
    const html = await pageRes.text();

    // Regex to match channel li items:
    // <li class="Bangla"><a onclick="view.location.href='play.php?stream=159'" class='channel flex-item'><img src="assets/images/Channel i1664976520.png" alt="Channel i"></a></li>
    const itemRegex = /<li\s+class=["']([^"']+)["'][^>]*>\s*<a\s+onclick=["'](?:view\.location\.href=)?['"]play\.php\?stream=([^'"]+)['"][^>]*>\s*<img\s+src=["']([^"']+)["']\s+alt=["']([^"']+)["']/gi;

    const channels = [];
    let match;
    while ((match = itemRegex.exec(html)) !== null) {
      const category = match[1].trim();
      const streamId = match[2].trim();
      let logo = match[3].trim();
      const name = match[4].trim();

      if (!logo.startsWith('http')) {
        logo = `${FTV_BASE}/${logo.replace(/^\//, '')}`;
      }

      channels.push({
        name,
        category,
        streamId,
        logo,
        playUrl: `${FTV_BASE}/play.php?stream=${encodeURIComponent(streamId)}`
      });
    }

    console.log(`Found ${channels.length} channels on FTV server!`);
    console.log('\nChannels by category:');
    const categories = {};
    channels.forEach(ch => {
      categories[ch.category] = (categories[ch.category] || 0) + 1;
    });
    console.table(categories);

    // Resolve M3U8 stream URL for each channel
    console.log(`\nResolving live M3U8 streams for each channel (fetching tokens)...`);
    const resolvedChannels = [];

    // Process in batches of 8
    const batchSize = 8;
    for (let i = 0; i < channels.length; i += batchSize) {
      const batch = channels.slice(i, i + batchSize);
      await Promise.all(batch.map(async (ch) => {
        try {
          const pRes = await fetch(ch.playUrl, { signal: AbortSignal.timeout(4000) });
          if (pRes.ok) {
            const pText = await pRes.text();
            const srcMatch = pText.match(/var videoSrc = ['"]([^'"]+)['"]/);
            if (srcMatch && srcMatch[1]) {
              ch.streamUrl = srcMatch[1];
              console.log(`  [✅] ${ch.name.padEnd(25)} -> ${ch.streamUrl.slice(0, 60)}...`);
            } else {
              ch.streamUrl = ch.playUrl;
              console.log(`  [⚠️] ${ch.name.padEnd(25)} -> No videoSrc (using web play)`);
            }
          }
        } catch (err) {
          ch.streamUrl = ch.playUrl;
          console.log(`  [❌] ${ch.name.padEnd(25)} -> Err: ${err.message}`);
        }
        resolvedChannels.push(ch);
      }));
    }

    // Save JSON database
    fs.writeFileSync(path.join(__dirname, 'ftv_channels.json'), JSON.stringify(resolvedChannels, null, 2), 'utf-8');

    // Generate M3U playlist file
    let m3u = `#EXTM3U name="FTV Local BDIX Live TV (172.16.15.5)"\n`;
    m3u += `# Source: http://172.16.15.5/ | Extracted on ${new Date().toISOString()}\n\n`;

    resolvedChannels.forEach(ch => {
      const streamTarget = ch.streamUrl || ch.playUrl;
      m3u += `#EXTINF:-1 tvg-id="${ch.streamId}" tvg-name="${ch.name}" tvg-logo="${ch.logo}" group-title="${ch.category}",${ch.name}\n`;
      m3u += `${streamTarget}\n\n`;
    });

    const m3uPath = path.join(__dirname, 'ftv_channels.m3u');
    fs.writeFileSync(m3uPath, m3u, 'utf-8');
    console.log(`\n🎉 Successfully generated:`);
    console.log(`  - ${m3uPath} (${resolvedChannels.length} channels)`);
    console.log(`  - ftv_channels.json`);

  } catch (err) {
    console.error('Error extracting FTV channels:', err.message);
  }
})();
