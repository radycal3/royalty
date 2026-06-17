-- Snapshots semanales (generados al cerrar período)
create table public.snapshots_semanales (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid unique not null references public.periodos_operativos(id) on delete cascade,
  ventas_totales numeric not null default 0,
  pedidos_totales integer not null default 0,
  hamburguesas_vendidas integer not null default 0,
  costo_productos numeric not null default 0,
  gasto_publicidad numeric not null default 0,
  gasto_equipo numeric not null default 0,
  gasto_cadeteria numeric not null default 0,
  gasto_consumo_interno numeric not null default 0,
  costos_totales numeric not null default 0,
  beneficio_neto numeric not null default 0,
  margen_neto_pct numeric not null default 0,
  envios_cobrados numeric not null default 0,
  resultado_cadeteria numeric not null default 0,
  ticket_promedio numeric not null default 0,
  cac numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table public.snapshots_semanales enable row level security;

create policy "admin_full_access" on public.snapshots_semanales
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );
