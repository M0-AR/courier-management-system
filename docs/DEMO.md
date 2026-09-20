# Demo media — how `docs/demo.{gif,mp4}` was made (and how to redo it)

Verified workflow (2026-09-20, Playwright 1.63 + ffmpeg 8.0). Follows the voted pattern: **GIF inline autoplay + MP4 full quality + poster thumbnail**, all under GitHub limits.

## Assets

| File | Spec | Limit | Status |
|---|---|---|---|
| `demo.gif` | 720 px wide, 12 fps, 15 s | ≤8 MB (ideal ≤5 MB) | ✅ 5.0 MB |
| `demo.mp4` | 1280×800 H.264 + AAC, 15 s | ≤10 MB | ✅ 1.2 MB |
| `demo-poster.jpg` | 1280×800 JPEG | ≤400 KB | ✅ 62 KB |
| `demo-*.png` | screenshots from live API | ≤1 MB each | ✅ 44–138 KB |

## Re-record (from repo root, stack must be up + seeded)

```bash
docker compose up -d --build
docker compose exec backend python -m app.seed_demo --yes

# 1. Record a real browser tour (dashboard → couriers → booking → track → pricing → revenue)
cat > /tmp/record-demo.js <<'JS'
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: '/tmp/demo-video/', size: { width: 1280, height: 800 } }
  });
  const page = await context.newPage();
  const base = 'http://localhost:8081';
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'All couriers' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Add courier', exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByRole('textbox', { name: 'Customer name' }).fill('Demo Walker');
  await page.getByRole('textbox', { name: 'Phone' }).fill('+15550001234');
  await page.getByRole('textbox', { name: 'Source' }).fill('Austin');
  await page.getByRole('textbox', { name: 'Destination' }).fill('Denver');
  await page.waitForTimeout(1200);
  await page.goto(base + '/?track=85', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Pricing' }).click();
  await page.waitForTimeout(600);
  await page.getByRole('textbox', { name: 'Weight in kg' }).fill('10');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Revenue' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.waitForTimeout(1500);
  await context.close();
  await browser.close();
  console.log('RECORDED');
})();
JS
mkdir -p /tmp/demo-video
NODE_PATH=$PWD/frontend/node_modules node /tmp/record-demo.js
```

```bash
# 2. WebM → compressed MP4 (H.264, faststart for streaming)
ffmpeg -y -i /tmp/demo-video/*.webm -vf "scale=1280:-1" \
  -c:v libx264 -crf 23 -preset medium -c:a aac -b:a 128k \
  -movflags +faststart /tmp/demo-full.mp4

# 3. Poster (first second)
ffmpeg -y -ss 00:00:01 -i /tmp/demo-full.mp4 -vframes 1 docs/demo-poster.jpg

# 4. GIF via palette (best quality/size — voted workflow)
ffmpeg -y -i /tmp/demo-full.mp4 -vf "fps=12,scale=720:-1:flags=lanczos,palettegen" /tmp/palette.png
ffmpeg -y -i /tmp/demo-full.mp4 -i /tmp/palette.png \
  -filter_complex "fps=12,scale=720:-1:flags=lanczos[x];[x][1:v]paletteuse" docs/demo.gif

cp /tmp/demo-full.mp4 docs/demo.mp4
ls -lh docs/demo.*
```

## Screenshots

Captured via Playwright MCP (`page.screenshot`) against the seeded stack, then copied to both locations (root for backward-compat, `docs/` canonical):

```bash
# dashboard / tracking (?track=85 — full 4-event history) / revenue / mobile (390px) / light theme
ls -lh docs-dashboard.png docs-tracking.png docs-revenue.png docs-mobile.png docs-dashboard-light.png
ls -lh docs/demo-*.png
```

## Publishing to GitHub (native player trick)

GitHub READMEs strip `<video>`/`<iframe>`. Two supported paths:

1. **Keep as-is:** GIF autoplays inline everywhere (GitHub, npm, mobile, offline). MP4 link works as download/preview. Zero setup.
2. **Native player (recommended after public push):** open any issue → drag `docs/demo.mp4` into a comment → GitHub uploads to `user-images.githubusercontent.com` → copy that URL → replace the `docs/demo.mp4` link in `README.md`. Keep the GIF as fallback.

Do **not** commit videos >25 MB, and never force-push full MP4s repeatedly — it bloats clones. Our files (1.2 + 5.0 MB) are within budget.
