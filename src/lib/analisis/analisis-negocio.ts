// Motor de análisis de negocio determinístico para el "Analista" del
// Laboratorio. Recibe un cliente Supabase (service_role / admin — la feature es
// admin-only y la salud de clientes se consulta por RPC que solo ejecuta
// service_role) y arma el objeto AnalisisCompleto que se congela por
// conversación y se le pasa a la IA. NINGÚN número lo inventa la IA: todo sale
// de acá. Módulo sin 'use server' → testeable aislado y reutilizable.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AnalisisCompleto,
  AnalisisPeriodo,
  Afinidad,
  AfinidadGrupo,
  ClientesResumen,
  DecisionHist,
  DiaResumen,
  EquipoResumen,
  EventoNegocio,
  Financiero,
  Historia,
  HistoriaSemana,
  Inversion,
  MermaResumen,
  ProductoLinea,
  PromosAnalisis,
  PubliSemanaHist,
  RangoAnalisis,
  ScopeAnalisis,
  TendenciaItem,
} from './tipos';
import { periodoDeJS } from '@/lib/dashboard/rangos';

const esPromo = (nombre: string) => /^\s*promo/i.test(nombre || '');
const r0 = (n: number) => Math.round(n || 0);
const r1 = (n: number) => Math.round((n || 0) * 10) / 10;
const fmtD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Áreas opcionales del análisis. El informe inicial las quiere TODAS (default).
// Las herramientas de drill-down (ej. comparar_periodos) solo necesitan el
// financiero + ranking de productos, así que apagan las áreas caras (sobre todo
// el RPC de salud de clientes y Meta Ads) para no reventar el timeout de la
// función. La matemática del P&L y productos es la misma en ambos casos → sin
// divergencia con el motor real.
export type OpcionesAnalisis = {
  inversion?: boolean; // Meta Ads + gastos por categoría detallados (default true)
  clientes?: boolean;  // RPC obtener_salud_clientes — el más caro (default true)
  equipo?: boolean;    // métricas de equipo (default true)
  merma?: boolean;     // conteos de stock (default true)
  tendencia?: boolean; // últimas 8 semanas (default true)
  historia?: boolean;  // "la película": serie semanal + promos + publi + decisiones + eventos (default true)
};

const CLIENTES_VACIO: ClientesResumen = {
  totalUnicos: 0, activos: 0, enRiesgo: 0, nuevoPerdido: 0, retencionCartera: 0,
  tasaRetencion: 0, pctFacturacionRepetidores: 0, altoValorEnRiesgo: 0,
  altoValorVentasHistoricas: 0, nuevosEnRiesgoEstaSemana: 0, medianaDiasEntreCompras: 0,
};

type PedidoRow = {
  fecha: string;
  cliente_id: string | null;
  importacion_id: string;
  envio_cobrado: number | null;
  pedidos_lineas: {
    producto_id: string;
    cantidad: number;
    precio_unitario_vendido: number;
    costo_unitario_calculado: number;
  }[];
};

// ─── Carga de datos base de un período ─────────────────────────────────────

async function activasSet(admin: SupabaseClient): Promise<Set<string>> {
  const { data } = await admin.from('importaciones').select('id').eq('estado', 'activa');
  return new Set((data || []).map((i: any) => i.id));
}

async function cargarPedidos(admin: SupabaseClient, desde: string, hasta: string, activas: Set<string>): Promise<PedidoRow[]> {
  // Paginado defensivo (Supabase corta en 1000).
  let all: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await admin
      .from('pedidos')
      .select('fecha, cliente_id, importacion_id, envio_cobrado, pedidos_lineas(producto_id, cantidad, precio_unitario_vendido, costo_unitario_calculado)')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all.filter((p) => activas.has(p.importacion_id));
}

// Primer pedido histórico por cliente (para clasificar repetidor vs nuevo).
async function primerPedidoPorCliente(admin: SupabaseClient, activas: Set<string>): Promise<Map<string, string>> {
  let all: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await admin
      .from('pedidos')
      .select('cliente_id, fecha, importacion_id')
      .not('cliente_id', 'is', null)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const m = new Map<string, string>();
  for (const p of all) {
    if (!activas.has(p.importacion_id)) continue;
    const prev = m.get(p.cliente_id);
    if (prev === undefined || p.fecha < prev) m.set(p.cliente_id, p.fecha);
  }
  return m;
}

