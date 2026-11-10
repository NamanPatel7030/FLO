// supabase/migrations/0009_usage_days.sql (and everything before it) against a local Postgres with the
// Supabase stand-in. Checks the tables are closed to API roles, the 10-minute ping guard, the phone request
// counter, the opt-in counts upsert, and cascades. The SQL mirrors lib/usage.ts.
//   FLO_TEST_DATABASE_URL=postgres://postgres@localhost:54329/flo_test node --test tests/usage-migration.test.mjs
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, root, seedUser, testDbUrl } from "./helpers.mjs";

const url = testDbUrl();
const skip = url ? false : "set FLO_TEST_DATABASE_URL to a local Postgres to run";
let sql;

before(async () => {
  if (skip) return;
  sql = connect(url);
  await sql.unsafe(readFileSync(resolve(root, "supabase/tests/supabase-stub.sql"), "utf8"));
  const dir = resolve(root, "supabase/migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await sql.unsafe(readFileSync(resolve(dir, f), "utf8"));
  // re-runnable
  await sql.unsafe(readFileSync(resolve(dir, "0009_usage_days.sql"), "utf8"));
});
after(async () => sql?.end());

// lib/usage.ts bumpUsage, with `now` injectable for the test
const bump = (userId, surface, at) => sql`
  insert into app.usage_days as u (user_id, day, surface, pings, updated_at)
  values (${userId}, (${at}::timestamptz at time zone 'utc')::date, ${surface}, 1, ${at}::timestamptz)
  on conflict (user_id, day, surface) do update
     set pings = u.pings + 1, updated_at = ${at}::timestamptz
   where u.updated_at < ${at}::timestamptz - interval '10 minutes'`;

test("usage tables: RLS on, no policies, no API-role privileges", { skip }, async () => {
  const rows = await sql`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                          where n.nspname = 'app' and c.relname in ('usage_days', 'usage_counts')`;
  assert.equal(rows.length, 2);
  for (const r of rows) assert.equal(r.relrowsecurity, true, r.relname);
  for (const role of ["anon", "authenticated"]) {
    const [p] = await sql`select has_table_privilege(${role}, 'app.usage_days', 'select') as a, has_table_privilege(${role}, 'app.usage_counts', 'insert') as b`;
    assert.deepEqual(p, { a: false, b: false }, role);
  }
});

test("a ping counts at most once per 10 minutes per surface", { skip }, async () => {
  const u = await seedUser(sql);
  for (const at of ["2026-11-10T09:00:00Z", "2026-11-10T09:04:00Z", "2026-11-10T09:09:59Z", "2026-11-10T09:10:01Z", "2026-11-10T09:30:00Z"]) await bump(u.id, "desktop", at);
  await bump(u.id, "phone", "2026-11-10T09:04:00Z");
  await bump(u.id, "desktop", "2026-11-11T00:01:00Z"); // next UTC day: new row
  const rows = await sql`select day::text, surface, pings from app.usage_days where user_id = ${u.id} order by day, surface`;
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { day: "2026-11-10", surface: "desktop", pings: 3 },
    { day: "2026-11-10", surface: "phone", pings: 1 },
    { day: "2026-11-11", surface: "desktop", pings: 1 },
  ]);
  await assert.rejects(sql`insert into app.usage_days (user_id, day, surface) values (${u.id}, '2026-11-10', 'tablet')`, /check/);
});

test("phone requests are counted without touching the ping guard", { skip }, async () => {
  const u = await seedUser(sql);
  const count = () => sql`
    insert into app.usage_days as u (user_id, day, surface, pings, requests, updated_at)
    values (${u.id}, (now() at time zone 'utc')::date, 'phone', 0, 1, now() - interval '1 hour')
    on conflict (user_id, day, surface) do update set requests = u.requests + 1`;
  await count();
  await count();
  await bump(u.id, "phone", new Date().toISOString()); // first ping of the day still lands
  const [r] = await sql`select pings, requests from app.usage_days where user_id = ${u.id}`;
  assert.deepEqual({ ...r }, { pings: 1, requests: 2 });
});

test("opt-in counts upsert to the latest total, bounded, deleted with the user", { skip }, async () => {
  const u = await seedUser(sql);
  const save = (rows) => sql`
    insert into app.usage_counts (user_id, day, kind, n, updated_at)
    select ${u.id}::uuid, x.day, x.kind, x.n, now() from jsonb_to_recordset(${JSON.stringify(rows)}::text::jsonb) as x(day date, kind text, n int)
    on conflict (user_id, day, kind) do update set n = excluded.n, updated_at = now()`;
  await save([{ day: "2026-11-10", kind: "dictations", n: 3 }, { day: "2026-11-10", kind: "words", n: 50 }]);
  await save([{ day: "2026-11-10", kind: "dictations", n: 5 }]);
  const rows = await sql`select kind, n from app.usage_counts where user_id = ${u.id} order by kind`;
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ kind: "dictations", n: 5 }, { kind: "words", n: 50 }]);
  await assert.rejects(save([{ day: "2026-11-10", kind: "transcript", n: 1 }]), /check/);
  await assert.rejects(save([{ day: "2026-11-10", kind: "words", n: -1 }]), /check/);
  await bump(u.id, "desktop", "2026-11-10T09:00:00Z");
  await sql`delete from auth.users where id = ${u.id}`;
  const [left] = await sql`select (select count(*)::int from app.usage_counts where user_id = ${u.id}) + (select count(*)::int from app.usage_days where user_id = ${u.id}) as n`;
  assert.equal(left.n, 0);
});
