import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openConfirm } from "../../src/lib/confirm-request";

describe("Rückfragen (useConfirm)", () => {
  it("liefert true bei Bestätigen und false bei Abbrechen", async () => {
    const a = openConfirm(null, { message: "Löschen?" });
    a.next.settle(true);
    assert.equal(await a.promise, true);

    const b = openConfirm(null, { message: "Löschen?" });
    b.next.settle(false);
    assert.equal(await b.promise, false);
  });

  it("beantwortet jede Rückfrage genau einmal", async () => {
    const r = openConfirm(null, { message: "x" });
    r.next.settle(true);
    r.next.settle(false);
    assert.equal(await r.promise, true);
  });

  it("eine neue Rückfrage bricht eine noch offene ab", async () => {
    const first = openConfirm(null, { message: "erste" });
    const second = openConfirm(first.next, { message: "zweite" });
    assert.equal(await first.promise, false);
    second.next.settle(true);
    assert.equal(await second.promise, true);
    assert.equal(second.next.options.message, "zweite");
  });
});
