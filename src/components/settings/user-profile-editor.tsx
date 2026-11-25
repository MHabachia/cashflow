"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  updateOwnProfileAction,
  revokeOtherSessionsAction,
} from "@/actions/auth-actions";
import {
  Camera,
  Trash2,
  User,
  Mail,
  Check,
  Loader2,
  Smartphone,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export interface SessionInfoItem {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  isCurrent: boolean;
}

export function UserProfileEditor({
  initialName,
  initialEmail,
  initialImage,
  role,
  sessions,
}: {
  initialName: string;
  initialEmail: string;
  initialImage: string | null;
  role: string;
  sessions: SessionInfoItem[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [currentPassword, setCurrentPassword] = useState("");
  const emailChanged =
    email.trim().toLowerCase() !== initialEmail.trim().toLowerCase();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialImage);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/profile/avatar", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();

      if (!res.ok || !json.avatarUrl) {
        toast.error(json.error || "Upload fehlgeschlagen.");
      } else {
        setAvatarUrl(json.avatarUrl);
        toast.success("Profilbild aktualisiert!");
        router.refresh();
      }
    } catch {
      toast.error("Fehler beim Hochladen des Profilbilds.");
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRemoveAvatar() {
    if (
      !window.confirm(
        "Möchtest du dein individuelles Profilbild wirklich entfernen?"
      )
    ) {
      return;
    }
    const res = await fetch("/api/profile/avatar", { method: "DELETE" });
    if (res.ok) {
      setAvatarUrl(null);
      toast.success("Profilbild entfernt.");
      router.refresh();
    } else {
      toast.error("Profilbild konnte nicht entfernt werden.");
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    const res = await updateOwnProfileAction({
      name,
      email,
      currentPassword: emailChanged ? currentPassword : undefined,
    });
    setSavingProfile(false);

    if (res.success) {
      setCurrentPassword("");
      toast.success(
        emailChanged
          ? "Gespeichert. Andere Geräte wurden aus Sicherheitsgründen abgemeldet."
          : "Benutzerinformationen gespeichert!"
      );
      router.refresh();
    } else {
      toast.error(res.error || "Speichern fehlgeschlagen.");
    }
  }

  return (
    <div className="space-y-5">
      {/* 1. Profilbild & Benutzerdaten (Open Canvas) */}
      <form
        onSubmit={handleSaveProfile}
        className="space-y-4 pb-6 border-b border-zinc-200/80 dark:border-zinc-800"
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <div className="relative w-20 h-20 shrink-0">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={name}
                className="w-20 h-20 rounded-full object-cover border border-zinc-200 dark:border-zinc-700"
              />
            ) : (
              <div className="w-20 h-20 rounded-full bg-brand text-white text-2xl font-bold flex items-center justify-center">
                {getInitials(name || "U")}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarUpload}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploadingAvatar}
              onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-brand text-white hover:opacity-90 shadow-md flex items-center justify-center"
              title="Profilbild ändern"
            >
              {uploadingAvatar ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
            </button>
          </div>

          <div className="flex-1">
            <h1 className="text-lg font-bold">{name}</h1>
            <p className="text-xs text-zinc-500">
              {role === "admin" ? "Administrator-Konto" : "Standard-Benutzer"}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 text-xs font-semibold"
              >
                Profilbild hochladen
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  className="px-2.5 py-1.5 rounded-xl text-red-600 hover:bg-red-500/10 text-xs font-medium flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Entfernen</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-1.5">
              Anzeigename
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-1.5">
              E-Mail-Adresse
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-3.5 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
              />
            </div>
          </div>
        </div>

        {emailChanged && (
          <div className="space-y-1.5">
            <label
              htmlFor="profile-current-password"
              className="text-xs font-semibold text-zinc-700 dark:text-zinc-300"
            >
              Aktuelles Passwort (zur Bestätigung der neuen E-Mail-Adresse)
            </label>
            <input
              id="profile-current-password"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={savingProfile}
          className="px-4 py-2.5 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold flex items-center gap-1.5"
        >
          {savingProfile ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          <span>Benutzerdaten speichern</span>
        </button>
      </form>

      {/* 2. Aktive Geräte & Sitzungen (Open Canvas) */}
      <div className="space-y-3 pb-6 border-b border-zinc-200/80 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-blue-600" />
            <h2 className="font-bold text-base">
              Angemeldete Geräte ({sessions.length})
            </h2>
          </div>
          {sessions.length > 1 && (
            <button
              type="button"
              onClick={async () => {
                const res = await revokeOtherSessionsAction();
                if (res.success) {
                  toast.success("Alle anderen Geräte wurden abgemeldet!");
                  router.refresh();
                }
              }}
              className="px-3 py-1.5 rounded-xl bg-red-500/10 text-red-600 text-xs font-semibold flex items-center gap-1 hover:bg-red-500/20"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Andere Geräte abmelden</span>
            </button>
          )}
        </div>

        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="py-2.5 flex items-center justify-between text-xs gap-2"
            >
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {s.userAgent?.includes("iPhone")
                    ? "Apple iPhone (Safari / PWA)"
                    : s.userAgent?.includes("Macintosh")
                      ? "Mac (Browser)"
                      : s.userAgent || "Browser-Sitzung"}
                </p>
                <p className="text-zinc-500">
                  Anmeldung: {s.createdAt} {s.ipAddress ? `• IP: ${s.ipAddress}` : ""}
                </p>
              </div>
              {s.isCurrent && (
                <span className="px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 font-semibold shrink-0">
                  Aktuelles Gerät
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
