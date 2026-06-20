'use server';

import { createClient } from '@/lib/supabase/server';
import { rangoAnterior, type Rango } from '@/lib/dashboard/rangos';

// ─── Types de datos (no de rango — esos viven en lib/dashboard/rangos.ts) ──

export type KpisPeriodo = {
  pedidos: number;
  hamburguesasVendidas: number;
  hamburguesasPorPedido: number;
  ventas: number;
  costoIngredientes: number;
  beneficioBruto: number;
  margenBruto: number;
  gastosVariables: number;
  gastosFijos: number;
  gastosTotal: number;
  gastoPublicidad: number;
  publicidadPct: number;
  costoPorPedido: number;
  roas: number;
  costoConsumoInterno: number;
  enviosCobrados: number;
  pagosCadetes: number;
  costoBaseCadeteria: number;
  resultadoDelivery: number;
  beneficioNeto: number;
  margenNeto: number;
  ticketPromedio: number;
  netoPorPedido: number;
};

export type KpisConDelta = {
  actual: KpisPeriodo;
  anterior: KpisPeriodo | null;
  rangoActual: Rango;
  rangoAnterior: Rango | null;
};

export type GastoDesglose = {
  tipo: string;
  categoria: string;
  total: number;
  legacy: boolean; // true para categoria = 'cadeteria': no participa de resultadoDelivery
};

export type ProductoRanking = {
  nombre: string;
  unidades: number;
  venta: number;
  costo: number;
  beneficio: number;
  margen: number;
  participacion: number;
};

export type IngredienteConsumo = {
  nombre: string;
  unidad: string;
  cantidad: number;
  costo: number;
  participacion: number;
};

// ─── Queries del Dashboard ─────────────────────────────────────────────────
// Todas las queries reciben { desde, hasta } y filtran con >= desde, <= hasta.
// Esto funciona igual para semana, mes, trimestre, año o personalizado.
//
// NOTA sobre multi-fuente: hoy solo existe Pedix como fuente de ventas, pero
// la arquitectura ya lo soporta. Cualquier fuente futura (WhatsApp, mostrador)
// insertaría en las mismas tablas (importaciones + pedidos + pedidos_lineas)
// con un campo origen distinto. Las queries del dashboard no filtran por origen,
// así que funcionarían sin cambios.

