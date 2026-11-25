import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { readAutoBackupAsSqlite } from "@/lib/backup-scheduler";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/backup/auto/<name> – lädt eine automatische Sicherung als
 * .sqlite-Datei herunter (nur Administratoren). Die Datei kann direkt über
 * „Backup wiederherstellen“ eingespielt werden.
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ name: string }> }
) {
  const session = await getCurrentSession();
  const user = session?.user as { id: string; role?: string } | undefined;
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 403 });
  }

  const { name } = await context.params;
  try {
    const data = readAutoBackupAsSqlite(name);
    logAudit({ action: "admin.backup.download", actorId: user.id, target: name });
    const fileName = name.replace(/\.gz(\.enc)?$/, "");
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(data.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error)?.message || "Sicherung nicht gefunden." },
      { status: 404 }
    );
  }
}
