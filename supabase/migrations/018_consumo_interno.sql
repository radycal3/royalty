-- 018_consumo_interno.sql
-- Fase 3.1: Consumo interno del equipo.
-- Registra productos consumidos internamente (comida del equipo).
-- Impacta costos del período pero NUNCA ventas.
-- Congela costos e ingredientes con la misma lógica que importación Pedix.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Tabla consumo_interno (cabecera)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS consumo_interno (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha DATE NOT NULL,
  nota TEXT,
  registrado_por UUID REFERENCES usuarios(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE consumo_interno IS
  'Registro de consumo interno (comida del equipo). No genera venta.';

CREATE INDEX IF NOT EXISTS idx_consumo_fecha
  ON consumo_interno(fecha);

CREATE INDEX IF NOT EXISTS idx_consumo_periodo
  ON consumo_interno(periodo_de(fecha));

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Tabla consumo_interno_lineas (productos consumidos)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS consumo_interno_lineas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  consumo_id UUID NOT NULL REFERENCES consumo_interno(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES productos(id),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  costo_unitario_calculado NUMERIC(12,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE consumo_interno_lineas IS
  'Productos consumidos internamente con costo congelado al registrar.';

CREATE INDEX IF NOT EXISTS idx_cil_consumo
  ON consumo_interno_lineas(consumo_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Tabla consumo_interno_ingredientes (congelación de ingredientes)
-- ══════════════════════════════════════════════════════════════════════════════
-- Estructura idéntica a pedidos_lineas_ingredientes.

CREATE TABLE IF NOT EXISTS consumo_interno_ingredientes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  consumo_linea_id UUID NOT NULL REFERENCES consumo_interno_lineas(id) ON DELETE CASCADE,
  ingrediente_id UUID NOT NULL REFERENCES ingredientes(id),

  cantidad_receta NUMERIC(10,4) NOT NULL,
  cantidad_consumida NUMERIC(10,4) NOT NULL,

  costo_unitario_ingrediente NUMERIC(12,4) NOT NULL DEFAULT 0,
  costo_compra_usado NUMERIC(12,4) NOT NULL DEFAULT 0,
  factor_conversion_usado NUMERIC(10,4) NOT NULL DEFAULT 1,

  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE consumo_interno_ingredientes IS
  'Ingredientes congelados del consumo interno. Misma estructura que pedidos_lineas_ingredientes.';

CREATE INDEX IF NOT EXISTS idx_cii_linea
  ON consumo_interno_ingredientes(consumo_linea_id);

CREATE INDEX IF NOT EXISTS idx_cii_ingrediente
  ON consumo_interno_ingredientes(ingrediente_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. RLS para las 3 tablas
-- ══════════════════════════════════════════════════════════════════════════════

-- consumo_interno
ALTER TABLE consumo_interno ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_ci" ON consumo_interno
  FOR SELECT USING (public.get_my_rol() = 'admin');
CREATE POLICY "admin_insert_ci" ON consumo_interno
  FOR INSERT WITH CHECK (public.get_my_rol() = 'admin');
CREATE POLICY "admin_delete_ci" ON consumo_interno
  FOR DELETE USING (public.get_my_rol() = 'admin');

-- consumo_interno_lineas
ALTER TABLE consumo_interno_lineas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_cil" ON consumo_interno_lineas
  FOR SELECT USING (public.get_my_rol() = 'admin');
CREATE POLICY "admin_insert_cil" ON consumo_interno_lineas
  FOR INSERT WITH CHECK (public.get_my_rol() = 'admin');
CREATE POLICY "admin_delete_cil" ON consumo_interno_lineas
  FOR DELETE USING (public.get_my_rol() = 'admin');

-- consumo_interno_ingredientes
ALTER TABLE consumo_interno_ingredientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_cii" ON consumo_interno_ingredientes
  FOR SELECT USING (public.get_my_rol() = 'admin');
CREATE POLICY "admin_insert_cii" ON consumo_interno_ingredientes
  FOR INSERT WITH CHECK (public.get_my_rol() = 'admin');
CREATE POLICY "admin_delete_cii" ON consumo_interno_ingredientes
  FOR DELETE USING (public.get_my_rol() = 'admin');
