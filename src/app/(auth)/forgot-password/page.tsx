"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Loader2, ShieldQuestion } from "lucide-react";
import { recoverWithCodeAction } from "@/actions/password-recovery-actions";
import { NewPasswordFields } from "@/components/auth/new-password-fields";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Die Passwörter stimmen nicht überein.");
      return;
    }
    setLoading(true);
    const res = await recoverWithCodeAction({ email, code, newPassword: password });
    setLoading(false);
    if (!res.success) {
      setError(res.error || "Zurücksetzen fehlgeschlagen.");
      return;
    }
    toast.success(
      `Passwort geändert. Noch ${res.remaining} Wiederherstellungscode(s) übrig – bei Bedarf in den Einstellungen neue erzeugen.`,
      { duration: 10000 }
    );
    router.push("/login");
  }

  return (
    <div className="min-h-dvh flex flex-col justify-center px-5 py-10 pt-safe pb-safe max-w-md mx-auto space-y-6">
      <div className="text-center space-y-2">
        <ShieldQuestion className="w-10 h-10 mx-auto text-blue-600" aria-hidden="true" />
        <h1 className="text-2xl font-bold tracking-tight">Passwort vergessen</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Mit einem deiner Wiederherstellungscodes kannst du selbst ein neues Passwort setzen.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="recover-email" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
            E-Mail-Adresse
          </label>
          <input
            id="recover-email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3.5 py-2.5 text-base rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
        <div>
          <label htmlFor="recover-code" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
            Wiederherstellungscode (z. B. ABCDE-23456)
          </label>
          <input
            id="recover-code"
            required
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full px-3.5 py-2.5 text-base tabular-nums rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
        <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-brand text-white hover:opacity-90 font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <KeyRound className="w-4 h-4" aria-hidden="true" />}
          Passwort neu setzen
        </button>
      </form>

      <div className="text-sm text-zinc-500 dark:text-zinc-400 space-y-2 border-t border-zinc-200 dark:border-zinc-800 pt-4">
        <p>
          <strong className="text-zinc-700 dark:text-zinc-300">Keine Codes?</strong> Bitte den Administrator
          um einen Link zum Zurücksetzen. Er wird nicht per E-Mail verschickt, sondern z. B. per Messenger
          weitergegeben.
        </p>
        <p>
          Hast du einen Passkey (Face ID / Touch ID) eingerichtet, kannst du dich auch weiterhin damit anmelden.
        </p>
        <Link href="/login" className="inline-block text-blue-600 dark:text-blue-400 font-medium hover:underline">
          Zurück zur Anmeldung
        </Link>
      </div>
    </div>
  );
}
