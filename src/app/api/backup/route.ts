import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { sqlite } from "@/lib/db";
import { MAX_RESTORE_BYTES, stageRestore } from "@/lib/db/restore";
import { logAudit } from "@/lib/audit";
import { publicErrorMessage } from "@/lib/errors";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const dbPath = path.resolve(process.env.DATABASE_PATH || "./data/app.db");

/**
 * GET /api/backup - Lädt einen ACID-konsistenten Snapshot der SQLite-Datenbank herunter (nur für Administratoren)
 */
export async function GET() {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Nicht autorisiert" }, { status: 403 });
    }

    logAudit({ action: "admin.backup.download", actorId: admin.id });

    // Eigenes Verzeichnis mit Rechten 0700: Die Kopie der gesamten Datenbank
    // ist für andere Benutzer des Systems nicht lesbar und wird immer entfernt
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cashflow-backup-"));
    let fileBuffer: Buffer;
    try {
      const tempFile = path.join(tempDir, "backup.sqlite");
      // Erstellt einen konsistenten Snapshot auch bei parallelen Schreibzugriffen
      await sqlite.backup(tempFile);
      fileBuffer = fs.readFileSync(tempFile);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const filename = `cashflow-backup-${dateStr}-${timeStr}.sqlite`;

    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": fileBuffer.length.toString(),
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: publicErrorMessage(err, "Fehler beim Erstellen des Backups.", "api/backup:get") },
      { status: 500 }
    );
  }
}

/**
 * POST /api/backup - Prüft eine hochgeladene SQLite-Sicherung und merkt sie zur
 * Wiederherstellung beim nächsten Neustart vor. Die laufende Datenbank wird
 * dabei nicht angefasst (siehe src/lib/db/restore.ts).
 */
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Nicht autorisiert" }, { status: 403 });
    }

    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > MAX_RESTORE_BYTES + 1024 * 1024) {
      return NextResponse.json({ error: "Die Sicherung ist zu groß." }, { status: 413 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Keine Datei hochgeladen" }, { status: 400 });
    }
    if (file.size > MAX_RESTORE_BYTES) {
      return NextResponse.json({ error: "Die Sicherung ist zu groß." }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = stageRestore(buffer, dbPath);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Sicherung ungültig." },
        { status: 400 }
      );
    }

    logAudit({
      action: "admin.backup.restore_staged",
      actorId: admin.id,
      details: { sizeBytes: buffer.length },
      headers: req.headers,
    });

    return NextResponse.json({
      success: true,
      restartRequired: true,
      message:
        "Sicherung geprüft und vorgemerkt. Starte die App bzw. den Container neu, um sie einzuspielen. Der aktuelle Stand wird dabei automatisch gesichert.",
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: publicErrorMessage(err, "Wiederherstellung fehlgeschlagen.", "api/backup:post") },
      { status: 500 }
    );
  }
}
