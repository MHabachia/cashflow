import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { sqlite } from "@/lib/db";
import { MAX_RESTORE_BYTES, stageRestore } from "@/lib/db/restore";
import { logAudit } from "@/lib/audit";
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

    // Sicherer temporärer Pfad für das SQLite-Backup
    const tempFile = path.join(
      os.tmpdir(),
      `cashflow-backup-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
    );

    // Erstellt einen 100% konsistenten Snapshot auch bei parallelen Schreibzugriffen
    await sqlite.backup(tempFile);

    const fileBuffer = fs.readFileSync(tempFile);
    fs.unlinkSync(tempFile);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const filename = `cashflow-backup-${dateStr}-${timeStr}.sqlite`;

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": fileBuffer.length.toString(),
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: (err as Error)?.message || "Fehler beim Erstellen des Backups" },
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
      { error: (err as Error)?.message || "Wiederherstellung fehlgeschlagen" },
      { status: 500 }
    );
  }
}
