import { describe, it } from "node:test";
import assert from "node:assert";
import { validateAuthSecret } from "../../src/lib/auth-guard";

describe("Strict Production AUTH_SECRET Guard", () => {
  it("akzeptiert ein sicheres 32-Zeichen-Secret in Produktion", () => {
    const res = validateAuthSecret({
      secret: "super-sicheres-und-langes-produktions-secret-12345",
      nodeEnv: "production",
      isBuildPhase: false,
    });
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.error, undefined);
  });

  it("verhindert in Produktion das Starten mit Standard-Platzhalter (Fail-Fast)", () => {
    const res = validateAuthSecret({
      secret: "lokales-entwicklungs-secret-mindestens-32-zeichen-lang",
      nodeEnv: "production",
      isBuildPhase: false,
    });
    assert.strictEqual(res.valid, false);
    assert.match(res.error || "", /SECURITY FATAL/);
  });

  it("verhindert in Produktion das Starten mit bitte-aendern Platzhalter", () => {
    const res = validateAuthSecret({
      secret: "bitte-aendern-in-ein-sicheres-32-zeichen-secret-123456",
      nodeEnv: "production",
      isBuildPhase: false,
    });
    assert.strictEqual(res.valid, false);
    assert.match(res.error || "", /SECURITY FATAL/);
  });

  it("verhindert in Produktion Secrets unter 32 Zeichen", () => {
    const res = validateAuthSecret({
      secret: "zu-kurzes-secret",
      nodeEnv: "production",
      isBuildPhase: false,
    });
    assert.strictEqual(res.valid, false);
    assert.match(res.error || "", /SECURITY FATAL/);
  });

  it("erlaubt Platzhalter-Secret während des Next.js Builds mit Warning", () => {
    const res = validateAuthSecret({
      secret: "lokales-entwicklungs-secret-mindestens-32-zeichen-lang",
      nodeEnv: "production",
      isBuildPhase: true,
    });
    assert.strictEqual(res.valid, true);
    assert.match(res.warning || "", /SECURITY WARNING/);
  });

  it("erlaubt Entwicklungs-Secret in Development", () => {
    const res = validateAuthSecret({
      secret: "lokales-entwicklungs-secret-mindestens-32-zeichen-lang",
      nodeEnv: "development",
      isBuildPhase: false,
    });
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.error, undefined);
  });

  it("verhindert in Produktion kopierte Beispiel-Secrets aus der Dokumentation", () => {
    for (const secret of [
      "bitte-eigenes-32-zeichen-secret-eintragen",
      "CHANGE_ME_CHANGE_ME_CHANGE_ME_CHANGE_ME",
      "changeme-changeme-changeme-changeme-12",
    ]) {
      const res = validateAuthSecret({ secret, nodeEnv: "production", isBuildPhase: false });
      assert.strictEqual(res.valid, false, secret);
    }
  });
});
