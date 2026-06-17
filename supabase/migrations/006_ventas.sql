-- Registro de importaciones de archivos Pedix
create table public.importaciones (
  id uuid primary key default gen_random_uuid(),
  nombre_archivo text not null,
  hash_archivo text unique not null,
  fecha_desde date,
  fecha_hasta date,
  total_pedidos integer not null default 0,
  total_productos integer not null default 0,
  importado_por uuid not null references public.usuarios(id),
  created_at timestamptz not null default now()
);

-- Pedidos individuales
create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  importacion_id uuid not null references public.importaciones(id) on delete cascade,
  pedido_pedix_id text unique not null,
  fecha date not null,
  hora time,
  envio_cobrado numeric not null default 0,
  created_at timestamptz not null default now()
);

create index idx_pedidos_fecha on public.pedidos(fecha);

-- Líneas de producto por pedido
create table public.pedidos_lineas (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  producto_id uuid not null references public.productos(id) on delete restrict,
  cantidad integer not null check (cantidad > 0),
  precio_unitario_vendido numeric not null,
  costo_unitario_calculado numeric not null default 0,
  created_at timestamptz not null default now()
);

create index idx_lineas_pedido on public.pedidos_lineas(pedido_id);

-- RLS
alter table public.importaciones enable row level security;
alter table public.pedidos enable row level security;
alter table public.pedidos_lineas enable row level security;

create policy "admin_full_access" on public.importaciones
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );

create policy "admin_full_access" on public.pedidos
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );

create policy "admin_full_access" on public.pedidos_lineas
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );

-- Empleado: lectura de pedidos (cantidades, no precios)
create policy "empleado_read" on public.pedidos
  for select using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'empleado')
  );

create policy "empleado_read" on public.pedidos_lineas
  for select using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'empleado')
  );
