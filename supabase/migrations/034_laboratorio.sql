-- 034_laboratorio.sql
-- Centro de acción: recomendaciones generadas por IA a partir de los KPIs
-- de la semana, con seguimiento de qué decisión se tomó y qué resultó
-- semanas después. Admin-only — es una herramienta estratégica de Lucas,
-- no algo que el equipo necesite ver.
--
-- Cada fila es UNA recomendación (no el lote completo) para poder marcar
-- decisión/resultado por separado. Flujo: sugerida -> decidida -> evaluada.

CREATE TABLE IF NOT EXISTS decisiones_laboratorio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_desde date NOT NULL,
  periodo_hasta date NOT NULL,

  -- Lo que generó la IA (congelado, no se regenera)
  area text NOT NULL,
  recomendacion text NOT NULL,
  justificacion text NOT NULL,

  -- Lo que Lucas decidió hacer
  decision_tomada text,
  fecha_decision date,

  -- Qué resultó, semanas después
  resultado text,
  fecha_resultado date,

  estado text NOT NULL DEFAULT 'sugerida' CHECK (estado IN ('sugerida', 'decidida', 'evaluada')),

  registrado_por uuid REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE decisiones_laboratorio IS
  'Recomendaciones generadas por IA (Anthropic) a partir de los KPIs semanales, con seguimiento de decisión tomada y resultado. Admin-only.';

CREATE INDEX IF NOT EXISTS idx_decisiones_periodo ON decisiones_laboratorio(periodo_desde);
CREATE INDEX IF NOT EXISTS idx_decisiones_estado ON decisiones_laboratorio(estado);

ALTER TABLE decisiones_laboratorio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_full_access_decisiones" ON decisiones_laboratorio
  FOR ALL USING (public.get_my_rol() = 'admin');
