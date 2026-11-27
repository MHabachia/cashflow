import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { getGlobalAppSettings } from "@/lib/settings";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  checkDeclaredUploadSize,
  directorySizeBytes,
  receiptsQuotaBytes,
} from "@/lib/upload-limits";

export const dynamic = "force-dynamic";

const ALLOWED_IMAGE_FORMATS = new Set([
  "jpeg",
  "jpg",
  "png",
  "webp",
  "heif",
  "avif",
  "gif",
]);

export async function POST(req: NextRequest) {
  const session = await getCurrentSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const settings = getGlobalAppSettings();
  const maxFileSize = (settings.maxUploadSizeMb || 15) * 1024 * 1024;

  const sizeProblem = checkDeclaredUploadSize(req.headers, maxFileSize);
  if (sizeProblem) {
    return NextResponse.json({ error: sizeProblem.error }, { status: sizeProblem.status });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "Keine Bilddatei übermittelt." },
        { status: 400 }
      );
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Nur Bilddateien sind erlaubt." },
        { status: 400 }
      );
    }

    if (file.size > maxFileSize) {
      return NextResponse.json(
        {
          error: `Datei ist zu groß (max. ${settings.maxUploadSizeMb} MB).`,
        },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Magic-Byte & Decompression-Bomb Schutz über sharp (max. 64 Megapixel)
    const image = sharp(buffer, { limitInputPixels: 8000 * 8000 });
    const metadata = await image.metadata();

    if (
      !metadata.format ||
      !ALLOWED_IMAGE_FORMATS.has(metadata.format.toLowerCase())
    ) {
      return NextResponse.json(
        { error: "Ungültiges oder nicht unterstütztes Bildformat." },
        { status: 400 }
      );
    }

    const uploadsRoot = path.resolve(
      process.env.UPLOADS_DIR || "./data/uploads"
    );
    const userDir = path.join(uploadsRoot, session.user.id);

    // Kontingent je Benutzer, damit niemand die Platte füllen kann.
    // Geprüft mit der Originalgröße; gespeichert wird das kleinere WebP.
    const quota = receiptsQuotaBytes();
    if (quota > 0 && directorySizeBytes(userDir) + file.size > quota) {
      return NextResponse.json(
        { error: "Der Speicherplatz für Belegfotos ist aufgebraucht. Bitte alte Belege löschen." },
        { status: 413 }
      );
    }

    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    const filename = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}.webp`;
    const fullPath = path.join(userDir, filename);

    await image
      .rotate()
      .resize({
        width: 1400,
        height: 1400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 78 })
      .toFile(fullPath);

    const relativePath = `${session.user.id}/${filename}`;

    return NextResponse.json({
      success: true,
      receiptPath: relativePath,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Fehler bei der Bildkomprimierung.",
      },
      { status: 500 }
    );
  }
}
