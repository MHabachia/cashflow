import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATABASE_PATH = path.resolve("./data/test-rate-limit-uploads.db");

describe("Client-IP für Rate-Limits", () => {
  it("IP_ADDRESS_HEADERS: nicht gesetzt = Standard, leer = keinem Header vertrauen", async () => {
    const { resolveIpAddressHeaders } = await import("../../src/lib/auth");
    assert.deepEqual(resolveIpAddressHeaders(undefined), ["x-forwarded-for", "x-real-ip"]);
    assert.deepEqual(resolveIpAddressHeaders(""), []);
    assert.deepEqual(resolveIpAddressHeaders("  "), []);
    assert.deepEqual(resolveIpAddressHeaders("cf-connecting-ip, x-real-ip"), ["cf-connecting-ip", "x-real-ip"]);
  });

  it("übernimmt keine mehrteilige X-Forwarded-For-Kette ohne TRUSTED_PROXIES", async () => {
    const { clientKeyFromHeaders } = await import("../../src/lib/simple-rate-limit");
    const single = new Headers({ "x-forwarded-for": "203.0.113.7" });
    assert.equal(clientKeyFromHeaders(single), "203.0.113.7");

    // Ein Client stellt eine erfundene Adresse voran: Ohne vertrauenswürdigen
    // Proxy darf sie nicht als Schlüssel dienen
    const chain = new Headers({ "x-forwarded-for": "198.51.100.1, 203.0.113.7" });
    assert.notEqual(clientKeyFromHeaders(chain), "198.51.100.1");
    // cf-connecting-ip steht nicht in der Standardliste und wird ignoriert
    const cf = new Headers({ "cf-connecting-ip": "198.51.100.2" });
    assert.notEqual(clientKeyFromHeaders(cf), "198.51.100.2");
  });
});

describe("Upload-Grenzen", () => {
  it("lehnt fehlende oder zu große Content-Length vor dem Einlesen ab", async () => {
    const { checkDeclaredUploadSize } = await import("../../src/lib/upload-limits");
    const max = 1024 * 1024;
    assert.equal(checkDeclaredUploadSize(new Headers(), max)?.status, 411);
    assert.equal(checkDeclaredUploadSize(new Headers({ "content-length": "abc" }), max)?.status, 411);
    assert.equal(checkDeclaredUploadSize(new Headers({ "content-length": String(10 * max) }), max)?.status, 413);
    assert.equal(checkDeclaredUploadSize(new Headers({ "content-length": String(max) }), max), null);
  });

  it("liest das Belegkontingent aus RECEIPTS_QUOTA_MB", async () => {
    const { receiptsQuotaBytes } = await import("../../src/lib/upload-limits");
    const MB = 1024 * 1024;
    assert.equal(receiptsQuotaBytes({}), 500 * MB);
    assert.equal(receiptsQuotaBytes({ RECEIPTS_QUOTA_MB: "50" }), 50 * MB);
    assert.equal(receiptsQuotaBytes({ RECEIPTS_QUOTA_MB: "0" }), 0);
    assert.equal(receiptsQuotaBytes({ RECEIPTS_QUOTA_MB: "-3" }), 500 * MB);
    assert.equal(receiptsQuotaBytes({ RECEIPTS_QUOTA_MB: "viel" }), 500 * MB);
  });

  it("summiert die Dateigrößen eines Verzeichnisses", async () => {
    const { directorySizeBytes } = await import("../../src/lib/upload-limits");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cashflow-quota-"));
    try {
      assert.equal(directorySizeBytes(path.join(dir, "fehlt")), 0);
      fs.writeFileSync(path.join(dir, "a.webp"), Buffer.alloc(1000));
      fs.writeFileSync(path.join(dir, "b.webp"), Buffer.alloc(234));
      assert.equal(directorySizeBytes(dir), 1234);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
