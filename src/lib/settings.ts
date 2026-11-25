import { db } from "@/lib/db";
import { appSettings, type PaymentMethod } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface GlobalAppSettings {
  id: string;
  appName: string;
  appSubtitle: string;
  primaryColor: string;
  allowOpenRegistration: boolean;
  defaultPaymentMethod: PaymentMethod;
  maxUploadSizeMb: number;
  customLogoPath: string | null;
  systemAnnouncement: string | null;
}

export function getGlobalAppSettings(): GlobalAppSettings {
  const row = db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, "global"))
    .get();

  if (!row) {
    return {
      id: "global",
      appName: "Cashflow",
      appSubtitle: "Fixkosten & Variable Ausgaben",
      primaryColor: "#2563eb",
      allowOpenRegistration: false,
      defaultPaymentMethod: "card",
      maxUploadSizeMb: 15,
      customLogoPath: null,
      systemAnnouncement: null,
    };
  }

  return {
    id: row.id,
    appName: row.appName,
    appSubtitle: row.appSubtitle,
    primaryColor: row.primaryColor,
    allowOpenRegistration: row.allowOpenRegistration,
    defaultPaymentMethod: row.defaultPaymentMethod,
    maxUploadSizeMb: row.maxUploadSizeMb,
    customLogoPath: row.customLogoPath ?? null,
    systemAnnouncement: row.systemAnnouncement,
  };
}
