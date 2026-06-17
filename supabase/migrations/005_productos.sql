-- Productos
create table public.productos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  categoria text not null check (categoria in ('hamburguesa', 'acompanamiento', 'bebida', 'combo')),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Historial de precios (append-only)
create table public.productos_precios (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete restrict,
  precio numeric not null check (precio >= 0),
  fecha_vigencia date not null,
  created_at timestamptz not null default now()
);

create index idx_precios_lookup
  on public.productos_precios(producto_id, fecha_vigencia desc);

-- Recetas (composición de productos)
create table public.recetas (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos(id) on delete cascade,
  ingrediente_id uuid not null references public.ingredientes(id) on delete restrict,
  cantidad numeric not null check (cantidad > 0),
  constraint unique_receta_item unique (producto_id, ingrediente_id)
);

-- Mapeo de nombres Pedix a productos internos
create table public.mapeo_pedix (
  id uuid primary key default gen_random_uuid(),
  nombre_pedix text unique not null,
  producto_id uuid not null references public.productos(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- RLS
alter table public.productos enable row level security;
alter table public.productos_precios enable row level security;
alter table public.recetas enable row level security;
alter table public.mapeo_pedix enable row level security;

create policy "admin_full_access" on public.productos
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );

create policy "admin_full_access" on public.productos_precios
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );

create policy "admin_full_access" on public.recetas
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );

create policy "admin_full_access" on public.mapeo_pedix
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );

-- Empleado: lectura de productos (para ver en panel)
create policy "empleado_read" on public.productos
  for select using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'empleado')
  );
