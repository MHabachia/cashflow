"use client";

import { useState } from "react";
import { useConfirm } from "@/components/ui/use-confirm";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import {
  Fingerprint,
  Plus,
  Trash2,
  Loader2,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";

export interface PasskeyItem {
  id: string;
  name: string | null;
  deviceType: string;
  createdAt: string | null;
}

export function PasskeyCard({
  initialPasskeys,
}: {
  initialPasskeys: PasskeyItem[];
}) {
  const { confirm, confirmDialog } = useConfirm();
  const router = useRouter();
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>(initialPasskeys);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  async function handleAddPasskey(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      const label = newName.trim() || "Mein Gerät (Passkey)";
      const res = await authClient.passkey.addPasskey({
        name: label,
      });

      if (res?.error) {
        toast.error(
          res.error.message ||
            "Passkey konnte nicht registriert werden (HTTPS / Passkey-Unterstützung erforderlich)."
        );
        setAdding(false);
        return;
      }

      setNewName("");
      toast.success(`Passkey „${label}“ erfolgreich hinterlegt!`);
      router.refresh();

      // Lokale Liste aktualisieren
      const listed = await authClient.passkey.listUserPasskeys();
      if (listed?.data) {
        setPasskeys(
          listed.data.map((p) => ({
            id: p.id,
            name: p.name ?? null,
            deviceType: p.deviceType,
            createdAt: p.createdAt
              ? new Date(p.createdAt).toLocaleDateString("de-DE")
              : null,
          }))
        );
      }
    } catch {
      toast.error(
        "Passkey-Registrierung abgebrochen oder vom Browser nicht unterstützt."
      );
    } finally {
      setAdding(false);
    }
  }

  async function handleDeletePasskey(id: string) {
    if (!(await confirm({ title: "Passkey entfernen?", confirmText: "Entfernen", variant: "danger", message: "Möchtest du diesen Passkey wirklich entfernen?" }))) {
      return;
    }
    const res = await authClient.passkey.deletePasskey({ id });
    if (res?.error) {
      toast.error(res.error.message || "Löschen fehlgeschlagen.");
      return;
    }
    setPasskeys((prev) => prev.filter((p) => p.id !== id));
    toast.success("Passkey entfernt.");
    router.refresh();
  }

  return (
    <div className="space-y-4 pb-6 border-b border-zinc-200/80 dark:border-zinc-800">
      <div className="flex items-start gap-2.5">
        <Fingerprint className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <h2 className="font-bold text-base">
            Passkeys (Face ID / Touch ID / Windows Hello)
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Melde dich sicher und ohne Passwort direkt per Biometrie oder
            Sicherheitsschlüssel an.
          </p>
        </div>
      </div>

      <form onSubmit={handleAddPasskey} className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Gerätename (z. B. iPhone, MacBook, Android)"
          className="flex-1 px-3.5 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
        />
        <button
          type="submit"
          disabled={adding}
          className="px-4 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0"
        >
          {adding ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          <span>Passkey hinzufügen</span>
        </button>
      </form>

      {passkeys.length > 0 && (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800 pt-1">
          {passkeys.map((pk) => (
            <div
              key={pk.id}
              className="py-2.5 flex items-center justify-between gap-2 text-xs"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Smartphone className="w-4 h-4 text-zinc-400 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold truncate">
                    {pk.name || "Passkey"}
                  </p>
                  <p className="text-zinc-500">
                    {pk.deviceType} {pk.createdAt ? `• Erstellt: ${pk.createdAt}` : ""}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDeletePasskey(pk.id)}
                className="p-2 rounded-lg text-red-600 hover:bg-red-500/10"
                title="Passkey entfernen"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
