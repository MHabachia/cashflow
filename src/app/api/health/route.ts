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
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "Database error",
      },
      { status: 500 }
    );
  }
}
