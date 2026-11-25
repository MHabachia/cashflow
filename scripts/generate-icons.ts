import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

async function generateIcons() {
  const publicDir = path.resolve("./public");
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  // Option C: Moderne 3D-Glasmorphismus Wallet mit leuchtender Cashflow-Trendkurve
  const svgIcon = (size: number, maskable = false) => {
    const padding = maskable ? Math.round(size * 0.1) : 0;
    const inner = size - padding * 2;
    const radius = maskable ? 0 : Math.round(size * 0.225);

    return Buffer.from(`
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0f172a" />
            <stop offset="50%" stop-color="#1e3a8a" />
            <stop offset="100%" stop-color="#2563eb" />
          </linearGradient>
          <linearGradient id="cardBack" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#38bdf8" />
            <stop offset="100%" stop-color="#6366f1" />
          </linearGradient>
          <linearGradient id="walletGlass" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.26" />
            <stop offset="100%" stop-color="#ffffff" stop-opacity="0.10" />
          </linearGradient>
          <linearGradient id="flowLine" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#34d399" />
            <stop offset="100%" stop-color="#2dd4bf" />
          </linearGradient>
        </defs>

        <!-- App Icon Hintergrund -->
        <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" fill="url(#bg)" />

        <g transform="translate(${padding + inner * 0.13}, ${padding + inner * 0.14}) scale(${inner / 100})">
          <!-- Hintere 3D Kreditkarte (schräg herausragend) -->
          <rect x="10" y="4" width="54" height="34" rx="8" transform="rotate(-8 37 21)" fill="url(#cardBack)" opacity="0.92" />

          <!-- Vordere 3D Glasmorphismus Wallet -->
          <rect x="4" y="16" width="66" height="48" rx="12" fill="url(#walletGlass)" stroke="#ffffff" stroke-opacity="0.45" stroke-width="2.2" />

          <!-- Wallet Verschluss-Lasche rechts -->
          <rect x="52" y="32" width="22" height="16" rx="8" fill="#1d4ed8" stroke="#93c5fd" stroke-width="2" />
          <circle cx="60" cy="40" r="3" fill="#34d399" />

          <!-- Leuchtende Cashflow-Trendkurve auf der Wallet -->
          <path d="M 14 48 C 22 48, 24 34, 32 37 C 40 40, 42 25, 50 24" fill="none" stroke="url(#flowLine)" stroke-width="4.5" stroke-linecap="round" />
          <path d="M 44 21 L 51 23 L 48 30" fill="none" stroke="#2dd4bf" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
        </g>
      </svg>
    `);
  };

  await sharp(svgIcon(180)).png().toFile(path.join(publicDir, "apple-touch-icon.png"));
  await sharp(svgIcon(192)).png().toFile(path.join(publicDir, "icon-192.png"));
  await sharp(svgIcon(512)).png().toFile(path.join(publicDir, "icon-512.png"));
  await sharp(svgIcon(512, true)).png().toFile(path.join(publicDir, "icon-512-maskable.png"));
  await sharp(svgIcon(64)).png().toFile(path.join(publicDir, "favicon.png"));

  console.log("Neues Cashflow 3D-Glasmorphismus-Wallet Icon erfolgreich in /public generiert.");
}

generateIcons().catch((err) => {
  console.error(err);
  process.exit(1);
});
