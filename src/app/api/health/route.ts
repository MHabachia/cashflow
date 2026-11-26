import { NextResponse } from "next/server";
import { sqlite } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const row = sqlite.prepare("SELECT 1 as ok").get() as { ok: number };
    if (row?.ok !== 1) {
      throw new Error("SQLite Testabfrage fehlgeschlagen");
    }
    return NextResponse.json(
      {
        status: "ok",
        database: "connected",
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    // Details nur ins Log, der öffentliche Endpunkt gibt keine Interna preis
    console.error("[Health] Datenbankprüfung fehlgeschlagen:", error);
    return NextResponse.json(
      {
        status: "error",
        database: "unavailable",
      },
      { status: 500 }
    );
  }
}
