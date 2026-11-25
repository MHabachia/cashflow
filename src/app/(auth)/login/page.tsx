"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { getBrandingAction } from "@/actions/auth-actions";
import { CashflowLogo } from "@/components/ui/cashflow-logo";
import {
  Lock,
  Mail,
  ArrowRight,
  Loader2,
  ShieldCheck,
  Fingerprint,
} from "lucide-react";
import { toast } from "sonner";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [branding, setBranding] = useState<{
    appName: string;
    appSubtitle: string;
    primaryColor: string;
    customLogoPath: string | null;
  }>({
    appName: "Cashflow",
    appSubtitle: "Fixkosten & Variable Ausgaben",
    primaryColor: "#2563eb",
    customLogoPath: null,
  });

  useEffect(() => {
    getBrandingAction()
      .then((data) => {
        if (data?.appName) setBranding(data);
      })
      .catch(() => {
        fetch("/api/branding/info")
          .then((r) => r.json())
          .then((data) => {
            if (data?.appName) setBranding(data);
          })
          .catch(() => {});
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        toast.error(
          error.message || "Anmeldung fehlgeschlagen. Bitte Zugangsdaten prüfen."
        );
        setLoading(false);
        return;
      }

      // Falls der Benutzer 2FA aktiviert hat -> 2FA-Eingabe anzeigen
      if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
        setNeedsTwoFactor(true);
        setLoading(false);
        return;
      }

      toast.success("Erfolgreich angemeldet!");
      router.push("/");
      router.refresh();
    } catch {
      toast.error("Netzwerkfehler bei der Anmeldung.");
      setLoading(false);
    }
  }

  async function handleVerifyTwoFactor(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = useBackupCode
        ? await authClient.twoFactor.verifyBackupCode({
            code: totpCode.trim(),
          })
        : await authClient.twoFactor.verifyTotp({
            code: totpCode.trim(),
            trustDevice: true,
          });

      if (error) {
        toast.error(error.message || "Ungültiger 2FA-Code.");
        setLoading(false);
        return;
      }

      toast.success("Erfolgreich mit 2FA angemeldet!");
      router.push("/");
      router.refresh();
    } catch {
      toast.error("Fehler bei der 2FA-Prüfung.");
      setLoading(false);
    }
  }

  async function handlePasskeySignIn() {
    setLoading(true);
    try {
      const res = await authClient.signIn.passkey();
      if (res?.error) {
        toast.error(
          res.error.message || "Passkey-Anmeldung fehlgeschlagen."
        );
        setLoading(false);
        return;
      }
      toast.success("Erfolgreich per Passkey angemeldet!");
      router.push("/");
      router.refresh();
    } catch {
      toast.error("Passkey-Anmeldung abgebrochen.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col justify-center px-5 py-10 pt-safe pb-safe max-w-md mx-auto">
      <div className="flex flex-col items-center text-center mb-8">
        <CashflowLogo
          className="w-16 h-16 shadow-xl rounded-lg mb-4"
          primaryColor={branding.primaryColor}
          customLogoPath={branding.customLogoPath}
        />
        <h1 className="text-2xl font-bold tracking-tight">
          {branding.appName}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          {branding.appSubtitle}
        </p>
      </div>

      {needsTwoFactor ? (
        <form
          action="javascript:void(0);"
          onSubmit={handleVerifyTwoFactor}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-6 space-y-4"
        >
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
            <ShieldCheck className="w-5 h-5" />
            <h2 className="font-bold text-base">
              Zwei-Faktor-Bestätigung (2FA)
            </h2>
          </div>
          <p className="text-xs text-zinc-500">
            {useBackupCode
              ? "Gib einen deiner Notfall-Backup-Codes ein."
              : "Gib den 6-stelligen Code aus deiner Authenticator-App ein."}
          </p>

          <input
            type="text"
            inputMode={useBackupCode ? "text" : "numeric"}
            required
            autoFocus
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value)}
            placeholder={useBackupCode ? "Backup-Code" : "000000"}
            className="w-full px-4 py-3 text-center text-xl tabular-nums rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 rounded-xl bg-brand text-white hover:opacity-90 font-semibold flex items-center justify-center gap-2 transition disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <span>Bestätigen & Anmelden</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <div className="flex items-center justify-between text-xs pt-1">
            <button
              type="button"
              onClick={() => {
                setUseBackupCode((v) => !v);
                setTotpCode("");
              }}
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              {useBackupCode
                ? "Authenticator-Code nutzen"
                : "Notfall-Backup-Code nutzen"}
            </button>
            <button
              type="button"
              onClick={() => {
                setNeedsTwoFactor(false);
                setTotpCode("");
              }}
              className="text-zinc-500 hover:underline"
            >
              Zurück
            </button>
          </div>
        </form>
      ) : (
        <form
          action="javascript:void(0);"
          onSubmit={handleSubmit}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-6 space-y-4"
        >
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
              E-Mail-Adresse
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@beispiel.de"
                className="w-full pl-10 pr-3.5 py-2.5 text-base rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Passwort
              </label>
              <Link
                href="/forgot-password"
                className="text-xs text-blue-600 dark:text-blue-400 font-medium hover:underline"
              >
                Passwort vergessen?
              </Link>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-3.5 py-2.5 text-base rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 rounded-xl bg-brand hover:opacity-90 active:scale-[0.99] text-white font-semibold flex items-center justify-center gap-2 transition disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <span>Anmelden</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-200 dark:border-zinc-800" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white dark:bg-zinc-900 px-2 text-zinc-400">
                oder
              </span>
            </div>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={handlePasskeySignIn}
            className="w-full py-2.5 px-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 font-semibold text-sm flex items-center justify-center gap-2 transition disabled:opacity-60"
          >
            <Fingerprint className="w-4 h-4 text-blue-600" />
            <span>Mit Passkey anmelden (Face ID / Touch ID)</span>
          </button>
        </form>
      )}

      <p className="text-center text-sm text-zinc-500 dark:text-zinc-400 mt-6">
        Noch kein Konto?{" "}
        <Link
          href="/register"
          className="text-blue-600 dark:text-blue-400 font-medium hover:underline"
        >
          Ersteinrichtung / Einladung einlösen
        </Link>
      </p>
    </div>
  );
}
