-- 020_cadetes_jornadas.sql
-- Fase 4 (Cadetes) — modelo financiero definitivo de liquidación.
--
-- Reemplaza el enfoque de pedidos_cadetes (pago por pedido individual) por
-- el cierre operativo real: cada noche, la empresa de cadetería informa
-- cuántos viajes hizo cada cadete. Esta tabla registra ese cierre y congela,
-- en el mismo momento de la carga, los 3 valores de configuración usados
-- para calcular el pago — igual patrón que ingredientes_costos /
-- productos_precios: el dato vivo en configuracion puede cambiar después
-- sin alterar lo ya liquidado.
--
-- pago_cadete = GREATEST(cadete_base_minima_usada, viajes_realizados * cadete_valor_viaje_usado)
-- Se calcula en la Server Action al insertar (no hay trigger: el INSERT es
-- siempre manual desde la pantalla de Cadetes, así que la Server Action ya
-- tiene los 3 valores de configuración leídos en el mismo request).
--
-- No contempla jornadas con 0 viajes: si un cadete fue solicitado, tuvo al
-- menos 1 viaje (regla operativa confirmada). El CHECK exige >= 1.

CREATE TABLE IF NOT EXISTS cadetes_jornadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipo_id uuid NOT NULL REFERENCES equipo(id),
  fecha date NOT NULL,
  viajes_realizados integer NOT NULL CHECK (viajes_realizados >= 1),

  -- Congelados al momento de cargar el cierre de la noche. Quedan
  -- guardados explícitamente (no solo derivados) para que una fila sea
  -- auditable por sí sola sin tener que cruzar contra el historial de
  -- configuracion, que es key-value mutable sin versión histórica.
  cadete_base_minima_usada numeric(12, 2) NOT NULL CHECK (cadete_base_minima_usada >= 0),
  cadete_valor_viaje_usado numeric(12, 2) NOT NULL CHECK (cadete_valor_viaje_usado >= 0),
  costo_empresa_cadete_usado numeric(12, 2) NOT NULL CHECK (costo_empresa_cadete_usado >= 0),

  -- Derivado: GREATEST(cadete_base_minima_usada, viajes_realizados * cadete_valor_viaje_usado)
  pago_cadete numeric(12, 2) NOT NULL CHECK (pago_cadete >= 0),

  observacion text,
  registrado_por uuid REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (equipo_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_cadetes_jornadas_fecha ON cadetes_jornadas (fecha);
CREATE INDEX IF NOT EXISTS idx_cadetes_jornadas_equipo ON cadetes_jornadas (equipo_id);

ALTER TABLE cadetes_jornadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY cadetes_jornadas_select ON cadetes_jornadas
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY cadetes_jornadas_insert ON cadetes_jornadas
  FOR INSERT
  TO authenticated
  WITH CHECK (public.get_my_rol() IN ('admin', 'empleado'));

CREATE POLICY cadetes_jornadas_update ON cadetes_jornadas
  FOR UPDATE
  TO authenticated
  USING (public.get_my_rol() IN ('admin', 'empleado'));

CREATE POLICY cadetes_jornadas_delete ON cadetes_jornadas
  FOR DELETE
  TO authenticated
  USING (public.get_my_rol() = 'admin');

-- ─────────────────────────────────────────────────────────────────────────
-- Nueva clave de configuración: costo que cobra la empresa de cadetería
-- por cada cadete activo en la jornada (independiente de lo que cobra el
-- cadete). Valor inicial $1.500 según lo informado — AJUSTAR si el valor
-- real vigente es otro antes de correr este INSERT.
--
-- Misma tabla configuracion ya existente (clave/valor/descripcion), no
-- requiere cambio de esquema.

-- Se usa WHERE NOT EXISTS en vez de ON CONFLICT porque no está confirmado
-- que la columna 'clave' tenga un constraint UNIQUE — esta forma funciona
-- de cualquier manera, sin asumir el esquema exacto.
INSERT INTO configuracion (clave, valor, descripcion)
SELECT
  'costo_empresa_cadete',
  '1500',
  'Costo que cobra la empresa de cadetería por cada cadete activo en la jornada (ARS)'
WHERE NOT EXISTS (
  SELECT 1 FROM configuracion WHERE clave = 'costo_empresa_cadete'
);

-- ─────────────────────────────────────────────────────────────────────────
-- NOTA: esta migración NO elimina pedidos_cadetes todavía. Ver migración
-- 021 para el DROP — debe aplicarse DESPUÉS de reemplazar actions.ts en
-- producción, para evitar que el dashboard consulte una tabla inexistente
-- mientras el código viejo siga desplegado.
