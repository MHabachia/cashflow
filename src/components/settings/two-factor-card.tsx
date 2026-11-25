"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import QRCode from "qrcode";
import {
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Copy,
  Check,
  Loader2,
  X,
} from "lucide-react";
import { toast } from "sonner";

export function TwoFactorCard({
  initialEnabled,
}: {
  initialEnabled: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [step, setStep] = useState<"idle" | "setup" | "disable">("idle");
  const [password, setPassword] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verifyCode, setVerifyCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);

  async function handleStartEnable(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await authClient.twoFactor.enable({
        password,
      });

      if (error || !data || !("totpURI" in data) || !data.totpURI) {
        toast.error(
          error?.message || "Passwort ungültig oder 2FA konnte nicht gestartet werden."
        );
        setLoading(false);
        return;
      }

      const qrUrl = await QRCode.toDataURL(data.totpURI, {
        width: 220,
        margin: 1,
      });
      setQrDataUrl(qrUrl);
      setTotpUri(data.totpURI);
      setBackupCodes(data.backupCodes || []);
      setPassword("");
      setStep("setup");
    } catch {
      toast.error("Fehler beim Einrichten von 2FA.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyTotp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({
        code: verifyCode.trim(),
      });

      if (error) {
        toast.error(error.message || "Ungültiger 6-stelliger Code.");
        setLoading(false);
        return;
      }

      setEnabled(true);
      setStep("idle");
      setVerifyCode("");
      toast.success("Zwei-Faktor-Authentifizierung (2FA) ist jetzt aktiv!");
      router.refresh();
    } catch {
      toast.error("Verifizierung fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await authClient.twoFactor.disable({
        password,
      });

      if (error) {
        toast.error(error.message || "Passwort falsch.");
        setLoading(false);
        return;
      }

      setEnabled(false);
      setStep("idle");
      setPassword("");
      toast.success("2FA wurde deaktiviert.");
      router.refresh();
    } catch {
      toast.error("Fehler beim Deaktivieren von 2FA.");
    } finally {
      setLoading(false);
    }
  }

  function copyAllBackupCodes() {
    navigator.clipboard.writeText(backupCodes.join("\n"));
    setCopiedCodes(true);
    toast.success("Backup-Codes in Zwischenablage kopiert!");
    setTimeout(() => setCopiedCodes(false), 2000);
  }

  return (
    <div className="space-y-4 pb-6 border-b border-zinc-200/80 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {enabled ? (
            <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          )}
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-base">
                Zwei-Faktor-Authentifizierung (2FA / TOTP)
              </h2>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                  enabled
                    ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                }`}
              >
                {enabled ? "Aktiv" : "Deaktiviert"}
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Schütze dein Konto mit einer Authenticator-App (Apple Passwörter,
              Google Authenticator, 1Password, Bitwarden).
            </p>
          </div>
        </div>
      </div>

      {/* Zustand: Idle */}
      {step === "idle" && !enabled && (
        <form onSubmit={handleStartEnable} className="flex flex-col sm:flex-row gap-2">
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Aktuelles Passwort zur Bestätigung"
            className="flex-1 px-3.5 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <KeyRound className="w-4 h-4" />
            )}
            <span>2FA jetzt einrichten</span>
          </button>
        </form>
      )}

      {step === "idle" && enabled && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
            Dein Konto ist beim Login durch einen 6-stelligen TOTP-Code geschützt.
          </p>
          <button
            type="button"
            onClick={() => {
              setPassword("");
              setStep("disable");
            }}
            className="px-3 py-1.5 rounded-xl bg-red-500/10 text-red-600 text-xs font-semibold hover:bg-red-500/20 shrink-0"
          >
            2FA deaktivieren
          </button>
        </div>
      )}

      {/* Schritt: QR-Code scannen & verifizieren */}
      {step === "setup" && (
        <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-zinc-500">
              Schritt 1: QR-Code mit Authenticator-App scannen
            </h3>
            <button
              type="button"
              onClick={() => setStep("idle")}
              className="p-1 text-zinc-400"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-5">
            {qrDataUrl && (
              <div className="p-3 bg-white rounded-lg border border-zinc-200 shrink-0">
                <img
                  src={qrDataUrl}
                  alt="2FA QR Code"
                  className="w-44 h-44"
                />
              </div>
            )}

            <div className="space-y-3 flex-1 w-full">
              {backupCodes.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold">
                      Notfall-Backup-Codes (sicher aufbewahren!):
                    </span>
                    <button
                      type="button"
                      onClick={copyAllBackupCodes}
                      className="text-xs text-blue-600 dark:text-blue-400 font-semibold flex items-center gap-1"
                    >
                      {copiedCodes ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>Kopieren</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 tabular-nums text-xs">
                    {backupCodes.map((code) => (
                      <span key={code} className="text-center py-0.5">
                        {code}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {totpUri && (
                <details className="text-xs text-zinc-500">
                  <summary className="cursor-pointer font-medium">
                    Manuellen Einrichtungscode anzeigen
                  </summary>
                  <code className="block mt-1 p-2 rounded-lg bg-zinc-100 dark:bg-zinc-900 break-all text-xs">
                    {totpUri}
                  </code>
                </details>
              )}
            </div>
          </div>

          <form
            onSubmit={handleVerifyTotp}
            className="pt-3 border-t border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row gap-2"
          >
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
              placeholder="6-stelligen Code aus der App eingeben"
              className="flex-1 px-3.5 py-2 text-sm tabular-nums rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
            />
            <button
              type="submit"
              disabled={loading || verifyCode.length !== 6}
              className="px-4 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              <span>Code bestätigen & aktivieren</span>
            </button>
          </form>
        </div>
      )}

      {/* Schritt: 2FA deaktivieren */}
      {step === "disable" && (
        <form
          onSubmit={handleDisable}
          className="p-3.5 rounded-xl bg-red-500/5 border border-red-500/20 flex flex-col sm:flex-row gap-2"
        >
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Passwort zum Deaktivieren eingeben"
            className="flex-1 px-3.5 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
          >
            Jetzt deaktivieren
          </button>
          <button
            type="button"
            onClick={() => setStep("idle")}
            className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs font-medium"
          >
            Abbrechen
          </button>
        </form>
      )}
    </div>
  );
}
