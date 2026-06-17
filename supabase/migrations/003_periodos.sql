-- Períodos operativos (semanas Vie-Sáb-Dom)
create table public.periodos_operativos (
  id uuid primary key default gen_random_uuid(),
  numero_semana integer not null,
  anio integer not null,
  fecha_inicio date not null,
  fecha_fin date not null,
  estado text not null default 'abierto' check (estado in ('abierto', 'cerrado')),
  cerrado_por uuid references public.usuarios(id),
  cerrado_at timestamptz,
  created_at timestamptz not null default now(),
  constraint unique_periodo unique (numero_semana, anio),
  constraint fechas_validas check (fecha_fin >= fecha_inicio)
);

alter table public.periodos_operativos enable row level security;

create policy "admin_full_access" on public.periodos_operativos
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );

create policy "empleado_read" on public.periodos_operativos
  for select using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'empleado')
  );
