-- 015_importacion_extras.sql
-- Fase 2: Soporte para anulación de importaciones + congelación de consumo de ingredientes.
-- PENDIENTE DE EJECUTAR EN SUPABASE.

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Campo estado en importaciones (para anulación futura sin borrar datos)
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE importaciones
  ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'activa'
  CHECK (estado IN ('activa', 'anulada'));

COMMENT ON COLUMN importaciones.estado IS
  'activa = importación vigente, anulada = importación descartada (datos se conservan pero no computan)';

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Tabla pedidos_lineas_ingredientes (congelación de consumo)
-- Cada fila congela: qué ingrediente, cuánto consumió, y a qué costo unitario,
-- todo al momento de la importación. Cambios futuros en recetas NO afectan esto.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pedidos_lineas_ingredientes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pedido_linea_id UUID NOT NULL REFERENCES pedidos_lineas(id) ON DELETE CASCADE,
  ingrediente_id UUID NOT NULL REFERENCES ingredientes(id),

  -- Receta congelada
  cantidad_receta NUMERIC(10,4) NOT NULL,        -- cantidad de receta por unidad de producto
  cantidad_consumida NUMERIC(10,4) NOT NULL,     -- cantidad_receta × cantidad_vendida

  -- Costo congelado
  costo_unitario_ingrediente NUMERIC(12,4) NOT NULL DEFAULT 0,  -- costo de este ingrediente por unidad de producto
  costo_compra_usado NUMERIC(12,4) NOT NULL DEFAULT 0,          -- costo_compra vigente al momento
  factor_conversion_usado NUMERIC(10,4) NOT NULL DEFAULT 1,     -- factor_conversion vigente al momento

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Índice para consultas por línea de pedido
CREATE INDEX IF NOT EXISTS idx_pli_pedido_linea
  ON pedidos_lineas_ingredientes(pedido_linea_id);

-- Índice para consultas de consumo por ingrediente
CREATE INDEX IF NOT EXISTS idx_pli_ingrediente
  ON pedidos_lineas_ingredientes(ingrediente_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. RLS para pedidos_lineas_ingredientes
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE pedidos_lineas_ingredientes ENABLE ROW LEVEL SECURITY;

-- Admin puede leer todo
CREATE POLICY "admin_read_pli" ON pedidos_lineas_ingredientes
  FOR SELECT
  USING (public.get_my_rol() = 'admin');

-- Admin puede insertar (solo vía server actions con service role, pero por seguridad)
CREATE POLICY "admin_insert_pli" ON pedidos_lineas_ingredientes
  FOR INSERT
  WITH CHECK (public.get_my_rol() = 'admin');

-- Admin puede eliminar (para rollback de importaciones fallidas)
CREATE POLICY "admin_delete_pli" ON pedidos_lineas_ingredientes
  FOR DELETE
  USING (public.get_my_rol() = 'admin');
