-- Cambios estratégicos (laboratorio)
create table public.cambios_estrategicos (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references public.periodos_operativos(id) on delete restrict,
  tipo text not null check (tipo in ('creativo', 'producto', 'horario', 'promocion', 'precio', 'otro')),
  titulo text not null,
  descripcion text,
  created_at timestamptz not null default now()
);

alter table public.cambios_estrategicos enable row level security;

create policy "admin_full_access" on public.cambios_estrategicos
  for all using (
    exists (select 1 from public.usuarios where id = auth.uid() and rol = 'admin')
  );
