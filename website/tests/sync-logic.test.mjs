// Encrypted sync request validation (no server, no database): node --test tests/sync-logic.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCursor, parsePush, SYNC_LIMITS, validCheck } from "../lib/sync-validate.ts";

const item = (o = {}) => ({ kind: "todos", id: "t1", rev: 1, nonce: "bm9uY2U=", ct: "Y2lwaGVy", deleted: false, ...o });

test("accepts a normal batch and a tombstone", () => {
  const r = parsePush({ items: [item(), item({ id: "t2", deleted: true, ct: "", nonce: "" })] });
  assert.ok("items" in r);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[1].deleted, true);
  assert.equal(r.items[1].ct, "");
});

test("tombstones drop any ciphertext sent with them", () => {
  const r = parsePush({ items: [item({ deleted: true })] });
  assert.ok("items" in r);
  assert.equal(r.items[0].ct, "");
  assert.equal(r.items[0].nonce, "");
});

test("rejects bad shapes", () => {
  for (const body of [null, {}, { items: "x" }, { items: [item({ kind: "Bad Kind" })] }, { items: [item({ id: "" })] }, { items: [item({ rev: -1 })] }, { items: [item({ rev: 1.5 })] }, { items: [item({ ct: "not base64!" })] }, { items: [item({ ct: "" })] }]) {
    assert.ok("error" in parsePush(body), JSON.stringify(body));
  }
});

test("rejects duplicates, oversize items and oversize batches", () => {
  assert.ok("error" in parsePush({ items: [item(), item()] }));
  assert.ok("error" in parsePush({ items: [item({ ct: "A".repeat(SYNC_LIMITS.maxItemBytes + 1) })] }));
  const many = Array.from({ length: SYNC_LIMITS.maxItems + 1 }, (_, i) => item({ id: `t${i}` }));
  assert.ok("error" in parsePush({ items: many }));
});

test("cursor parsing", () => {
  assert.equal(parseCursor(null), 0);
  assert.equal(parseCursor(""), 0);
  assert.equal(parseCursor("42"), 42);
  assert.equal(parseCursor("-1"), null);
  assert.equal(parseCursor("1e3"), null);
  assert.equal(parseCursor("9".repeat(20)), null);
});

test("key check is a bounded opaque string", () => {
  assert.equal(validCheck('{"n":"a","c":"b"}'), true);
  assert.equal(validCheck(""), false);
  assert.equal(validCheck(5), false);
  assert.equal(validCheck("x".repeat(2001)), false);
});
