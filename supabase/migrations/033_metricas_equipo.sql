-- 033_metricas_equipo.sql
-- Métricas operativas semanales del equipo, cargadas a mano por el admin.
-- Sin ningún campo en pesos — los empleados las ven en /panel sin filtrar
-- nada (a diferencia del resumen financiero, que sí necesita el admin
-- client + recorte de campos).

CREATE TABLE IF NOT EXISTS metricas_equipo_semana (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_desde date NOT NULL,
  periodo_hasta date NOT NULL,
  mensajes_recibidos integer,
  mensajes_convertidos integer,
  tiempo_promedio_produccion_min numeric(6,1),
  quejas_faltantes integer,
  quejas_calidad integer,
  registrado_por uuid REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (periodo_desde)
);

COMMENT ON TABLE metricas_equipo_semana IS
  'Métricas operativas semanales cargadas a mano por el admin (mensajes recibidos/convertidos, tiempo de producción, quejas). Sin campos en pesos.';

CREATE INDEX IF NOT EXISTS idx_metricas_equipo_periodo ON metricas_equipo_semana(periodo_desde);

ALTER TABLE metricas_equipo_semana ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_full_access_metricas_equipo" ON metricas_equipo_semana
  FOR ALL USING (public.get_my_rol() = 'admin');

CREATE POLICY "empleado_read_metricas_equipo" ON metricas_equipo_semana
  FOR SELECT USING (public.get_my_rol() = 'empleado');
