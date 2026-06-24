'use server';

import { createClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { calcularKpis, obtenerSaludClientes } from '../dashboard/actions';
import { obtenerAnalisisMerma } from '../stock/actions';
import { obtenerMetricasHistorico } from '../equipo/actions';

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
  return (data || []).map(mapDecision);
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
  return (data || []).map(mapDecision);
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

Vas a recibir un JSON con los KPIs de una semana operativa: financieros, de clientes, de equipo y de merma (si hay datos).

Generá entre 3 y 6 recomendaciones ESPECÍFICAS y ACCIONABLES para la semana que viene, basadas estrictamente en los números del JSON — nunca inventes datos que no están ahí. Cada recomendación debe:
- Apuntar a un área concreta del negocio.
- Ser una acción específica que el dueño pueda tomar esta semana, no un consejo genérico de manual de gestión.
- Tener una justificación que cite el número concreto que la motiva.

Si un bloque del JSON dice "sin_datos_todavia", no generes ninguna recomendación sobre esa área — priorizá las áreas donde sí hay datos reales.`;

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
