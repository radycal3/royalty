-- 023_periodos_detalle.sql
-- Auditoría Financiera Inteligente — detalle congelado por período cerrado.
--
-- Amplía qué se congela en cerrarPeriodo(): además de los 14 campos
-- agregados que ya viven en 'periodos', cada cierre NUEVO también guarda
-- el detalle por producto y por categoría de gasto, tal como estaban en
-- el momento exacto del cierre.
--
-- IMPORTANTE: esto aplica solo a cierres realizados DESPUÉS de esta
-- migración. Las semanas ya cerradas (ej. la semana del 12-14 jun) NO
-- van a tener filas acá — quedan como períodos "sin detalle disponible".
-- El código de comparación/auditoría debe tratar la ausencia de filas
-- como información faltante, nunca como "todo en cero".
--
-- Ninguna fila de 'periodos' se modifica. Esta migración es puramente
-- aditiva.

CREATE TABLE IF NOT EXISTS periodos_productos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_id uuid NOT NULL REFERENCES periodos(id) ON DELETE CASCADE,
  producto_nombre text NOT NULL,
  unidades integer NOT NULL,
  venta numeric(12, 2) NOT NULL,
  costo numeric(12, 2) NOT NULL,
  beneficio numeric(12, 2) NOT NULL,
  margen numeric(6, 2) NOT NULL,
  participacion numeric(6, 2) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_periodos_productos_periodo ON periodos_productos (periodo_id);

CREATE TABLE IF NOT EXISTS periodos_gastos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_id uuid NOT NULL REFERENCES periodos(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  categoria text NOT NULL,
  total numeric(12, 2) NOT NULL,
  legacy boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_periodos_gastos_periodo ON periodos_gastos (periodo_id);

ALTER TABLE periodos_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE periodos_gastos ENABLE ROW LEVEL SECURITY;

CREATE POLICY periodos_productos_select ON periodos_productos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY periodos_productos_insert ON periodos_productos
  FOR INSERT TO authenticated
  WITH CHECK (public.get_my_rol() IN ('admin', 'empleado'));

CREATE POLICY periodos_gastos_select ON periodos_gastos
  FOR SELECT TO authenticated USING (true);

CREATE POLICY periodos_gastos_insert ON periodos_gastos
  FOR INSERT TO authenticated
  WITH CHECK (public.get_my_rol() IN ('admin', 'empleado'));

-- Sin políticas de UPDATE/DELETE individuales: el detalle se borra
-- únicamente en cascada si se borra el período entero (mismo criterio que
-- ya rige para 'periodos': un cierre no se edita, se borra y se rehace).
