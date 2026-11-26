"use client";

import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  adminCreateUserAction,
  adminUpdateUserRoleAction,
  adminToggleUserBanAction,
  adminDeleteUserAction,
  saveGlobalAppSettingsAction,
  resetGlobalAppSettingsAction,
} from "@/actions/admin-actions";
import {
  createInvitationAction,
  deleteInvitationAction,
} from "@/actions/auth-actions";
import type { GlobalAppSettings } from "@/lib/settings";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/db/schema";
import { PAYMENT_METHOD_LABELS, formatDateDE } from "@/lib/format";
import { CATEGORY_COLORS } from "@/components/ui/category-icon";
import { CashflowLogo } from "@/components/ui/cashflow-logo";
import {
  Shield,
  Users,
  Palette,
  UserPlus,
  KeyRound,
  Ban,
  CheckCircle2,
  Trash2,
  Copy,
  Check,
  Link2,
  Megaphone,
  Upload,
  RotateCcw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { createPasswordResetLinkAction } from "@/actions/password-recovery-actions";
import { cn } from "@/lib/utils";
import { accentContrastIssue } from "@/lib/color-contrast";

interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  banned: boolean;
  createdAt: string;
  txCount: number;
  fixedCount: number;
}

interface InviteRow {
  id: string;
  token: string;
  email: string | null;
  usedAt: string | null;
  expiresAt: string;
}

