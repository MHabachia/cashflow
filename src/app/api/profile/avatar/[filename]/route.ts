import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ filename: string }> }
) {
  const session = await getCurrentSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const { filename } = await context.params;
  const safeFilename = path.basename(filename);

  // Nur das eigene Profilbild ausliefern (Admins dürfen alle sehen). Der
  // Dateiname allein ist kein ausreichendes Geheimnis.
  const isOwnAvatar = session.user.image === `/api/profile/avatar/${safeFilename}`;
  const isAdmin = (session.user as { role?: string }).role === "admin";
  if (!isOwnAvatar && !isAdmin) {
    return NextResponse.json({ error: "Profilbild nicht gefunden." }, { status: 404 });
  }

  const uploadsRoot = path.resolve(process.env.UPLOADS_DIR || "./data/uploads");
  const filePath = path.join(uploadsRoot, "avatars", safeFilename);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json(
      { error: "Profilbild nicht gefunden." },
      { status: 404 }
    );
  }

  const buffer = fs.readFileSync(filePath);
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
