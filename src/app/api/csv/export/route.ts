import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@/lib/db";
import { transactions, categories } from "@/lib/db/schema";
import { escapeCsvField } from "@/lib/format";
import { desc, eq, and, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getCurrentSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }

  const userId = session.user.id;
  const url = new URL(req.url);
  const yearParam = url.searchParams.get("year");

  const userCategories = db
    .select()
    .from(categories)
    .where(eq(categories.userId, userId))
    .all();

  const catMap = Object.fromEntries(userCategories.map((c) => [c.id, c.name]));

  const queryConditions = [eq(transactions.userId, userId)];
  if (yearParam && /^\d{4}$/.test(yearParam)) {
    queryConditions.push(sql`substr(${transactions.date}, 1, 4) = ${yearParam}`);
  }

  const rows = db
    .select()
    .from(transactions)
    .where(and(...queryConditions))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .all();

  const categoryParam = url.searchParams.get("category");
  const view = url.searchParams.get("view");

  // Auswertung: Summe je Kategorie (z. B. für die Steuererklärung)
  if (view === "categories") {
    const totals = new Map<string, { name: string; type: string; cents: number; count: number }>();
    for (const r of rows) {
      if (r.costType === "transfer") continue;
      if (r.isSplit) continue; // Split-Buchungen werden im Detail-Export aufgelöst
      const key = `${r.type}:${r.categoryId}`;
      const entry = totals.get(key) ?? {
        name: catMap[r.categoryId] || "Sonstiges",
        type: r.type === "income" ? "Einnahme" : "Ausgabe",
        cents: 0,
        count: 0,
      };
      entry.cents += r.amountCents;
      entry.count += 1;
      totals.set(key, entry);
    }
    const sumLines = [...totals.values()]
      .sort((a, b) => a.type.localeCompare(b.type) || b.cents - a.cents)
      .map((t) =>
        [
          escapeCsvField(t.type),
          escapeCsvField(t.name),
          escapeCsvField((t.cents / 100).toFixed(2).replace(".", ",")),
          escapeCsvField(String(t.count)),
        ].join(";")
      );
    const sumCsv = "\uFEFF" + [["Typ", "Kategorie", "Summe_EUR", "Anzahl"].join(";"), ...sumLines].join("\r\n");
    return new NextResponse(sumCsv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="cashflow-kategorien-${yearParam ?? "gesamt"}.csv"`,
      },
    });
  }

  const header = [
    "Datum",
    "Betrag_EUR",
    "Typ",
    "Kostenart",
    "Kategorie",
    "Beschreibung",
    "Zahlungsart",
  ].join(";");

  const lines = rows
    .filter((r) => !categoryParam || r.categoryId === categoryParam)
    .map((r) => {
    const euroFormatted = (r.amountCents / 100).toFixed(2).replace(".", ",");
    const typeLabel = r.type === "income" ? "Einnahme" : "Ausgabe";
    const costTypeLabel = r.costType === "fixed" ? "Fixkosten" : "Variabel";
    const categoryName = catMap[r.categoryId] || "Sonstiges";

    return [
      escapeCsvField(r.date),
      escapeCsvField(euroFormatted),
      escapeCsvField(typeLabel),
      escapeCsvField(costTypeLabel),
      escapeCsvField(categoryName),
      escapeCsvField(r.description),
      escapeCsvField(r.paymentMethod),
    ].join(";");
  });

  const csvContent = "\uFEFF" + [header, ...lines].join("\r\n");
  const today = new Date().toISOString().slice(0, 10);
  const filename = yearParam ? `cashflow-export-${yearParam}.csv` : `cashflow-export-${today}.csv`;

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
