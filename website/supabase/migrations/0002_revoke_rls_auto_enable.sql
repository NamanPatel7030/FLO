-- Supabase's "auto-enable RLS" event-trigger helper is created in public with default EXECUTE grants,
-- which the security advisor flags (SECURITY DEFINER callable by anon/authenticated). Clients never need it;
-- the event trigger fires regardless of these grants.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
