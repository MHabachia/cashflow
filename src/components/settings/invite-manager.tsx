"use client";

import { useState } from "react";
import {
  createInvitationAction,
  deleteInvitationAction,
} from "@/actions/auth-actions";
import { UserPlus, Copy, Trash2, Check, Users } from "lucide-react";
import { toast } from "sonner";

interface InviteItem {
  id: string;
  token: string;
  email: string | null;
  usedAt: string | null;
  expiresAt: string;
}

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: string;
}

export function InviteManager({
  invitations,
  users,
}: {
  invitations: InviteItem[];
  users: UserItem[];
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await createInvitationAction(email);
      if (res.success && res.token) {
        setEmail("");
        const url = `${window.location.origin}/register?token=${res.token}`;
        await navigator.clipboard.writeText(url).catch(() => {});
        toast.success("Einladungslink erstellt & in Zwischenablage kopiert!");
      }
    } catch {
      toast.error("Fehler beim Erstellen der Einladung.");
    } finally {
      setLoading(false);
    }
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/register?token=${token}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    toast.success("Einladungslink kopiert!");
    setTimeout(() => setCopiedToken(null), 2000);
  }

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-3">
          <UserPlus className="w-5 h-5 text-blue-600" />
          <h2 className="font-bold text-base">
            Benutzer einladen (Admin)
          </h2>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
          Die offene Registrierung ist gesperrt. Erzeuge hier einen
          Einladungslink (7 Tage gültig) für weitere Benutzer.
        </p>

        <form onSubmit={handleCreateInvite} className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Optional: E-Mail festlegen"
            className="flex-1 px-3.5 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-sm font-medium shrink-0"
          >
            Link erzeugen
          </button>
        </form>

        {invitations.length > 0 && (
          <div className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
            {invitations.map((inv) => (
              <div
                key={inv.id}
                className="py-2.5 flex items-center justify-between gap-2 text-xs"
              >
                <div className="truncate">
                  <p className="font-medium truncate">
                    {inv.email || "Beliebige E-Mail-Adresse"}
                  </p>
                  <p className="text-zinc-500">
                    {inv.usedAt ? "Bereits eingelöst" : "Offen (7 Tage gültig)"}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!inv.usedAt && (
                    <button
                      onClick={() => copyLink(inv.token)}
                      className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200"
                      title="Einladungslink kopieren"
                    >
                      {copiedToken === inv.token ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      if (
                        !window.confirm(
                          "Möchtest du diesen Einladungslink wirklich widerrufen?"
                        )
                      ) {
                        return;
                      }
                      const res = await deleteInvitationAction(inv.id);
                      if (res?.success) {
                        toast.success("Einladungslink widerrufen.");
                      } else {
                        toast.error("Löschen fehlgeschlagen.");
                      }
                    }}
                    className="p-2 rounded-lg text-red-600 hover:bg-red-500/10"
                    title="Löschen"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-5 h-5 text-blue-600" />
          <h2 className="font-bold text-base">
            Registrierte Benutzer ({users.length})
          </h2>
        </div>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {users.map((u) => (
            <div
              key={u.id}
              className="py-2.5 flex items-center justify-between text-sm"
            >
              <div>
                <p className="font-medium">{u.name}</p>
                <p className="text-xs text-zinc-500">{u.email}</p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 font-medium">
                {u.role}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
