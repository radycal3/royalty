-- Cadetes
create table public.cadetes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.cadetes enable row level security;

create policy "admin_full_access" on public.cadetes
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );
