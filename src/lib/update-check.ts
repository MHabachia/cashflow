import packageJson from "../../package.json";

export interface UpdateInfo {
  current: string;
  latest: string | null;
  url: string | null;
  updateAvailable: boolean;
  checked: boolean;
}

const TTL_MS = 6 * 60 * 60 * 1000;
let cache: { at: number; latest: string; url: string } | null = null;

/** Vergleicht zwei Versionen wie „2.1.0“; true, wenn `a` neuer ist als `b`. */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Fragt das neueste Release auf GitHub ab (höchstens alle 6 Stunden). Es werden
 * keine Nutzerdaten gesendet. Abschaltbar mit UPDATE_CHECK=false.
 */
export async function getUpdateInfo(): Promise<UpdateInfo> {
  const current = packageJson.version;
  const base: UpdateInfo = { current, latest: null, url: null, updateAvailable: false, checked: false };
  if (process.env.UPDATE_CHECK === "false" || process.env.NODE_ENV === "test") return base;

  if (!cache || Date.now() - cache.at > TTL_MS) {
    try {
      const res = await fetch("https://api.github.com/repos/MHabachia/cashflow/releases/latest", {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "cashflow-update-check" },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return base;
      const json = (await res.json()) as { tag_name?: string; html_url?: string };
      if (!json.tag_name) return base;
      cache = { at: Date.now(), latest: json.tag_name.replace(/^v/, ""), url: json.html_url ?? "" };
    } catch {
      return base;
    }
  }
  return {
    current,
    latest: cache.latest,
    url: cache.url,
    updateAvailable: isNewerVersion(cache.latest, current),
    checked: true,
  };
}
