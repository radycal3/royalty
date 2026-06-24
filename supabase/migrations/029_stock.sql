-- 029_stock.sql
-- Módulo de stock: compras de ingredientes (admin) y conteos físicos
-- (empleados + admin), para detectar merma comparando consumo real vs
-- consumo teórico que ya calcula obtenerConsumoIngredientes().

-- 1. Compras de ingredientes — solo admin las registra. Contiene costo_total,
--    por lo tanto NO es legible por empleados (principio 2.10).
CREATE TABLE IF NOT EXISTS compras_ingredientes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha DATE NOT NULL,
  ingrediente_id UUID NOT NULL REFERENCES ingredientes(id),
  cantidad NUMERIC NOT NULL CHECK (cantidad > 0),
  unidad TEXT NOT NULL,
  costo_total NUMERIC NOT NULL CHECK (costo_total >= 0),
  proveedor TEXT,
  nota TEXT,
  registrado_por UUID REFERENCES usuarios(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE compras_ingredientes IS
  'Compras reales de ingredientes, para calcular consumo real = stock_inicio + compras - stock_fin. Solo admin (contiene costo_total).';

CREATE INDEX IF NOT EXISTS idx_compras_ingrediente_fecha
  ON compras_ingredientes(ingrediente_id, fecha);

CREATE INDEX IF NOT EXISTS idx_compras_fecha
  ON compras_ingredientes(fecha);

-- 2. Conteos de stock físico — empleados cargan el conteo de fin de noche,
--    admin puede cargar cualquier tipo (incluido inicio_semana). Sin costos:
--    solo cantidad física, por eso es seguro que empleados lean y escriban.
CREATE TABLE IF NOT EXISTS conteos_stock (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha DATE NOT NULL,
  ingrediente_id UUID NOT NULL REFERENCES ingredientes(id),
  cantidad NUMERIC NOT NULL CHECK (cantidad >= 0),
  unidad TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('inicio_semana', 'fin_noche')),
  nota TEXT,
  registrado_por UUID REFERENCES usuarios(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (fecha, ingrediente_id, tipo)
);

COMMENT ON TABLE conteos_stock IS
  'Conteo físico de stock. inicio_semana = conteo del viernes antes de abrir. fin_noche = conteo al cerrar vie/sáb/dom. El cálculo de merma usa inicio_semana del viernes y fin_noche del domingo de cada período operativo.';

CREATE INDEX IF NOT EXISTS idx_conteos_ingrediente_fecha
  ON conteos_stock(ingrediente_id, fecha);

CREATE INDEX IF NOT EXISTS idx_conteos_fecha
  ON conteos_stock(fecha);

-- 3. RLS
ALTER TABLE compras_ingredientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE conteos_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_full_access_compras" ON compras_ingredientes
  FOR ALL USING (public.get_my_rol() = 'admin');

CREATE POLICY "admin_full_access_conteos" ON conteos_stock
  FOR ALL USING (public.get_my_rol() = 'admin');

CREATE POLICY "empleado_insert_conteo" ON conteos_stock
  FOR INSERT WITH CHECK (public.get_my_rol() = 'empleado');

CREATE POLICY "empleado_read_conteo" ON conteos_stock
  FOR SELECT USING (public.get_my_rol() = 'empleado');

-- Permite que un empleado corrija su propio conteo de la misma noche
-- (ej. error de tipeo) sin poder tocar lo cargado por otra persona.
CREATE POLICY "empleado_update_conteo_propio" ON conteos_stock
  FOR UPDATE USING (public.get_my_rol() = 'empleado' AND registrado_por = auth.uid());

-- 4. Marcar como controlados solo los 4 ingredientes que explican ~79% del
--    costo (sección 14.4 del handoff). El resto queda en false; Lucas puede
--    reactivar cualquiera desde Productos > Ingredientes si lo necesita.
UPDATE ingredientes SET controlado_stock = false
WHERE nombre NOT IN ('Carne', 'Cheddar', 'Panes de papa', 'Papas fritas Buttler');

UPDATE ingredientes SET controlado_stock = true
WHERE nombre IN ('Carne', 'Cheddar', 'Panes de papa', 'Papas fritas Buttler');
