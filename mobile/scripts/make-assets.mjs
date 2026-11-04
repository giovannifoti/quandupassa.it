// Genera icone e splash screen di iOS e Android a partire dal logo vettoriale
// del sito (public/img/favicon.svg): segnaposto con autobus, colori del brand.
// Uso: npm run assets   (rigenera i PNG nei progetti nativi)
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('..', import.meta.url));
const BRAND = '#e8553a';
const WHITE = '#ffffff';

// Geometria del logo (viewBox 64×80), identica a public/img/favicon.svg.
const PIN = 'M32 2C15.4 2 2 15.1 2 31.5 2 52 32 78 32 78s30-26 30-46.5C62 15.1 48.6 2 32 2Z';
const BUS = '<rect x="16" y="14" width="32" height="33" rx="7"/><rect x="19" y="44" width="6" height="7" rx="2"/><rect x="39" y="44" width="6" height="7" rx="2"/>';
const GLASS = '<rect x="20.5" y="18.5" width="23" height="13" rx="3"/><circle cx="23.5" cy="39.5" r="2.6"/><circle cx="40.5" cy="39.5" r="2.6"/>';

// Logo "invertito" (come l'icona maskable del sito): pin bianco, autobus arancione.
function mark({ x, y, height, pin = WHITE, bus = BRAND, glass = WHITE }) {
  const scale = height / 80;
  return `<g transform="translate(${x} ${y}) scale(${scale})"><path fill="${pin}" d="${PIN}"/><g fill="${bus}">${BUS}</g><g fill="${glass}">${GLASS}</g></g>`;
}

function centeredMark(width, height, markHeight, options = {}) {
  const markWidth = markHeight * 64 / 80;
  return mark({ x: (width - markWidth) / 2, y: (height - markHeight) / 2, height: markHeight, ...options });
}

function svg(width, height, body, background = null) {
  const bg = background ? `<rect width="${width}" height="${height}" fill="${background}"/>` : '';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bg}${body}</svg>`);
}

async function png(file, buffer, { flatten = false } = {}) {
  const path = `${root}${file}`;
  await mkdir(dirname(path), { recursive: true });
  let image = sharp(buffer);
  // Le icone App Store non devono avere il canale alfa.
  if (flatten) image = image.flatten({ background: BRAND }).removeAlpha();
  await writeFile(path, await image.png({ compressionLevel: 9 }).toBuffer());
  console.log(`creato ${file}`);
}

/* ------------------------------------------------------------- sorgenti */

await png('resources/icon-1024.png', svg(1024, 1024, centeredMark(1024, 1024, 560), BRAND), { flatten: true });
await png('resources/splash-2732.png', svg(2732, 2732, centeredMark(2732, 2732, 520), BRAND), { flatten: true });

/* ------------------------------------------------------------- iOS */

await png('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', svg(1024, 1024, centeredMark(1024, 1024, 560), BRAND), { flatten: true });
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  await png(`ios/App/App/Assets.xcassets/Splash.imageset/${name}`, svg(2732, 2732, centeredMark(2732, 2732, 520), BRAND), { flatten: true });
}

/* ------------------------------------------------------------- Android */

const RES = 'android/app/src/main/res';
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

for (const [density, factor] of Object.entries(DENSITIES)) {
  // Icona legacy (48 dp) e rotonda.
  const legacy = Math.round(48 * factor);
  await png(`${RES}/mipmap-${density}/ic_launcher.png`, svg(legacy, legacy,
    `<rect width="${legacy}" height="${legacy}" rx="${legacy * 0.2}" fill="${BRAND}"/>${centeredMark(legacy, legacy, legacy * 0.6)}`));
  await png(`${RES}/mipmap-${density}/ic_launcher_round.png`, svg(legacy, legacy,
    `<circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}" fill="${BRAND}"/>${centeredMark(legacy, legacy, legacy * 0.56)}`));

  // Icona adattiva: livello di primo piano 108 dp, contenuto nella zona sicura (66 dp).
  const adaptive = Math.round(108 * factor);
  await png(`${RES}/mipmap-${density}/ic_launcher_foreground.png`, svg(adaptive, adaptive, centeredMark(adaptive, adaptive, adaptive * 0.5)));
  // Icona monocromatica (icone a tema di Android 13+): solo la sagoma.
  const m = centeredMark(adaptive, adaptive, adaptive * 0.5, { pin: WHITE, bus: 'black', glass: WHITE });
  await png(`${RES}/mipmap-${density}/ic_launcher_monochrome.png`, svg(adaptive, adaptive,
    `<defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${adaptive}" height="${adaptive}"><rect width="${adaptive}" height="${adaptive}" fill="black"/>${m}</mask></defs><rect width="${adaptive}" height="${adaptive}" fill="${WHITE}" mask="url(#m)"/>`));

  // Splash di Android 12+: icona su canvas di 288 dp (cerchio visibile 192 dp).
  const splashIcon = Math.round(288 * factor);
  await png(`${RES}/drawable-${density}/splash_icon.png`, svg(splashIcon, splashIcon, centeredMark(splashIcon, splashIcon, splashIcon * 0.42)));

  // Splash a tutto schermo per Android 11 e precedenti.
  const short = Math.round(320 * factor);
  const long = Math.round(480 * factor);
  await png(`${RES}/drawable-port-${density}/splash.png`, svg(short, long, centeredMark(short, long, short * 0.32), BRAND), { flatten: true });
  await png(`${RES}/drawable-land-${density}/splash.png`, svg(long, short, centeredMark(long, short, short * 0.32), BRAND), { flatten: true });
}
await png(`${RES}/drawable/splash.png`, svg(480, 320, centeredMark(480, 320, 110), BRAND), { flatten: true });
