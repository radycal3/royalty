-- Empleados
create table public.empleados (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  rol text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Asistencia diaria
create table public.asistencia (
  id uuid primary key default gen_random_uuid(),
  empleado_id uuid not null references public.empleados(id) on delete restrict,
  fecha date not null,
  presente boolean not null default true,
  registrado_por uuid not null references public.usuarios(id),
  created_at timestamptz not null default now(),
  constraint unique_asistencia unique (empleado_id, fecha)
);

-- RLS
alter table public.empleados enable row level security;
alter table public.asistencia enable row level security;

create policy "admin_full_access" on public.empleados
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );

create policy "admin_full_access" on public.asistencia
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );

create policy "empleado_read" on public.empleados
  for select using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'empleado')
  );

create policy "empleado_read" on public.asistencia
  for select using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'empleado')
  );
