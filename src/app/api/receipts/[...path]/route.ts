import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

function resolveOwnedReceiptFile(
  sessionUserId: string,
  segments: string[] | undefined
): { error?: string; status?: number; filePath?: string } {
  if (!segments || segments.length !== 2) {
    return { error: "Ungültiger Pfad.", status: 400 };
  }

  const [ownerUserId, filename] = segments;

  if (ownerUserId !== sessionUserId) {
    return { error: "Zugriff verweigert.", status: 403 };
  }

  const safeFilename = path.basename(filename);
  const uploadsRoot = path.resolve(process.env.UPLOADS_DIR || "./data/uploads");
  const filePath = path.join(uploadsRoot, sessionUserId, safeFilename);

  return { filePath };
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const session = await getCurrentSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const { path: segments } = await context.params;
  const resolved = resolveOwnedReceiptFile(session.user.id, segments);

  if (resolved.error || !resolved.filePath) {
    return NextResponse.json(
      { error: resolved.error },
      { status: resolved.status || 400 }
    );
  }

  if (!fs.existsSync(resolved.filePath)) {
    return NextResponse.json(
      { error: "Beleg nicht gefunden." },
      { status: 404 }
    );
  }

  const fileBuffer = fs.readFileSync(resolved.filePath);

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

/**
 * Löscht ein temporär hochgeladenes Belegfoto wieder vom Server,
 * wenn der Benutzer das Formular abbricht oder das Foto vor dem Speichern entfernt.
 */
export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const session = await getCurrentSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const { path: segments } = await context.params;
  const resolved = resolveOwnedReceiptFile(session.user.id, segments);

  if (resolved.error || !resolved.filePath) {
    return NextResponse.json(
      { error: resolved.error },
      { status: resolved.status || 400 }
    );
  }

  if (fs.existsSync(resolved.filePath)) {
    fs.unlinkSync(resolved.filePath);
  }

  return NextResponse.json({ success: true });
}
