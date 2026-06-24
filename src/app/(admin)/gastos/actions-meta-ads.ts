'use server';

import { createClient } from '@/lib/supabase/server';

// ─── Types ─────────────────────────────────────────────────────────────────

export type MetaAdsImportacion = {
  periodoDesde: string;
  periodoHasta: string;
  gastoUsd: number;
  tipoCambio: number;
  gastoArs: number;
  alcance: number | null;
  impresiones: number | null;
  clics: number | null;
  resultados: number | null;
  nombreArchivo: string | null;
};

function mapImportacion(d: any): MetaAdsImportacion {
  return {
    periodoDesde: d.periodo_desde,
    periodoHasta: d.periodo_hasta,
    gastoUsd: d.gasto_usd,
    tipoCambio: d.tipo_cambio,
    gastoArs: d.gasto_ars,
    alcance: d.alcance,
    impresiones: d.impresiones,
    clics: d.clics,
    resultados: d.resultados,
    nombreArchivo: d.nombre_archivo,
  };
}

// ─── Consultas ───────────────────────────────────────────────────────────────

export async function obtenerMetaAdsPeriodo(periodoDesde: string): Promise<MetaAdsImportacion | null> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('meta_ads_importaciones')
    .select('*')
    .eq('periodo_desde', periodoDesde)
    .maybeSingle();

  if (error) throw new Error(`Error al obtener importación: ${error.message}`);
  return data ? mapImportacion(data) : null;
}

// Total de gastos de categoria='publicidad' ya cargados para el rango —
// para avisar antes de reemplazar, sea manual o de una importación previa.
export async function obtenerGastoPublicidadExistente(periodoDesde: string, periodoHasta: string): Promise<number> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('gastos_operativos')
    .select('monto')
    .eq('categoria', 'publicidad')
    .gte('fecha', periodoDesde)
    .lte('fecha', periodoHasta);

  if (error) throw new Error(`Error al obtener gastos de publicidad: ${error.message}`);
  return (data || []).reduce((sum: number, g: any) => sum + g.monto, 0);
}

// ─── Importar / reemplazar ──────────────────────────────────────────────────
// Borra cualquier gasto categoria='publicidad' ya cargado en el rango
// (manual o de una importación anterior) y lo reemplaza por el total de
// Meta Ads convertido a ARS — para no duplicar publicidad.

export async function importarMetaAds(input: {
  periodoDesde: string;
  periodoHasta: string;
  gastoUsd: number;
  tipoCambio: number;
  alcance: number | null;
  impresiones: number | null;
  clics: number | null;
  resultados: number | null;
  nombreArchivo: string | null;
}): Promise<{ error: string } | { success: true; gastoArs: number }> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  if (input.gastoUsd < 0) return { error: 'El gasto no puede ser negativo' };
  if (!input.tipoCambio || input.tipoCambio <= 0) return { error: 'Ingresá un tipo de cambio válido' };

  const gastoArs = Math.round(input.gastoUsd * input.tipoCambio * 100) / 100;

  const { error: errorBorrado } = await supabase
    .from('gastos_operativos')
    .delete()
    .eq('categoria', 'publicidad')
    .gte('fecha', input.periodoDesde)
    .lte('fecha', input.periodoHasta);

  if (errorBorrado) return { error: errorBorrado.message };

  // gastos_operativos.monto exige > 0 — si el gasto convertido es $0, no
  // se crea el gasto pero sí se guardan las métricas de la importación.
  let gastoOperativoId: string | null = null;
  if (gastoArs > 0) {
    const { data: gastoCreado, error: errorGasto } = await supabase
      .from('gastos_operativos')
      .insert({
        fecha: input.periodoDesde,
        categoria: 'publicidad',
        tipo: 'variable',
        monto: gastoArs,
        nota: `Importado de Meta Ads (USD ${input.gastoUsd.toLocaleString('es-AR')} × $${input.tipoCambio})`,
        registrado_por: user.user.id,
      })
      .select('id')
      .single();

    if (errorGasto) return { error: errorGasto.message };
    gastoOperativoId = gastoCreado.id;
  }

  const { error: errorImport } = await supabase.from('meta_ads_importaciones').upsert(
    {
      periodo_desde: input.periodoDesde,
      periodo_hasta: input.periodoHasta,
      gasto_operativo_id: gastoOperativoId,
      gasto_usd: input.gastoUsd,
      tipo_cambio: input.tipoCambio,
      gasto_ars: gastoArs,
      alcance: input.alcance,
      impresiones: input.impresiones,
      clics: input.clics,
      resultados: input.resultados,
      nombre_archivo: input.nombreArchivo,
      registrado_por: user.user.id,
    },
    { onConflict: 'periodo_desde' }
  );

  if (errorImport) return { error: errorImport.message };
  return { success: true, gastoArs };
}

// Deshace una importación completa: borra la fila de meta_ads_importaciones
// y el gasto_operativo que generó (si existe). No toca periodos.
export async function eliminarMetaAdsPeriodo(periodoDesde: string) {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data: importacion } = await supabase
    .from('meta_ads_importaciones')
    .select('gasto_operativo_id')
    .eq('periodo_desde', periodoDesde)
    .maybeSingle();

  if (importacion?.gasto_operativo_id) {
    await supabase.from('gastos_operativos').delete().eq('id', importacion.gasto_operativo_id);
  }

  const { error } = await supabase.from('meta_ads_importaciones').delete().eq('periodo_desde', periodoDesde);
  if (error) return { error: error.message };
  return { success: true };
}
