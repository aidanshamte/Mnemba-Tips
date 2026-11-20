// Build every Mnemba Tips logo derivative from the approved master artwork.
//
//   npx --yes --package=sharp@0.34.4 node scripts/brand/build-logo-assets.mjs
//
// The master (brand/mnemba-tips-logo-master.png) is never modified. Derivatives are
// only trimmed, isolated, padded and resized — the artwork is not redrawn or recoloured.
// "On dark" variants place the unmodified artwork on a light plate, because the navy
// wordmark has too little contrast on navy surfaces.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {delimiter, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const root = resolve(import.meta.dirname, '../..');
const master = resolve(root, 'brand/mnemba-tips-logo-master.png');
const out = resolve(root, 'public/brand');
const MASTER_SHA256 = '050067ce3a6731404fa195ede6886b32c5d774d7e71a6cc1dd7cb55ff3eb360b';

const entry = [process.env.SHARP_MODULE, ...(process.env.PATH ?? '').split(delimiter).map(p => resolve(p, '../sharp/lib/index.js'))].filter(Boolean).find(existsSync);
if (!entry) throw new Error('sharp is not available. Run with: npx --yes --package=sharp@0.34.4 node scripts/brand/build-logo-assets.mjs');
const {default: sharp} = await import(pathToFileURL(entry).href);

const bytes = readFileSync(master);
const sha = createHash('sha256').update(bytes).digest('hex');
if (sha !== MASTER_SHA256) throw new Error(`Unexpected master checksum ${sha}`);
mkdirSync(out, {recursive: true});

const PLATE = '#f4f7f8'; // --mt-color-surface-page (light)
const {data, info} = await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject: true});
const W = info.width, H = info.height, A = (x, y) => data[(y * W + x) * 4 + 3];
const VISIBLE = 8;

function bbox(test) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (test(x, y)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return {x0, y0, x1, y1};
}

// 1. Full wordmark: trim transparent canvas, keep a small transparent margin.
const PAD = 6;
const full = bbox((x, y) => A(x, y) > VISIBLE);
const crop = {left: Math.max(0, full.x0 - PAD), top: Math.max(0, full.y0 - PAD)};
crop.width = Math.min(W, full.x1 + PAD + 1) - crop.left;
crop.height = Math.min(H, full.y1 + PAD + 1) - crop.top;
const wordmark = await sharp(bytes).extract(crop).png().toBuffer();

// 2. Compact emblem: the ball, "M", ribbons, arrow and target. The gold underline swoosh is a
// separate shape (not touching the emblem); it is masked out by flood-fill, the letters by column.
const swoosh = new Uint8Array(W * H);
{
  let seed = null;
  for (let y = 420; y < 600 && !seed; y++) if (A(1200, y) > 200) seed = [1200, y];
  if (!seed) throw new Error('Could not locate the underline swoosh');
  const stack = [seed]; swoosh[seed[1] * W + seed[0]] = 1;
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = ny * W + nx;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && !swoosh[k] && A(nx, ny) > VISIBLE) { swoosh[k] = 1; stack.push([nx, ny]); }
    }
  }
}
// Letters begin at the first column right of the emblem that has visible, non-swoosh pixels after a gap.
const LETTER_START = (() => {
  let gapAt = -1;
  for (let x = 560; x < 760; x++) {
    let any = false;
    for (let y = 0; y < H; y++) if (A(x, y) > VISIBLE && !swoosh[y * W + x]) { any = true; break; }
    if (!any && gapAt < 0) gapAt = x;
    if (any && gapAt >= 0) return x;
  }
  throw new Error('Could not separate the emblem from the wordmark');
})();
const emblemRaw = Buffer.from(data);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const k = y * W + x;
  if (x >= LETTER_START || swoosh[k] || (x > LETTER_START - 40 && y > 520 && A(x, y) <= VISIBLE)) emblemRaw[k * 4 + 3] = 0;
}
const eb = bbox((x, y) => x < LETTER_START && emblemRaw[(y * W + x) * 4 + 3] > VISIBLE);
const side = Math.max(eb.x1 - eb.x0 + 1, eb.y1 - eb.y0 + 1) + 2 * PAD;
const emblemTrim = await sharp(emblemRaw, {raw: {width: W, height: H, channels: 4}})
  .extract({left: eb.x0, top: eb.y0, width: eb.x1 - eb.x0 + 1, height: eb.y1 - eb.y0 + 1}).png().toBuffer();
const emblem = await sharp(emblemTrim).resize(side, side, {fit: 'contain', background: {r: 0, g: 0, b: 0, alpha: 0}}).png().toBuffer();

