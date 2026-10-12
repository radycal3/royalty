// Herramientas de solo-lectura del Analista (fase 3 "híbrida"). El modelo las
// invoca on-demand cuando necesita datos fuera del contexto congelado. Los
// números SIEMPRE los calcula este código (reusa el motor de análisis) — la IA
// solo interpreta. Admin-only: se ejecutan con el client service_role.

import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import { buildRangoSemana, periodoDeJS } from '@/lib/dashboard/rangos';
import { construirAnalisisCompleto } from '@/lib/analisis/analisis-negocio';
import { cargarPedidosLivianos, primerPedidoDe } from '@/lib/analisis/clientes-operacion';
import { agregarNota } from '@/lib/laboratorio/conocimiento';

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

export const TOOLS: Anthropic.Beta.BetaTool[] = [
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
      'Lista accionable de clientes de un segmento, con teléfono (para WhatsApp): "alto_valor_en_riesgo" (los más valiosos que dejaron de comprar), "nuevos_en_riesgo" (cruzaron a riesgo esta semana), "top_repetidores" (los que más compran) o "una_compra_recientes" (compraron UNA sola vez en las últimas 6 semanas y no volvieron: los mejores candidatos para invitar a la comunidad o a una segunda compra). Usala cuando Lucas quiera a quién contactar.',
    input_schema: {
      type: 'object',
      properties: {
        segmento: { type: 'string', enum: ['alto_valor_en_riesgo', 'nuevos_en_riesgo', 'top_repetidores', 'una_compra_recientes'] },
      },
      required: ['segmento'],
    },
  },
  {
    name: 'antes_y_despues',
    description:
      'Mide el efecto de un cambio o experimento: compara el promedio semanal de las N semanas ANTES de una fecha contra las N semanas DESDE esa fecha. Incluye ventas, margen neto, beneficio, pedidos, ticket, publicidad (de semanas cerradas) y adquisición/recompra (clientes nuevos, clientes que volvieron, % pedidos de nuevos) y cupones usados. Usala para "¿funcionó la Royal Family?", "¿qué pasó desde que cambié la campaña?", "¿cómo cambió todo desde que se cayó WhatsApp?".',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha YYYY-MM-DD en que empezó el cambio' },
        semanas: { type: 'number', description: 'Cuántas semanas comparar de cada lado (default 4, máx 12)' },
      },
      required: ['fecha'],
    },
  },
  {
    name: 'adquisicion_semana',
    description:
      'Detalle de clientes de UNA semana operativa: cuántos fueron nuevos y cuántos ya habían comprado, cuántas compras previas tenían los que volvieron, y qué pasó después con los nuevos de esa semana (si volvieron y en cuántos días). Usala para profundizar en una semana puntual de la serie de recompra.',
    input_schema: {
      type: 'object',
      properties: { fecha: { type: 'string', description: 'Fecha YYYY-MM-DD dentro de la semana' } },
      required: ['fecha'],
    },
  },
  {
    name: 'recordar',
    description:
      'Anota algo en tu MEMORIA permanente (la vas a ver en todas las conversaciones futuras). Usala SOLO para: una decisión que Lucas tomó, un experimento que arranca (qué, desde cuándo, qué métrica mirar, cuándo evaluarlo), un dato del negocio que Lucas te contó y que no está en la ficha, o una conclusión importante a la que llegaron. Escribila corta, autocontenida y con fechas concretas. NO la uses para resumir la charla.',
    input_schema: {
      type: 'object',
      properties: { nota: { type: 'string', description: 'La nota, en una o dos frases (máx. 600 caracteres)' } },
      required: ['nota'],
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
      return input.segmento === 'una_compra_recientes'
        ? listarUnaCompraRecientes(admin)
        : listarClientesSegmento(admin, input.segmento);
    case 'antes_y_despues':
      return antesYDespues(admin, input.fecha, input.semanas ?? 4);
    case 'adquisicion_semana':
      return adquisicionSemana(admin, input.fecha);
    case 'recordar': {
      const r = await agregarNota(admin, String(input.nota || ''), 'asesor');
      return 'error' in r ? { error: r.error } : { ok: true, anotado: r.nota.texto, fecha: r.nota.fecha };
    }
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
  // Lite: la herramienta solo devuelve financiero + top productos + deltas, así
  // que apagamos las áreas caras (salud de clientes RPC, Meta Ads, equipo, merma,
  // tendencia) que NO se usan acá. Baja de ~20s a ~2s y evita el timeout.
  const an = await construirAnalisisCompleto(
    admin,
    { tipo: 'comparacion', a: { desde: a.desde, hasta: a.hasta, label: a.label }, b: { desde: b.desde, hasta: b.hasta, label: b.label } },
    new Date().toISOString(),
    { inversion: false, clientes: false, equipo: false, merma: false, tendencia: false, historia: false }
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

// ─── Herramientas de clientes / experimentos ───────────────────────────────

const semanaDe = (fecha: string) => fmtFecha(periodoDeJS(new Date(fecha + 'T12:00:00')));
const sumarDias = (fecha: string, n: number) => { const d = new Date(fecha + 'T12:00:00'); d.setDate(d.getDate() + n); return fmtFecha(d); };
const diasEntre = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000);
const prom = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

async function listarUnaCompraRecientes(admin: SupabaseClient) {
  const act = await activas(admin);
  let rows: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await admin
      .from('pedidos')
      .select('cliente_id, cliente_celular, cliente_nombre, fecha, importacion_id')
      .not('cliente_id', 'is', null)
      .order('id')
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    rows = rows.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  rows = rows.filter((r) => act.has(r.importacion_id));
  const ultimaFecha = rows.reduce((m, r) => (r.fecha > m ? r.fecha : m), '0000-01-01');
  const limite = sumarDias(ultimaFecha, -42);
  const porCliente = new Map<string, { n: number; fecha: string; celular: string | null; nombre: string | null }>();
  for (const r of rows) {
    const e = porCliente.get(r.cliente_id) || { n: 0, fecha: r.fecha, celular: r.cliente_celular, nombre: r.cliente_nombre };
    e.n++;
    if (r.fecha > e.fecha) e.fecha = r.fecha;
    porCliente.set(r.cliente_id, e);
  }
  const lista = [...porCliente.values()]
    .filter((c) => c.n === 1 && c.fecha >= limite)
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  return {
    segmento: 'una_compra_recientes',
    criterio: `una sola compra, hecha entre ${limite} y ${ultimaFecha} (último pedido importado)`,
    cantidad: lista.length,
    clientes: lista.slice(0, 30).map((c) => ({
      nombre: c.nombre || '(sin nombre)', celular: c.celular, unicaCompra: c.fecha, diasDesdeLaCompra: diasEntre(c.fecha, ultimaFecha),
    })),
  };
}

async function antesYDespues(admin: SupabaseClient, fecha: string, semanasIn: number) {
  const n = Math.max(1, Math.min(12, Math.round(semanasIn || 4)));
  const corte = semanaDe(fecha);
  const act = await activas(admin);
  const [pedidos, { data: pers }] = await Promise.all([
    cargarPedidosLivianos(admin, act),
    admin.from('periodos').select('desde, ventas, margen_neto, beneficio_neto, pedidos, ticket_promedio, publicidad_pct').eq('tipo', 'semana').order('desde'),
  ]);
  const primer = primerPedidoDe(pedidos);
  const ultimaFecha = pedidos.reduce((m, p) => (p.fecha > m ? p.fecha : m), '0000-01-01');

  // Semanas completas con datos (el domingo ya pasó en los datos importados).
  const porSemana = new Map<string, { pedidos: number; nuevos: Set<string>; vuelven: Set<string>; pedNuevos: number; cupones: number }>();
  for (const p of pedidos) {
    const s = semanaDe(p.fecha);
    if (sumarDias(s, 2) > ultimaFecha) continue;
    const e = porSemana.get(s) || { pedidos: 0, nuevos: new Set<string>(), vuelven: new Set<string>(), pedNuevos: 0, cupones: 0 };
    e.pedidos++;
    if (p.cupon) e.cupones++;
    if (p.cliente_id) {
      const primeraSemana = semanaDe(primer.get(p.cliente_id)!);
      if (primeraSemana === s) { e.nuevos.add(p.cliente_id); e.pedNuevos++; } else e.vuelven.add(p.cliente_id);
    }
    porSemana.set(s, e);
  }
  const todas = [...porSemana.keys()].sort();
  const antes = todas.filter((s) => s < corte).slice(-n);
  const despues = todas.filter((s) => s >= corte).slice(0, n);

  const resumen = (sems: string[]) => {
    const fin = (pers || []).filter((p: any) => sems.includes(p.desde));
    const cli = sems.map((s) => porSemana.get(s)!);
    const avg = (xs: number[]) => { const v = prom(xs); return v === null ? null : r1(v); };
    return {
      semanas: sems,
      financiero_semanasCerradas: fin.length,
      ventasPromedio: fin.length ? r0(prom(fin.map((p: any) => Number(p.ventas)))!) : null,
      margenNetoPromedio: fin.length ? avg(fin.map((p: any) => Number(p.margen_neto))) : null,
      beneficioNetoPromedio: fin.length ? r0(prom(fin.map((p: any) => Number(p.beneficio_neto)))!) : null,
      ticketPromedio: fin.length ? r0(prom(fin.map((p: any) => Number(p.ticket_promedio)))!) : null,
      publicidadPctPromedio: fin.length ? avg(fin.map((p: any) => Number(p.publicidad_pct))) : null,
      pedidosPorSemana: avg(cli.map((c) => c.pedidos)),
      clientesNuevosPorSemana: avg(cli.map((c) => c.nuevos.size)),
      clientesQueVolvieronPorSemana: avg(cli.map((c) => c.vuelven.size)),
      pctPedidosDeNuevos: avg(cli.map((c) => (c.pedidos ? (c.pedNuevos / c.pedidos) * 100 : 0))),
      pedidosConCuponPorSemana: avg(cli.map((c) => c.cupones)),
    };
  };
  return {
    fechaCambio: fecha,
    semanaDelCambio: corte,
    datosHasta: ultimaFecha,
    advertencia:
      despues.length < n
        ? `Solo hay ${despues.length} semana(s) completas desde el cambio (pediste ${n}): la comparación todavía es preliminar.`
        : null,
    nota: 'Promedios simples por semana. Antes/después no prueba causalidad: revisá eventos, promos y estacionalidad del mismo período.',
    antes: resumen(antes),
    despues: resumen(despues),
  };
}

async function adquisicionSemana(admin: SupabaseClient, fecha: string) {
  const s = semanaDe(fecha);
  const act = await activas(admin);
  const pedidos = await cargarPedidosLivianos(admin, act);
  const ultimaFecha = pedidos.reduce((m, p) => (p.fecha > m ? p.fecha : m), '0000-01-01');
  const fechas = new Map<string, string[]>();
  for (const p of pedidos) {
    if (!p.cliente_id) continue;
    const a = fechas.get(p.cliente_id) || [];
    if (!a.includes(p.fecha)) a.push(p.fecha);
    fechas.set(p.cliente_id, a);
  }
  for (const a of fechas.values()) a.sort();
  const clientesSemana = new Set(pedidos.filter((p) => p.cliente_id && semanaDe(p.fecha) === s).map((p) => p.cliente_id!));
  const nuevos: string[][] = [];
  const previasDeLosQueVolvieron: number[] = [];
  for (const id of clientesSemana) {
    const f = fechas.get(id)!;
    if (semanaDe(f[0]) === s) nuevos.push(f);
    else previasDeLosQueVolvieron.push(f.filter((x) => semanaDe(x) < s).length);
  }
  const volvieron = nuevos.filter((f) => f.some((x) => semanaDe(x) > s));
  const diasHastaVolver = volvieron.map((f) => diasEntre(f[0], f.find((x) => semanaDe(x) > s)!)).sort((a, b) => a - b);
  return {
    semana: s,
    datosHasta: ultimaFecha,
    clientes: clientesSemana.size,
    nuevos: nuevos.length,
    yaHabianComprado: previasDeLosQueVolvieron.length,
    comprasPreviasDeLosQueVolvieron: {
      '1': previasDeLosQueVolvieron.filter((x) => x === 1).length,
      '2-3': previasDeLosQueVolvieron.filter((x) => x >= 2 && x <= 3).length,
      '4+': previasDeLosQueVolvieron.filter((x) => x >= 4).length,
    },
    nuevosQueVolvieronDespues: volvieron.length,
    pctNuevosQueVolvieron: nuevos.length ? r1((volvieron.length / nuevos.length) * 100) : 0,
    medianaDiasHastaVolver: diasHastaVolver.length ? diasHastaVolver[Math.floor(diasHastaVolver.length / 2)] : null,
    diasTranscurridosDesdeLaSemana: diasEntre(sumarDias(s, 2), ultimaFecha),
  };
}
