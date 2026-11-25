"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, BellOff, Loader2 } from "lucide-react";
import {
  getPushConfigAction,
  removePushSubscriptionAction,
  savePushSubscriptionAction,
  sendTestNotificationAction,
  updateNotificationSettingsAction,
} from "@/actions/notification-actions";

type Settings = {
  budgetAlerts: boolean;
  consentAlerts: boolean;
  largeTxAlerts: boolean;
  largeTxThresholdCents: number;
  inboxAlerts: boolean;
};

type Support = "checking" | "unsupported" | "ios-needs-install" | "supported";

function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const OPTIONS: Array<{ key: keyof Omit<Settings, "largeTxThresholdCents">; label: string }> = [
  { key: "budgetAlerts", label: "Budget zu 80 % / 100 % ausgeschöpft" },
  { key: "consentAlerts", label: "Bankzugriff läuft ab oder ist abgelaufen" },
  { key: "largeTxAlerts", label: "Hohe Abbuchung vom Bankkonto" },
  { key: "inboxAlerts", label: "Täglicher Hinweis auf ungeprüfte Umsätze" },
];

export function NotificationCard() {
  const [support, setSupport] = useState<Support>("checking");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setSupport(isIos && !standalone ? "ios-needs-install" : "unsupported");
        return;
      }
      setSupport("supported");
      const config = await getPushConfigAction();
      setPublicKey(config.publicKey);
      setSettings(config.settings);
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setSubscribed(Boolean(sub));
    })().catch(() => setSupport("unsupported"));
  }, []);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("Benachrichtigungen wurden im Browser nicht erlaubt.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicKey),
      });
      const res = await savePushSubscriptionAction(sub.toJSON());
      if (!res.success) {
        await sub.unsubscribe();
        toast.error(res.error || "Aktivieren fehlgeschlagen.");
        return;
      }
      setSubscribed(true);
      toast.success("Benachrichtigungen auf diesem Gerät aktiviert.");
    } catch {
      toast.error("Benachrichtigungen konnten nicht aktiviert werden.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscriptionAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast.success("Benachrichtigungen auf diesem Gerät deaktiviert.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    const res = await sendTestNotificationAction();
    setBusy(false);
    if (res.success) toast.success("Testbenachrichtigung gesendet.");
    else toast.error(res.error || "Senden fehlgeschlagen.");
  }

  async function saveSettings(next: Settings) {
    setSettings(next);
    const res = await updateNotificationSettingsAction(next);
    if (!res.success) toast.error(res.error || "Speichern fehlgeschlagen.");
  }

  return (
    <section aria-labelledby="notif-heading" className="space-y-4 pb-6 border-b border-zinc-200/80 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <Bell className="w-5 h-5 text-blue-600" aria-hidden="true" />
        <h2 id="notif-heading" className="font-bold text-base">
          Benachrichtigungen
        </h2>
      </div>

      {support === "checking" && <p className="text-xs text-zinc-500">Prüfe Unterstützung…</p>}
      {support === "unsupported" && (
        <p className="text-xs text-zinc-500">Dieser Browser unterstützt keine Push-Benachrichtigungen.</p>
      )}
      {support === "ios-needs-install" && (
        <p className="text-xs text-zinc-500">
          Auf iPhone und iPad funktionieren Benachrichtigungen nur, wenn die App über „Teilen → Zum
          Home-Bildschirm“ installiert und von dort geöffnet wird (ab iOS 16.4).
        </p>
      )}

      {support === "supported" && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            {subscribed ? (
              <>
                <button
                  type="button"
                  onClick={sendTest}
                  disabled={busy}
                  className="px-3 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold disabled:opacity-50"
                >
                  Testbenachrichtigung senden
                </button>
                <button
                  type="button"
                  onClick={disable}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold disabled:opacity-50"
                >
                  <BellOff className="w-3.5 h-3.5" aria-hidden="true" />
                  Auf diesem Gerät deaktivieren
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={enable}
                disabled={busy || !publicKey}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold disabled:opacity-50"
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                Auf diesem Gerät aktivieren
              </button>
            )}
          </div>

          {settings && (
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Worüber möchtest du informiert werden?
              </legend>
              {OPTIONS.map((opt) => (
                <label key={opt.key} className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={settings[opt.key]}
                    onChange={(e) => saveSettings({ ...settings, [opt.key]: e.target.checked })}
                  />
                  {opt.label}
                </label>
              ))}
              <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                Hohe Abbuchung ab
                <input
                  type="number"
                  min={10}
                  step={10}
                  value={Math.round(settings.largeTxThresholdCents / 100)}
                  onChange={(e) =>
                    setSettings({ ...settings, largeTxThresholdCents: Math.max(10, Number(e.target.value) || 10) * 100 })
                  }
                  onBlur={() => saveSettings(settings)}
                  className="w-24 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                  aria-label="Schwelle für hohe Abbuchungen in Euro"
                />
                €
              </label>
            </fieldset>
          )}
        </>
      )}
    </section>
  );
}
