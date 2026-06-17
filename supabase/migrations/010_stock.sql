-- Conteos de stock (inventario físico)
create table public.stock_conteos (
  id uuid primary key default gen_random_uuid(),
  ingrediente_id uuid not null references public.ingredientes(id) on delete restrict,
  cantidad numeric not null check (cantidad >= 0),
  fecha date not null,
  registrado_por uuid not null references public.usuarios(id),
  created_at timestamptz not null default now()
);

create index idx_conteos_lookup
  on public.stock_conteos(ingrediente_id, fecha desc);

-- Compras de ingredientes
create table public.stock_compras (
  id uuid primary key default gen_random_uuid(),
  ingrediente_id uuid not null references public.ingredientes(id) on delete restrict,
  cantidad numeric not null check (cantidad > 0),
  costo_total numeric not null check (costo_total >= 0),
  costo_unitario numeric not null,
  fecha date not null,
  periodo_id uuid references public.periodos_operativos(id),
  created_at timestamptz not null default now()
);

create index idx_compras_periodo on public.stock_compras(periodo_id);

-- RLS
alter table public.stock_conteos enable row level security;
alter table public.stock_compras enable row level security;

create policy "admin_full_access" on public.stock_conteos
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );

-- Empleado puede insertar conteos
create policy "empleado_insert_conteo" on public.stock_conteos
  for insert with check (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'empleado')
  );

create policy "empleado_read_conteo" on public.stock_conteos
  for select using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'empleado')
  );

create policy "admin_full_access" on public.stock_compras
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );
