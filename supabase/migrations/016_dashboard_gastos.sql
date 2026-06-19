-- 016_dashboard_gastos.sql
-- Fase 3: Dashboard, Gastos Operativos y Analítica de Rentabilidad.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Función periodo_de(fecha) — Resuelve a qué viernes pertenece una fecha
-- ══════════════════════════════════════════════════════════════════════════════
-- Royalty opera Vie-Sáb-Dom. Esta función devuelve el viernes de la semana
-- operativa para cualquier fecha:
--   Viernes  → mismo día
--   Sábado   → día - 1
--   Domingo  → día - 2
--   Lun-Jue  → viernes anterior (período que ya cerró)
--
-- ISODOW: 1=Lun, 2=Mar, 3=Mié, 4=Jue, 5=Vie, 6=Sáb, 7=Dom
-- Fórmula: fecha - ((ISODOW - 5 + 7) % 7)

CREATE OR REPLACE FUNCTION periodo_de(fecha date) RETURNS date AS $$
  SELECT fecha - ((EXTRACT(ISODOW FROM fecha)::int - 5 + 7) % 7)::int;
$$ LANGUAGE SQL IMMUTABLE;

COMMENT ON FUNCTION periodo_de(date) IS
  'Devuelve el viernes de la semana operativa (Vie-Sáb-Dom) para una fecha dada';

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Tabla gastos_operativos
-- ══════════════════════════════════════════════════════════════════════════════
-- Registra gastos del negocio por período. Cada gasto tiene categoría y tipo
-- (variable/fijo) para separar en la cascada de rentabilidad.
--
-- Categorías:
--   publicidad  → Meta Ads, campañas            (variable)
--   cadeteria   → Pagos a cadetes               (variable)
--   packaging   → Cajas, bolsitas, stickers...  (variable)
--   sueldos     → Pagos al equipo               (fijo)
--   servicios   → Luz, gas, internet, alquiler  (fijo)
--   impuestos   → Monotributo, IIBB, tasas      (fijo)
--   otros       → Lo que no encaje arriba        (el usuario elige tipo)

CREATE TABLE IF NOT EXISTS gastos_operativos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  fecha DATE NOT NULL,
  categoria TEXT NOT NULL
    CHECK (categoria IN (
      'publicidad', 'cadeteria', 'packaging',
      'sueldos', 'servicios', 'impuestos', 'otros'
    )),
  tipo TEXT NOT NULL
    CHECK (tipo IN ('variable', 'fijo')),
  monto NUMERIC(12,2) NOT NULL
    CHECK (monto > 0),
  nota TEXT,

  registrado_por UUID REFERENCES usuarios(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE gastos_operativos IS
  'Gastos operativos del negocio, asignados a períodos vía periodo_de(fecha)';

-- Índice para consultas por período
CREATE INDEX IF NOT EXISTS idx_gastos_periodo
  ON gastos_operativos(periodo_de(fecha));

-- Índice para consultas por categoría
CREATE INDEX IF NOT EXISTS idx_gastos_categoria
  ON gastos_operativos(categoria);

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. RLS para gastos_operativos
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE gastos_operativos ENABLE ROW LEVEL SECURITY;

-- Admin puede leer todos los gastos
CREATE POLICY "admin_read_gastos" ON gastos_operativos
  FOR SELECT
  USING (public.get_my_rol() = 'admin');

-- Admin puede insertar gastos
CREATE POLICY "admin_insert_gastos" ON gastos_operativos
  FOR INSERT
  WITH CHECK (public.get_my_rol() = 'admin');

-- Admin puede actualizar gastos
CREATE POLICY "admin_update_gastos" ON gastos_operativos
  FOR UPDATE
  USING (public.get_my_rol() = 'admin');

-- Admin puede eliminar gastos
CREATE POLICY "admin_delete_gastos" ON gastos_operativos
  FOR DELETE
  USING (public.get_my_rol() = 'admin');

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Índice funcional en pedidos para consultas por período (performance)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_pedidos_periodo
  ON pedidos(periodo_de(fecha));
