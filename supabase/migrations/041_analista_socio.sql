-- 041_analista_socio.sql
-- "Tu Analista" pasa a ser un socio-asesor: conoce el negocio (ficha), recuerda
-- entre conversaciones (memoria) y ve adquisición/recompra, entrega, pago y
-- cupones de cada pedido.
--
-- 1) Pedidos: columnas que Pedix ya exporta y el importador descartaba.
--    Son descriptivas (no montos congelados del P&L), nullable: NULL = "no se
--    capturó" (pedidos importados antes de esta migración, hasta el backfill).
--    `descuento` = suma (positiva) de los descuentos que Pedix aplicó al pedido
--    (producto + promociones + cupón + pago). Informativo: las ventas ya vienen
--    netas de descuento en las líneas.
--    RLS: pedidos ya es admin-only (migración 039), las columnas lo heredan.

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tipo_entrega text;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS medio_pago text;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cupon text;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS descuento numeric;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS origen_venta text;

-- 2) Conocimiento cualitativo del negocio para el Analista. Tabla propia y
--    ADMIN-ONLY: `configuracion` tiene policy empleado_read, y acá va
--    estrategia, presupuesto y decisiones (principio 2.10).
--    tipo 'ficha'  → una sola fila: la descripción del negocio (editable).
--    tipo 'evento' → hechos fechados del mundo real ("WhatsApp caído 15-sep").
--    tipo 'nota'   → memoria entre conversaciones (decisiones, experimentos,
--                    aprendizajes), la escribe Lucas o el propio asesor.

CREATE TABLE IF NOT EXISTS analista_conocimiento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('ficha', 'evento', 'nota')),
  fecha date,
  texto text NOT NULL,
  origen text NOT NULL DEFAULT 'lucas' CHECK (origen IN ('lucas', 'asesor')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_analista_ficha_unica ON analista_conocimiento (tipo) WHERE tipo = 'ficha';
CREATE INDEX IF NOT EXISTS idx_analista_conocimiento_tipo ON analista_conocimiento (tipo, fecha DESC);

ALTER TABLE analista_conocimiento ENABLE ROW LEVEL SECURITY;

CREATE POLICY analista_conocimiento_admin ON analista_conocimiento
  FOR ALL TO authenticated
  USING (public.get_my_rol() = 'admin')
  WITH CHECK (public.get_my_rol() = 'admin');

-- 2.b) Mover los eventos existentes desde configuracion (legible por empleados).
INSERT INTO analista_conocimiento (tipo, fecha, texto, origen)
SELECT 'evento', (e->>'fecha')::date, e->>'descripcion', 'lucas'
FROM configuracion c, jsonb_array_elements(c.valor::jsonb) AS e
WHERE c.clave = 'negocio_eventos'
  AND e->>'fecha' IS NOT NULL
  AND e->>'descripcion' IS NOT NULL;

DELETE FROM configuracion WHERE clave = 'negocio_eventos';

-- 2.c) Ficha inicial (Lucas la edita desde el Laboratorio).
INSERT INTO analista_conocimiento (tipo, texto, origen)
SELECT 'ficha', $ficha$QUÉ ES ROYALTY: hamburguesería de delivery y take-away en Rosario. Abre solo viernes, sábado y domingo a la noche; los pedidos entran entre las 19:00 y las 23:00. Los pedidos se toman por la tienda online de Pedix (link compartido por WhatsApp e Instagram).

CANALES: WhatsApp Business con una lista de más de 2.000 clientes. Los envíos masivos hacen que WhatsApp se caiga o nos bloqueen (pasó desde el 15-sep). Instagram. Publicidad en Meta Ads.

PUBLICIDAD: campaña de Meta Ads de mensajes a WhatsApp, presupuesto de ~USD 150 por fin de semana. Se prende viernes, sábado y domingo a las 19:00 y se apaga a las 22:30 (la misma franja en la que entran los pedidos). Conjuntos de audiencia fría y cálida.

DELIVERY: cadetes por jornada; cada cadete cobra el mayor entre una base mínima por noche y un valor por viaje, más un costo fijo por cadete a la empresa de cadetería (valores en Configuración). El cliente paga el envío según la distancia.

PROYECTO EN CURSO — ROYAL FAMILY: comunidad de WhatsApp para dejar de depender de los envíos masivos. Se invita una última vez a toda la lista. Beneficios: descuentos mensuales, promos exclusivas para la comunidad, sorteos mensuales y votar la "hamburguesa del mes", que se hace especial para la Royal Family.

HIPÓTESIS QUE QUIERO EVALUAR: mover el presupuesto de publicidad de viernes-domingo a la noche a miércoles-viernes, con anuncios a la landing de la comunidad para llenarla, y los fines de semana vender con promos dentro de la comunidad. Creo que la gente no compra en el momento por un anuncio: lo ve, guarda la hamburguesería y compra después.$ficha$, 'lucas'
WHERE NOT EXISTS (SELECT 1 FROM analista_conocimiento WHERE tipo = 'ficha');

-- 3) Conversaciones: el CHECK de scope_tipo admite los modos reales
--    ('negocio' = diagnóstico estratégico, 'charla' = debatir una idea). Antes el
--    modo 'negocio' se guardaba como 'semana' por este CHECK.

ALTER TABLE laboratorio_conversaciones DROP CONSTRAINT IF EXISTS laboratorio_conversaciones_scope_tipo_check;
ALTER TABLE laboratorio_conversaciones ADD CONSTRAINT laboratorio_conversaciones_scope_tipo_check
  CHECK (scope_tipo IN ('semana', 'mes', 'comparacion', 'negocio', 'charla'));

UPDATE laboratorio_conversaciones
SET scope_tipo = 'negocio'
WHERE contexto->>'scopeTipo' = 'negocio' AND scope_tipo <> 'negocio';
