// Startet die Unit-Tests plattformunabhängig (auch unter Windows):
// setzt die Standard-Umgebung und übergibt die Testdateien explizit an tsx.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const testDir = path.join("tests", "unit");
const files = readdirSync(testDir)
  .filter((f) => f.endsWith(".test.ts"))
  .sort()
  .map((f) => path.join(testDir, f));

const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_PATH: process.env.DATABASE_PATH || path.join("data", "test-shared.db"),
  UPLOADS_DIR: process.env.UPLOADS_DIR || path.join("data", "test-uploads"),
};

const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), "--test", ...files], {
  env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
