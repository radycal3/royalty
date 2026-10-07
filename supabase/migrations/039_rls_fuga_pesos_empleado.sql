-- 039_rls_fuga_pesos_empleado.sql
-- Cierra fugas de RLS pre-existentes del mismo tipo que corrigió la 030 para
-- `periodos`, pero que quedaron abiertas en otras tablas con montos en pesos y
-- en la RPC de salud de clientes. Violan el principio 2.10 ("empleados nunca
-- ven pesos"). No importaban mientras no hubiera cuentas empleado; ahora sí
-- existe al menos una, así que son explotables: un empleado autenticado, con
-- la anon key + su sesión, podía leer estos datos directo (la UI no los
-- muestra, pero la API REST sí los servía).
--
-- Patrón: las policies de SELECT pasan a admin-only. Las de insert/update se
-- dejan como estaban (la escritura ya está protegida por el gate de ruta
-- (admin) + verificaciones de rol en los server actions). El panel de
-- empleados NO necesita estas tablas: lee márgenes por la vista
-- periodos_margen_empleado (030) y los conteos de pedidos se calculan
-- server-side con service_role.

-- ── pedidos / pedidos_lineas (006): tenían empleado_read ──
-- RLS es por FILA, no por columna: ese SELECT exponía precio_unitario_vendido,
-- costo_unitario_calculado y envio_cobrado (pesos) + celular/nombre (PII).
DROP POLICY IF EXISTS empleado_read ON public.pedidos;
DROP POLICY IF EXISTS empleado_read ON public.pedidos_lineas;

-- ── periodos_productos / periodos_gastos (023): USING (true) ──
-- Contienen venta/costo/beneficio/total congelados.
DROP POLICY IF EXISTS periodos_productos_select ON public.periodos_productos;
CREATE POLICY periodos_productos_select ON public.periodos_productos
  FOR SELECT TO authenticated
  USING (public.get_my_rol() = 'admin');

DROP POLICY IF EXISTS periodos_gastos_select ON public.periodos_gastos;
CREATE POLICY periodos_gastos_select ON public.periodos_gastos
  FOR SELECT TO authenticated
  USING (public.get_my_rol() = 'admin');

-- ── cadetes_jornadas (020): USING (true) ──
-- Expone pago_cadete y las tarifas congeladas (todos pesos).
DROP POLICY IF EXISTS cadetes_jornadas_select ON public.cadetes_jornadas;
CREATE POLICY cadetes_jornadas_select ON public.cadetes_jornadas
  FOR SELECT TO authenticated
  USING (public.get_my_rol() = 'admin');

-- ── clientes (025): USING (true) ──
-- No tiene pesos, pero expone el padrón completo (celular + nombre = PII).
DROP POLICY IF EXISTS clientes_select ON public.clientes;
CREATE POLICY clientes_select ON public.clientes
  FOR SELECT TO authenticated
  USING (public.get_my_rol() = 'admin');

-- ── RPC obtener_salud_clientes (027/032): SECURITY DEFINER + GRANT a todos ──
-- Devuelve ventas/ticket/ventas_repetidores (pesos) + celulares/nombres. Al
-- correr como owner, bypasea la RLS admin-only de pedidos/clientes. Se revoca
-- a los roles de cliente y se deja solo para service_role. El dashboard admin
-- ya la invoca con admin client (service_role) tras verificar rol
-- (obtenerSaludClientes en dashboard/actions.ts).
REVOKE EXECUTE ON FUNCTION public.obtener_salud_clientes(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.obtener_salud_clientes(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.obtener_salud_clientes(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_salud_clientes(integer) TO service_role;
