-- Gastos de publicidad
create table public.gastos_publicidad (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  usd_invertidos numeric not null check (usd_invertidos > 0),
  cotizacion_dolar numeric not null check (cotizacion_dolar > 0),
  monto_ars numeric not null,
  descripcion text,
  periodo_id uuid references public.periodos_operativos(id),
  created_at timestamptz not null default now()
);

-- Gastos de equipo (sueldos)
create table public.gastos_equipo (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  empleado_id uuid not null references public.empleados(id) on delete restrict,
  monto numeric not null check (monto > 0),
  descripcion text,
  periodo_id uuid references public.periodos_operativos(id),
  created_at timestamptz not null default now()
);

-- Gastos de cadetería (pago por noche)
create table public.gastos_cadeteria (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  cadete_id uuid not null references public.cadetes(id) on delete restrict,
  viajes_realizados integer not null check (viajes_realizados >= 0),
  base_minima_aplicada numeric not null,
  valor_viaje_aplicado numeric not null,
  pago_calculado numeric not null,
  supero_base boolean not null,
  periodo_id uuid references public.periodos_operativos(id),
  created_at timestamptz not null default now(),
  constraint unique_cadete_fecha unique (cadete_id, fecha)
);

-- Consumo interno (generado automáticamente)
create table public.consumo_interno (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  tipo text not null check (tipo in ('empleado', 'cadete')),
  persona_id uuid not null,
  producto_id uuid not null references public.productos(id) on delete restrict,
  cantidad integer not null default 1,
  costo_unitario numeric not null,
  periodo_id uuid references public.periodos_operativos(id),
  created_at timestamptz not null default now()
);

-- Índices
create index idx_gastos_pub_periodo on public.gastos_publicidad(periodo_id);
create index idx_gastos_equipo_periodo on public.gastos_equipo(periodo_id);
create index idx_gastos_cadeteria_periodo on public.gastos_cadeteria(periodo_id);
create index idx_consumo_periodo on public.consumo_interno(periodo_id);

-- RLS
alter table public.gastos_publicidad enable row level security;
alter table public.gastos_equipo enable row level security;
alter table public.gastos_cadeteria enable row level security;
alter table public.consumo_interno enable row level security;

create policy "admin_full_access" on public.gastos_publicidad
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );

create policy "admin_full_access" on public.gastos_equipo
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );

create policy "admin_full_access" on public.gastos_cadeteria
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );

create policy "admin_full_access" on public.consumo_interno
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );
