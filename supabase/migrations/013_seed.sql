-- Configuración global inicial
-- NOTA: El usuario admin se crea manualmente en Supabase Auth
-- y luego se inserta en la tabla usuarios (ver instrucciones de deploy).

-- Parámetros de cadetería
insert into public.configuracion (clave, valor, descripcion) values
  ('cadete_base_minima', '21000', 'Base mínima de pago por noche de cadete en ARS'),
  ('cadete_valor_viaje', '2000', 'Valor por viaje realizado en ARS'),
  ('meta_hamburguesas', '105', 'Meta semanal de hamburguesas para el equipo'),
  ('meta_nombre', 'Meta semanal', 'Nombre visible de la meta'),
  ('meta_descripcion', 'Cantidad de hamburguesas vendidas por semana operativa', 'Descripción de la meta'),
  ('alerta_margen_minimo', '40', 'Porcentaje mínimo de margen para activar alerta'),
  ('alerta_publicidad_maxima', '15', 'Porcentaje máximo de publicidad sobre ventas para alerta');

-- Los valores de producto_consumo_empleado y producto_consumo_cadete
-- se configuran después de crear los productos en Fase 1.

-- Primer período operativo
-- Ajustar las fechas al próximo viernes operativo real
insert into public.periodos_operativos (numero_semana, anio, fecha_inicio, fecha_fin, estado)
values (1, 2026, '2026-06-19', '2026-06-21', 'abierto');
