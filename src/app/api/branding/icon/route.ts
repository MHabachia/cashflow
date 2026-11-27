import { NextRequest, NextResponse } from "next/server";
import { getGlobalAppSettings } from "@/lib/settings";
import { requireAdmin } from "@/lib/session";
import { publicErrorMessage } from "@/lib/errors";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { checkDeclaredUploadSize } from "@/lib/upload-limits";

export const dynamic = "force-dynamic";

const MAX_ICON_BYTES = 10 * 1024 * 1024;

/**
 * Fertig gerenderte Icons. Der Endpunkt ist ohne Anmeldung erreichbar; ohne
 * Cache ließe sich sharp mit Dauerabrufen auslasten. Der Schlüssel enthält
 * Logo und Farbe, ein neues Branding erzeugt also automatisch neue Einträge.
 */
const iconCache = new Map<string, Buffer>();
const MAX_CACHED_ICONS = 100;

function cacheIcon(key: string, png: Buffer): Buffer {
  if (iconCache.size >= MAX_CACHED_ICONS) iconCache.clear();
  iconCache.set(key, png);
  return png;
}

function pngResponse(png: Buffer): NextResponse {
  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-cache, must-revalidate",
    },
  });
}

function buildDynamicSvgIcon(
  size: number,
  primaryColor: string,
  maskable = false
): Buffer {
  const padding = maskable ? Math.round(size * 0.1) : 0;
  const inner = size - padding * 2;
  const radius = maskable ? 0 : Math.round(size * 0.225);

  return Buffer.from(`
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0f172a" />
          <stop offset="100%" stop-color="${primaryColor}" />
        </linearGradient>
        <linearGradient id="cardBack" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#38bdf8" />
          <stop offset="100%" stop-color="${primaryColor}" />
        </linearGradient>
        <linearGradient id="walletGlass" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.28" />
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0.12" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" fill="url(#bg)" />
      <g transform="translate(${padding + inner * 0.13}, ${padding + inner * 0.14}) scale(${inner / 100})">
        <rect x="10" y="4" width="54" height="34" rx="8" transform="rotate(-8 37 21)" fill="url(#cardBack)" opacity="0.92" />
        <rect x="4" y="16" width="66" height="48" rx="12" fill="url(#walletGlass)" stroke="#ffffff" stroke-opacity="0.48" stroke-width="2.2" />
        <rect x="52" y="32" width="22" height="16" rx="8" fill="${primaryColor}" stroke="#ffffff" stroke-opacity="0.6" stroke-width="2" />
        <circle cx="60" cy="40" r="3" fill="#34d399" />
        <path d="M 14 48 C 22 48, 24 34, 32 37 C 40 40, 42 25, 50 24" fill="none" stroke="#34d399" stroke-width="4.8" stroke-linecap="round" />
        <path d="M 44 21 L 51 23 L 48 30" fill="none" stroke="#2dd4bf" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
      </g>
    </svg>
  `);
}

/**
 * Liefert das App-Icon / Favicon dynamisch in der gewünschten Größe (z. B. ?size=64, 180, 192, 512).
 * Falls der Admin ein eigenes Favicon/Logo hochgeladen hat, wird dieses skaliert ausgeliefert,
 * andernfalls das 3D-Glasmorphismus-Wallet-Icon in der aktuellen Branding-Akzentfarbe!
 */
export async function GET(req: NextRequest) {
  const settings = getGlobalAppSettings();
  const sizeParam = Number(req.nextUrl.searchParams.get("size")) || 192;
  const size = Math.min(Math.max(sizeParam, 32), 512);
  const maskable = req.nextUrl.searchParams.get("maskable") === "1";

  const uploadsRoot = path.resolve(process.env.UPLOADS_DIR || "./data/uploads");
  const primaryColor = settings.primaryColor || "#2563eb";
  const cacheKey = `${settings.customLogoPath ?? ""}|${primaryColor}|${size}|${maskable ? 1 : 0}`;
  const cached = iconCache.get(cacheKey);
  if (cached) return pngResponse(cached);

  if (settings.customLogoPath) {
    const customFile = path.join(
      uploadsRoot,
      "branding",
      path.basename(settings.customLogoPath)
    );
    if (fs.existsSync(customFile)) {
      const pngBuffer = await sharp(customFile)
        .resize(size, size, { fit: "cover" })
        .png()
        .toBuffer();
      return pngResponse(cacheIcon(cacheKey, pngBuffer));
    }
  }

  const svg = buildDynamicSvgIcon(size, primaryColor, maskable);
  const pngBuffer = await sharp(svg).png().toBuffer();
  return pngResponse(cacheIcon(cacheKey, pngBuffer));
}

/**
 * Erlaubt dem Administrator das Hochladen eines eigenen App-Logos / Favicons.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const sizeProblem = checkDeclaredUploadSize(req.headers, MAX_ICON_BYTES);
    if (sizeProblem) {
      return NextResponse.json({ error: sizeProblem.error }, { status: sizeProblem.status });
    }
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file || !file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Bitte eine gültige Bilddatei wählen." },
        { status: 400 }
      );
    }
    if (file.size > MAX_ICON_BYTES) {
      return NextResponse.json({ error: "Das Logo darf maximal 10 MB groß sein." }, { status: 413 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const image = sharp(buffer, { limitInputPixels: 6000 * 6000 });
    const meta = await image.metadata();
    if (!meta.format) {
      return NextResponse.json(
        { error: "Ungültiges Bildformat." },
        { status: 400 }
      );
    }

    const uploadsRoot = path.resolve(
      process.env.UPLOADS_DIR || "./data/uploads"
    );
    const brandingDir = path.join(uploadsRoot, "branding");
    if (!fs.existsSync(brandingDir)) {
      fs.mkdirSync(brandingDir, { recursive: true });
    }

    const filename = `custom_logo_${Date.now()}.png`;
    const fullPath = path.join(brandingDir, filename);

    await image
      .rotate()
      .resize(512, 512, { fit: "cover" })
      .png()
      .toFile(fullPath);

    db.update(appSettings)
      .set({
        customLogoPath: filename,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, "global"))
      .run();

    return NextResponse.json({
      success: true,
      customLogoPath: filename,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: publicErrorMessage(err, "Upload fehlgeschlagen.", "api/branding/icon"),
      },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    await requireAdmin();
    db.update(appSettings)
      .set({
        customLogoPath: null,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, "global"))
      .run();

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Zurücksetzen fehlgeschlagen." },
      { status: 500 }
    );
  }
}
