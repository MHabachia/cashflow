import { test } from "node:test";
import assert from "node:assert/strict";
import { getAppBaseUrl, createAbsoluteUrl } from "../../src/lib/url";
import { NextRequest } from "next/server";

const URL_ENV_KEYS = [
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "BETTER_AUTH_URL",
  "TRUSTED_HOSTS",
] as const;

function withEnv(values: Partial<Record<(typeof URL_ENV_KEYS)[number], string>>, fn: () => void) {
  const saved = Object.fromEntries(URL_ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of URL_ENV_KEYS) delete process.env[k];
  Object.assign(process.env, values);
  try {
    fn();
  } finally {
    for (const k of URL_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("URL Resolver & 0.0.0.0 Sanitizer (src/lib/url.ts)", async (t) => {
  await t.test("ersetzt 0.0.0.0 Bind-Adresse durch localhost für sichere Browser-Navigation", () => {
    withEnv({}, () => {
      const req = new NextRequest("http://0.0.0.0:3000/api/bank-sync/authorize", {
        headers: { host: "0.0.0.0:3000" },
      });
      const url = getAppBaseUrl(req);
      assert.doesNotMatch(url, /0\.0\.0\.0/);
      assert.match(url, /localhost:3000/);
    });
  });

  await t.test("erzeugt saubere absolute URLs ohne doppelte Slashes", () => {
    withEnv({}, () => {
      const req = new NextRequest("http://localhost:3000/test");
      const targetUrl = createAbsoluteUrl("/settings?bank_connected=1", req);
      assert.equal(targetUrl.pathname, "/settings");
      assert.equal(targetUrl.searchParams.get("bank_connected"), "1");
      assert.doesNotMatch(targetUrl.toString(), /0\.0\.0\.0/);
    });
  });

  await t.test("nutzt APP_URL hinter Reverse-Proxy", () => {
    withEnv({ APP_URL: "https://cashflow.meinedomain.de" }, () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/bank-sync/authorize", {
        headers: {
          "x-forwarded-host": "cashflow.meinedomain.de",
          "x-forwarded-proto": "https",
        },
      });
      assert.equal(getAppBaseUrl(req), "https://cashflow.meinedomain.de");
    });
  });

  await t.test("ignoriert manipulierten Host/X-Forwarded-Host (Host-Header-Injection)", () => {
    withEnv({ APP_URL: "https://cashflow.meinedomain.de" }, () => {
      const req = new NextRequest("http://127.0.0.1:3000/api/bank-sync/authorize", {
        headers: {
          "x-forwarded-host": "evil.example.com",
          "x-forwarded-proto": "https",
          host: "evil.example.com",
        },
      });
      assert.equal(getAppBaseUrl(req), "https://cashflow.meinedomain.de");
      assert.equal(
        createAbsoluteUrl("/banking", req).toString(),
        "https://cashflow.meinedomain.de/banking"
      );
    });
  });

  await t.test("ignoriert fremde Hosts auch ohne APP_URL", () => {
    withEnv({}, () => {
      const req = new NextRequest("http://localhost:3000/", {
        headers: { "x-forwarded-host": "evil.example.com" },
      });
      assert.equal(getAppBaseUrl(req), "http://localhost:3000");
    });
  });

  await t.test("akzeptiert zusätzliche Hosts aus TRUSTED_HOSTS", () => {
    withEnv(
      { APP_URL: "https://cashflow.meinedomain.de", TRUSTED_HOSTS: "kosten.lan:3000" },
      () => {
        const req = new NextRequest("http://kosten.lan:3000/", {
          headers: { host: "kosten.lan:3000" },
        });
        assert.equal(getAppBaseUrl(req), "http://kosten.lan:3000");
      }
    );
  });
});
