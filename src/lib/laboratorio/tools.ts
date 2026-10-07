// Herramientas de solo-lectura del Analista (fase 3 "híbrida"). El modelo las
// invoca on-demand cuando necesita datos fuera del contexto congelado. Los
// números SIEMPRE los calcula este código (reusa el motor de análisis) — la IA
// solo interpreta. Admin-only: se ejecutan con el client service_role.

import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import { buildRangoSemana, periodoDeJS } from '@/lib/dashboard/rangos';
import { construirAnalisisCompleto } from '@/lib/analisis/analisis-negocio';

function fmtFecha(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const r1 = (n: number) => Math.round(n * 10) / 10;
const r0 = (n: number) => Math.round(n);

async function activas(admin: SupabaseClient): Promise<Set<string>> {
  const { data } = await admin.from('importaciones').select('id').eq('estado', 'activa');
  return new Set((data || []).map((i: any) => i.id));
}

// ─── Definiciones (schemas) que ve el modelo ───────────────────────────────

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'comparar_periodos',
    description:
      'Compara DOS semanas operativas (Vie-Dom) entre sí: ventas, margen neto, beneficio, pedidos, ticket, publicidad y top productos de cada una, con los deltas. Usala cuando Lucas pida comparar contra otra semana o "¿cómo venía antes?". Pasá una fecha cualquiera dentro de cada semana.',
    input_schema: {
      type: 'object',
      properties: {
        fechaA: { type: 'string', description: 'Fecha YYYY-MM-DD dentro de la semana A' },
        fechaB: { type: 'string', description: 'Fecha YYYY-MM-DD dentro de la semana B' },
      },
      required: ['fechaA', 'fechaB'],
    },
  },
  {
    name: 'detalle_dia',
    description:
      'Detalle de UN día puntual: pedidos, ventas, ticket promedio, hamburguesas y los productos más vendidos ese día. Usala para "¿qué pasó el sábado?" o un día específico.',
    input_schema: {
      type: 'object',
      properties: { fecha: { type: 'string', description: 'Fecha exacta YYYY-MM-DD' } },
      required: ['fecha'],
    },
  },
  {
    name: 'detalle_producto',
    description:
      'Evolución de UN producto en las últimas N semanas operativas: unidades, venta y margen por semana. Usala para "¿cómo viene el King?" o "¿la PROMO 2x1 está creciendo o cayendo?". El nombre puede ser parcial.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre (o parte) del producto' },
        semanas: { type: 'number', description: 'Cuántas semanas hacia atrás (default 8)' },
      },
      required: ['nombre'],
    },
  },
  {
    name: 'listar_clientes_segmento',
    description:
      'Lista accionable de clientes de un segmento, con teléfono (para WhatsApp): "alto_valor_en_riesgo" (los más valiosos que dejaron de comprar), "nuevos_en_riesgo" (cruzaron a riesgo esta semana) o "top_repetidores" (los que más compran). Usala cuando Lucas quiera a quién contactar.',
    input_schema: {
      type: 'object',
      properties: {
        segmento: { type: 'string', enum: ['alto_valor_en_riesgo', 'nuevos_en_riesgo', 'top_repetidores'] },
      },
      required: ['segmento'],
    },
  },
];

// ─── Ejecutores ─────────────────────────────────────────────────────────────

export async function ejecutarTool(admin: SupabaseClient, name: string, input: any): Promise<unknown> {
  switch (name) {
    case 'comparar_periodos':
      return compararPeriodos(admin, input.fechaA, input.fechaB);
    case 'detalle_dia':
      return detalleDia(admin, input.fecha);
    case 'detalle_producto':
      return detalleProducto(admin, input.nombre, input.semanas ?? 8);
    case 'listar_clientes_segmento':
      return listarClientesSegmento(admin, input.segmento);
    default:
      return { error: `Herramienta desconocida: ${name}` };
  }
}

function compactFin(f: any) {
  return {
    ventas: r0(f.ventas), beneficioNeto: r0(f.beneficioNeto), margenNeto: r1(f.margenNeto),
    pedidos: f.pedidos, ticketPromedio: r0(f.ticketPromedio),
    publicidadPct: r1(f.publicidadPct), pctVentasRepetidores: r1(f.pctVentasRepetidores),
  };
}

async function compararPeriodos(admin: SupabaseClient, fechaA: string, fechaB: string) {
  const a = buildRangoSemana(new Date(fechaA + 'T12:00:00'));
  const b = buildRangoSemana(new Date(fechaB + 'T12:00:00'));
  const an = await construirAnalisisCompleto(
    admin,
    { tipo: 'comparacion', a: { desde: a.desde, hasta: a.hasta, label: a.label }, b: { desde: b.desde, hasta: b.hasta, label: b.label } },
    new Date().toISOString()
  );
  const top = (p: any) => p.productos.slice(0, 5).map((x: any) => ({ nombre: x.nombre, venta: r0(x.venta), margen: r1(x.margen) }));
  return {
    A: { label: a.label, financiero: compactFin(an.periodoA.financiero), topProductos: top(an.periodoA) },
    B: { label: b.label, financiero: compactFin(an.periodoB!.financiero), topProductos: top(an.periodoB) },
    deltas: an.deltas,
  };
}