// ─── Análisis de un período ────────────────────────────────────────────────

async function analizarPeriodo(
  admin: SupabaseClient,
  rango: RangoAnalisis,
  productosMap: Map<string, { nombre: string; categoria: string }>,
  idsHamburguesa: Set<string>,
  primerPedido: Map<string, string>,
  activas: Set<string>,
  opts: OpcionesAnalisis = {}
): Promise<AnalisisPeriodo> {
  const { desde, hasta } = rango;
  const pedidos = await cargarPedidos(admin, desde, hasta, activas);

  // ── Financiero + ranking de productos + por día + promos + afinidad ──
  let nPedidos = 0, ventas = 0, costoIng = 0, hamburguesas = 0, envios = 0;
  let pedidosRep = 0, ventasRep = 0;
  const porProducto = new Map<string, { unidades: number; venta: number; costo: number }>();
  const dias: Record<number, { pedidos: number; ventas: number; hamburguesas: number; prod: Map<string, number> }> = {
    5: { pedidos: 0, ventas: 0, hamburguesas: 0, prod: new Map() }, // Vie
    6: { pedidos: 0, ventas: 0, hamburguesas: 0, prod: new Map() }, // Sáb
    0: { pedidos: 0, ventas: 0, hamburguesas: 0, prod: new Map() }, // Dom
  };
  // afinidad
  const grupoRep = { pedidos: 0, ventas: 0, prod: new Map<string, { u: number; v: number }>() };
  const grupoNue = { pedidos: 0, ventas: 0, prod: new Map<string, { u: number; v: number }>() };

  for (const p of pedidos) {
    nPedidos++;
    envios += p.envio_cobrado || 0;
    const dow = new Date(p.fecha + 'T12:00:00').getDay();
    const dd = dias[dow];
    if (dd) dd.pedidos++;
    const primera = p.cliente_id ? primerPedido.get(p.cliente_id) : undefined;
    const rep = !!(primera && primera < p.fecha);
    const g = rep ? grupoRep : grupoNue;
    g.pedidos++;
    let ventaPedido = 0;
    for (const l of p.pedidos_lineas || []) {
      const v = l.precio_unitario_vendido * l.cantidad;
      const c = l.costo_unitario_calculado * l.cantidad;
      ventas += v; costoIng += c; ventaPedido += v;
      const info = productosMap.get(l.producto_id);
      const nombre = info?.nombre || 'Desconocido';
      if (idsHamburguesa.has(l.producto_id)) hamburguesas += l.cantidad;
      const e = porProducto.get(l.producto_id) || { unidades: 0, venta: 0, costo: 0 };
      e.unidades += l.cantidad; e.venta += v; e.costo += c; porProducto.set(l.producto_id, e);
      if (dd) { dd.ventas += v; if (idsHamburguesa.has(l.producto_id)) dd.hamburguesas += l.cantidad; dd.prod.set(nombre, (dd.prod.get(nombre) || 0) + l.cantidad); }
      const gp = g.prod.get(nombre) || { u: 0, v: 0 };
      gp.u += l.cantidad; gp.v += v; g.prod.set(nombre, gp);
    }
    g.ventas += ventaPedido;
    if (rep) { pedidosRep++; ventasRep += ventaPedido; }
  }

  // Gastos / consumo / cadetes
  const [{ data: gastosData }, { data: consumoData }, { data: jornadasData }] = await Promise.all([
    admin.from('gastos_operativos').select('tipo, categoria, monto').gte('fecha', desde).lte('fecha', hasta),
    admin.from('consumo_interno').select('consumo_interno_lineas(cantidad, costo_unitario_calculado)').gte('fecha', desde).lte('fecha', hasta),
    admin.from('cadetes_jornadas').select('pago_cadete, costo_empresa_cadete_usado').gte('fecha', desde).lte('fecha', hasta),
  ]);
  let gastosVariables = 0, gastosFijos = 0, gastoPublicidad = 0;
  for (const g of gastosData || []) {
    if (g.categoria === 'cadeteria') continue; // ya entra por resultadoDelivery
    if (g.tipo === 'variable') gastosVariables += g.monto; else gastosFijos += g.monto;
    if (g.categoria === 'publicidad') gastoPublicidad += g.monto;
  }
  let costoConsumoInterno = 0;
  for (const ci of consumoData || []) for (const l of ci.consumo_interno_lineas || []) costoConsumoInterno += l.costo_unitario_calculado * l.cantidad;
  let pagosCadetes = 0, costoBaseCadeteria = 0;
  for (const j of jornadasData || []) { pagosCadetes += j.pago_cadete || 0; costoBaseCadeteria += j.costo_empresa_cadete_usado || 0; }

  const resultadoDelivery = envios - pagosCadetes - costoBaseCadeteria;
  const beneficioBruto = ventas - costoIng;
  const gastosTotal = gastosVariables + gastosFijos;
  const beneficioNeto = beneficioBruto - costoConsumoInterno - gastosTotal + resultadoDelivery;

  const financiero: Financiero = {
    pedidos: nPedidos,
    hamburguesasVendidas: hamburguesas,
    ticketPromedio: nPedidos > 0 ? ventas / nPedidos : 0,
    ventas, costoIngredientes: costoIng, beneficioBruto,
    margenBruto: ventas > 0 ? (beneficioBruto / ventas) * 100 : 0,
    gastosVariables, gastosFijos, gastosTotal, gastoPublicidad,
    publicidadPct: ventas > 0 ? (gastoPublicidad / ventas) * 100 : 0,
    costoConsumoInterno, resultadoDelivery, beneficioNeto,
    margenNeto: ventas > 0 ? (beneficioNeto / ventas) * 100 : 0,
    pedidosRepetidores: pedidosRep, ventasRepetidores: ventasRep,
    pctVentasRepetidores: ventas > 0 ? (ventasRep / ventas) * 100 : 0,
  };

  // Ranking de productos
  const productos: ProductoLinea[] = [...porProducto.entries()].map(([id, d]) => {
    const info = productosMap.get(id);
    const nombre = info?.nombre || 'Desconocido';
    return {
      nombre, categoria: info?.categoria || '', esPromo: esPromo(nombre),
      unidades: d.unidades, venta: d.venta, costo: d.costo, beneficio: d.venta - d.costo,
      margen: d.venta > 0 ? ((d.venta - d.costo) / d.venta) * 100 : 0,
      participacion: ventas > 0 ? (d.venta / ventas) * 100 : 0,
    };
  }).sort((a, b) => b.venta - a.venta);

  // Por día
  const nombreDia: Record<number, DiaResumen['dia']> = { 5: 'Viernes', 6: 'Sábado', 0: 'Domingo' };
  const porDia: DiaResumen[] = [5, 6, 0].map((dow) => {
    const dd = dias[dow];
    const top = [...dd.prod.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([nombre, unidades]) => ({ nombre, unidades }));
    return { dia: nombreDia[dow], pedidos: dd.pedidos, ventas: dd.ventas, ticketPromedio: dd.pedidos > 0 ? dd.ventas / dd.pedidos : 0, hamburguesas: dd.hamburguesas, topProductos: top };
  });

  // Promos
  const promosProd = productos.filter((p) => p.esPromo);
  const noPromoProd = productos.filter((p) => !p.esPromo);
  const sumar = (arr: ProductoLinea[]) => arr.reduce((a, p) => ({ ventas: a.ventas + p.venta, beneficio: a.beneficio + p.beneficio, unidades: a.unidades + p.unidades }), { ventas: 0, beneficio: 0, unidades: 0 });
  const sp = sumar(promosProd), snp = sumar(noPromoProd);
  const promos: PromosAnalisis = {
    promos: promosProd,
    resumenPromo: { ventas: sp.ventas, beneficio: sp.beneficio, margen: sp.ventas > 0 ? (sp.beneficio / sp.ventas) * 100 : 0, participacionVentas: ventas > 0 ? (sp.ventas / ventas) * 100 : 0, unidades: sp.unidades },
    resumenNoPromo: { ventas: snp.ventas, beneficio: snp.beneficio, margen: snp.ventas > 0 ? (snp.beneficio / snp.ventas) * 100 : 0, participacionVentas: ventas > 0 ? (snp.ventas / ventas) * 100 : 0, unidades: snp.unidades },
  };

  // Afinidad
  const grupoResumen = (g: { pedidos: number; ventas: number; prod: Map<string, { u: number; v: number }> }): AfinidadGrupo => ({
    pedidos: g.pedidos, ventas: g.ventas, ticketPromedio: g.pedidos > 0 ? g.ventas / g.pedidos : 0,
    topProductos: [...g.prod.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 6).map(([nombre, d]) => ({ nombre, unidades: d.u, pctVentasGrupo: g.ventas > 0 ? (d.v / g.ventas) * 100 : 0 })),
  });
  const afinidad: Afinidad = { repetidores: grupoResumen(grupoRep), nuevos: grupoResumen(grupoNue) };

  // Inversión (gastos por categoría + Meta Ads agregado del período)
  const porCategoria = aggGastos(gastosData || []);
  const inversion: Inversion = opts.inversion === false
    ? { porCategoria, total: porCategoria.reduce((a, c) => a + c.total, 0), publicidad: 'sin_datos_todavia' }
    : await construirInversion(admin, desde, hasta, ventas, porCategoria);

  // Clientes (RPC, estado actual — se marca como tal afuera). Es la consulta más
  // cara: las herramientas de drill-down la apagan (no usan este dato).
  const clientes = opts.clientes === false ? CLIENTES_VACIO : await construirClientes(admin);

  // Equipo (métricas de las semanas del período)
  const equipo = opts.equipo === false ? 'sin_datos_todavia' : await construirEquipo(admin, desde, hasta, nPedidos);

  // Merma (dormida si no hay conteos)
  const merma = opts.merma === false ? 'sin_datos_todavia' : await construirMerma(admin, desde);

  return { rango, financiero, productos, porDia, promos, afinidad, inversion, clientes, equipo, merma };
}

