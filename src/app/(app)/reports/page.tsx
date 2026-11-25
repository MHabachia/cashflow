import { requireUser } from "@/lib/session";
import { getAnnualReportData } from "@/lib/reports";
import { AnnualReportView } from "@/components/reports/annual-report-view";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const currentYear = new Date().getFullYear();
  const year = params.year ? parseInt(params.year, 10) || currentYear : currentYear;

  const reportData = getAnnualReportData(user.id, year);

  return <AnnualReportView data={reportData} />;
}
