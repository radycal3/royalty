-- 032_clientes_riesgo_semanal.sql
-- Sección "entraron en riesgo esta semana" + registro de contacto.
--
-- 1. Extiende obtener_salud_clientes (CREATE OR REPLACE, misma firma, sin
--    tocar ninguna columna ni cálculo existente) agregando el detalle de
--    TODOS los clientes en riesgo (no solo alto valor, a diferencia de
--    alto_valor_detalle) cuyos días sin comprar cayeron en la ventana de
--    los últimos 7 días — es decir, cruzaron el umbral de riesgo esta
--    semana, no hace un mes.
--
-- 2. Tabla clientes_contactos: registro manual de "llamé/escribí a este
--    cliente". "¿Volvió a comprar?" NO se guarda como campo — se calcula
--    en vivo comparando la fecha de contacto contra pedidos.fecha, para no
--    depender de que alguien lo actualice a mano (principio: no inventar
--    causalidad, derivar de datos reales).

CREATE OR REPLACE FUNCTION obtener_salud_clientes(p_ventana_dias int DEFAULT 21)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_hoy                 date := CURRENT_DATE;

  -- Ventanas de tendencia: 4 semanas rodantes (28 días)
  v_tend_actual_hasta   date := v_hoy;
  v_tend_actual_desde   date := v_hoy - interval '28 days';
  v_tend_anterior_hasta date := v_hoy - interval '28 days' - interval '1 day';
  v_tend_anterior_desde date := v_hoy - interval '56 days';

  v_result json;
