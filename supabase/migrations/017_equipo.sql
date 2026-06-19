-- 017_equipo.sql
-- Fase 3.1: CRUD de miembros del equipo.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Tabla equipo
-- ══════════════════════════════════════════════════════════════════════════════
-- Personas que trabajan en Royalty. No son cuentas de login (eso es `usuarios`).
-- Un cadete no necesita cuenta en el sistema.

CREATE TABLE IF NOT EXISTS equipo (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL
    CHECK (rol IN ('cadete', 'cocina', 'caja', 'general')),
  telefono TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE equipo IS
  'Miembros del equipo operativo de Royalty (no confundir con usuarios/cuentas de login)';

-- Índice para filtros por rol
CREATE INDEX IF NOT EXISTS idx_equipo_rol ON equipo(rol);

-- Índice para filtros por estado
CREATE INDEX IF NOT EXISTS idx_equipo_activo ON equipo(activo);

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. RLS
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE equipo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_equipo" ON equipo
  FOR SELECT
  USING (public.get_my_rol() = 'admin');

CREATE POLICY "admin_insert_equipo" ON equipo
  FOR INSERT
  WITH CHECK (public.get_my_rol() = 'admin');

CREATE POLICY "admin_update_equipo" ON equipo
  FOR UPDATE
  USING (public.get_my_rol() = 'admin');

CREATE POLICY "admin_delete_equipo" ON equipo
  FOR DELETE
  USING (public.get_my_rol() = 'admin');
