import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTrustedOrigins } from "../../src/lib/trusted-origins";

describe("Erlaubte Ursprünge für die Auth-API", () => {
  it("enthält in Produktion keine localhost-Adressen", () => {
    const o = buildTrustedOrigins({ NODE_ENV: "production", APP_URL: "https://cashflow.example.org/" } as NodeJS.ProcessEnv);
    assert.deepEqual(o, ["https://cashflow.example.org"]);
  });
  it("übernimmt TRUSTED_HOSTS mit http und https", () => {
    const o = buildTrustedOrigins({ NODE_ENV: "production", TRUSTED_HOSTS: "kosten.lan:3000" } as NodeJS.ProcessEnv);
    assert.deepEqual(o, ["https://kosten.lan:3000", "http://kosten.lan:3000"]);
  });
  it("erlaubt localhost in der Entwicklung", () => {
    const o = buildTrustedOrigins({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
    assert.ok(o.includes("http://localhost:3000"));
  });
});