async function calcularKpis(
  supabase: any,
  desde: string,
  hasta: string
): Promise<KpisPeriodo> {
  // Q1: Ventas y costos
  const { data: ventasData } = await supabase
    .from('pedidos')
    .select(`
      id,
      importacion_id,
      envio_cobrado,
      pedidos_lineas (
        producto_id,
        cantidad,
        precio_unitario_vendido,
        costo_unitario_calculado
      )
    `)
    .gte('fecha', desde)
    .lte('fecha', hasta);

  const { data: importaciones } = await supabase
    .from('importaciones')
    .select('id')
    .eq('estado', 'activa');

  const activas = new Set((importaciones || []).map((i: any) => i.id));

  // Productos categoría 'hamburguesa' — para distinguir "hamburguesas
  // vendidas" de "unidades de cualquier producto" (bebidas, papas, etc.
  // quedan afuera).
  const { data: productosHamburguesa } = await supabase
    .from('productos')
    .select('id')
    .eq('categoria', 'hamburguesa');

  const idsHamburguesa = new Set(
    (productosHamburguesa || []).map((p: any) => p.id)
  );

  let pedidos = 0;
  let ventas = 0;
  let costoIngredientes = 0;
  let enviosCobrados = 0;
  let hamburguesasVendidas = 0;

  for (const p of ventasData || []) {
    if (!activas.has(p.importacion_id)) continue;
    pedidos++;
    // envio_cobrado vive en la cabecera del pedido — se suma una sola vez
    // por pedido, NO dentro del loop de pedidos_lineas (que lo duplicaría
    // por cada línea, ver riesgo documentado en el handoff).
    enviosCobrados += p.envio_cobrado || 0;
    for (const l of p.pedidos_lineas || []) {
      ventas += l.precio_unitario_vendido * l.cantidad;
      costoIngredientes += l.costo_unitario_calculado * l.cantidad;
      if (idsHamburguesa.has(l.producto_id)) {
        hamburguesasVendidas += l.cantidad;
      }
    }
  }

  // Q2: Gastos (cadetería ya NO se lee de acá — ver Q4)
  const { data: gastosData } = await supabase
    .from('gastos_operativos')
    .select('tipo, categoria, monto')
    .gte('fecha', desde)
    .lte('fecha', hasta);

  let gastosVariables = 0;
  let gastosFijos = 0;
  let gastoPublicidad = 0;

  for (const g of gastosData || []) {
    if (g.tipo === 'variable') gastosVariables += g.monto;
    else gastosFijos += g.monto;
    if (g.categoria === 'publicidad') gastoPublicidad += g.monto;
  }

  // Q3: Consumo interno
  const { data: consumoData } = await supabase
    .from('consumo_interno')
    .select(`
      consumo_interno_lineas (
        cantidad,
        costo_unitario_calculado
      )
    `)
    .gte('fecha', desde)
    .lte('fecha', hasta);

  let costoConsumoInterno = 0;
  for (const ci of consumoData || []) {
    for (const l of ci.consumo_interno_lineas || []) {
      costoConsumoInterno += l.costo_unitario_calculado * l.cantidad;
    }
  }

  // Q4: Liquidación de cadetes — fuente única del costo de cadetería desde
  // Fase 4. Lee de cadetes_jornadas (cierre operativo nocturno: cadete +
  // fecha + viajes_realizados), NO de pedidos. pago_cadete y
  // costo_empresa_cadete_usado ya vienen congelados en cada fila al
  // momento de cargar el cierre — no se recalculan acá con la
  // configuración vigente, para no alterar liquidaciones pasadas si la
  // tarifa cambia después.
  // gastos_operativos con categoria = 'cadeteria' ya NO se lee acá; queda
  // como histórico pre-Fase 4 (ver nota en migración 019).
  const { data: jornadasData } = await supabase
    .from('cadetes_jornadas')
    .select('pago_cadete, costo_empresa_cadete_usado')
    .gte('fecha', desde)
    .lte('fecha', hasta);

  let pagosCadetes = 0;
  let costoBaseCadeteria = 0;
  for (const j of jornadasData || []) {
    pagosCadetes += j.pago_cadete || 0;
    costoBaseCadeteria += j.costo_empresa_cadete_usado || 0;
  }

  const resultadoDelivery = enviosCobrados - pagosCadetes - costoBaseCadeteria;

  const beneficioBruto = ventas - costoIngredientes;
  const gastosTotal = gastosVariables + gastosFijos;
  const beneficioNeto =
    beneficioBruto - costoConsumoInterno - gastosTotal + resultadoDelivery;

  return {
    pedidos,
    hamburguesasVendidas,
    hamburguesasPorPedido: pedidos > 0 ? hamburguesasVendidas / pedidos : 0,
    ventas,
    costoIngredientes,
    beneficioBruto,
    margenBruto: ventas > 0 ? (beneficioBruto / ventas) * 100 : 0,
    gastosVariables,
    gastosFijos,
    gastosTotal,
    gastoPublicidad,
    publicidadPct: ventas > 0 ? (gastoPublicidad / ventas) * 100 : 0,
    costoPorPedido: pedidos > 0 ? gastoPublicidad / pedidos : 0,
    roas: gastoPublicidad > 0 ? ventas / gastoPublicidad : 0,
    costoConsumoInterno,
    enviosCobrados,
    pagosCadetes,
    costoBaseCadeteria,
    resultadoDelivery,
    beneficioNeto,
    margenNeto: ventas > 0 ? (beneficioNeto / ventas) * 100 : 0,
    ticketPromedio: pedidos > 0 ? ventas / pedidos : 0,
    netoPorPedido: pedidos > 0 ? beneficioNeto / pedidos : 0,
  };
}

export async function obtenerKpisRango(rango: Rango): Promise<KpisConDelta> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const actual = await calcularKpis(supabase, rango.desde, rango.hasta);

  const rAnterior = rangoAnterior(rango);
  const anterior = await calcularKpis(supabase, rAnterior.desde, rAnterior.hasta);
  const tieneAnterior = anterior.pedidos > 0 || anterior.gastosTotal > 0;

  return {
    actual,
    anterior: tieneAnterior ? anterior : null,
    rangoActual: rango,
    rangoAnterior: tieneAnterior ? rAnterior : null,
  };
}

export async function obtenerGastosDesglose(
  desde: string,
  hasta: string
): Promise<GastoDesglose[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('gastos_operativos')
    .select('tipo, categoria, monto')
    .gte('fecha', desde)
    .lte('fecha', hasta);

  if (error) throw new Error(error.message);

  // 'cadeteria' se marca como legacy: desde Fase 4 la fuente de verdad del
  // costo de cadetería es pedidos_cadetes (ver resultadoDelivery en
  // calcularKpis). Cualquier registro con esta categoría sigue siendo
  // visible aquí para auditoría, pero NO participa del cálculo del
  // beneficio neto — ese ya se calculó sin leer gastos_operativos para esta
  // categoría. Si se muestra agrupado igual que el resto, se vería como si
  // restara dos veces; por eso queda separado con la bandera legacy.
  const map = new Map<string, GastoDesglose>();
  for (const g of data || []) {
    const key = `${g.tipo}-${g.categoria}`;
    const existing = map.get(key);
    if (existing) existing.total += g.monto;
    else
      map.set(key, {
        tipo: g.tipo,
        categoria: g.categoria,
        total: g.monto,
        legacy: g.categoria === 'cadeteria',
      });
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === 'variable' ? -1 : 1;
    return b.total - a.total;
  });
}

