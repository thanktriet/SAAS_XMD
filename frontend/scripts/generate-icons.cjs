// Generate PWA icons from SVG
// Run: node scripts/generate-icons.cjs
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const SIZES = [72, 192, 512];
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'icons');

function generateIcon(size, maskable = false) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background
  const radius = maskable ? 0 : size * 0.125;
  ctx.fillStyle = '#1a56db';
  if (radius > 0) {
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, radius);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, size, size);
  }

  // Text "XMD"
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${size * 0.38}px Arial`;
  ctx.fillText('XMD', size / 2, size / 2);

  return canvas.toBuffer('image/png');
}

// Ensure output dir exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Generate standard icons
for (const size of SIZES) {
  const buf = generateIcon(size);
  fs.writeFileSync(path.join(OUTPUT_DIR, `icon-${size}.png`), buf);
  console.log(`✓ icon-${size}.png`);
}

// Generate maskable icon
const maskBuf = generateIcon(512, true);
fs.writeFileSync(path.join(OUTPUT_DIR, 'icon-maskable-512.png'), maskBuf);
console.log('✓ icon-maskable-512.png');

// Badge icon (small, for notification badge)
const badgeCanvas = createCanvas(72, 72);
const bctx = badgeCanvas.getContext('2d');
bctx.fillStyle = '#1a56db';
bctx.beginPath();
bctx.arc(36, 36, 36, 0, Math.PI * 2);
bctx.fill();
bctx.fillStyle = '#ffffff';
bctx.textAlign = 'center';
bctx.textBaseline = 'middle';
bctx.font = 'bold 28px Arial';
bctx.fillText('X', 36, 36);
fs.writeFileSync(path.join(OUTPUT_DIR, 'badge-72.png'), badgeCanvas.toBuffer('image/png'));
console.log('✓ badge-72.png');

console.log('\nDone! Icons generated in public/icons/');
