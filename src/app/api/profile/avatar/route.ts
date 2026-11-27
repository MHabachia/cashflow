import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { publicErrorMessage } from "@/lib/errors";
import { db } from "@/lib/db";
import { user as userTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { checkDeclaredUploadSize } from "@/lib/upload-limits";

export const dynamic = "force-dynamic";

const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

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

  const sizeProblem = checkDeclaredUploadSize(req.headers, MAX_AVATAR_BYTES);
  if (sizeProblem) {
    return NextResponse.json({ error: sizeProblem.error }, { status: sizeProblem.status });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file || !file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Bitte eine gültige Bilddatei wählen." },
        { status: 400 }
      );
    }

    if (file.size > MAX_AVATAR_BYTES) {
      return NextResponse.json(
        { error: "Profilbild darf maximal 10 MB groß sein." },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const image = sharp(buffer, { limitInputPixels: 6000 * 6000 });
    const metadata = await image.metadata();

    if (
      !metadata.format ||
      !ALLOWED_IMAGE_FORMATS.has(metadata.format.toLowerCase())
    ) {
      return NextResponse.json(
        { error: "Nicht unterstütztes Bildformat." },
        { status: 400 }
      );
    }

    const uploadsRoot = path.resolve(
      process.env.UPLOADS_DIR || "./data/uploads"
    );
    const avatarsDir = path.join(uploadsRoot, "avatars");
    if (!fs.existsSync(avatarsDir)) {
      fs.mkdirSync(avatarsDir, { recursive: true });
    }

    // Altes Profilbild des Benutzers löschen, falls vorhanden
    const currentUser = db
      .select({ image: userTable.image })
      .from(userTable)
      .where(eq(userTable.id, session.user.id))
      .get();

    if (currentUser?.image?.startsWith("/api/profile/avatar/")) {
      const oldFilename = path.basename(currentUser.image);
      const oldFullPath = path.join(avatarsDir, oldFilename);
      if (fs.existsSync(oldFullPath)) {
        try {
          fs.unlinkSync(oldFullPath);
        } catch {
          // Ignorieren
        }
      }
    }

    const filename = `${session.user.id}_${crypto.randomBytes(4).toString("hex")}.webp`;
    const fullPath = path.join(avatarsDir, filename);

    // Quadratischer 256x256 Avatar in WebP
    await image
      .rotate()
      .resize({
        width: 256,
        height: 256,
        fit: "cover",
        position: "centre",
      })
      .webp({ quality: 82 })
      .toFile(fullPath);

    const avatarUrl = `/api/profile/avatar/${filename}`;

    db.update(userTable)
      .set({
        image: avatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(userTable.id, session.user.id))
      .run();

    return NextResponse.json({
      success: true,
      avatarUrl,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: publicErrorMessage(err, "Fehler beim Verarbeiten des Profilbilds.", "api/profile/avatar"),
      },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  const session = await getCurrentSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const uploadsRoot = path.resolve(process.env.UPLOADS_DIR || "./data/uploads");
  const avatarsDir = path.join(uploadsRoot, "avatars");

  const currentUser = db
    .select({ image: userTable.image })
    .from(userTable)
    .where(eq(userTable.id, session.user.id))
    .get();

  if (currentUser?.image?.startsWith("/api/profile/avatar/")) {
    const oldFilename = path.basename(currentUser.image);
    const oldFullPath = path.join(avatarsDir, oldFilename);
    if (fs.existsSync(oldFullPath)) {
      try {
        fs.unlinkSync(oldFullPath);
      } catch {
        // Ignorieren
      }
    }
  }

  db.update(userTable)
    .set({
      image: null,
      updatedAt: new Date(),
    })
    .where(eq(userTable.id, session.user.id))
    .run();

  return NextResponse.json({ success: true });
}