function aggGastos(rows: any[]): { categoria: string; tipo: string; total: number }[] {
  const m = new Map<string, { categoria: string; tipo: string; total: number }>();
  for (const g of rows) {
    const key = `${g.tipo}-${g.categoria}`;
    const e = m.get(key);
    if (e) e.total += g.monto; else m.set(key, { categoria: g.categoria, tipo: g.tipo, total: g.monto });
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

async function construirInversion(admin: SupabaseClient, desde: string, hasta: string, ventas: number, porCategoria: { categoria: string; tipo: string; total: number }[]): Promise<Inversion> {
  const total = porCategoria.reduce((a, c) => a + c.total, 0);
  // Meta Ads: todas las importaciones cuya periodo_desde cae en el rango.
  const { data: imps } = await admin
    .from('meta_ads_importaciones')
    .select('periodo_desde, gasto_usd, gasto_ars, alcance, clics, resultados')
    .gte('periodo_desde', desde).lte('periodo_desde', hasta);
  if (!imps || imps.length === 0) {
    return { porCategoria, total, publicidad: 'sin_datos_todavia' };
  }
  const gastoUsd = imps.reduce((a, i) => a + (i.gasto_usd || 0), 0);
  const gastoArs = imps.reduce((a, i) => a + (i.gasto_ars || 0), 0);
  const alcance = imps.reduce((a, i) => a + (i.alcance || 0), 0) || null;
  const clics = imps.reduce((a, i) => a + (i.clics || 0), 0) || null;
  const resultados = imps.reduce((a, i) => a + (i.resultados || 0), 0) || null;

  const { data: det } = await admin
    .from('meta_ads_detalle')
    .select('nombre_conjunto, tipo_audiencia, gasto_ars, conversaciones, clics_enlace, impresiones')
    .gte('periodo_desde', desde).lte('periodo_desde', hasta);
  const porConj = new Map<string, { tipo: string; gastoArs: number; conv: number; clics: number; impr: number }>();
  for (const d of det || []) {
    const e = porConj.get(d.nombre_conjunto) || { tipo: d.tipo_audiencia, gastoArs: 0, conv: 0, clics: 0, impr: 0 };
    e.gastoArs += d.gasto_ars || 0; e.conv += d.conversaciones || 0; e.clics += d.clics_enlace || 0; e.impr += d.impresiones || 0;
    porConj.set(d.nombre_conjunto, e);
  }
  const porConjunto = [...porConj.entries()].map(([nombre, e]) => ({
    nombre, tipoAudiencia: e.tipo, gastoArs: e.gastoArs,
    conversaciones: e.conv || null,
    costoPorConversacion: e.conv > 0 ? e.gastoArs / e.conv : null,
    ctrEnlace: e.impr > 0 ? (e.clics / e.impr) * 100 : null,
  })).sort((a, b) => b.gastoArs - a.gastoArs);

  return {
    porCategoria, total,
    publicidad: { gastoUsd, gastoArs, pctVentas: ventas > 0 ? (gastoArs / ventas) * 100 : 0, roas: gastoArs > 0 ? ventas / gastoArs : 0, alcance, clics, resultados, porConjunto },
  };
}

async function construirClientes(admin: SupabaseClient): Promise<ClientesResumen> {
  const { data } = await admin.rpc('obtener_salud_clientes', { p_ventana_dias: 21 });
  const r = (data || {}) as Record<string, any>;
  return {
    totalUnicos: Number(r.total_unicos || 0),
    activos: Number(r.activo || 0),
    enRiesgo: Number(r.en_riesgo || 0),
    nuevoPerdido: Number(r.nuevo_perdido || 0),
    retencionCartera: Number(r.retencion_cartera || 0),
    tasaRetencion: Number(r.tasa_retencion || 0),
    pctFacturacionRepetidores: Number(r.pct_facturacion_repetidores || 0),
    altoValorEnRiesgo: Number(r.alto_valor_en_riesgo || 0),
    altoValorVentasHistoricas: Number(r.alto_valor_ventas_historicas || 0),
    nuevosEnRiesgoEstaSemana: Array.isArray(r.nuevos_en_riesgo_detalle) ? r.nuevos_en_riesgo_detalle.length : 0,
    medianaDiasEntreCompras: Number(r.mediana_dias_entre_compras || 0),
  };
}

async function construirEquipo(admin: SupabaseClient, desde: string, hasta: string, pedidosPeriodo: number): Promise<EquipoResumen> {
  const { data } = await admin
    .from('metricas_equipo_semana')
    .select('mensajes_recibidos, mensajes_convertidos, tiempo_promedio_produccion_min, quejas_faltantes, quejas_calidad')
    .gte('periodo_desde', desde).lte('periodo_desde', hasta);
  if (!data || data.length === 0) return 'sin_datos_todavia';
  // Agregar (sumar conteos, promediar tiempos) por si el período abarca varias semanas.
  let mr = 0, mc = 0, qf = 0, qc = 0, tProd = 0, nT = 0, hayMsg = false, hayQuejas = false;
  for (const m of data) {
    if (m.mensajes_recibidos != null) { mr += m.mensajes_recibidos; hayMsg = true; }
    if (m.mensajes_convertidos != null) mc += m.mensajes_convertidos;
    if (m.quejas_faltantes != null) { qf += m.quejas_faltantes; hayQuejas = true; }
    if (m.quejas_calidad != null) { qc += m.quejas_calidad; hayQuejas = true; }
    if (m.tiempo_promedio_produccion_min != null) { tProd += m.tiempo_promedio_produccion_min; nT++; }
  }
  const errores = qf + qc;
  return {
    mensajesRecibidos: hayMsg ? mr : null,
    mensajesConvertidos: hayMsg ? mc : null,
    tasaConversion: hayMsg && mr > 0 ? (mc / mr) * 100 : null,
    tiempoPromedioProduccionMin: nT > 0 ? tProd / nT : null,
    quejasFaltantes: hayQuejas ? qf : null,
    quejasCalidad: hayQuejas ? qc : null,
    pctPedidosConError: hayQuejas && pedidosPeriodo > 0 ? (errores / pedidosPeriodo) * 100 : null,
  };
}

async function construirMerma(admin: SupabaseClient, desde: string): Promise<MermaResumen> {
  // Dormido hasta que se carguen conteos de stock. Si no hay conteos para la
  // semana, se marca sin_datos (no se inventa).
  const { data } = await admin.from('conteos_stock').select('id').eq('fecha', desde).limit(1);
  if (!data || data.length === 0) return 'sin_datos_todavia';
  // (Cálculo completo de merma vive en stock/actions.ts; acá solo se señala que
  // hay conteos — el detalle se puede traer como drill-down.)
  return 'sin_datos_todavia';
}

// ─── Tendencia (últimas N semanas cerradas) ────────────────────────────────

async function construirTendencia(admin: SupabaseClient, hastaRef: string, n: number): Promise<TendenciaItem[]> {
  const { data } = await admin
    .from('periodos')
    .select('label, desde, ventas, margen_neto, beneficio_neto, pedidos')
    .eq('tipo', 'semana')
    .lte('desde', hastaRef)
    .order('desde', { ascending: false })
    .limit(n);
  return (data || []).map((p: any) => ({
    label: p.label, desde: p.desde, ventas: p.ventas, margenNeto: p.margen_neto,
    beneficioNeto: p.beneficio_neto, pedidos: p.pedidos, cerrada: true,
  })).reverse();
}

// ─── HISTORIA: "la película" (serie semanal para el asesor estratégico) ──────
// Todo sale de tablas YA precomputadas al cerrar cada semana (periodos,
// periodos_productos, meta_ads_detalle) + el loop de decisiones. Son lecturas
// indexadas y baratas → se arman una sola vez al congelar el contexto.

const UMBRAL_PROMO_PCT = 15; // participación de productos "PROMO…" para marcar "semana de promo"

async function construirHistoria(
  admin: SupabaseClient,
  hastaRef: string,
  nSemanas: number,
  primerPedido: Map<string, string>,
  activas: Set<string>
): Promise<Historia> {
  // 1) Semanas cerradas (KPIs ya calculados) hasta la fecha de referencia.
  const { data: pers } = await admin
    .from('periodos')
    .select('id, label, desde, ventas, margen_neto, beneficio_neto, pedidos, ticket_promedio, publicidad_pct, roas, resultado_delivery')
    .eq('tipo', 'semana')
    .lte('desde', hastaRef)
    .order('desde', { ascending: false })
    .limit(nSemanas);
  const periodos = (pers || []).slice().reverse(); // cronológico: viejo → nuevo
  const periodoIds = periodos.map((p: any) => p.id);
  const desdeVentana = periodos.length ? periodos[0].desde : hastaRef;

  // 2) En paralelo: promo por semana, repetidores % por semana, publi por semana, decisiones.
  const [promoPorPeriodo, repPorViernes, publiPorSemana, decisiones] = await Promise.all([
    promoPorPeriodoMap(admin, periodoIds),
    repetidoresPorSemana(admin, desdeVentana, hastaRef, primerPedido, activas),
    publiHistoria(admin, desdeVentana, hastaRef),
    decisionesHistoria(admin),
  ]);

  const semanas: HistoriaSemana[] = periodos.map((p: any) => {
    const pa = promoPorPeriodo.get(p.id);
    const participacion = pa && p.ventas > 0 ? (pa.venta / p.ventas) * 100 : 0;
    const promo = pa
      ? { participacion: r1(participacion), margen: pa.venta > 0 ? r1((pa.beneficio / pa.venta) * 100) : 0, unidades: pa.unidades, venta: r0(pa.venta) }
      : null;
    return {
      semana: p.desde,
      label: p.label,
      esPromo: participacion > UMBRAL_PROMO_PCT,
      ventas: r0(p.ventas),
      margenNeto: r1(p.margen_neto),
      beneficioNeto: r0(p.beneficio_neto),
      pedidos: p.pedidos,
      ticketPromedio: r0(p.ticket_promedio),
      publicidadPct: r1(p.publicidad_pct),
      roas: r1(p.roas),
      resultadoDelivery: r0(p.resultado_delivery),
      pctVentasRepetidores: repPorViernes.has(p.desde) ? repPorViernes.get(p.desde)! : null,
      promo,
    };
  });

  return { semanas, publiPorSemana, decisiones };
}

async function promoPorPeriodoMap(admin: SupabaseClient, periodoIds: string[]): Promise<Map<string, { venta: number; beneficio: number; unidades: number }>> {
  const out = new Map<string, { venta: number; beneficio: number; unidades: number }>();
  if (periodoIds.length === 0) return out;
  const { data } = await admin
    .from('periodos_productos')
    .select('periodo_id, producto_nombre, unidades, venta, beneficio')
    .in('periodo_id', periodoIds);
  for (const row of data || []) {
    if (!esPromo((row as any).producto_nombre)) continue;
    const e = out.get((row as any).periodo_id) || { venta: 0, beneficio: 0, unidades: 0 };
    e.venta += Number((row as any).venta) || 0;
    e.beneficio += Number((row as any).beneficio) || 0;
    e.unidades += Number((row as any).unidades) || 0;
    out.set((row as any).periodo_id, e);
  }
  return out;
}

// Repetidores % de ventas por semana operativa (viernes). Reusa primerPedido
// (misma definición que analizarPeriodo: cliente con compra previa a este pedido).
async function repetidoresPorSemana(
  admin: SupabaseClient,
  desde: string,
  hasta: string,
  primerPedido: Map<string, string>,
  activas: Set<string>
): Promise<Map<string, number>> {
  const pedidos = await cargarPedidos(admin, desde, hasta, activas);
  const porSemana = new Map<string, { ventas: number; ventasRep: number }>();
  for (const p of pedidos) {
    const vie = fmtD(periodoDeJS(new Date(p.fecha + 'T12:00:00')));
    let venta = 0;
    for (const l of p.pedidos_lineas || []) venta += l.precio_unitario_vendido * l.cantidad;
    const primera = p.cliente_id ? primerPedido.get(p.cliente_id) : undefined;
    const rep = !!(primera && primera < p.fecha);
    const e = porSemana.get(vie) || { ventas: 0, ventasRep: 0 };
    e.ventas += venta;
    if (rep) e.ventasRep += venta;
    porSemana.set(vie, e);
  }
  const out = new Map<string, number>();
  for (const [vie, e] of porSemana) out.set(vie, e.ventas > 0 ? r1((e.ventasRep / e.ventas) * 100) : 0);
  return out;
}

async function publiHistoria(admin: SupabaseClient, desde: string, hasta: string): Promise<PubliSemanaHist[]> {
  const { data } = await admin
    .from('meta_ads_detalle')
    .select('periodo_desde, tipo_audiencia, gasto_ars, conversaciones')
    .gte('periodo_desde', desde)
    .lte('periodo_desde', hasta);
  const m = new Map<string, { gastoArs: number; frio: { g: number; c: number }; calido: { g: number; c: number } }>();
  for (const d of data || []) {
    const sem = (d as any).periodo_desde as string;
    const e = m.get(sem) || { gastoArs: 0, frio: { g: 0, c: 0 }, calido: { g: 0, c: 0 } };
    const g = Number((d as any).gasto_ars) || 0;
    const c = Number((d as any).conversaciones) || 0;
    e.gastoArs += g;
    const bucket = (d as any).tipo_audiencia === 'fría' ? e.frio : e.calido;
    bucket.g += g;
    bucket.c += c;
    m.set(sem, e);
  }
  return [...m.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([semana, e]) => ({
      semana,
      gastoArs: r0(e.gastoArs),
      frio: e.frio.g > 0 ? { gastoArs: r0(e.frio.g), conversaciones: e.frio.c, costoPorConversacion: e.frio.c > 0 ? r0(e.frio.g / e.frio.c) : null } : null,
      calido: e.calido.g > 0 ? { gastoArs: r0(e.calido.g), conversaciones: e.calido.c, costoPorConversacion: e.calido.c > 0 ? r0(e.calido.g / e.calido.c) : null } : null,
    }));
}

async function decisionesHistoria(admin: SupabaseClient): Promise<DecisionHist[]> {
  const { data } = await admin
    .from('decisiones_laboratorio')
    .select('periodo_desde, area, recomendacion, estado, decision_tomada, resultado')
    .order('periodo_desde', { ascending: false })
    .limit(20);
  return (data || []).map((d: any) => ({
    periodoDesde: d.periodo_desde,
    area: d.area,
    recomendacion: d.recomendacion,
    estado: d.estado,
    decisionTomada: d.decision_tomada,
    resultado: d.resultado,
  }));
}

// Eventos del mundo real (guardados en configuracion.clave='negocio_eventos' como
// JSON — sin tabla nueva). Los más recientes primero.
async function construirEventos(admin: SupabaseClient): Promise<EventoNegocio[]> {
  const { data } = await admin.from('configuracion').select('valor').eq('clave', 'negocio_eventos').maybeSingle();
  if (!data?.valor) return [];
  try {
    const arr = JSON.parse(data.valor);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e: any) => e && e.fecha && e.descripcion)
      .map((e: any) => ({ fecha: String(e.fecha), descripcion: String(e.descripcion) }))
      .sort((a: EventoNegocio, b: EventoNegocio) => (a.fecha < b.fecha ? 1 : -1))
      .slice(0, 30);
  } catch {
    return [];
  }
}

