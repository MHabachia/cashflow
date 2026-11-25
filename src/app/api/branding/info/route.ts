import { NextResponse } from "next/server";
import { getGlobalAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = getGlobalAppSettings();
  return NextResponse.json({
    appName: s.appName,
    appSubtitle: s.appSubtitle,
    primaryColor: s.primaryColor,
    customLogoPath: s.customLogoPath,
  });
}
