-- Detalle por conjunto de anuncios y anuncio para cada importación de Meta Ads.
-- ON DELETE CASCADE elimina las filas de detalle al borrar la importación padre.

CREATE TABLE IF NOT EXISTS meta_ads_detalle (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  importacion_id          UUID NOT NULL REFERENCES meta_ads_importaciones(id) ON DELETE CASCADE,
  periodo_desde           DATE NOT NULL,
  nombre_campana          TEXT,
  nombre_conjunto         TEXT NOT NULL,
  nombre_anuncio          TEXT,
  tipo_audiencia          TEXT NOT NULL CHECK (tipo_audiencia IN ('caliente', 'fría')),
  gasto_usd               NUMERIC(10, 2) NOT NULL DEFAULT 0,
  gasto_ars               NUMERIC(12, 2) NOT NULL DEFAULT 0,
  alcance                 INTEGER,
  impresiones             INTEGER,
  conversaciones          INTEGER,
  costo_por_resultado_usd NUMERIC(10, 4),
  ctr_enlace              NUMERIC(8, 6),
  clics_enlace            INTEGER,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meta_ads_detalle_importacion_idx ON meta_ads_detalle (importacion_id);
CREATE INDEX IF NOT EXISTS meta_ads_detalle_periodo_idx     ON meta_ads_detalle (periodo_desde);

ALTER TABLE meta_ads_detalle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins can select meta_ads_detalle"
  ON meta_ads_detalle FOR SELECT TO authenticated
  USING (get_my_rol() = 'admin');

CREATE POLICY "admins can insert meta_ads_detalle"
  ON meta_ads_detalle FOR INSERT TO authenticated
  WITH CHECK (get_my_rol() = 'admin');

CREATE POLICY "admins can delete meta_ads_detalle"
  ON meta_ads_detalle FOR DELETE TO authenticated
  USING (get_my_rol() = 'admin');
