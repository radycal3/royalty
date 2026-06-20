-- 022_periodos.sql
-- Etapa Evolución del Dashboard — snapshots semanales congelados.
--
-- Cierre manual exclusivamente: no hay trigger ni cron. Una fila se crea
-- únicamente cuando un usuario confirma el cierre desde el dashboard
-- (cerrarPeriodo() en evolucion/actions.ts).
--
-- Solo tipo 'semana' por ahora. Mes/Trimestre se calculan agregando
-- semanas cerradas en tiempo de lectura — no tienen cierre propio ni fila
-- propia en esta tabla.
--
-- Todos los campos numéricos son una copia congelada de KpisPeriodo en el
-- momento exacto del cierre. Cambios posteriores en recetas, costos,
-- configuración o en la forma de calcular un KPI NO alteran estas filas.

CREATE TABLE IF NOT EXISTS periodos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL DEFAULT 'semana' CHECK (tipo = 'semana'),
  desde date NOT NULL,
  hasta date NOT NULL,
  label text NOT NULL,

  pedidos integer NOT NULL,
  hamburguesas_vendidas integer NOT NULL,
  hamburguesas_por_pedido numeric(8, 2) NOT NULL,
  ticket_promedio numeric(12, 2) NOT NULL,
  costo_por_pedido numeric(12, 2) NOT NULL,
  ventas numeric(12, 2) NOT NULL,
  beneficio_bruto numeric(12, 2) NOT NULL,
  beneficio_neto numeric(12, 2) NOT NULL,
  beneficio_por_pedido numeric(12, 2) NOT NULL,
  margen_bruto numeric(6, 2) NOT NULL,
  margen_neto numeric(6, 2) NOT NULL,
  roas numeric(8, 2) NOT NULL,
  publicidad_pct numeric(6, 2) NOT NULL,
  resultado_delivery numeric(12, 2) NOT NULL,

  cerrado_por uuid REFERENCES usuarios(id),
  cerrado_en timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tipo, desde, hasta)
);

CREATE INDEX IF NOT EXISTS idx_periodos_desde ON periodos (desde);

ALTER TABLE periodos ENABLE ROW LEVEL SECURITY;

CREATE POLICY periodos_select ON periodos
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY periodos_insert ON periodos
  FOR INSERT
  TO authenticated
  WITH CHECK (public.get_my_rol() IN ('admin', 'empleado'));

-- Sin política de UPDATE: un período cerrado no se edita. Si hace falta
-- corregir un cierre erróneo, se elimina y se vuelve a cerrar — nunca se
-- muta una fila ya congelada.
CREATE POLICY periodos_delete ON periodos
  FOR DELETE
  TO authenticated
  USING (public.get_my_rol() = 'admin');
