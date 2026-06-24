-- 028_empleados.sql
-- Sistema de empleados: limpieza de tablas muertas de Fase 0 + metas_equipo.
--
-- Roles y RLS de usuarios/ingredientes para empleados YA EXISTEN desde
-- 001_usuarios.sql (policy empleado_read_self) y 004_ingredientes.sql
-- (policy empleado_read). No se tocan migraciones ya aplicadas.

-- 1. Limpieza: tablas de Fase 0 vacías, sin uso en el código, superadas por
--    `equipo` (017) y por el módulo de stock que se crea en 029_stock.sql.
DROP TABLE IF EXISTS public.asistencia CASCADE;
DROP TABLE IF EXISTS public.empleados CASCADE;
DROP TABLE IF EXISTS public.stock_conteos CASCADE;
DROP TABLE IF EXISTS public.stock_compras CASCADE;

-- 2. Tabla metas_equipo: niveles de recompensa por margen neto, configurables
--    por Lucas, mostrados en el dashboard motivacional de empleados (/panel).
--    Estructura relacional (no configuracion key-value) porque son varias
--    filas con relación entre sí (niveles ordenados).
CREATE TABLE IF NOT EXISTS metas_equipo (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nivel INTEGER NOT NULL CHECK (nivel BETWEEN 1 AND 5),
  margen_minimo NUMERIC NOT NULL,
  descripcion TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'gray' CHECK (color IN ('gray', 'green', 'yellow', 'red')),
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (nivel)
);

COMMENT ON TABLE metas_equipo IS
  'Niveles de recompensa por margen neto para el dashboard de empleados. La descripcion no debe incluir montos en pesos (principio 2.10: empleados nunca ven montos en pesos).';

ALTER TABLE metas_equipo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_full_access_metas" ON metas_equipo
  FOR ALL USING (public.get_my_rol() = 'admin');

CREATE POLICY "empleado_read_metas" ON metas_equipo
  FOR SELECT USING (public.get_my_rol() = 'empleado');

-- Seed inicial orientativo (Lucas lo edita desde Configuración).
INSERT INTO metas_equipo (nivel, margen_minimo, descripcion, color) VALUES
  (1, 0,  'Sin bono — sigamos mejorando', 'gray'),
  (2, 10, 'Bono básico', 'yellow'),
  (3, 20, 'Bono medio', 'green'),
  (4, 30, 'Bono premium', 'green')
ON CONFLICT (nivel) DO NOTHING;
