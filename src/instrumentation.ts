export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { processAllUsersDueRecurringExpenses } = await import(
      "@/lib/recurring-processor"
    );
    const { withJobLock } = await import("@/lib/job-lock");
    const { pruneAuditLog } = await import("@/lib/audit");
    const { runAutoBackup } = await import("@/lib/backup-scheduler");
    const { snapshotAllUsers } = await import("@/lib/forecast");
    const { runNotificationChecks } = await import("@/lib/notifications");

    // Fällige Fixkosten buchen und alte Audit-Einträge aufräumen.
    // Die DB-Sperre verhindert parallele Läufe mehrerer Prozesse.
    const runMaintenance = async () => {
      try {
        await withJobLock("recurring-and-maintenance", 10 * 60 * 1000, () => {
          processAllUsersDueRecurringExpenses();
          pruneAuditLog();
          snapshotAllUsers();
        });
      } catch {
        // Ignorieren bei temporärem DB-Lock oder während der Build-Phase
      }
      try {
        await withJobLock("notifications", 10 * 60 * 1000, () => runNotificationChecks());
      } catch (err) {
        console.warn("[Benachrichtigungen] Prüfung fehlgeschlagen:", err);
      }
      try {
        // Automatische Sicherung (prüft selbst, ob das Intervall erreicht ist)
        await withJobLock("auto-backup", 30 * 60 * 1000, () => runAutoBackup());
      } catch (err) {
        console.error("[Backup] Automatische Sicherung fehlgeschlagen:", err);
      }
    };

    // Beim Serverstart einmalig, danach alle 15 Minuten
    await runMaintenance();
    const timer = setInterval(runMaintenance, 15 * 60 * 1000);
    if (typeof timer.unref === "function") {
      timer.unref();
    }

    // Automatischer Hintergrund-Worker für Bank-Synchronisation
    try {
      const { startBankSyncScheduler } = await import(
        "@/lib/bank-sync/scheduler"
      );
      startBankSyncScheduler();
    } catch {
      // Ignorieren während Build-Phase
    }
  }
}