BEGIN
  WITH

  imp_activas AS (
    SELECT id FROM importaciones WHERE estado = 'activa'
  ),

  pedidos_validos AS (
    SELECT
      p.id              AS pedido_id,
      p.cliente_id,
      p.fecha,
      COALESCE(SUM(pl.precio_unitario_vendido * pl.cantidad), 0) AS venta_pedido
    FROM pedidos p
    JOIN imp_activas ia ON ia.id = p.importacion_id
    LEFT JOIN pedidos_lineas pl ON pl.pedido_id = p.id
    WHERE p.cliente_id IS NOT NULL
    GROUP BY p.id, p.cliente_id, p.fecha
  ),

  clientes_agg AS (
    SELECT
      cliente_id,
      COUNT(*)          AS total_pedidos,
      MIN(fecha)        AS primer_pedido,
      MAX(fecha)        AS ultimo_pedido,
      SUM(venta_pedido) AS ventas_totales
    FROM pedidos_validos
    GROUP BY cliente_id
  ),

  clientes_clasificados AS (
    SELECT
      cliente_id,
      total_pedidos,
      primer_pedido,
      ultimo_pedido,
      ventas_totales,
      (v_hoy - primer_pedido) AS dias_desde_primer_pedido,
      (v_hoy - ultimo_pedido) AS dias_desde_ultimo_pedido,
      CASE
        WHEN (v_hoy - primer_pedido) < p_ventana_dias
          THEN 'reciente_sin_veredicto'
        WHEN total_pedidos = 1 AND (v_hoy - primer_pedido) >= p_ventana_dias
          THEN 'nuevo_perdido'
        WHEN total_pedidos >= 2 AND (v_hoy - ultimo_pedido) < p_ventana_dias
          THEN 'activo'
        WHEN total_pedidos >= 2 AND (v_hoy - ultimo_pedido) >= p_ventana_dias
          THEN 'en_riesgo'
        ELSE 'desconocido'
      END AS categoria
    FROM clientes_agg
  ),

  facturacion_global AS (
    SELECT
      SUM(CASE WHEN ca.total_pedidos >= 2 THEN pv.venta_pedido ELSE 0 END) AS ventas_repetidores,
      SUM(CASE WHEN ca.total_pedidos = 1  THEN pv.venta_pedido ELSE 0 END) AS ventas_nuevos,
      SUM(pv.venta_pedido)                                                   AS ventas_total
    FROM pedidos_validos pv
    JOIN clientes_agg ca ON ca.cliente_id = pv.cliente_id
  ),

  intervalos_cliente AS (
    SELECT
      cliente_id,
      CASE WHEN total_pedidos > 1
        THEN (ultimo_pedido - primer_pedido)::numeric / (total_pedidos - 1)
        ELSE NULL
      END AS promedio_intervalo
    FROM clientes_agg
    WHERE total_pedidos >= 2
  ),
  stats_intervalos AS (
    SELECT
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY promedio_intervalo)::numeric, 1)
        AS mediana_dias,
      ROUND(AVG(promedio_intervalo)::numeric, 1)
        AS promedio_dias
    FROM intervalos_cliente
    WHERE promedio_intervalo IS NOT NULL
  ),

  riesgo_economico AS (
    SELECT
      COUNT(*)              AS n_en_riesgo,
      SUM(ventas_totales)   AS ventas_historicas_en_riesgo,
      SUM(total_pedidos)    AS pedidos_totales_en_riesgo,
      COUNT(*) FILTER (WHERE total_pedidos >= 3)             AS alto_valor_en_riesgo,
      SUM(ventas_totales) FILTER (WHERE total_pedidos >= 3)  AS alto_valor_ventas_historicas
    FROM clientes_clasificados
    WHERE categoria = 'en_riesgo'
  ),

  top_repetidores AS (
    SELECT
      c.nombre_referencia       AS nombre,
      COALESCE(c.celular, '')   AS celular,
      ca.total_pedidos,
      ca.ventas_totales,
      ca.ultimo_pedido
    FROM clientes_clasificados cc
    JOIN clientes_agg ca ON ca.cliente_id = cc.cliente_id
    JOIN clientes c ON c.id = cc.cliente_id
    WHERE ca.total_pedidos >= 2
    ORDER BY ca.ventas_totales DESC, ca.total_pedidos DESC
    LIMIT 5
  ),

  alto_valor_detalle AS (
    SELECT
      cc.cliente_id,
      c.nombre_referencia       AS nombre,
      COALESCE(c.celular, '')   AS celular,
      ca.total_pedidos,
      ca.ventas_totales,
      ca.ultimo_pedido,
      (v_hoy - ca.ultimo_pedido) AS dias_sin_comprar
    FROM clientes_clasificados cc
    JOIN clientes_agg ca ON ca.cliente_id = cc.cliente_id
    JOIN clientes c ON c.id = cc.cliente_id
    WHERE cc.categoria = 'en_riesgo'
      AND ca.total_pedidos >= 3
    ORDER BY dias_sin_comprar DESC
  ),

  -- NUEVO: TODOS los clientes en riesgo (no solo alto valor) que cruzaron
  -- el umbral en los últimos 7 días — dias_sin_comprar entre p_ventana_dias
  -- y p_ventana_dias+6. Orden ASC: los que acaban de cruzar primero (más
  -- accionables — todavía frescos).
  nuevos_en_riesgo_detalle AS (
    SELECT
      cc.cliente_id,
      c.nombre_referencia       AS nombre,
      COALESCE(c.celular, '')   AS celular,
      ca.total_pedidos,
      ca.ventas_totales,
      ca.ultimo_pedido,
      cc.dias_desde_ultimo_pedido AS dias_sin_comprar
    FROM clientes_clasificados cc
    JOIN clientes_agg ca ON ca.cliente_id = cc.cliente_id
    JOIN clientes c ON c.id = cc.cliente_id
    WHERE cc.categoria = 'en_riesgo'
      AND cc.dias_desde_ultimo_pedido >= p_ventana_dias
      AND cc.dias_desde_ultimo_pedido <= p_ventana_dias + 6
    ORDER BY dias_sin_comprar ASC
  ),

  conteos AS (
    SELECT
      COUNT(*) FILTER (WHERE categoria = 'reciente_sin_veredicto') AS reciente_sin_veredicto,
      COUNT(*) FILTER (WHERE categoria = 'nuevo_perdido')           AS nuevo_perdido,
      COUNT(*) FILTER (WHERE categoria = 'activo')                  AS activo,
      COUNT(*) FILTER (WHERE categoria = 'en_riesgo')               AS en_riesgo,
      COUNT(*)                                                       AS total_unicos
    FROM clientes_clasificados
  ),

  tend_actual_universo AS (
    SELECT cliente_id
    FROM clientes_agg
    WHERE primer_pedido >= v_tend_actual_desde
      AND primer_pedido <= v_tend_actual_hasta
  ),
  tend_actual AS (
    SELECT
      COUNT(*)                                                              AS n_clientes,
      COUNT(*) FILTER (WHERE ca.total_pedidos >= 2)                        AS n_retuvieron,
      SUM(ca.ventas_totales)                                               AS ventas_total,
      SUM(CASE WHEN ca.total_pedidos >= 2 THEN ca.ventas_totales ELSE 0 END) AS ventas_repetidores
    FROM tend_actual_universo tau
    JOIN clientes_agg ca ON ca.cliente_id = tau.cliente_id
  ),

  tend_anterior_universo AS (
    SELECT cliente_id
    FROM clientes_agg
    WHERE primer_pedido >= v_tend_anterior_desde
      AND primer_pedido <= v_tend_anterior_hasta
  ),
  tend_anterior AS (
    SELECT
      COUNT(*)                                                              AS n_clientes,
      COUNT(*) FILTER (WHERE ca.total_pedidos >= 2)                        AS n_retuvieron,
      SUM(ca.ventas_totales)                                               AS ventas_total,
      SUM(CASE WHEN ca.total_pedidos >= 2 THEN ca.ventas_totales ELSE 0 END) AS ventas_repetidores
    FROM tend_anterior_universo tau
    JOIN clientes_agg ca ON ca.cliente_id = tau.cliente_id
  ),

  top_list AS (
    SELECT json_agg(
      json_build_object(
        'nombre',         nombre,
        'celular',        celular,
        'total_pedidos',  total_pedidos,
        'ventas_totales', ventas_totales,
        'ultimo_pedido',  ultimo_pedido
      ) ORDER BY ventas_totales DESC, total_pedidos DESC
    ) AS lista
    FROM top_repetidores
  ),

  alto_valor_lista AS (
    SELECT json_agg(
      json_build_object(
        'cliente_id',       cliente_id,
        'nombre',           nombre,
        'celular',          celular,
        'total_pedidos',    total_pedidos,
        'ventas_totales',   ventas_totales,
        'ultimo_pedido',    ultimo_pedido,
        'dias_sin_comprar', dias_sin_comprar
      ) ORDER BY dias_sin_comprar DESC
    ) AS lista
    FROM alto_valor_detalle
  ),

  nuevos_en_riesgo_lista AS (
    SELECT json_agg(
      json_build_object(
        'cliente_id',       cliente_id,
        'nombre',           nombre,
        'celular',          celular,
        'total_pedidos',    total_pedidos,
        'ventas_totales',   ventas_totales,
        'ultimo_pedido',    ultimo_pedido,
        'dias_sin_comprar', dias_sin_comprar
      ) ORDER BY dias_sin_comprar ASC
    ) AS lista
    FROM nuevos_en_riesgo_detalle
  )

  SELECT json_build_object(
    'fecha_calculo',              v_hoy,
    'ventana_dias',               p_ventana_dias,

    'total_unicos',               ct.total_unicos,
    'reciente_sin_veredicto',     ct.reciente_sin_veredicto,
    'nuevo_perdido',              ct.nuevo_perdido,
    'activo',                     ct.activo,
    'en_riesgo',                  ct.en_riesgo,

    'alto_valor_en_riesgo',       re.alto_valor_en_riesgo,
    'alto_valor_ventas_historicas', COALESCE(re.alto_valor_ventas_historicas, 0),

    'en_riesgo_ventas_historicas', COALESCE(re.ventas_historicas_en_riesgo, 0),
    'en_riesgo_pedidos_totales',   COALESCE(re.pedidos_totales_en_riesgo, 0),
    'en_riesgo_ticket_promedio',
      CASE WHEN COALESCE(re.pedidos_totales_en_riesgo, 0) > 0
        THEN ROUND((re.ventas_historicas_en_riesgo / re.pedidos_totales_en_riesgo)::numeric, 0)
        ELSE 0
      END,

    'ventas_repetidores',          fg.ventas_repetidores,
    'ventas_nuevos',               fg.ventas_nuevos,
    'ventas_total',                fg.ventas_total,
    'pct_facturacion_repetidores',
      CASE WHEN fg.ventas_total > 0
        THEN ROUND((fg.ventas_repetidores / fg.ventas_total * 100)::numeric, 1)
        ELSE 0
      END,

    'pct_clientes_repetidores',
      CASE WHEN (ct.total_unicos - ct.reciente_sin_veredicto) > 0
        THEN ROUND(
          ((ct.activo + ct.en_riesgo)::numeric /
           (ct.total_unicos - ct.reciente_sin_veredicto) * 100)::numeric, 1)
        ELSE 0
      END,

    'tasa_retencion',
      CASE WHEN (ct.activo + ct.en_riesgo + ct.nuevo_perdido) > 0
        THEN ROUND(
          ((ct.activo + ct.en_riesgo)::numeric /
           (ct.activo + ct.en_riesgo + ct.nuevo_perdido) * 100)::numeric, 1)
        ELSE 0
      END,

    'retencion_cartera',
      CASE WHEN (ct.activo + ct.en_riesgo) > 0
        THEN ROUND(
          (ct.activo::numeric / (ct.activo + ct.en_riesgo) * 100)::numeric, 1)
        ELSE 0
      END,

    'mediana_dias_entre_compras',  COALESCE(si.mediana_dias, 0),
    'promedio_dias_entre_compras', COALESCE(si.promedio_dias, 0),

    'tend_actual_n_clientes',      ta.n_clientes,
    'tend_actual_n_retuvieron',    ta.n_retuvieron,
    'tend_actual_ventas_total',    COALESCE(ta.ventas_total, 0),
    'tend_actual_ventas_rep',      COALESCE(ta.ventas_repetidores, 0),
    'tend_actual_tasa_retencion',
      CASE WHEN ta.n_clientes > 0
        THEN ROUND((ta.n_retuvieron::numeric / ta.n_clientes * 100)::numeric, 1)
        ELSE 0
      END,
    'tend_actual_pct_facturacion',
      CASE WHEN COALESCE(ta.ventas_total, 0) > 0
        THEN ROUND((COALESCE(ta.ventas_repetidores, 0) / ta.ventas_total * 100)::numeric, 1)
        ELSE 0
      END,

    'tend_anterior_n_clientes',    tap.n_clientes,
    'tend_anterior_n_retuvieron',  tap.n_retuvieron,
    'tend_anterior_ventas_total',  COALESCE(tap.ventas_total, 0),
    'tend_anterior_ventas_rep',    COALESCE(tap.ventas_repetidores, 0),
    'tend_anterior_tasa_retencion',
      CASE WHEN tap.n_clientes > 0
        THEN ROUND((tap.n_retuvieron::numeric / tap.n_clientes * 100)::numeric, 1)
        ELSE 0
      END,
    'tend_anterior_pct_facturacion',
      CASE WHEN COALESCE(tap.ventas_total, 0) > 0
        THEN ROUND((COALESCE(tap.ventas_repetidores, 0) / tap.ventas_total * 100)::numeric, 1)
        ELSE 0
      END,

    'tend_actual_desde',           v_tend_actual_desde,
    'tend_actual_hasta',           v_tend_actual_hasta,
    'tend_anterior_desde',         v_tend_anterior_desde,
    'tend_anterior_hasta',         v_tend_anterior_hasta,

    'top_repetidores',             COALESCE(tl.lista, '[]'::json),
    'alto_valor_detalle',          COALESCE(avl.lista, '[]'::json),

    -- NUEVO
    'nuevos_en_riesgo_detalle',    COALESCE(nrl.lista, '[]'::json)

  ) INTO v_result
  FROM conteos ct, facturacion_global fg, riesgo_economico re,
       stats_intervalos si, tend_actual ta, tend_anterior tap,
       top_list tl, alto_valor_lista avl, nuevos_en_riesgo_lista nrl;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION obtener_salud_clientes(int) TO authenticated;

-- ── Registro de contacto con clientes ────────────────────────────────────
-- "¿Volvió a comprar?" no se guarda acá — se calcula comparando fecha
-- contra pedidos.fecha al leer (ver dashboard/actions.ts).

CREATE TABLE IF NOT EXISTS clientes_contactos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  fecha date NOT NULL,
  metodo text NOT NULL CHECK (metodo IN ('llamada', 'whatsapp', 'otro')),
  nota text,
  registrado_por uuid REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clientes_contactos_cliente ON clientes_contactos(cliente_id);

ALTER TABLE clientes_contactos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_full_access_contactos" ON clientes_contactos
  FOR ALL USING (public.get_my_rol() = 'admin');