export function AdminDashboardView({
  currentAdminId,
  initialSettings,
  users,
  invitations,
}: {
  currentAdminId: string;
  initialSettings: GlobalAppSettings;
  users: AdminUserRow[];
  invitations: InviteRow[];
}) {
  const router = useRouter();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<"users" | "branding" | "invites">(
    "users"
  );

  // 1. State: Benutzer direkt anlegen
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");
  const [creatingUser, setCreatingUser] = useState(false);

  // 2. State: Passwort zurücksetzen Modal
  const [resetUser, setResetUser] = useState<AdminUserRow | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [creatingResetLink, setCreatingResetLink] = useState(false);

  // 3. State: Einladungslinks
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDays, setInviteDays] = useState(7);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // 4. State: Globale App-Einstellungen & Branding
  const [appName, setAppName] = useState(initialSettings.appName);
  const [appSubtitle, setAppSubtitle] = useState(initialSettings.appSubtitle);
  const [primaryColor, setPrimaryColor] = useState(
    initialSettings.primaryColor
  );
  const [allowOpenRegistration, setAllowOpenRegistration] = useState(
    initialSettings.allowOpenRegistration
  );
  const [defaultPaymentMethod, setDefaultPaymentMethod] =
    useState<PaymentMethod>(initialSettings.defaultPaymentMethod);
  const [maxUploadSizeMb, setMaxUploadSizeMb] = useState(
    initialSettings.maxUploadSizeMb
  );
  const [systemAnnouncement, setSystemAnnouncement] = useState(
    initialSettings.systemAnnouncement || ""
  );
  const [customLogoPath, setCustomLogoPath] = useState<string | null>(
    initialSettings.customLogoPath
  );
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setCreatingUser(true);
    const res = await adminCreateUserAction({
      name: newName,
      email: newEmail,
      password: newPassword,
      role: newRole,
    });
    setCreatingUser(false);

    if (res.success) {
      toast.success(`Benutzer „${newName}“ erfolgreich angelegt!`);
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setNewRole("user");
      setShowCreateUser(false);
    } else {
      toast.error(res.error || "Fehler beim Anlegen.");
    }
  }

  // Statt eines vom Admin gewählten Passworts: Einmal-Link, mit dem der
  // Nutzer selbst ein neues Passwort setzt (Admin kennt es nie)
  async function handleCreateResetLink() {
    if (!resetUser) return;
    setCreatingResetLink(true);
    const res = await createPasswordResetLinkAction(resetUser.id);
    setCreatingResetLink(false);
    if (res.success && res.url) {
      setResetLink(res.url);
    } else {
      toast.error(res.error || "Link konnte nicht erstellt werden.");
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSavingSettings(true);
    const res = await saveGlobalAppSettingsAction({
      appName,
      appSubtitle,
      primaryColor,
      allowOpenRegistration,
      defaultPaymentMethod,
      maxUploadSizeMb,
      systemAnnouncement: systemAnnouncement.trim() || null,
    });
    setSavingSettings(false);

    if (res.success) {
      document.documentElement.style.setProperty(
        "--brand-primary",
        primaryColor
      );
      toast.success("Globale App-Einstellungen & Branding gespeichert!");
      router.refresh();
    } else {
      toast.error(res.error || "Speichern fehlgeschlagen.");
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/branding/icon", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok || !json.customLogoPath) {
        toast.error(json.error || "Logo-Upload fehlgeschlagen.");
      } else {
        setCustomLogoPath(json.customLogoPath);
        toast.success("Eigenes App-Logo & Favicon aktiviert!");
        router.refresh();
      }
    } catch {
      toast.error("Fehler beim Hochladen des App-Logos.");
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  }

  async function handleResetLogo() {
    if (
      !window.confirm(
        "Möchtest du das individuelle Logo entfernen und das Standard-3D-Logo wiederherstellen?"
      )
    ) {
      return;
    }
    const res = await fetch("/api/branding/icon", { method: "DELETE" });
    if (res.ok) {
      setCustomLogoPath(null);
      toast.success("Standard-3D-Logo wiederhergestellt!");
      router.refresh();
    } else {
      toast.error("Logo konnte nicht zurückgesetzt werden.");
    }
  }

  async function handleResetAllBranding() {
    if (
      !window.confirm(
        "Möchtest du wirklich alle Branding- & App-Einstellungen (Name, Untertitel, Farbe, Logo & Optionen) auf den Standard zurücksetzen?"
      )
    ) {
      return;
    }
    setSavingSettings(true);
    const res = await resetGlobalAppSettingsAction();
    setSavingSettings(false);
    if (res.success) {
      setAppName("Cashflow");
      setAppSubtitle("Fixkosten & Variable Ausgaben");
      setPrimaryColor("#2563eb");
      setAllowOpenRegistration(false);
      setDefaultPaymentMethod("card");
      setMaxUploadSizeMb(15);
      setSystemAnnouncement("");
      setCustomLogoPath(null);
      document.documentElement.style.setProperty("--brand-primary", "#2563eb");
      toast.success("Alle Branding-Einstellungen wurden auf Standard zurückgesetzt!");
      router.refresh();
    } else {
      toast.error("Zurücksetzen fehlgeschlagen.");
    }
  }

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    const res = await createInvitationAction(inviteEmail, inviteDays);
    if (res.success && res.token) {
      setInviteEmail("");
      const url = `${window.location.origin}/register?token=${res.token}`;
      await navigator.clipboard.writeText(url).catch(() => {});
      toast.success("Einladungslink erstellt & kopiert!");
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
    <div className="space-y-4">
      {/* Admin Header */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 shrink-0"
          >
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Admin-Panel & App-Grundgerüst</h1>
            <p className="text-xs text-zinc-500">
              Benutzerverwaltung, Branding & globale Systemeinstellungen
            </p>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-1.5 grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={() => setActiveTab("users")}
          className={cn(
            "py-2.5 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition",
            activeTab === "users"
              ? "bg-brand text-white "
              : "text-zinc-600 dark:text-zinc-400"
          )}
        >
          <Users className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Benutzer ({users.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("branding")}
          className={cn(
            "py-2.5 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition",
            activeTab === "branding"
              ? "bg-brand text-white "
              : "text-zinc-600 dark:text-zinc-400"
          )}
        >
          <Palette className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Branding & App</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("invites")}
          className={cn(
            "py-2.5 px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition",
            activeTab === "invites"
              ? "bg-brand text-white "
              : "text-zinc-600 dark:text-zinc-400"
          )}
        >
          <Link2 className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Einladungen</span>
        </button>
      </div>

      {/* TAB 1: BENUTZERVERWALTUNG */}
      {activeTab === "users" && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-sm">Benutzerkonten verwalten</h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Lege neue Benutzer direkt an, ändere Rollen, setze Passwörter
                zurück oder sperre Konten.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateUser((v) => !v)}
              className="px-3.5 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold flex items-center gap-1.5 shrink-0"
            >
              <UserPlus className="w-4 h-4" />
              <span>Benutzer anlegen</span>
            </button>
          </div>

          {showCreateUser && (
            <form
              onSubmit={handleCreateUser}
              className="bg-white dark:bg-zinc-900 border-2 border-blue-600/30 rounded-lg p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm">
                  Neuen Benutzer direkt erstellen
                </h3>
                <button
                  type="button"
                  onClick={() => setShowCreateUser(false)}
                  className="p-1 text-zinc-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="z. B. Lisa Mustermann"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">
                    E-Mail-Adresse
                  </label>
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="lisa@beispiel.de"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">
                    Initiales Passwort (mind. {PASSWORD_MIN_LENGTH} Zeichen)
                  </label>
                  <input
                    type="password"
                    required
                    minLength={PASSWORD_MIN_LENGTH}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">
                    Rolle
                  </label>
                  <select
                    value={newRole}
                    onChange={(e) =>
                      setNewRole(e.target.value as "user" | "admin")
                    }
                    className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
                  >
                    <option value="user">Standard-Benutzer</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={creatingUser}
                className="w-full py-2.5 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>
                  {creatingUser
                    ? "Erstelle Benutzer..."
                    : "Benutzer jetzt erstellen (inkl. Standardkategorien)"}
                </span>
              </button>
            </form>
          )}

          {/* Passwort-Reset per Einmal-Link */}
          {resetUser && (
            <div className="bg-white dark:bg-zinc-900 border-2 border-amber-500/40 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm">
                  Passwort zurücksetzen: {resetUser.name} ({resetUser.email})
                </h3>
                <button
                  type="button"
                  aria-label="Schließen"
                  onClick={() => {
                    setResetUser(null);
                    setResetLink(null);
                  }}
                  className="p-1 text-zinc-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {resetLink ? (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Gib diesen Link persönlich oder per Messenger weiter. Er ist 24 Stunden gültig und
                    nur einmal verwendbar; danach werden alle Geräte des Nutzers abgemeldet.
                  </p>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={resetLink}
                      aria-label="Link zum Zurücksetzen"
                      onFocus={(e) => e.target.select()}
                      className="flex-1 px-3 py-2 text-xs tabular-nums rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        navigator.clipboard.writeText(resetLink).then(() => toast.success("Link kopiert."))
                      }
                      className="px-4 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold"
                    >
                      Kopieren
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Erstellt einen Einmal-Link, mit dem der Nutzer selbst ein neues Passwort festlegt.
                    Ein bereits erstellter, unbenutzter Link wird dabei ungültig.
                  </p>
                  <button
                    type="button"
                    onClick={handleCreateResetLink}
                    disabled={creatingResetLink}
                    className="px-4 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold disabled:opacity-50"
                  >
                    Link erstellen
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Benutzerliste */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg divide-y divide-zinc-100 dark:divide-zinc-800">
            {users.map((u) => {
              const isSelf = u.id === currentAdminId;
              return (
                <div
                  key={u.id}
                  className={cn(
                    "p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3",
                    u.banned && "bg-red-500/5"
                  )}
                >
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{u.name}</span>
                      <span
                        className={cn(
                          "text-xs px-2 py-0.5 rounded-md font-semibold",
                          u.role === "admin"
                            ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                        )}
                      >
                        {u.role === "admin" ? "Admin" : "Benutzer"}
                      </span>
                      {u.banned && (
                        <span className="text-xs px-2 py-0.5 rounded-md bg-red-500/15 text-red-600 font-bold">
                          Gesperrt
                        </span>
                      )}
                      {isSelf && (
                        <span className="text-xs text-zinc-400">
                          (Du selbst)
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {u.email} • Seit {formatDateDE(u.createdAt)} •{" "}
                      {u.txCount} Buchungen • {u.fixedCount} Fixkosten
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Rolle umschalten */}
                    {!isSelf && (
                      <button
                        type="button"
                        onClick={async () => {
                          const nextRole =
                            u.role === "admin" ? "user" : "admin";
                          const res = await adminUpdateUserRoleAction(
                            u.id,
                            nextRole
                          );
                          if (res.success) {
                            toast.success(
                              `Rolle von ${u.name} auf ${nextRole} geändert.`
                            );
                          } else {
                            toast.error(res.error);
                          }
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        {u.role === "admin" ? "Zu User stufen" : "Zum Admin"}
                      </button>
                    )}

                    {/* Passwort zurücksetzen */}
                    <button
                      type="button"
                      onClick={() => {
                        setResetUser(u);
                        setResetLink(null);
                      }}
                      title="Passwort zurücksetzen"
                      className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                    </button>

                    {/* Konto sperren / entsperren */}
                    {!isSelf && (
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await adminToggleUserBanAction(
                            u.id,
                            !u.banned
                          );
                          if (res.success) {
                            toast.success(
                              u.banned
                                ? `${u.name} wurde wieder freigeschaltet.`
                                : `${u.name} wurde gesperrt.`
                            );
                          }
                        }}
                        title={
                          u.banned ? "Konto entsperren" : "Konto sperren"
                        }
                        className={cn(
                          "p-2 rounded-lg border border-zinc-200 dark:border-zinc-800",
                          u.banned
                            ? "text-emerald-600 hover:bg-emerald-500/10"
                            : "text-amber-600 hover:bg-amber-500/10"
                        )}
                      >
                        {u.banned ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <Ban className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}

                    {/* Benutzer komplett löschen */}
                    {!isSelf && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (
                            !window.confirm(
                              `Möchtest du den Benutzer „${u.name}“ inkl. aller Buchungen und Belegfotos wirklich unwiderruflich löschen?`
                            )
                          ) {
                            return;
                          }
                          const res = await adminDeleteUserAction(u.id);
                          if (res.success) {
                            toast.success(`Benutzer ${u.name} gelöscht.`);
                          } else {
                            toast.error(res.error);
                          }
                        }}
                        title="Benutzer löschen"
                        className="p-2 rounded-lg text-red-600 hover:bg-red-500/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: BRANDING & GLOBALE APP-EINSTELLUNGEN */}
      {activeTab === "branding" && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 space-y-5"
        >
          <div>
            <h2 className="font-bold text-base">
              Branding & Globale App-Konfiguration
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Passe den Namen, die Akzentfarbe, das PWA-Erscheinungsbild und
              globale Sicherheitsregeln deiner Instanz an.
            </p>
          </div>

          {/* Live-Vorschau & Eigenes Favicon / App-Logo hochladen */}
          <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <CashflowLogo
                className="w-14 h-14 rounded-lg shadow-md shrink-0"
                primaryColor={primaryColor}
                customLogoPath={customLogoPath}
              />
              <div>
                <p className="text-sm font-bold">{appName}</p>
                <p className="text-xs text-zinc-500">{appSubtitle}</p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {customLogoPath
                    ? "Eigenes Logo & Favicon aktiv"
                    : "Dynamisches 3D-Logo in gewählter Akzentfarbe"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
              />
              <button
                type="button"
                disabled={uploadingLogo}
                onClick={() => logoInputRef.current?.click()}
                className="px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 text-xs font-semibold flex items-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>
                  {uploadingLogo ? "Lade hoch..." : "Eigenes Favicon / Logo"}
                </span>
              </button>
              {customLogoPath && (
                <button
                  type="button"
                  onClick={handleResetLogo}
                  className="px-2.5 py-2 rounded-xl text-red-600 hover:bg-red-500/10 text-xs font-medium flex items-center gap-1"
                  title="Auf 3D-Standardlogo zurücksetzen"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Standard</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1.5">
                App-Name (Header, Login & PWA-Manifest)
              </label>
              <input
                type="text"
                required
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="z. B. Cashflow"
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1.5">
                Untertitel / Slogan
              </label>
              <input
                type="text"
                required
                value={appSubtitle}
                onChange={(e) => setAppSubtitle(e.target.value)}
                placeholder="z. B. Fixkosten & Variable Ausgaben"
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-2">
              Branding-Akzentfarbe (Theme Color & Logo)
            </label>
            <div className="flex flex-wrap items-center gap-2.5">
              {["#2563eb", ...CATEGORY_COLORS].map((col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => setPrimaryColor(col)}
                  aria-label={`Akzentfarbe ${col}`}
                  aria-pressed={primaryColor === col}
                  className={cn(
                    "w-9 h-9 rounded-xl transition",
                    primaryColor === col &&
                      "ring-2 ring-offset-2 ring-blue-600 scale-110"
                  )}
                  style={{ backgroundColor: col }}
                />
              ))}
              <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                <span>oder Hex-Wert</span>
                <input
                  type="text"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  maxLength={7}
                  spellCheck={false}
                  className="w-24 px-2 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 tabular-nums"
                />
              </label>
            </div>

            {/* Vorschau: so sehen Buttons und Fortschrittsbalken mit der Akzentfarbe aus */}
            <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg border border-zinc-200 dark:border-zinc-800 p-3" aria-label="Vorschau der Akzentfarbe">
              <span className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold">Buchung erfassen</span>
              <span className="w-32 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                <span className="block h-full w-2/3 rounded-full bg-brand" />
              </span>
              <span className="text-xs text-brand font-medium">Link</span>
            </div>
            {accentContrastIssue(primaryColor) && (
              <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                {accentContrastIssue(primaryColor)}
              </p>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1.5">
                Standard-Zahlungsart bei neuen Einträgen
              </label>
              <select
                value={defaultPaymentMethod}
                onChange={(e) =>
                  setDefaultPaymentMethod(e.target.value as PaymentMethod)
                }
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
              >
                {PAYMENT_METHODS.map((pm) => (
                  <option key={pm} value={pm}>
                    {PAYMENT_METHOD_LABELS[pm]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-500 mb-1.5">
                Max. Upload-Größe für Belegfotos (in MB)
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={maxUploadSizeMb}
                onChange={(e) =>
                  setMaxUploadSizeMb(Number(e.target.value) || 15)
                }
                className="w-full px-3.5 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-500 mb-1.5 flex items-center gap-1.5">
              <Megaphone className="w-3.5 h-3.5 text-amber-500" />
              <span>
                Globale System-Mitteilung / Banner (optional für alle Benutzer)
              </span>
            </label>
            <input
              type="text"
              value={systemAnnouncement}
              onChange={(e) => setSystemAnnouncement(e.target.value)}
              placeholder="Leer lassen, um kein Banner anzuzeigen (z. B. Wartungshinweis)"
              className="w-full px-3.5 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
            />
          </div>

          <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={allowOpenRegistration}
                onChange={(e) => setAllowOpenRegistration(e.target.checked)}
                className="mt-0.5 rounded text-blue-600"
              />
              <div className="text-xs">
                <p className="font-semibold">
                  Offene Registrierung ohne Einladungslink erlauben
                </p>
                <p className="text-zinc-500 mt-0.5">
                  Standardmäßig deaktiviert (empfohlen). Wenn aktiviert, kann
                  sich jeder auf <code>/register</code> auch ohne Einladungstoken
                  registrieren.
                </p>
              </div>
            </label>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              type="submit"
              disabled={savingSettings}
              className="flex-1 py-3 rounded-xl bg-brand text-white hover:opacity-90 text-sm font-bold flex items-center justify-center gap-2"
            >
              <Check className="w-4 h-4" />
              <span>
                {savingSettings
                  ? "Speichere Einstellungen..."
                  : "Branding & App-Einstellungen speichern"}
              </span>
            </button>

            <button
              type="button"
              disabled={savingSettings}
              onClick={handleResetAllBranding}
              className="px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 hover:bg-red-500/10 hover:text-red-600 hover:border-red-500/30 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Auf Standard zurücksetzen</span>
            </button>
          </div>

          {/* Sektion: Auto-Kategorisierungs-Regeln für die Instanz */}
          <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <span>Auto-Kategorisierungs-Regelwerk</span>
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Verwalte Regeln für Händler- und Begriffserkennung oder lade das deutsche Standard-Paket.
              </p>
            </div>
            <Link
              href="/categories?tab=rules"
              className="px-3.5 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold shrink-0 transition"
            >
              Regelwerk öffnen
            </Link>
          </div>
        </form>
      )}

      {/* TAB 3: EINLADUNGSLINKS */}
      {activeTab === "invites" && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 space-y-4">
          <div>
            <h2 className="font-bold text-base">Einladungslinks erzeugen</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Erstelle einen einmaligen Registrierungslink, den
              du per iMessage/WhatsApp verschicken kannst.
            </p>
          </div>

          <form onSubmit={handleCreateInvite} className="flex gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="Optional: Auf E-Mail-Adresse beschränken"
              className="flex-1 px-3.5 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
            />
            <label className="sr-only" htmlFor="invite-days">Gültigkeit</label>
            <select
              id="invite-days"
              value={inviteDays}
              onChange={(e) => setInviteDays(Number(e.target.value))}
              className="px-2.5 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
            >
              <option value={1}>1 Tag</option>
              <option value={7}>7 Tage</option>
              <option value={30}>30 Tage</option>
            </select>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-brand text-white hover:opacity-90 text-xs font-semibold shrink-0"
            >
              Link erzeugen
            </button>
          </form>

          {invitations.length === 0 ? (
            <p className="text-xs text-zinc-500">
              Noch keine Einladungslinks erstellt.
            </p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="py-3 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="truncate">
                    <p className="font-semibold truncate">
                      {inv.email || "Für beliebige E-Mail-Adresse gültig"}
                    </p>
                    <p className="text-zinc-500">
                      {inv.usedAt
                        ? "Bereits eingelöst"
                        : new Date(inv.expiresAt).getTime() < Date.now()
                          ? "Abgelaufen"
                          : `Offen, gültig bis ${new Date(inv.expiresAt).toLocaleDateString("de-DE")}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!inv.usedAt && (
                      <button
                        type="button"
                        onClick={() => copyLink(inv.token)}
                        className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200"
                        title="Link kopieren"
                      >
                        {copiedToken === inv.token ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
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
      )}
    </div>
  );
}
