-- 035_meta_ads.sql
-- Importación de reportes de Meta Ads Manager. Una fila por semana
-- operativa — reimportar la misma semana reemplaza la fila (UNIQUE
-- periodo_desde) y el gasto_operativo que generó.
--
-- Admin-only: gasto_usd/tipo_cambio/gasto_ars son montos en pesos
-- (principio 2.10). No se tocan gastos_operativos ni periodos existentes
-- — esta tabla es puramente aditiva.

CREATE TABLE IF NOT EXISTS meta_ads_importaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_desde date NOT NULL,
  periodo_hasta date NOT NULL,

  -- Gasto generado en gastos_operativos (categoria='publicidad'). Puede
  -- ser null si el gasto en ARS fue $0 (gastos_operativos.monto exige > 0).
  gasto_operativo_id uuid REFERENCES gastos_operativos(id) ON DELETE SET NULL,

  gasto_usd numeric NOT NULL CHECK (gasto_usd >= 0),
  tipo_cambio numeric NOT NULL CHECK (tipo_cambio > 0),
  gasto_ars numeric NOT NULL CHECK (gasto_ars >= 0),

  alcance integer,
  impresiones integer,
  clics integer,
  resultados integer,

  nombre_archivo text,
  registrado_por uuid REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (periodo_desde)
);

COMMENT ON TABLE meta_ads_importaciones IS
  'Importación de reportes de Meta Ads Manager (CSV) por semana operativa. Crea/reemplaza el gasto de categoria=publicidad correspondiente en gastos_operativos. No modifica periodos ya cerrados — ver handoff sobre cómo re-cerrar una semana si se quiere actualizar también el snapshot.';

CREATE INDEX IF NOT EXISTS idx_meta_ads_periodo ON meta_ads_importaciones(periodo_desde);

ALTER TABLE meta_ads_importaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_full_access_meta_ads" ON meta_ads_importaciones
  FOR ALL USING (public.get_my_rol() = 'admin');
