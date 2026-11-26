"use client";

import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

export function NewPasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
}) {
  const mismatch = confirm.length > 0 && password !== confirm;
  return (
    <>
      <div>
        <label htmlFor="new-password" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
          Neues Passwort (mind. {PASSWORD_MIN_LENGTH} Zeichen)
        </label>
        <input
          id="new-password"
          type="password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={128}
          autoComplete="new-password"
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          className="w-full px-3.5 py-2.5 text-base rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
        />
      </div>
      <div>
        <label htmlFor="confirm-password" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5">
          Neues Passwort wiederholen
        </label>
        <input
          id="confirm-password"
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => onConfirm(e.target.value)}
          aria-invalid={mismatch}
          aria-describedby={mismatch ? "password-mismatch" : undefined}
          className="w-full px-3.5 py-2.5 text-base rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
        />
        {mismatch && (
          <p id="password-mismatch" role="alert" className="text-xs text-red-600 mt-1">
            Die Passwörter stimmen nicht überein.
          </p>
        )}
      </div>
    </>
  );
}
