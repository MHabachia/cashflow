"use client";

import { useState } from "react";
import { changeOwnPasswordAction } from "@/actions/auth-actions";
import { KeyRound, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function PasswordChangeCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await changeOwnPasswordAction({
      currentPassword,
      newPassword,
    });
    setLoading(false);

    if (res.success) {
      toast.success("Passwort erfolgreich geändert!");
      setCurrentPassword("");
      setNewPassword("");
    } else {
      toast.error(res.error || "Fehler beim Ändern des Passworts.");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 pb-6 border-b border-zinc-200/80 dark:border-zinc-800"
    >
      <div className="flex items-center gap-2">
        <KeyRound className="w-5 h-5 text-blue-600" />
        <h2 className="font-bold text-base">Eigenes Passwort ändern</h2>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">
            Aktuelles Passwort
          </label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full px-3.5 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-500 mb-1">
            Neues Passwort (mind. 8 Zeichen)
          </label>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full px-3.5 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="px-4 py-2.5 rounded-xl bg-brand text-white text-xs font-semibold flex items-center gap-1.5"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Check className="w-4 h-4" />
        )}
        <span>Passwort aktualisieren</span>
      </button>
    </form>
  );
}
