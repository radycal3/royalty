-- 024_alertas_config.sql
-- Auditoría Financiera Inteligente — umbrales de alerta nuevos.
--
-- Sigue el mismo patrón key-value ya usado por cadeteria/meta/alertas
-- existentes (alerta_margen_minimo, alerta_publicidad_maxima). No se crea
-- una tabla dedicada para alertas: el patrón actual ya es extensible sin
-- refactor — cada alerta futura (alerta_caida_beneficio_neto_pct,
-- alerta_resultado_delivery_minimo, alerta_caida_pedidos_pct, etc.) es
-- simplemente una fila más acá, sin tocar el esquema.
--
-- Usa WHERE NOT EXISTS en vez de ON CONFLICT por la misma razón que en la
-- migración 020: no está confirmado que 'clave' tenga un constraint
-- UNIQUE explícito, así que se evita asumirlo.

INSERT INTO configuracion (clave, valor, descripcion)
SELECT 'alerta_roas_minimo', '3', 'ROAS mínimo aceptable. Por debajo, el semáforo marca atención (ARS de venta por ARS de publicidad)'
WHERE NOT EXISTS (SELECT 1 FROM configuracion WHERE clave = 'alerta_roas_minimo');

INSERT INTO configuracion (clave, valor, descripcion)
SELECT 'alerta_caida_ventas_pct', '15', 'Porcentaje de caída de ventas (semana vs anterior) que activa alerta'
WHERE NOT EXISTS (SELECT 1 FROM configuracion WHERE clave = 'alerta_caida_ventas_pct');

INSERT INTO configuracion (clave, valor, descripcion)
SELECT 'alerta_relevancia_monto_minimo', '15000', 'Monto mínimo en ARS para que un producto o categoría de gasto se considere relevante en la comparación entre períodos'
WHERE NOT EXISTS (SELECT 1 FROM configuracion WHERE clave = 'alerta_relevancia_monto_minimo');

INSERT INTO configuracion (clave, valor, descripcion)
SELECT 'alerta_relevancia_pct_minimo', '5', 'Porcentaje mínimo del cambio total para que un producto o categoría de gasto se considere relevante en la comparación entre períodos'
WHERE NOT EXISTS (SELECT 1 FROM configuracion WHERE clave = 'alerta_relevancia_pct_minimo');