export async function obtenerRankingProductos(
  desde: string,
  hasta: string
): Promise<ProductoRanking[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data: pedidos } = await supabase
    .from('pedidos')
    .select(`
      importacion_id,
      pedidos_lineas (
        producto_id, cantidad,
        precio_unitario_vendido,
        costo_unitario_calculado
      )
    `)
    .gte('fecha', desde)
    .lte('fecha', hasta);

  const { data: importaciones } = await supabase
    .from('importaciones')
    .select('id')
    .eq('estado', 'activa');

  const activas = new Set((importaciones || []).map((i: any) => i.id));

  const { data: productos } = await supabase.from('productos').select('id, nombre');
  const nombresMap = new Map<string, string>(
    (productos || []).map((p: any) => [p.id, p.nombre])
  );

  const porProducto = new Map<string, { unidades: number; venta: number; costo: number }>();

  for (const p of pedidos || []) {
    if (!activas.has(p.importacion_id)) continue;
    for (const l of p.pedidos_lineas || []) {
      const e = porProducto.get(l.producto_id) || { unidades: 0, venta: 0, costo: 0 };
      e.unidades += l.cantidad;
      e.venta += l.precio_unitario_vendido * l.cantidad;
      e.costo += l.costo_unitario_calculado * l.cantidad;
      porProducto.set(l.producto_id, e);
    }
  }

  const ventaTotal = Array.from(porProducto.values()).reduce((s, p) => s + p.venta, 0);

  return Array.from(porProducto.entries())
    .map(([id, d]) => ({
      nombre: nombresMap.get(id) || 'Desconocido',
      unidades: d.unidades,
      venta: d.venta,
      costo: d.costo,
      beneficio: d.venta - d.costo,
      margen: d.venta > 0 ? ((d.venta - d.costo) / d.venta) * 100 : 0,
      participacion: ventaTotal > 0 ? (d.venta / ventaTotal) * 100 : 0,
    }))
    .sort((a, b) => b.venta - a.venta);
}

export async function obtenerConsumoIngredientes(
  desde: string,
  hasta: string
): Promise<IngredienteConsumo[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data: pedidos } = await supabase
    .from('pedidos')
    .select(`
      importacion_id,
      pedidos_lineas (
        cantidad,
        pedidos_lineas_ingredientes (
          ingrediente_id, cantidad_consumida, costo_unitario_ingrediente
        )
      )
    `)
    .gte('fecha', desde)
    .lte('fecha', hasta);

  const { data: importaciones } = await supabase
    .from('importaciones')
    .select('id')
    .eq('estado', 'activa');

  const activas = new Set((importaciones || []).map((i: any) => i.id));

  const { data: ingredientes } = await supabase
    .from('ingredientes')
    .select('id, nombre, unidad_receta');

  const ingMap = new Map<string, { nombre: string; unidad: string }>(
    (ingredientes || []).map((i: any) => [i.id, { nombre: i.nombre, unidad: i.unidad_receta }])
  );

  const porIng = new Map<string, { cantidad: number; costo: number }>();

  for (const p of pedidos || []) {
    if (!activas.has(p.importacion_id)) continue;
    for (const l of p.pedidos_lineas || []) {
      for (const pli of l.pedidos_lineas_ingredientes || []) {
        const e = porIng.get(pli.ingrediente_id) || { cantidad: 0, costo: 0 };
        e.cantidad += pli.cantidad_consumida;
        e.costo += pli.costo_unitario_ingrediente * l.cantidad;
        porIng.set(pli.ingrediente_id, e);
      }
    }
  }

  const costoTotal = Array.from(porIng.values()).reduce((s, i) => s + i.costo, 0);

  return Array.from(porIng.entries())
    .map(([id, d]) => {
      const info = ingMap.get(id) || { nombre: 'Desconocido', unidad: '' };
      return {
        nombre: info.nombre,
        unidad: info.unidad,
        cantidad: d.cantidad,
        costo: d.costo,
        participacion: costoTotal > 0 ? (d.costo / costoTotal) * 100 : 0,
      };
    })
    .sort((a, b) => b.costo - a.costo);
}
