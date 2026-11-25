import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Schutz gegen Registrierungen am Einladungssystem vorbei.
 *
 * Better Auth legt Benutzer sowohl über den öffentlichen HTTP-Endpunkt
 * (`POST /api/auth/sign-up/email`) als auch über `auth.api.signUpEmail()` an.
 * Nur die serverseitigen Pfade, die Einladung bzw. Admin-Rechte geprüft haben,
 * dürfen weitere Benutzer anlegen. Sie markieren ihren Aufruf mit
 * `runWithSignUpAllowed()`; der `user.create.before`-Hook in `auth.ts` lehnt
 * alle anderen Anlageversuche ab (Ausnahme: allererster Benutzer).
 *
 * Die Instanz liegt auf `globalThis`, damit alle Next.js-Bundles dieselbe
 * AsyncLocalStorage verwenden.
 */
const globalForGuard = globalThis as unknown as {
  signUpGuardStorage?: AsyncLocalStorage<boolean>;
};

const storage =
  globalForGuard.signUpGuardStorage ?? new AsyncLocalStorage<boolean>();
globalForGuard.signUpGuardStorage = storage;

export function runWithSignUpAllowed<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run(true, fn);
}

export function isSignUpAllowedInContext(): boolean {
  return storage.getStore() === true;
}
