-- 038_metricas_detalle.sql
-- Detalle de faltantes (producto + cantidad + precio de venta congelado) y
-- quejas de calidad (texto libre) para métricas semanales de equipo.
-- El precio_unitario_venta es el precio de venta al cliente (productos_precios),
-- no el costo interno. Tanto admin como empleado lo ven — es un precio público.

CREATE TABLE metricas_faltantes_detalle (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  metrica_id           uuid        NOT NULL REFERENCES metricas_equipo_semana(id) ON DELETE CASCADE,
  periodo_desde        date        NOT NULL,
  producto_id          uuid        NOT NULL REFERENCES productos(id),
  producto_nombre      text        NOT NULL,
  cantidad             integer     NOT NULL CHECK (cantidad > 0),
  precio_unitario_venta numeric(12,2) NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON metricas_faltantes_detalle(metrica_id);
CREATE INDEX ON metricas_faltantes_detalle(periodo_desde);

COMMENT ON TABLE metricas_faltantes_detalle IS
  'Detalle de ítems faltantes por semana. producto_nombre y precio_unitario_venta congelados al guardar (mismo principio que pedidos_lineas).';

ALTER TABLE metricas_faltantes_detalle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_faltantes" ON metricas_faltantes_detalle
  FOR ALL USING (public.get_my_rol() = 'admin');

CREATE POLICY "empleado_read_faltantes" ON metricas_faltantes_detalle
  FOR SELECT USING (public.get_my_rol() = 'empleado');


CREATE TABLE metricas_quejas_detalle (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  metrica_id  uuid        NOT NULL REFERENCES metricas_equipo_semana(id) ON DELETE CASCADE,
  descripcion text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON metricas_quejas_detalle(metrica_id);

COMMENT ON TABLE metricas_quejas_detalle IS
  'Detalle de quejas de calidad con texto libre por semana.';

ALTER TABLE metricas_quejas_detalle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_quejas" ON metricas_quejas_detalle
  FOR ALL USING (public.get_my_rol() = 'admin');

CREATE POLICY "empleado_read_quejas" ON metricas_quejas_detalle
  FOR SELECT USING (public.get_my_rol() = 'empleado');