// ─── Orquestador ────────────────────────────────────────────────────────────

export async function construirAnalisisCompleto(
  admin: SupabaseClient,
  scope: ScopeAnalisis,
  generadoEn: string,
  opts: OpcionesAnalisis = {}
): Promise<AnalisisCompleto> {
  const activas = await activasSet(admin);
  const [{ data: prodRows }, { data: hamRows }, primerPedido] = await Promise.all([
    admin.from('productos').select('id, nombre, categoria'),
    admin.from('productos').select('id').eq('categoria', 'hamburguesa'),
    primerPedidoPorCliente(admin, activas),
  ]);
  const productosMap = new Map<string, { nombre: string; categoria: string }>((prodRows || []).map((p: any) => [p.id, { nombre: p.nombre, categoria: p.categoria }]));
  const idsHamburguesa = new Set<string>((hamRows || []).map((p: any) => p.id));

  const periodoA = await analizarPeriodo(admin, scope.a, productosMap, idsHamburguesa, primerPedido, activas, opts);

  // findes (viernes) en el período A
  const findes = contarViernes(scope.a.desde, scope.a.hasta);

  const tendencia = opts.tendencia === false ? [] : await construirTendencia(admin, scope.a.hasta, 8);

  // "La película": serie semanal + promos + publi + decisiones + eventos. Solo
  // en el contexto congelado (informe/estratégico), no en las herramientas lite.
  const [historia, eventos] = opts.historia === false
    ? [undefined, undefined]
    : await Promise.all([
        construirHistoria(admin, scope.a.hasta, 16, primerPedido, activas),
        construirEventos(admin),
      ]);

  if (scope.tipo === 'comparacion') {
    const periodoB = await analizarPeriodo(admin, scope.b, productosMap, idsHamburguesa, primerPedido, activas, opts);
    const deltas = construirDeltas(periodoA.financiero, periodoB.financiero);
    return { generadoEn, scopeTipo: 'comparacion', periodoA, periodoB, deltas, tendencia, findes, historia, eventos };
  }

  return { generadoEn, scopeTipo: scope.tipo, periodoA, tendencia, findes, historia, eventos };
}

function contarViernes(desde: string, hasta: string): number {
  let n = 0;
  const d = new Date(desde + 'T12:00:00');
  const end = new Date(hasta + 'T12:00:00');
  while (d <= end) { if (d.getDay() === 5) n++; d.setDate(d.getDate() + 1); }
  return n;
}

function construirDeltas(a: Financiero, b: Financiero): Record<string, { a: number; b: number; delta: number }> {
  const campos: (keyof Financiero)[] = ['ventas', 'beneficioNeto', 'margenNeto', 'pedidos', 'ticketPromedio', 'gastoPublicidad', 'publicidadPct', 'pctVentasRepetidores'];
  const out: Record<string, { a: number; b: number; delta: number }> = {};
  for (const c of campos) out[c] = { a: a[c], b: b[c], delta: (b[c] as number) - (a[c] as number) };
  return out;
}
