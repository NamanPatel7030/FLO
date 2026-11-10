// supabase/migrations/0010_google.sql (and everything before it) against a local Postgres with the
// Supabase stand-in. Checks the tables are closed to API roles, re-runnable, single-use state/handoff
// semantics (the SQL mirrors lib/db.ts) and cascades.
//   FLO_TEST_DATABASE_URL=postgres://postgres@localhost:54329/flo_test node --test tests/google-migration.test.mjs
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
  await sql.unsafe(readFileSync(resolve(dir, "0010_google.sql"), "utf8"));
});
after(async () => sql?.end());

const rnd = () => Math.random().toString(36).slice(2);

test("google tables: RLS on, no policies, no API-role privileges", { skip }, async () => {
  const rows = await sql`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                          where n.nspname = 'app' and c.relname in ('google_states', 'google_handoffs')`;
  assert.equal(rows.length, 2);
  for (const r of rows) assert.equal(r.relrowsecurity, true, r.relname);
  const [pol] = await sql`select count(*)::int as n from pg_policies where schemaname = 'app' and tablename in ('google_states', 'google_handoffs')`;
  assert.equal(pol.n, 0);
  for (const role of ["anon", "authenticated"]) {
    const [p] = await sql`select has_table_privilege(${role}, 'app.google_states', 'select') as a, has_table_privilege(${role}, 'app.google_handoffs', 'select') as b,
                                 has_table_privilege(${role}, 'app.google_handoffs', 'insert') as c`;
    assert.deepEqual({ ...p }, { a: false, b: false, c: false }, role);
  }
});

test("state: stores scopes, defaults, consumed once, expired never", { skip }, async () => {
  const u = await seedUser(sql);
  const s1 = "st-" + rnd();
  await sql`insert into app.google_states (state, challenge, scopes, user_id, expires_at)
            values (${s1}, 'ch', 'calendar gmail', (select id from public.profiles where id = ${u.id}::uuid), now() + interval '10 minutes')`;
  const consume = (s) => sql`delete from app.google_states where state = ${s} and not used and expires_at > now() returning challenge, user_id, scopes`;
  const [r] = await consume(s1);
  assert.deepEqual({ ...r }, { challenge: "ch", user_id: u.id, scopes: "calendar gmail" });
  assert.equal((await consume(s1)).length, 0);
  const s2 = "st-" + rnd();
  await sql`insert into app.google_states (state, challenge, expires_at) values (${s2}, 'ch', now() - interval '1 second')`;
  assert.equal((await consume(s2)).length, 0);
  const [d] = await sql`select scopes, used from app.google_states where state = ${s2}`;
  assert.deepEqual({ ...d }, { scopes: "", used: false });
});

test("handoff: claimed once with matching challenge and account; email kept beside the blob", { skip }, async () => {
  const u = await seedUser(sql);
  const other = await seedUser(sql);
  const code = "c-" + rnd();
  await sql`insert into app.google_handoffs (code, sealed, challenge, user_id, email, expires_at)
            values (${code}, 'sealed-blob', 'ch', ${u.id}, 'riya@example.com', now() + interval '5 minutes')`;
  const claim = (ch, uid) => sql`
    delete from app.google_handoffs
     where code = ${code} and challenge = ${ch} and not used and expires_at > now()
       and (user_id is null or user_id = ${uid}::uuid)
    returning sealed, email`;
  assert.equal((await claim("wrong", u.id)).length, 0);
  assert.equal((await claim("ch", other.id)).length, 0);
  assert.equal((await claim("ch", null)).length, 0);
  const [r] = await claim("ch", u.id);
  assert.deepEqual({ ...r }, { sealed: "sealed-blob", email: "riya@example.com" });
  assert.equal((await claim("ch", u.id)).length, 0);
  const [d] = await sql`insert into app.google_handoffs (code, sealed, challenge, expires_at) values (${"c-" + rnd()}, 'x', 'ch', now()) returning email`;
  assert.equal(d.email, "");
});

test("deleting the user removes their google rows", { skip }, async () => {
  const u = await seedUser(sql);
  await sql`insert into app.google_states (state, challenge, user_id, expires_at) values (${"st-" + rnd()}, 'ch', ${u.id}, now() + interval '10 minutes')`;
  await sql`insert into app.google_handoffs (code, sealed, challenge, user_id, expires_at) values (${"c-" + rnd()}, 'x', 'ch', ${u.id}, now() + interval '5 minutes')`;
  await sql`delete from auth.users where id = ${u.id}`;
  const [left] = await sql`select (select count(*)::int from app.google_states where user_id = ${u.id}) + (select count(*)::int from app.google_handoffs where user_id = ${u.id}) as n`;
  assert.equal(left.n, 0);
});