const written = [];
const save = async (name, pipeline) => { const buf = await pipeline.toBuffer(); writeFileSync(resolve(out, name), buf); const m = await sharp(buf).metadata(); written.push({name, width: m.width, height: m.height, bytes: buf.length}); return buf; };
const formats = (img, base) => [
  save(`${base}.avif`, img.clone().avif({quality: 62, effort: 6})),
  save(`${base}.webp`, img.clone().webp({quality: 88, alphaQuality: 100, effort: 6})),
  save(`${base}.png`, img.clone().png({compressionLevel: 9, palette: false})),
];

// Wordmark (light backgrounds): responsive widths for desktop rail, tablet and mobile headers.
for (const w of [240, 480, 960]) await Promise.all(formats(sharp(wordmark).resize({width: w}), `mnemba-tips-wordmark-${w}`));

// Wordmark for dark backgrounds: the unmodified artwork on a light rounded plate.
async function plate(buf, width, padX, padY, radius) {
  const m = await sharp(buf).resize({width: width - 2 * padX}).png().toBuffer();
  const mm = await sharp(m).metadata();
  const height = mm.height + 2 * padY;
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" fill="${PLATE}"/></svg>`);
  return sharp(svg).composite([{input: m, left: padX, top: padY}]);
}
await save('mnemba-tips-wordmark-on-dark-960.png', await plate(wordmark, 960, 48, 32, 32));

// Compact emblem.
for (const s of [64, 128, 256]) await Promise.all(formats(sharp(emblem).resize(s, s), `mnemba-tips-emblem-${s}`));

// Favicons and application icons.
const png = async (s, bg) => {
  if (!bg) return sharp(emblem).resize(s, s).png({compressionLevel: 9}).toBuffer();
  const inner = Math.round(s * bg.scale);
  const e = await sharp(emblem).resize(inner, inner).png().toBuffer();
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}"><rect width="${s}" height="${s}" rx="${bg.radius ?? 0}" fill="${PLATE}"/></svg>`);
  return sharp(svg).composite([{input: e, gravity: 'center'}]).png({compressionLevel: 9}).toBuffer();
};
const icoSizes = [16, 32, 48];
const icoImgs = await Promise.all(icoSizes.map(s => png(s)));
{
  const header = Buffer.alloc(6 + 16 * icoImgs.length); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoImgs.length, 4);
  let offset = header.length;
  icoImgs.forEach((img, i) => { const e = 6 + 16 * i; header.writeUInt8(icoSizes[i], e); header.writeUInt8(icoSizes[i], e + 1); header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6); header.writeUInt32LE(img.length, e + 8); header.writeUInt32LE(offset, e + 12); offset += img.length; });
  const ico = Buffer.concat([header, ...icoImgs]); writeFileSync(resolve(root, 'public/favicon.ico'), ico); written.push({name: '../favicon.ico', width: 48, height: 48, bytes: ico.length});
}
await save('favicon-32.png', sharp(await png(32)));
await save('icon-192.png', sharp(await png(192)));
await save('icon-512.png', sharp(await png(512)));
// Maskable: emblem inside the 80% safe zone on a light square. Apple touch: iOS fills transparency with black.
await save('icon-maskable-512.png', sharp(await png(512, {scale: 0.72})));
await save('apple-touch-icon.png', sharp(await png(180, {scale: 0.86})));

// Social sharing image (Open Graph / Twitter), 1200×630, artwork centred on the light page colour.
{
  const m = await sharp(wordmark).resize({width: 960}).png().toBuffer(), mm = await sharp(m).metadata();
  await save('mnemba-tips-social-1200x630.png', sharp({create: {width: 1200, height: 630, channels: 4, background: PLATE}}).composite([{input: m, left: 120, top: Math.round((630 - mm.height) / 2)}]).png({compressionLevel: 9}));
}

writeFileSync(resolve(root, 'brand/derivatives.json'), JSON.stringify({master: 'brand/mnemba-tips-logo-master.png', masterSha256: sha, masterSize: [W, H], wordmarkCrop: crop, emblemBox: eb, letterStart: LETTER_START, files: written}, null, 1) + '\n');
console.log(`master ${W}x${H} sha256 ${sha.slice(0, 16)}… wordmark ${crop.width}x${crop.height} emblem ${side}x${side}`);
for (const f of written) console.log(`${f.name.padEnd(42)} ${String(f.width).padStart(4)}x${String(f.height).padEnd(4)} ${(f.bytes / 1024).toFixed(1)} KB`);