async function detalleDia(admin: SupabaseClient, fecha: string) {
  const act = await activas(admin);
  const { data: prods } = await admin.from('productos').select('id, nombre, categoria');
  const nombre = new Map((prods || []).map((p: any) => [p.id, p.nombre]));
  const esHamb = new Set((prods || []).filter((p: any) => p.categoria === 'hamburguesa').map((p: any) => p.id));
  const { data: pedidos } = await admin
    .from('pedidos')
    .select('importacion_id, pedidos_lineas(producto_id, cantidad, precio_unitario_vendido)')
    .eq('fecha', fecha);
  let nPed = 0, ventas = 0, hamb = 0;
  const porProd = new Map<string, { u: number; v: number }>();
  for (const p of pedidos || []) {
    if (!act.has(p.importacion_id)) continue;
    nPed++;
    for (const l of p.pedidos_lineas || []) {
      ventas += l.precio_unitario_vendido * l.cantidad;
      if (esHamb.has(l.producto_id)) hamb += l.cantidad;
      const e = porProd.get(l.producto_id) || { u: 0, v: 0 };
      e.u += l.cantidad; e.v += l.precio_unitario_vendido * l.cantidad; porProd.set(l.producto_id, e);
    }
  }
  const dow = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][new Date(fecha + 'T12:00:00').getDay()];
  return {
    fecha, dia: dow, pedidos: nPed, ventas: r0(ventas), hamburguesas: hamb,
    ticketPromedio: nPed > 0 ? r0(ventas / nPed) : 0,
    topProductos: [...porProd.entries()].map(([id, d]) => ({ nombre: nombre.get(id) || '?', unidades: d.u, venta: r0(d.v) })).sort((a, b) => b.venta - a.venta).slice(0, 8),
  };
}

async function detalleProducto(admin: SupabaseClient, nombre: string, semanas: number) {
  const act = await activas(admin);
  const { data: prods } = await admin.from('productos').select('id, nombre');
  const q = (nombre || '').toLowerCase().trim();
  // Preferir match EXACTO (ej. "King" → solo el producto "King", no la PROMO
  // DOMINIO que menciona King); si no hay exacto, usar substring.
  const exactas = (prods || []).filter((p: any) => p.nombre.toLowerCase() === q);
  const match = exactas.length ? exactas : (prods || []).filter((p: any) => p.nombre.toLowerCase().includes(q));
  if (match.length === 0) return { error: `No encontré ningún producto que contenga "${nombre}".`, disponibles: (prods || []).map((p: any) => p.nombre).slice(0, 40) };
  const ids = new Set(match.map((p: any) => p.id));

  // Traer líneas del/los producto(s) con la fecha del pedido (paginado).
  let rows: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await admin
      .from('pedidos_lineas')
      .select('producto_id, cantidad, precio_unitario_vendido, costo_unitario_calculado, pedidos!inner(fecha, importacion_id)')
      .in('producto_id', [...ids])
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    rows = rows.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  // Agrupar por semana operativa (viernes).
  const porSemana = new Map<string, { u: number; v: number; c: number }>();
  for (const r of rows) {
    const ped = (r as any).pedidos;
    if (!ped || !act.has(ped.importacion_id)) continue;
    const vie = fmtFecha(periodoDeJS(new Date(ped.fecha + 'T12:00:00')));
    const e = porSemana.get(vie) || { u: 0, v: 0, c: 0 };
    e.u += r.cantidad; e.v += r.precio_unitario_vendido * r.cantidad; e.c += r.costo_unitario_calculado * r.cantidad;
    porSemana.set(vie, e);
  }
  const series = [...porSemana.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, semanas).reverse()
    .map(([viernes, d]) => ({ semana: viernes, unidades: d.u, venta: r0(d.v), margen: d.v > 0 ? r1(((d.v - d.c) / d.v) * 100) : 0 }));
  return { producto: match.map((m: any) => m.nombre).join(' + '), ultimasSemanas: series };
}

async function listarClientesSegmento(admin: SupabaseClient, segmento: string) {
  const { data } = await admin.rpc('obtener_salud_clientes', { p_ventana_dias: 21 });
  const r = (data || {}) as Record<string, any>;
  const campo = segmento === 'alto_valor_en_riesgo' ? 'alto_valor_detalle'
    : segmento === 'nuevos_en_riesgo' ? 'nuevos_en_riesgo_detalle'
    : 'top_repetidores';
  const lista = Array.isArray(r[campo]) ? r[campo] : [];
  return {
    segmento,
    cantidad: lista.length,
    clientes: lista.slice(0, 30).map((c: any) => ({
      nombre: c.nombre || '(sin nombre)',
      celular: c.celular || null,
      totalPedidos: c.total_pedidos,
      ventasTotales: r0(Number(c.ventas_totales || 0)),
      diasSinComprar: c.dias_sin_comprar,
      ultimoPedido: c.ultimo_pedido,
    })),
  };
}
