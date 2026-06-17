-- Tabla de usuarios vinculada a Supabase Auth
create table public.usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  nombre text not null,
  rol text not null check (rol in ('admin', 'empleado')),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.usuarios enable row level security;

-- Admin: acceso total
create policy "admin_full_access" on public.usuarios
  for all using (
    exists (select 1 from public.usuarios u where u.id = auth.uid() and u.rol = 'admin')
  );

-- Empleado: solo puede ver su propio registro
create policy "empleado_read_self" on public.usuarios
  for select using (id = auth.uid());
