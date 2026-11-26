"use client";

import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  getRegistrationStatusAction,
  registerUserAction,
} from "@/actions/auth-actions";
import { CashflowLogo } from "@/components/ui/cashflow-logo";
import {
  ShieldCheck,
  User,
  Mail,
  Lock,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

function RegisterFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("token") || undefined;

  const [status, setStatus] = useState<{
    loading: boolean;
    isFirstUser: boolean;
    registrationAllowed: boolean;
    inviteEmail: string | null;
    invalidToken?: boolean;
    branding?: {
      appName: string;
      appSubtitle: string;
      primaryColor: string;
      customLogoPath: string | null;
    };
  }>({
    loading: true,
    isFirstUser: false,
    registrationAllowed: false,
    inviteEmail: null,
  });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getRegistrationStatusAction(inviteToken).then((res) => {
      setStatus({
        loading: false,
        ...res,
      });
      if (res.inviteEmail) {
        setEmail(res.inviteEmail);
      }
    });
  }, [inviteToken]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);

    const res = await registerUserAction({
      name,
      email,
      password,
      inviteToken,
    });

    if (!res.success) {
      toast.error(res.error || "Registrierung fehlgeschlagen.");
      setSubmitting(false);
      return;
    }

    toast.success(
      status.isFirstUser
        ? "Admin-Konto erfolgreich erstellt!"
        : "Konto erfolgreich erstellt!"
    );
    router.push("/");
    router.refresh();
  }

  if (status.loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-blue-600" />
      </div>
    );
  }

  const appName = status.branding?.appName || "Cashflow";
  const primaryColor = status.branding?.primaryColor || "#2563eb";
  const customLogoPath = status.branding?.customLogoPath || null;

  return (
    <div className="min-h-dvh flex flex-col justify-center px-5 py-10 pt-safe pb-safe max-w-md mx-auto">
      <div className="flex flex-col items-center text-center mb-8">
        <CashflowLogo
          className="w-16 h-16 shadow-xl rounded-lg mb-4"
          primaryColor={primaryColor}
          customLogoPath={customLogoPath}
        />
        <h1 className="text-2xl font-bold tracking-tight">
          {status.isFirstUser ? `${appName} – Admin-Setup` : `${appName} – Konto erstellen`}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          {status.isFirstUser
            ? "Der erste registrierte Benutzer wird automatisch Administrator."
            : "Registrierung über deine persönliche Einladung."}
        </p>
      </div>

      {!status.registrationAllowed ? (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-6 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="font-semibold text-lg">Registrierung deaktiviert</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {status.invalidToken
              ? "Dieser Einladungslink ist ungültig oder bereits abgelaufen."
              : "Der Administrator wurde bereits eingerichtet. Neue Benutzer können nur über einen Einladungslink des Administrators registriert werden."}
          </p>
          <Link
            href="/login"
            style={{ backgroundColor: primaryColor }}
            className="inline-flex w-full py-2.5 px-4 rounded-xl text-white font-medium justify-center transition hover:opacity-90"
          >
            Zurück zum Login
          </Link>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-6 space-y-4"
        >
          {status.isFirstUser && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-blue-500/10 text-blue-700 dark:text-blue-300 text-xs font-medium">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>
                Erster Benutzer: Du erhältst volle Admin-Rechte. Danach wird die
                öffentliche Registrierung automatisch gesperrt.
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
              Name
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Max Mustermann"
                className="w-full pl-10 pr-3.5 py-2.5 text-base rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
              E-Mail-Adresse
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                readOnly={Boolean(status.inviteEmail)}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@beispiel.de"
                className="w-full pl-10 pr-3.5 py-2.5 text-base rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-600 read-only:opacity-70"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
              Passwort (mind. {PASSWORD_MIN_LENGTH} Zeichen)
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-3.5 py-2.5 text-base rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 px-4 rounded-xl bg-brand text-white hover:opacity-90 font-semibold flex items-center justify-center gap-2 transition disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <span>Konto erstellen & starten</span>
            )}
          </button>
        </form>
      )}

      <p className="text-center text-sm text-zinc-500 dark:text-zinc-400 mt-6">
        Bereits registriert?{" "}
        <Link
          href="/login"
          className="text-blue-600 dark:text-blue-400 font-medium hover:underline"
        >
          Zum Login
        </Link>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh flex items-center justify-center">
          <Loader2 className="w-7 h-7 animate-spin text-blue-600" />
        </div>
      }
    >
      <RegisterFormContent />
    </Suspense>
  );
}
