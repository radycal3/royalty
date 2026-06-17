-- Ingredientes
create table public.ingredientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  unidad_compra text not null,
  unidad_receta text not null,
  factor_conversion numeric not null check (factor_conversion > 0),
  controlado_stock boolean not null default true,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Historial de costos (append-only)
create table public.ingredientes_costos (
  id uuid primary key default gen_random_uuid(),
  ingrediente_id uuid not null references public.ingredientes(id) on delete restrict,
  costo_por_unidad_compra numeric not null check (costo_por_unidad_compra >= 0),
  fecha_vigencia date not null,
  created_at timestamptz not null default now()
);

create index idx_costos_lookup
  on public.ingredientes_costos(ingrediente_id, fecha_vigencia desc);

alter table public.ingredientes enable row level security;
alter table public.ingredientes_costos enable row level security;

-- Admin: acceso total
create policy "admin_full_access" on public.ingredientes
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );

create policy "admin_full_access" on public.ingredientes_costos
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );

-- Empleado: lectura de ingredientes (para stock)
create policy "empleado_read" on public.ingredientes
  for select using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'empleado')
  );
