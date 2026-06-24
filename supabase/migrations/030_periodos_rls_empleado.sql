-- 030_periodos_rls_empleado.sql
-- Corrige una fuga de RLS pre-existente: periodos_select (022) usaba
-- USING (true) para cualquier usuario autenticado, incluidos empleados,
-- exponiendo ventas/beneficio_neto/etc. Nunca importó hasta ahora porque
-- no existían cuentas empleado. Viola el principio 2.10.
--
-- Se restringe la tabla a admin y se agrega una vista acotada (solo %
-- margen neto, sin ningún campo en pesos) para el dashboard de empleados.

DROP POLICY IF EXISTS periodos_select ON periodos;

CREATE POLICY periodos_select ON periodos
  FOR SELECT
  TO authenticated
  USING (public.get_my_rol() = 'admin');

CREATE OR REPLACE VIEW periodos_margen_empleado AS
SELECT desde, hasta, label, margen_neto
FROM periodos
WHERE tipo = 'semana';

COMMENT ON VIEW periodos_margen_empleado IS
  'Vista de solo lectura para el dashboard de empleados (/panel). Expone únicamente el % de margen neto histórico, sin ningún campo en pesos.';

GRANT SELECT ON periodos_margen_empleado TO authenticated;
