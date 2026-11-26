/**
 * Strikte Validierung von AUTH_SECRET / BETTER_AUTH_SECRET.
 * In Produktionsumgebungen wird das Starten mit Standard-Platzhaltern oder zu kurzen Keys strikt blockiert.
 */
/**
 * Bekannte Platzhalter aus Beispielen und Vorlagen. Wer ein Beispiel aus der
 * Dokumentation kopiert, soll nicht mit einem öffentlich bekannten Secret starten.
 */
const PLACEHOLDER_PATTERNS = [
  "lokales-entwicklungs-secret",
  "bitte-aendern",
  "bitte-in-env-setzen",
  "eintragen",
  "changeme",
  "change-me",
  "change_me",
  "your-secret",
  "dein-secret",
  "example",
  "beispiel",
];

export function looksLikePlaceholder(secret: string): boolean {
  const lower = secret.toLowerCase();
  return PLACEHOLDER_PATTERNS.some((p) => lower.includes(p));
}

export function validateAuthSecret(params: {
  secret?: string | null;
  nodeEnv?: string;
  isBuildPhase?: boolean;
}): { valid: boolean; error?: string; warning?: string } {
  const { secret, nodeEnv, isBuildPhase } = params;
  const isProduction = nodeEnv === "production";
  const raw = (secret || "").trim();

  const isPlaceholder = !raw || raw.length < 32 || looksLikePlaceholder(raw);

  if (!isProduction) {
    if (isPlaceholder) {
      return {
        valid: true,
        warning: "AUTH_SECRET verwendet ein Entwicklungs-Secret.",
      };
    }
    return { valid: true };
  }

  // In Produktion:
  if (isPlaceholder) {
    if (isBuildPhase) {
      return {
        valid: true,
        warning:
          "[SECURITY WARNING] AUTH_SECRET verwendet einen Platzhalter während des Builds. Für den Produktivbetrieb muss ein echtes Secret konfiguriert werden.",
      };
    }
    return {
      valid: false,
      error:
        "[SECURITY FATAL] In Produktion darf kein Standard-Platzhalter oder ein zu kurzes Secret (< 32 Zeichen) für AUTH_SECRET / BETTER_AUTH_SECRET verwendet werden! Bitte generiere ein sicheres Secret mit 'openssl rand -base64 32'.",
    };
  }

  return { valid: true };
}
