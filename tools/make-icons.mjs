// Draws the app icons (assets/icons/*.png) with a headless Chromium: a yellow tuk-tuk on a sky square.
// Needs Playwright (a dev tool, not part of the game):  node tools/make-icons.mjs
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const html = `<canvas id=c></canvas><script>
function draw(size, maskable) {
  const c = document.getElementById('c'); c.width = c.height = size; const g = c.getContext('2d'); const u = size / 512;
  const sky = g.createLinearGradient(0, 0, 0, size); sky.addColorStop(0, '#79c3ea'); sky.addColorStop(1, '#d9ccb0');
  g.fillStyle = sky;
  if (maskable) g.fillRect(0, 0, size, size); else { g.beginPath(); g.roundRect(0, 0, size, size, 96 * u); g.fill(); }
  g.save(); g.translate(size / 2, size / 2); g.scale(maskable ? 0.74 : 0.9, maskable ? 0.74 : 0.9); g.translate(-size / 2, -size / 2);
  g.fillStyle = '#3b3b3b'; g.fillRect(70 * u, 372 * u, 372 * u, 14 * u);                       // road
  g.fillStyle = '#1f6b45'; g.beginPath(); g.roundRect(120 * u, 120 * u, 270 * u, 46 * u, 14 * u); g.fill();   // roof
  g.fillStyle = '#2a2a2a'; g.fillRect(138 * u, 164 * u, 14 * u, 110 * u); g.fillRect(366 * u, 164 * u, 14 * u, 110 * u);  // posts
  g.fillStyle = '#f2c230'; g.beginPath(); g.roundRect(120 * u, 262 * u, 280 * u, 92 * u, 26 * u); g.fill();   // body
  g.beginPath(); g.moveTo(400 * u, 262 * u); g.lineTo(446 * u, 322 * u); g.lineTo(446 * u, 354 * u); g.lineTo(400 * u, 354 * u); g.fill();   // nose
  g.fillStyle = '#d9a51f'; g.fillRect(120 * u, 330 * u, 280 * u, 24 * u);
  g.fillStyle = '#5a3422'; g.fillRect(170 * u, 222 * u, 150 * u, 50 * u);                      // seat
  g.fillStyle = '#1b1b1b'; for (const x of [172, 386]) { g.beginPath(); g.arc(x * u, 372 * u, 36 * u, 0, 7); g.fill(); }
  g.fillStyle = '#cfcfcf'; for (const x of [172, 386]) { g.beginPath(); g.arc(x * u, 372 * u, 14 * u, 0, 7); g.fill(); }
  g.restore();
  return c.toDataURL('image/png');
}
</script>`;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);
mkdirSync(new URL('../assets/icons/', import.meta.url), { recursive: true });
for (const [name, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true]]) {
  const url = await page.evaluate(([s, m]) => draw(s, m), [size, maskable]);
  writeFileSync(new URL(`../assets/icons/${name}`, import.meta.url), Buffer.from(url.split(',')[1], 'base64'));
  console.log('written', name);
}
await browser.close();
