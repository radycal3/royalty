'use server';

import { createClient } from '@/lib/supabase/server';
import type { Rango } from '@/lib/dashboard/rangos';
import type { KpisPeriodo } from '../dashboard/actions';

// ─── Types ───────────────────────────────────────────────────────────────

export type Advertencia = {
  codigo: 'sin_pedix' | 'envios_sin_cadetes' | 'pedidos_sin_hamburguesas';
  mensaje: string;
};

export type ValidacionCierre = {
  yaCerrada: boolean;
  advertencias: Advertencia[];
  preview: KpisPeriodo;
};

export type PeriodoCerrado = {
  id: string;
  desde: string;
  hasta: string;
  label: string;
  pedidos: number;
  hamburguesasVendidas: number;
  hamburguesasPorPedido: number;
  ticketPromedio: number;
  costoPorPedido: number;
  ventas: number;
  beneficioBruto: number;
  beneficioNeto: number;
  beneficioPorPedido: number;
  margenBruto: number;
  margenNeto: number;
  roas: number;
  publicidadPct: number;
  resultadoDelivery: number;
  cerradoEn: string;
};

export type RecordHistorico = {
  valor: number;
  label: string; // label del período donde ocurrió, ej. "Vie 12 — Dom 14 Jun 2026"
};

// ─── Validar antes de cerrar ─────────────────────────────────────────────
// No muta nada. Solo informa — el usuario decide si cierra a pesar de
// advertencias no bloqueantes. "yaCerrada" es la única condición que
// realmente impide el cierre.

export async function validarCierre(rango: Rango, kpis: KpisPeriodo): Promise<ValidacionCierre> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data: existente } = await supabase
    .from('periodos')
    .select('id')
    .eq('tipo', 'semana')
    .eq('desde', rango.desde)
    .eq('hasta', rango.hasta)
    .maybeSingle();

  const yaCerrada = !!existente;

  const advertencias: Advertencia[] = [];

  const { data: importaciones } = await supabase
    .from('importaciones')
    .select('id, fecha_desde, fecha_hasta')
    .eq('estado', 'activa');

  const hayImportacion = (importaciones || []).some(
    (i: any) => i.fecha_desde <= rango.hasta && i.fecha_hasta >= rango.desde
  );

  if (!hayImportacion) {
    advertencias.push({
      codigo: 'sin_pedix',
      mensaje: 'No hay ninguna importación de Pedix activa que cubra este rango de fechas.',
    });
  }

  if (kpis.enviosCobrados > 0 && kpis.pagosCadetes === 0 && kpis.costoBaseCadeteria === 0) {
    advertencias.push({
      codigo: 'envios_sin_cadetes',
      mensaje:
        'Hay envíos cobrados en este período pero ninguna jornada de cadetes liquidada para esas fechas.',
    });
  }

  if (kpis.pedidos > 0 && kpis.hamburguesasVendidas === 0) {
    advertencias.push({
      codigo: 'pedidos_sin_hamburguesas',
      mensaje: 'Hay pedidos registrados pero ninguna hamburguesa vendida en este período.',
    });
  }

  return { yaCerrada, advertencias, preview: kpis };
}

// ─── Cerrar período ──────────────────────────────────────────────────────
// Copia los valores de KpisPeriodo, calculados por el dashboard para este
// rango exacto, a una fila congelada en periodos. No recalcula nada acá:
// recibe los KPIs ya computados por calcularKpis() para garantizar que el
// snapshot sea EXACTAMENTE lo que el usuario vio en pantalla al confirmar.

