-- 040_laboratorio_analista.sql
-- "Tu Analista": conversaciones con la IA sobre un análisis de negocio.
-- Cada conversación congela su contexto (el análisis determinístico completo)
-- para ser estable aunque cambien los datos después. Admin-only.

CREATE TABLE IF NOT EXISTS laboratorio_conversaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  scope_tipo text NOT NULL CHECK (scope_tipo IN ('semana', 'mes', 'comparacion')),
  scope jsonb NOT NULL,              -- los rangos analizados {a:{desde,hasta,label}, b?:{...}}
  contexto jsonb NOT NULL,           -- AnalisisCompleto CONGELADO al crear
  modelo_informe text,
  modelo_chat text,
  archivada boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS laboratorio_mensajes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id uuid NOT NULL REFERENCES laboratorio_conversaciones(id) ON DELETE CASCADE,
  orden int NOT NULL,
  rol text NOT NULL CHECK (rol IN ('user', 'assistant')),
  contenido text NOT NULL,
  meta jsonb,                        -- tool calls / tokens / modelo
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lab_msg_conv ON laboratorio_mensajes (conversacion_id, orden);
CREATE INDEX IF NOT EXISTS idx_lab_conv_creada ON laboratorio_conversaciones (created_at DESC);

ALTER TABLE laboratorio_conversaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE laboratorio_mensajes ENABLE ROW LEVEL SECURITY;

-- Admin-only (contienen análisis financiero en pesos).
CREATE POLICY lab_conv_admin ON laboratorio_conversaciones
  FOR ALL TO authenticated
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

CREATE POLICY lab_msg_admin ON laboratorio_mensajes
  FOR ALL TO authenticated
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');
