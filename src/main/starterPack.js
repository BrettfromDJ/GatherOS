// Starter pack — six cards installed into a "Welcome" bucket on the
// user's very first launch.
//
// Two sources, in priority order:
//   1. Real image files dropped into src/main/assets/welcome/ —
//      iterated alphabetically. Filename (minus extension) becomes
//      the save title, so name them e.g. "01 Sunrise.jpg" /
//      "02 Wave.png" if you want a deterministic order.
//   2. Bundled procedural SVGs below — used as a fallback so a clone
//      with no welcome assets still ships a populated first-run.
//
// Either way the saves go through the standard saveImageFromBuffer
// pipeline (palette extraction, thumbnail, fresh-shimmer flag).

const fs = require('node:fs');
const path = require('node:path');

const ASSETS_DIR = path.join(__dirname, 'assets', 'welcome');
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp']);

function titleFromFilename(filename) {
  // "01 sunrise.jpg" → "Sunrise"; "ocean-wave.PNG" → "Ocean Wave".
  // Strip a leading numeric/whitespace prefix so users can sort with
  // "01-foo.jpg" without that ordinal leaking into the title.
  const base = filename.slice(0, filename.lastIndexOf('.')) || filename;
  const stripped = base.replace(/^[\s_\-0-9]+/, '');
  const cleaned = stripped.replace(/[-_]+/g, ' ').trim();
  if (!cleaned) return base;
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

function readFileCards() {
  let entries = [];
  try {
    entries = fs.readdirSync(ASSETS_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((name) => IMAGE_EXTS.has(path.extname(name).toLowerCase()))
    .sort()
    .map((name) => {
      const ext = path.extname(name).slice(1).toLowerCase();
      return {
        title: titleFromFilename(name),
        ext: ext === 'jpeg' ? 'jpg' : ext,
        buffer: fs.readFileSync(path.join(ASSETS_DIR, name)),
      };
    });
}

const STARTER_CARDS = [
  {
    title: 'Sunrise',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900">
  <defs>
    <radialGradient id="sky" cx="50%" cy="68%" r="78%">
      <stop offset="0%"  stop-color="#fff5b8"/>
      <stop offset="22%" stop-color="#ffd56b"/>
      <stop offset="44%" stop-color="#ff7e5f"/>
      <stop offset="72%" stop-color="#7c4584"/>
      <stop offset="100%" stop-color="#1a1147"/>
    </radialGradient>
    <radialGradient id="halo" cx="50%" cy="68%" r="22%">
      <stop offset="0%"   stop-color="#fff8d4" stop-opacity="1"/>
      <stop offset="100%" stop-color="#fff8d4" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="900" fill="url(#sky)"/>
  <circle cx="600" cy="612" r="280" fill="url(#halo)"/>
  <circle cx="600" cy="612" r="120" fill="#fff8d4"/>
  <g fill="#0a0823" opacity="0.55">
    <path d="M0 780 L160 720 L320 760 L460 700 L640 740 L820 690 L1000 730 L1200 700 L1200 900 L0 900 Z"/>
  </g>
</svg>`,
  },

  {
    title: 'Wave',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900">
  <defs>
    <linearGradient id="ocean" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"  stop-color="#a8edea"/>
      <stop offset="55%" stop-color="#5ac8fa"/>
      <stop offset="100%" stop-color="#0a3d80"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="900" fill="url(#ocean)"/>
  <path d="M0 520 Q300 420 600 520 T1200 520 V900 H0 Z" fill="#0a84ff" opacity="0.55"/>
  <path d="M0 620 Q300 540 600 620 T1200 620 V900 H0 Z" fill="#003d80" opacity="0.55"/>
  <path d="M0 720 Q300 660 600 720 T1200 720 V900 H0 Z" fill="#001a40" opacity="0.7"/>
  <g fill="#ffffff" opacity="0.55">
    <circle cx="180" cy="510" r="3"/>
    <circle cx="340" cy="475" r="2.5"/>
    <circle cx="520" cy="500" r="3"/>
    <circle cx="730" cy="465" r="2"/>
    <circle cx="900" cy="495" r="3"/>
    <circle cx="1060" cy="470" r="2.5"/>
  </g>
</svg>`,
  },

  {
    title: 'Garden',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900">
  <rect width="1200" height="900" fill="#f3eddc"/>
  <g fill="#3d8b40" opacity="0.85">
    <path d="M120 640 Q220 420 360 540 Q300 740 120 640 Z"/>
    <path d="M820 180 Q940 80 1060 240 Q940 360 820 180 Z"/>
    <path d="M460 780 Q620 680 700 840 Q540 900 460 780 Z"/>
  </g>
  <g fill="#85b66a" opacity="0.9">
    <path d="M80 200 Q200 40 320 200 Q200 360 80 200 Z"/>
    <path d="M880 580 Q1040 480 1120 700 Q960 820 880 580 Z"/>
    <path d="M540 320 Q620 220 720 320 Q620 420 540 320 Z"/>
  </g>
  <g fill="#cfe2a3">
    <circle cx="600" cy="450" r="56"/>
    <circle cx="430" cy="200" r="36"/>
    <circle cx="980" cy="430" r="44"/>
    <circle cx="240" cy="780" r="40"/>
  </g>
  <g fill="#ffd56b">
    <circle cx="600" cy="450" r="22"/>
    <circle cx="430" cy="200" r="14"/>
    <circle cx="980" cy="430" r="17"/>
  </g>
</svg>`,
  },

  {
    title: 'Citrus',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900">
  <rect width="1200" height="900" fill="#fff5d6"/>
  <g>
    <circle cx="200" cy="200" r="120" fill="#ff9500"/>
    <circle cx="600" cy="200" r="120" fill="#ffcc00"/>
    <circle cx="1000" cy="200" r="120" fill="#ff6b35"/>
    <circle cx="200" cy="500" r="120" fill="#ffcc00"/>
    <circle cx="600" cy="500" r="120" fill="#ff6b35"/>
    <circle cx="1000" cy="500" r="120" fill="#ff9500"/>
    <circle cx="200" cy="800" r="120" fill="#ff6b35"/>
    <circle cx="600" cy="800" r="120" fill="#ff9500"/>
    <circle cx="1000" cy="800" r="120" fill="#ffcc00"/>
  </g>
  <g fill="#ffffff" opacity="0.42">
    <ellipse cx="170" cy="170" rx="36" ry="22"/>
    <ellipse cx="570" cy="170" rx="36" ry="22"/>
    <ellipse cx="970" cy="170" rx="36" ry="22"/>
    <ellipse cx="170" cy="470" rx="36" ry="22"/>
    <ellipse cx="570" cy="470" rx="36" ry="22"/>
    <ellipse cx="970" cy="470" rx="36" ry="22"/>
    <ellipse cx="170" cy="770" rx="36" ry="22"/>
    <ellipse cx="570" cy="770" rx="36" ry="22"/>
    <ellipse cx="970" cy="770" rx="36" ry="22"/>
  </g>
</svg>`,
  },

  {
    title: 'Display Serif',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900">
  <rect width="1200" height="900" fill="#ebe5d2"/>
  <g font-family="Georgia, 'Times New Roman', serif">
    <text x="80" y="120" font-size="32" fill="#6b6552">Display Serif</text>
    <text x="80" y="158" font-size="20" fill="#9a9379">Regular · 640pt</text>
    <line x1="80" y1="180" x2="240" y2="180" stroke="#6b6552" stroke-width="2"/>
    <text x="600" y="700" text-anchor="middle" font-size="640" font-style="italic" fill="#2c2820">Aa</text>
    <text x="1080" y="858" text-anchor="end" font-size="20" fill="#9a9379">A · a · 1 · 2</text>
  </g>
</svg>`,
  },

  {
    title: 'Palette',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900">
  <rect width="1200" height="900" fill="#fafaf9"/>
  <g>
    <rect x="0"    y="0" width="200" height="900" fill="#af52de"/>
    <rect x="200"  y="0" width="200" height="900" fill="#0a84ff"/>
    <rect x="400"  y="0" width="200" height="900" fill="#34c759"/>
    <rect x="600"  y="0" width="200" height="900" fill="#ffcc00"/>
    <rect x="800"  y="0" width="200" height="900" fill="#ff9500"/>
    <rect x="1000" y="0" width="200" height="900" fill="#ff3b30"/>
  </g>
  <g font-family="ui-monospace, 'SF Mono', Menlo, monospace" font-size="22" letter-spacing="0.05em">
    <text x="100"  y="850" text-anchor="middle" fill="#fff">#AF52DE</text>
    <text x="300"  y="850" text-anchor="middle" fill="#fff">#0A84FF</text>
    <text x="500"  y="850" text-anchor="middle" fill="#fff">#34C759</text>
    <text x="700"  y="850" text-anchor="middle" fill="#2c2820">#FFCC00</text>
    <text x="900"  y="850" text-anchor="middle" fill="#fff">#FF9500</text>
    <text x="1100" y="850" text-anchor="middle" fill="#fff">#FF3B30</text>
  </g>
</svg>`,
  },
];

// Renders a single SVG → 1200×900 PNG buffer via sharp. Density of
// 144 gives crisp text without ballooning the file size — sharp's
// SVG renderer otherwise rasterizes at 1× viewBox dimensions.
async function rasterize(svg) {
  const sharp = require('sharp');
  return sharp(Buffer.from(svg), { density: 144 })
    .resize(1200, 900, { fit: 'inside' })
    .png()
    .toBuffer();
}

// Returns an array of { title, buffer, ext } ready to feed through
// the existing saveImageFromBuffer / insertSave pipeline. Prefers
// real files in src/main/assets/welcome/ over the procedural SVGs.
async function buildStarterPack() {
  const fileCards = readFileCards();
  if (fileCards.length > 0) return fileCards;

  const out = [];
  for (const card of STARTER_CARDS) {
    out.push({
      title: card.title,
      ext: 'png',
      buffer: await rasterize(card.svg),
    });
  }
  return out;
}

module.exports = { buildStarterPack };