export async function cerrarPeriodo(
  rango: Rango,
  kpis: KpisPeriodo
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  if (rango.tipo !== 'semana') {
    return { ok: false, mensaje: 'Solo se pueden cerrar períodos de tipo semana.' };
  }

  const { error } = await supabase.from('periodos').insert({
    tipo: 'semana',
    desde: rango.desde,
    hasta: rango.hasta,
    label: rango.label,
    pedidos: kpis.pedidos,
    hamburguesas_vendidas: kpis.hamburguesasVendidas,
    hamburguesas_por_pedido: kpis.hamburguesasPorPedido,
    ticket_promedio: kpis.ticketPromedio,
    costo_por_pedido: kpis.costoPorPedido,
    ventas: kpis.ventas,
    beneficio_bruto: kpis.beneficioBruto,
    beneficio_neto: kpis.beneficioNeto,
    beneficio_por_pedido: kpis.netoPorPedido,
    margen_bruto: kpis.margenBruto,
    margen_neto: kpis.margenNeto,
    roas: kpis.roas,
    publicidad_pct: kpis.publicidadPct,
    resultado_delivery: kpis.resultadoDelivery,
    cerrado_por: user.user.id,
  });

  if (error) {
    const yaExiste = error.code === '23505';
    return {
      ok: false,
      mensaje: yaExiste
        ? 'Esta semana ya fue cerrada.'
        : error.message,
    };
  }

  return { ok: true };
}

// ─── Histórico de períodos cerrados ──────────────────────────────────────

function mapPeriodo(p: any): PeriodoCerrado {
  return {
    id: p.id,
    desde: p.desde,
    hasta: p.hasta,
    label: p.label,
    pedidos: p.pedidos,
    hamburguesasVendidas: p.hamburguesas_vendidas,
    hamburguesasPorPedido: p.hamburguesas_por_pedido,
    ticketPromedio: p.ticket_promedio,
    costoPorPedido: p.costo_por_pedido,
    ventas: p.ventas,
    beneficioBruto: p.beneficio_bruto,
    beneficioNeto: p.beneficio_neto,
    beneficioPorPedido: p.beneficio_por_pedido,
    margenBruto: p.margen_bruto,
    margenNeto: p.margen_neto,
    roas: p.roas,
    publicidadPct: p.publicidad_pct,
    resultadoDelivery: p.resultado_delivery,
    cerradoEn: p.cerrado_en,
  };
}

export async function obtenerPeriodoActual(
  desde: string,
  hasta: string
): Promise<PeriodoCerrado | null> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('periodos')
    .select('*')
    .eq('tipo', 'semana')
    .eq('desde', desde)
    .eq('hasta', hasta)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapPeriodo(data) : null;
}

// cantidad: número de semanas cerradas más recientes a traer. null = todo
// el histórico.
export async function obtenerEvolucion(cantidad: number | null): Promise<PeriodoCerrado[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  let query = supabase
    .from('periodos')
    .select('*')
    .eq('tipo', 'semana')
    .order('desde', { ascending: false });

  if (cantidad !== null) {
    query = query.limit(cantidad);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  // Se pidió en orden descendente (más reciente primero) para el LIMIT;
  // se devuelve ascendente (más antiguo primero) para graficar de
  // izquierda a derecha en orden cronológico natural.
  return (data || []).map(mapPeriodo).reverse();
}

// ─── Récords históricos ──────────────────────────────────────────────────
// Recorre TODO el histórico de periodos, sin importar el filtro de
// "últimas N semanas" que esté aplicado en la UI — el récord es siempre
// sobre la totalidad de semanas cerradas.

export async function obtenerRecords(): Promise<{
  ventas: RecordHistorico | null;
  beneficioNeto: RecordHistorico | null;
  hamburguesasVendidas: RecordHistorico | null;
}> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('periodos')
    .select('label, ventas, beneficio_neto, hamburguesas_vendidas')
    .eq('tipo', 'semana');

  if (error) throw new Error(error.message);

  if (!data || data.length === 0) {
    return { ventas: null, beneficioNeto: null, hamburguesasVendidas: null };
  }

  const maxPor = (campo: 'ventas' | 'beneficio_neto' | 'hamburguesas_vendidas'): RecordHistorico => {
    const mejor = data.reduce((acc: any, p: any) => (p[campo] > acc[campo] ? p : acc));
    return { valor: mejor[campo], label: mejor.label };
  };

  return {
    ventas: maxPor('ventas'),
    beneficioNeto: maxPor('beneficio_neto'),
    hamburguesasVendidas: maxPor('hamburguesas_vendidas'),
  };
}
