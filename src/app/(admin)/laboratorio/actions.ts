'use server';

import { createClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { calcularKpis, obtenerSaludClientes } from '../dashboard/actions';
import { obtenerAnalisisMerma } from '../stock/actions';
import { obtenerMetricasHistorico, obtenerMetricasPeriodo } from '../equipo/actions';
import { obtenerMetaAdsPeriodo, obtenerDetalleMetaAds } from '../gastos/actions-meta-ads';
import { formatARS } from '@/lib/utils/format';

// ─── Types ─────────────────────────────────────────────────────────────────

export type EstadoDecision = 'sugerida' | 'decidida' | 'evaluada';

export type DecisionLaboratorio = {
  id: string;
  periodoDesde: string;
  periodoHasta: string;
  area: string;
  recomendacion: string;
  justificacion: string;
  decisionTomada: string | null;
  fechaDecision: string | null;
  resultado: string | null;
  fechaResultado: string | null;
  estado: EstadoDecision;
  // Pre-cargado solo por obtenerDecisionesPendientesDeResultado() — texto
  // generado por código (no por IA) comparando la semana de la decisión
  // contra la semana más recientemente cerrada. null si todavía no pasó
  // una semana cerrada desde la decisión (nada que comparar aún).
  resumenSugerido: string | null;
};

function mapDecision(d: any): DecisionLaboratorio {
  return {
    id: d.id,
    periodoDesde: d.periodo_desde,
    periodoHasta: d.periodo_hasta,
    area: d.area,
    recomendacion: d.recomendacion,
    justificacion: d.justificacion,
    decisionTomada: d.decision_tomada,
    fechaDecision: d.fecha_decision,
    resultado: d.resultado,
    fechaResultado: d.fecha_resultado,
    estado: d.estado,
    resumenSugerido: null,
  };
}

// ─── Listar decisiones ───────────────────────────────────────────────────────

export async function obtenerDecisionesPeriodo(desde: string): Promise<DecisionLaboratorio[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('decisiones_laboratorio')
    .select('*')
    .eq('periodo_desde', desde)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Error al obtener decisiones: ${error.message}`);
  const decisiones = (data || []).map(mapDecision);
  await aplicarResumenSugerido(supabase, decisiones);
  return decisiones;
}

// Decisiones ya tomadas en cualquier período, esperando que se registre el
// resultado — para que no queden enterradas si Lucas no vuelve a navegar a
// esa semana puntual.
export async function obtenerDecisionesPendientesDeResultado(): Promise<DecisionLaboratorio[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('decisiones_laboratorio')
    .select('*')
    .eq('estado', 'decidida')
    .order('fecha_decision', { ascending: true });

  if (error) throw new Error(`Error al obtener pendientes: ${error.message}`);
  const pendientes = (data || []).map(mapDecision);
  await aplicarResumenSugerido(supabase, pendientes);
  return pendientes;
}

// Cantidad de decisiones que se volvieron evaluables (resumenSugerido
// no nulo) gracias al cierre de `desdeRecienCerrado` — para el banner
// post-cierre en el dashboard. No toca nada del flujo de cierre en sí.
export async function contarDecisionesEvaluablesTrasCierre(desdeRecienCerrado: string): Promise<number> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('decisiones_laboratorio')
    .select('*')
    .eq('estado', 'decidida');

  if (error) throw new Error(`Error al obtener pendientes: ${error.message}`);
  const pendientes = (data || []).map(mapDecision);
  await aplicarResumenSugerido(supabase, pendientes, desdeRecienCerrado);
  return pendientes.filter((d) => d.resumenSugerido).length;
}

// Calcula y aplica (mutando in-place) el resumenSugerido de cada decisión
// con estado 'decidida' sin resultado, comparando la semana en que se
// decidió contra la semana más recientemente cerrada (o una semana
// específica, si se pasa `hastaDesde` — usado por el banner post-cierre
// para preguntar puntualmente "¿esto se volvió evaluable con ESTE cierre?").
async function aplicarResumenSugerido(
  supabase: any,
  decisiones: DecisionLaboratorio[],
  hastaDesde?: string
): Promise<void> {
  const pendientes = decisiones.filter((d) => d.estado === 'decidida' && d.fechaDecision);
  if (pendientes.length === 0) return;

  const query = supabase
    .from('periodos')
    .select('desde, hasta, ventas, margen_neto, beneficio_neto, resultado_delivery, publicidad_pct')
    .eq('tipo', 'semana');

  const { data: ultimoCerrado } = hastaDesde
    ? await query.eq('desde', hastaDesde).maybeSingle()
    : await query.order('desde', { ascending: false }).limit(1).maybeSingle();

  // Nunca se cerró ninguna semana todavía (o la semana pedida no está
  // cerrada) — no hay "después" con qué comparar.
  if (!ultimoCerrado) return;

  const despues: KpisComparables = {
    ventas: ultimoCerrado.ventas,
    margenNeto: ultimoCerrado.margen_neto,
    beneficioNeto: ultimoCerrado.beneficio_neto,
    resultadoDelivery: ultimoCerrado.resultado_delivery,
    publicidadPct: ultimoCerrado.publicidad_pct,
  };
  const metricasDespues = await obtenerMetricasPeriodo(ultimoCerrado.desde);
  const mermaDespues = await obtenerMermaTotalOpcional(ultimoCerrado.desde, ultimoCerrado.hasta);
  const metaAdsDespues = await obtenerMetaAdsPeriodo(ultimoCerrado.desde);

  for (const d of pendientes) {
    const viernesDecision = viernesDe(d.fechaDecision!);

    // Decidido en la misma semana que se acaba de cerrar: todavía no pasó
    // tiempo para ver el efecto. No se inventa una comparación de la
    // semana contra sí misma.
    if (viernesDecision === ultimoCerrado.desde) continue;

    const domingoDecision = domingoDe(viernesDecision);
    const antes = await obtenerKpisSemana(supabase, viernesDecision, domingoDecision);
    const metricasAntes = await obtenerMetricasPeriodo(viernesDecision);
    const mermaAntes = await obtenerMermaTotalOpcional(viernesDecision, domingoDecision);
    const metaAdsAntes = await obtenerMetaAdsPeriodo(viernesDecision);

    d.resumenSugerido = construirResumen(
      d.area,
      antes,
      despues,
      metricasAntes,
      metricasDespues,
      mermaAntes,
      mermaDespues,
      metaAdsAntes,
      metaAdsDespues
    );
  }
}

// ─── Comparación automática "antes vs después" ─────────────────────────────
// Texto generado por código (sin IA): rápido, gratis y basado únicamente en
// números reales — la interpretación queda en manos de Lucas al confirmar.

type KpisComparables = {
  ventas: number;
  margenNeto: number;
  beneficioNeto: number;
  resultadoDelivery: number;
  publicidadPct: number;
};

function periodoDeJS(fecha: Date): Date {
  const day = fecha.getDay();
  const isodow = day === 0 ? 7 : day;
  const offset = (isodow - 5 + 7) % 7;
  const viernes = new Date(fecha);
  viernes.setDate(fecha.getDate() - offset);
  return viernes;
}

function formatFechaLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function viernesDe(fechaStr: string): string {
  return formatFechaLocal(periodoDeJS(new Date(fechaStr + 'T12:00:00')));
}

function domingoDe(viernesStr: string): string {
  const d = new Date(viernesStr + 'T12:00:00');
  d.setDate(d.getDate() + 2);
  return formatFechaLocal(d);
}

// Prefiere el snapshot congelado de periodos; si esa semana todavía no se
// cerró, calcula en vivo con calcularKpis (mismo dato, solo que no frozen).
async function obtenerKpisSemana(supabase: any, desde: string, hasta: string): Promise<KpisComparables> {
  const { data: row } = await supabase
    .from('periodos')
    .select('ventas, margen_neto, beneficio_neto, resultado_delivery, publicidad_pct')
    .eq('tipo', 'semana')
    .eq('desde', desde)
    .eq('hasta', hasta)
    .maybeSingle();

  if (row) {
    return {
      ventas: row.ventas,
      margenNeto: row.margen_neto,
      beneficioNeto: row.beneficio_neto,
      resultadoDelivery: row.resultado_delivery,
      publicidadPct: row.publicidad_pct,
    };
  }

  const kpis = await calcularKpis(supabase, desde, hasta);
  return {
    ventas: kpis.ventas,
    margenNeto: kpis.margenNeto,
    beneficioNeto: kpis.beneficioNeto,
    resultadoDelivery: kpis.resultadoDelivery,
    publicidadPct: kpis.publicidadPct,
  };
}

async function obtenerMermaTotalOpcional(desde: string, hasta: string): Promise<number | null> {
  try {
    const analisis = await obtenerAnalisisMerma(desde, hasta);
    const completos = analisis.ingredientes.filter((i) => i.datosCompletos);
    if (completos.length === 0) return null;
    return analisis.mermaPesosTotal;
  } catch {
    return null;
  }
}

function pp(delta: number): string {
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pp`;
}

function construirResumen(
  area: string,
  antes: KpisComparables,
  despues: KpisComparables,
  metricasAntes: Awaited<ReturnType<typeof obtenerMetricasPeriodo>>,
  metricasDespues: Awaited<ReturnType<typeof obtenerMetricasPeriodo>>,
  mermaAntes: number | null,
  mermaDespues: number | null,
  metaAdsAntes: Awaited<ReturnType<typeof obtenerMetaAdsPeriodo>>,
  metaAdsDespues: Awaited<ReturnType<typeof obtenerMetaAdsPeriodo>>
): string {
  const partes: string[] = [];

  partes.push(
    `Margen neto: ${antes.margenNeto.toFixed(1)}% → ${despues.margenNeto.toFixed(1)}% (${pp(despues.margenNeto - antes.margenNeto)}).`
  );
  partes.push(`Ventas: ${formatARS(antes.ventas)} → ${formatARS(despues.ventas)}.`);

  const areaLower = area.toLowerCase();

  if (areaLower.includes('deliver')) {
    partes.push(`Resultado Delivery: ${formatARS(antes.resultadoDelivery)} → ${formatARS(despues.resultadoDelivery)}.`);
  }

  if (areaLower.includes('public') || areaLower.includes('costo')) {
    partes.push(
      `Publicidad: ${antes.publicidadPct.toFixed(1)}% de ventas → ${despues.publicidadPct.toFixed(1)}% (${pp(despues.publicidadPct - antes.publicidadPct)}).`
    );
    if (metaAdsAntes && metaAdsDespues) {
      partes.push(
        `Meta Ads — Alcance: ${metaAdsAntes.alcance ?? '—'} → ${metaAdsDespues.alcance ?? '—'}. Clics: ${metaAdsAntes.clics ?? '—'} → ${metaAdsDespues.clics ?? '—'}. Resultados: ${metaAdsAntes.resultados ?? '—'} → ${metaAdsDespues.resultados ?? '—'}.`
      );
    }
  }

  if (areaLower.includes('equipo') || areaLower.includes('queja') || areaLower.includes('mensaje')) {
    if (
      metricasAntes?.mensajesRecibidos &&
      metricasDespues?.mensajesRecibidos &&
      metricasAntes.mensajesConvertidos != null &&
      metricasDespues.mensajesConvertidos != null
    ) {
      const tasaAntes = (metricasAntes.mensajesConvertidos / metricasAntes.mensajesRecibidos) * 100;
      const tasaDespues = (metricasDespues.mensajesConvertidos / metricasDespues.mensajesRecibidos) * 100;
      partes.push(`Conversión de mensajes: ${tasaAntes.toFixed(0)}% → ${tasaDespues.toFixed(0)}%.`);
    }
    if (metricasAntes && metricasDespues) {
      const quejasAntes = (metricasAntes.quejasFaltantes ?? 0) + (metricasAntes.quejasCalidad ?? 0);
      const quejasDespues = (metricasDespues.quejasFaltantes ?? 0) + (metricasDespues.quejasCalidad ?? 0);
      if (metricasAntes.quejasFaltantes != null || metricasAntes.quejasCalidad != null) {
        partes.push(`Quejas: ${quejasAntes} → ${quejasDespues}.`);
      }
    }
  }

  if ((areaLower.includes('merma') || areaLower.includes('stock')) && mermaAntes != null && mermaDespues != null) {
    partes.push(`Merma total: ${formatARS(mermaAntes)} → ${formatARS(mermaDespues)}.`);
  }

  return partes.join(' ');
}

// ─── Registrar decisión / resultado ─────────────────────────────────────────

export async function registrarDecision(id: string, decisionTomada: string) {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');
  if (!decisionTomada.trim()) return { error: 'Describí qué decidiste hacer' };

  const hoy = new Date().toISOString().split('T')[0];

  const { error } = await supabase
    .from('decisiones_laboratorio')
    .update({ decision_tomada: decisionTomada.trim(), fecha_decision: hoy, estado: 'decidida' })
    .eq('id', id);

  if (error) return { error: error.message };
  return { success: true };
}

export async function registrarResultado(id: string, resultado: string) {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');
  if (!resultado.trim()) return { error: 'Describí qué resultó' };

  const hoy = new Date().toISOString().split('T')[0];

  const { error } = await supabase
    .from('decisiones_laboratorio')
    .update({ resultado: resultado.trim(), fecha_resultado: hoy, estado: 'evaluada' })
    .eq('id', id);

  if (error) return { error: error.message };
  return { success: true };
}

// ─── Generar recomendaciones con la API de Anthropic ───────────────────────
// Disparo manual únicamente (botón en la UI) — nunca automático, para que el
// costo de la llamada sea predecible y vos decidas cuándo gastarlo.

const RecomendacionesSchema = z.object({
  recomendaciones: z
    .array(
      z.object({
        area: z.string().describe('Área de negocio: Ventas, Costos, Delivery, Clientes, Equipo, Merma, Publicidad, etc.'),
        recomendacion: z.string().describe('Acción específica y concreta para tomar esta semana'),
        justificacion: z.string().describe('Por qué — citando el número concreto del contexto que la motiva'),
      })
    )
    .min(1)
    .max(8),
});

const SYSTEM_PROMPT = `Sos un asesor estratégico para Royalty Burgers, una hamburguesería en Rosario, Argentina que opera viernes, sábado y domingo.

Vas a recibir un JSON con los KPIs de una semana operativa: financieros, de clientes, de equipo, de Meta Ads y de merma (si hay datos).

Generá entre 3 y 6 recomendaciones ESPECÍFICAS y ACCIONABLES para la semana que viene, basadas estrictamente en los números del JSON — nunca inventes datos que no están ahí. Cada recomendación debe:
- Apuntar a un área concreta del negocio.
- Ser una acción específica que el dueño pueda tomar esta semana, no un consejo genérico de manual de gestión.
- Tener una justificación que cite el número concreto que la motiva.

Si un bloque del JSON dice "sin_datos_todavia", no generes ninguna recomendaciones sobre esa área — priorizá las áreas donde sí hay datos reales.

REGLA CRÍTICA — Meta Ads por conjunto:
El campo "metaAds.porConjunto" muestra cada conjunto de anuncios con su "tipoAudiencia": "caliente" (seguidores e Instagram / compradores previos) o "fría" (audiencia nueva sin relación previa con la marca).
- NUNCA compares el costo por conversación entre conjuntos de distinto tipo de audiencia. La audiencia caliente tiene menor volumen pero mayor tasa de conversión a pedido real; la fría genera más conversaciones pero convierte menos. Comparar sus costos por conversación lleva a conclusiones incorrectas.
- Solo compará costo por conversación entre conjuntos del MISMO tipo de audiencia.
- Al recomendar escalar o pausar un conjunto, basate en: costo por conversación vs otros del mismo tipo, CTR, y contexto financiero general.`;

async function construirContextoKpis(supabase: any, desde: string, hasta: string) {
  const kpis = await calcularKpis(supabase, desde, hasta);
  const salud = await obtenerSaludClientes();

  let merma: unknown = 'sin_datos_todavia';
  try {
    const analisis = await obtenerAnalisisMerma(desde, hasta);
    const completos = analisis.ingredientes.filter((i) => i.datosCompletos);
    if (completos.length > 0) {
      merma = completos.map((i) => ({
        ingrediente: i.nombre,
        mermaPct: i.mermaPct,
        semaforo: i.semaforo,
      }));
    }
  } catch {
    merma = 'sin_datos_todavia';
  }

  const metricasRecientes = await obtenerMetricasHistorico(8);
  const metricaSemana = metricasRecientes.find((m) => m.periodoDesde === desde) ?? null;

  const metaAdsSemana = await obtenerMetaAdsPeriodo(desde);
  const detalleConjuntos = await obtenerDetalleMetaAds(desde);

  return {
    periodo: { desde, hasta },
    financiero: {
      ventas: kpis.ventas,
      costoIngredientes: kpis.costoIngredientes,
      beneficioBruto: kpis.beneficioBruto,
      margenBruto: kpis.margenBruto,
      gastosVariables: kpis.gastosVariables,
      gastosFijos: kpis.gastosFijos,
      gastoPublicidad: kpis.gastoPublicidad,
      publicidadPct: kpis.publicidadPct,
      roas: kpis.roas,
      costoConsumoInterno: kpis.costoConsumoInterno,
      resultadoDelivery: kpis.resultadoDelivery,
      beneficioNeto: kpis.beneficioNeto,
      margenNeto: kpis.margenNeto,
      ticketPromedio: kpis.ticketPromedio,
      pedidos: kpis.pedidos,
      hamburguesasVendidas: kpis.hamburguesasVendidas,
      pctVentasRepetidores: kpis.pctVentasRepetidores,
    },
    clientes: {
      retencionCartera: salud.retencionCartera,
      tasaRetencion: salud.tasaRetencion,
      altoValorEnRiesgo: salud.altoValorEnRiesgo,
      nuevosEnRiesgoEstaSemana: salud.nuevosEnRiesgoDetalle.length,
      pctFacturacionRepetidores: salud.pctFacturacionRepetidores,
    },
    equipo: metricaSemana
      ? {
          mensajesRecibidos: metricaSemana.mensajesRecibidos,
          mensajesConvertidos: metricaSemana.mensajesConvertidos,
          tiempoPromedioProduccionMin: metricaSemana.tiempoPromedioProduccionMin,
          quejasFaltantes: metricaSemana.quejasFaltantes,
          quejasCalidad: metricaSemana.quejasCalidad,
        }
      : 'sin_datos_todavia',
    metaAds: metaAdsSemana
      ? {
          gastoUsd: metaAdsSemana.gastoUsd,
          alcance: metaAdsSemana.alcance,
          impresiones: metaAdsSemana.impresiones,
          clics: metaAdsSemana.clics,
          resultados: metaAdsSemana.resultados,
          porConjunto: detalleConjuntos,
        }
      : 'sin_datos_todavia',
    merma,
  };
}

export async function generarRecomendaciones(desde: string, hasta: string) {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: 'Falta configurar ANTHROPIC_API_KEY en las variables de entorno.' };
  }

  const contexto = await construirContextoKpis(supabase, desde, hasta);

  const client = new Anthropic();

  let response;
  try {
    response = await client.messages.parse({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(contexto) }],
      output_config: { format: zodOutputFormat(RecomendacionesSchema) },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Error al llamar a la API de Anthropic' };
  }

  const parsed = response.parsed_output;
  if (!parsed) {
    return { error: 'La IA no devolvió un resultado con el formato esperado. Probá de nuevo.' };
  }

  // Borrar sugeridas anteriores del período antes de insertar las nuevas.
  // Las decididas y evaluadas nunca se tocan.
  const { error: errorBorrado } = await supabase
    .from('decisiones_laboratorio')
    .delete()
    .eq('periodo_desde', desde)
    .eq('estado', 'sugerida');
  if (errorBorrado) return { error: errorBorrado.message };

  const filas = parsed.recomendaciones.map((r) => ({
    periodo_desde: desde,
    periodo_hasta: hasta,
    area: r.area,
    recomendacion: r.recomendacion,
    justificacion: r.justificacion,
    registrado_por: user.user!.id,
  }));

  const { error } = await supabase.from('decisiones_laboratorio').insert(filas);
  if (error) return { error: error.message };

  return { success: true, cantidad: filas.length };
}
