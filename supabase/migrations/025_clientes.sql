-- 025_clientes.sql
-- Captura de identidad de cliente desde Pedix.
--
-- El teléfono (Celular en el Excel) es el identificador primario. Se
-- normaliza antes de guardarlo: sin guiones, espacios ni caracteres no
-- numéricos, para que "341-621-4667" y "3416214667" sean el mismo cliente.
--
-- La columna cliente_id en pedidos es nullable: pedidos ya importados
-- (sin teléfono capturado) y pedidos sin teléfono en Pedix quedan con
-- NULL, lo cual es correcto y honesto — no se inventa un cliente genérico.
--
-- Se guardan también cliente_celular y cliente_nombre directamente en
-- pedidos (desnormalizado), igual que el patrón ya usado en
-- cadetes_jornadas con los valores congelados. El dato que era verdad
-- en el momento del pedido queda guardado en la fila del pedido,
-- independientemente de si el cliente después cambia su número o nombre.
--
-- Se agrega también cliente_direccion (campo "Dirección" del Excel de
-- Pedix), útil para análisis de zona de cobertura en el futuro.

CREATE TABLE IF NOT EXISTS clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  celular text NOT NULL,
  nombre_referencia text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (celular)
);

CREATE INDEX IF NOT EXISTS idx_clientes_celular ON clientes (celular);

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS cliente_id uuid REFERENCES clientes(id),
  ADD COLUMN IF NOT EXISTS cliente_celular text,
  ADD COLUMN IF NOT EXISTS cliente_nombre text,
  ADD COLUMN IF NOT EXISTS cliente_direccion text;

CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_id ON pedidos (cliente_id);

ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY clientes_select ON clientes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY clientes_insert ON clientes
  FOR INSERT TO authenticated
  WITH CHECK (public.get_my_rol() IN ('admin', 'empleado'));

CREATE POLICY clientes_update ON clientes
  FOR UPDATE TO authenticated
  USING (public.get_my_rol() IN ('admin', 'empleado'));
