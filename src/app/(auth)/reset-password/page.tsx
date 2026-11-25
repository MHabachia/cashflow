"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import {
  inspectResetTokenAction,
  resetPasswordWithTokenAction,
} from "@/actions/password-recovery-actions";
import { NewPasswordFields } from "@/components/auth/new-password-fields";

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [status, setStatus] = useState<"checking" | "valid" | "invalid">("checking");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }
    inspectResetTokenAction(token).then((res) => {
      if (res.valid) {
        setMaskedEmail(res.maskedEmail);
        setStatus("valid");
      } else {
        setStatus("invalid");
      }
    });
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }
    setLoading(true);
    const res = await resetPasswordWithTokenAction({ token, newPassword: password });
    setLoading(false);
    if (!res.success) {
      setError(res.error || "Zurücksetzen fehlgeschlagen.");
      return;
    }
    toast.success("Passwort geändert. Bitte neu anmelden.");
    router.push("/login");
  }

  return (
    <div className="min-h-dvh flex flex-col justify-center px-5 py-10 pt-safe pb-safe max-w-md mx-auto space-y-6">
      <div className="text-center space-y-2">
        <KeyRound className="w-10 h-10 mx-auto text-blue-600" aria-hidden="true" />
        <h1 className="text-2xl font-bold tracking-tight">Neues Passwort festlegen</h1>
        {status === "valid" && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">für {maskedEmail}</p>
        )}
      </div>

      {status === "checking" && <p className="text-center text-sm text-zinc-500">Link wird geprüft…</p>}

      {status === "invalid" && (
        <div role="alert" className="text-center space-y-3">
          <p className="text-sm text-red-600 dark:text-red-400">
            Dieser Link ist ungültig, abgelaufen oder wurde bereits verwendet.
          </p>
          <Link href="/forgot-password" className="text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline">
            Andere Möglichkeiten zur Wiederherstellung
          </Link>
        </div>
      )}

      {status === "valid" && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <p className="text-xs text-zinc-500">Alle Geräte werden danach aus Sicherheitsgründen abgemeldet.</p>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-brand text-white hover:opacity-90 font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            Passwort speichern
          </button>
        </form>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
