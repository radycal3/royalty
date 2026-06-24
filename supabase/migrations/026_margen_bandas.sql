-- 026_margen_bandas.sql
-- Evolución Visual de Rentabilidad — bandas de salud configurables.
--
-- Agrega 2 umbrales nuevos a configuracion. El tercero (límite inferior
-- de la zona de Alerta) reutiliza alerta_margen_minimo, que ya existe
-- con valor 40 — no se crea una clave separada para no tener dos
-- configuraciones representando el mismo concepto.
--
-- Las 3 zonas del gráfico quedan así:
--   Zona Problema:  margen_neto < alerta_margen_minimo (ya existe, valor 40)
--   Zona Objetivo:  alerta_margen_minimo <= margen_neto < margen_objetivo_minimo (nuevo)
--   Zona Excelente: margen_neto >= margen_excelente_minimo (nuevo)
--
-- Valores default razonables para ajustar desde Configuración:
--   margen_objetivo_minimo  = 50  (entre 40 y 55 es un margen sólido)
--   margen_excelente_minimo = 60  (>60% es excelente para gastronomía)

INSERT INTO configuracion (clave, valor, descripcion)
SELECT 'margen_objetivo_minimo', '50',
  'Margen neto mínimo para considerarse en zona Objetivo (entre Alerta y Excelente)'
WHERE NOT EXISTS (SELECT 1 FROM configuracion WHERE clave = 'margen_objetivo_minimo');

INSERT INTO configuracion (clave, valor, descripcion)
SELECT 'margen_excelente_minimo', '60',
  'Margen neto mínimo para considerarse en zona Excelente'
WHERE NOT EXISTS (SELECT 1 FROM configuracion WHERE clave = 'margen_excelente_minimo');

INSERT INTO configuracion (clave, valor, descripcion)
SELECT 'cliente_ventana_activo_dias', '21',
  'Días desde la última compra para considerar un cliente como activo. Calibrar según ciclo real de compra de Royalty.'
WHERE NOT EXISTS (SELECT 1 FROM configuracion WHERE clave = 'cliente_ventana_activo_dias');
