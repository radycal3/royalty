-- Parámetros globales del sistema
create table public.configuracion (
  id uuid primary key default gen_random_uuid(),
  clave text unique not null,
  valor text not null,
  descripcion text,
  updated_at timestamptz not null default now()
);

alter table public.configuracion enable row level security;

create policy "admin_full_access" on public.configuracion
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );

-- Empleado puede leer config de metas (necesario para vista empleado)
create policy "empleado_read" on public.configuracion
  for select using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'empleado')
  );
