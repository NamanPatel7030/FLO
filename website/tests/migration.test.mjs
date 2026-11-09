// supabase/migrations/0001_init.sql against a local Postgres with a Supabase stand-in (no Supabase needed).
//   FLO_TEST_DATABASE_URL=postgres://postgres@localhost:54329/flo_test node --test tests/migration.test.mjs
// Checks: applies cleanly twice (idempotent), profile trigger + metadata mapping, email sync, RLS on
// profiles (own row only, no email edits, anon sees nothing), app schema closed to API roles, cascades.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, root, seedUser, testDbUrl } from "./helpers.mjs";

const url = testDbUrl();
const skip = url ? false : "set FLO_TEST_DATABASE_URL to a local Postgres to run";
let sql;

before(async () => {
  if (skip) return;
  sql = connect(url);
  await sql.unsafe(readFileSync(resolve(root, "supabase/tests/supabase-stub.sql"), "utf8"));
});
after(async () => sql?.end());

const migration = () => readFileSync(resolve(root, "supabase/migrations/0001_init.sql"), "utf8");

/** Run `fn` as an API role with a JWT `sub`, like PostgREST does; always rolled back. */
async function as(role, sub, fn) {
  let result;
  await sql
    .begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      if (sub) await tx`select set_config('request.jwt.claim.sub', ${sub}, true)`;
      result = await fn(tx);
      throw new Error("rollback");
    })
    .catch((e) => {
      if (e.message !== "rollback") throw e;
    });
  return result;
}
const denied = (p) => p.then(() => assert.fail("expected permission denied"), (e) => assert.match(String(e.message), /permission denied/));

test("migration applies, and applies again (idempotent)", { skip }, async () => {
  await sql.unsafe(migration());
  await sql.unsafe(migration());
  const tables = await sql`select table_schema || '.' || table_name as t from information_schema.tables where table_schema in ('app','public') order by 1`;
  for (const t of ["app.handoffs", "app.mobile_devices", "app.notifications", "app.pair_codes", "app.presence", "app.slack_handoffs", "app.slack_states", "public.profiles"]) {
    assert.ok(tables.some((r) => r.t === t), `missing ${t}`);
  }
  const rls = await sql`select n.nspname || '.' || c.relname as t, c.relrowsecurity as on from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('app','public') and c.relkind = 'r'`;
  for (const r of rls) assert.equal(r.on, true, `RLS off on ${r.t}`);
  const policies = await sql`select count(*)::int as n from pg_policies where schemaname = 'app'`;
  assert.equal(policies[0].n, 0, "app tables must have no policies (deny-all)");
});

test("new auth user → profile from metadata (name / full_name, avatar_url / picture)", { skip }, async () => {
  const a = await seedUser(sql, { name: "Ada Lovelace" });
  const [pa] = await sql`select email, name, avatar_url from public.profiles where id = ${a.id}`;
  assert.deepEqual(pa, { email: a.email, name: "Ada Lovelace", avatar_url: null });

  const [g] = await sql`insert into auth.users (email, raw_user_meta_data) values ('g-' || gen_random_uuid() || '@example.com',
    ${sql.json({ full_name: "Grace Hopper", picture: "https://lh3.googleusercontent.com/a/x" })}) returning id`;
  const [pg] = await sql`select name, avatar_url from public.profiles where id = ${g.id}`;
  assert.deepEqual(pg, { name: "Grace Hopper", avatar_url: "https://lh3.googleusercontent.com/a/x" });

  const [n] = await sql`insert into auth.users (email, raw_user_meta_data) values ('n-' || gen_random_uuid() || '@example.com', null) returning id`;
  const [pn] = await sql`select name from public.profiles where id = ${n.id}`;
  assert.equal(pn.name, "");
});

test("email change and later metadata are mirrored into the profile", { skip }, async () => {
  const u = await seedUser(sql, { name: "" });
  const next = `changed-${Date.now()}@example.com`;
  await sql`update auth.users set email = ${next}, raw_user_meta_data = ${sql.json({ full_name: "Late Name", avatar_url: "https://x/y.png" })} where id = ${u.id}`;
  const [p] = await sql`select email, name, avatar_url from public.profiles where id = ${u.id}`;
  assert.deepEqual(p, { email: next, name: "Late Name", avatar_url: "https://x/y.png" });
  // a name the user already has is never overwritten by provider metadata
  await sql`update auth.users set raw_user_meta_data = ${sql.json({ full_name: "Other" })} where id = ${u.id}`;
  assert.equal((await sql`select name from public.profiles where id = ${u.id}`)[0].name, "Late Name");
});

test("RLS: a user reads and updates only their own profile, and can't change email", { skip }, async () => {
  const a = await seedUser(sql, { name: "A" });
  const b = await seedUser(sql, { name: "B" });
  const seen = await as("authenticated", a.id, (tx) => tx`select id from public.profiles`);
  assert.deepEqual(seen.map((r) => r.id), [a.id]);

  const upd = await as("authenticated", a.id, (tx) => tx`update public.profiles set name = 'A2' where id in (${a.id}, ${b.id}) returning id`);
  assert.deepEqual(upd.map((r) => r.id), [a.id]);

  await as("authenticated", a.id, (tx) => denied(tx`update public.profiles set email = 'evil@example.com' where id = ${a.id}`));
  await as("authenticated", a.id, (tx) => denied(tx`insert into public.profiles (id) values (gen_random_uuid())`));
  await as("authenticated", a.id, (tx) => denied(tx`delete from public.profiles where id = ${a.id}`));
  await as("anon", null, (tx) => denied(tx`select id from public.profiles`));
});

test("app schema is closed to anon and authenticated", { skip }, async () => {
  const a = await seedUser(sql);
  for (const role of ["anon", "authenticated"]) {
    for (const t of ["handoffs", "slack_states", "slack_handoffs", "presence", "mobile_devices", "pair_codes", "notifications"]) {
      await as(role, a.id, (tx) => denied(tx.unsafe(`select 1 from app.${t} limit 1`)));
    }
  }
  const [usage] = await sql`select has_schema_privilege('authenticated', 'app', 'USAGE') as a, has_schema_privilege('anon', 'app', 'USAGE') as b`;
  assert.deepEqual(usage, { a: false, b: false });
});

test("constraints, defaults and ON DELETE CASCADE", { skip }, async () => {
  const u = await seedUser(sql);
  await sql`insert into app.presence (user_id, status) values (${u.id}, 'away')`;
  await assert.rejects(sql`insert into app.presence (user_id, status) values (${u.id}, 'afk') on conflict (user_id) do update set status = excluded.status`, /check/);
  const [d] = await sql`insert into app.mobile_devices (user_id, name, platform, token_hash, push_token) values (${u.id}, 'Pixel', 'android', ${"h-" + u.id}, ${"p-" + u.id}) returning id, created_at, last_seen`;
  assert.match(d.id, /^[0-9a-f-]{36}$/);
  assert.ok(d.created_at instanceof Date && d.last_seen instanceof Date);
  await assert.rejects(sql`insert into app.mobile_devices (user_id, name, platform, token_hash, push_token) values (${u.id}, 'Dup', 'android', ${"h2-" + u.id}, ${"p-" + u.id})`, /duplicate key/);
  const [n] = await sql`insert into app.notifications (user_id, kind, title, data) values (${u.id}, 'reminder', 't', ${sql.json({ a: "1" })}) returning id, data`;
  assert.deepEqual(n.data, { a: "1" });
  await sql`insert into app.handoffs (code, state, user_id, expires_at) values (${"c-" + u.id}, 's', ${u.id}, now() + interval '5 minutes')`;
  await sql`insert into app.pair_codes (code_hash, user_id, expires_at) values (${"pc-" + u.id}, ${u.id}, now() + interval '5 minutes')`;
  await sql`insert into app.slack_states (state, challenge, user_id, expires_at) values (${"st-" + u.id}, 'c', ${u.id}, now())`;
  await sql`insert into app.slack_handoffs (code, sealed, challenge, user_id, expires_at) values (${"sh-" + u.id}, 'x', 'c', ${u.id}, now())`;

  await sql`delete from auth.users where id = ${u.id}`;
  const left = await sql`
    select (select count(*) from public.profiles where id = ${u.id})
         + (select count(*) from app.presence where user_id = ${u.id})
         + (select count(*) from app.mobile_devices where user_id = ${u.id})
         + (select count(*) from app.notifications where user_id = ${u.id})
         + (select count(*) from app.handoffs where user_id = ${u.id})
         + (select count(*) from app.pair_codes where user_id = ${u.id})
         + (select count(*) from app.slack_states where user_id = ${u.id})
         + (select count(*) from app.slack_handoffs where user_id = ${u.id}) as n`;
  assert.equal(Number(left[0].n), 0);
});
