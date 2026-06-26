'use server';

import { createClient } from '@/lib/supabase/server';
import type { MetaAdsFilaDetalle } from '@/lib/utils/meta-ads-parser';

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

export type MetaAdsConjuntoResumen = {
  nombre: string;
  tipoAudiencia: 'caliente' | 'fría';
  gastoArs: number;
  conversaciones: number;
  costoPorConversacion: number | null;
  ctrEnlace: number | null;
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

// Total de gastos de categoria='publicidad' ya cargados para el rango.
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

// Detalle por conjunto, agrupado y sumado, para el Laboratorio.
export async function obtenerDetalleMetaAds(periodoDesde: string): Promise<MetaAdsConjuntoResumen[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('meta_ads_detalle')
    .select('nombre_conjunto, tipo_audiencia, gasto_ars, conversaciones, clics_enlace, impresiones')
    .eq('periodo_desde', periodoDesde);

  if (error) throw new Error(`Error al obtener detalle Meta Ads: ${error.message}`);
  if (!data || data.length === 0) return [];

  const grupos = new Map<string, {
    nombre: string;
    tipoAudiencia: 'caliente' | 'fría';
    gastoArs: number;
    conversaciones: number;
    totalClics: number;
    totalImpresiones: number;
  }>();

  for (const row of data) {
    if (!grupos.has(row.nombre_conjunto)) {
      grupos.set(row.nombre_conjunto, {
        nombre: row.nombre_conjunto,
        tipoAudiencia: row.tipo_audiencia as 'caliente' | 'fría',
        gastoArs: 0,
        conversaciones: 0,
        totalClics: 0,
        totalImpresiones: 0,
      });
    }
    const g = grupos.get(row.nombre_conjunto)!;
    g.gastoArs        += row.gasto_ars       ?? 0;
    g.conversaciones  += row.conversaciones  ?? 0;
    g.totalClics      += row.clics_enlace    ?? 0;
    g.totalImpresiones += row.impresiones    ?? 0;
  }

  return Array.from(grupos.values()).map((g) => ({
    nombre: g.nombre,
    tipoAudiencia: g.tipoAudiencia,
    gastoArs: Math.round(g.gastoArs * 100) / 100,
    conversaciones: g.conversaciones,
    costoPorConversacion: g.conversaciones > 0
      ? Math.round((g.gastoArs / g.conversaciones) * 100) / 100
      : null,
    ctrEnlace: g.totalImpresiones > 0
      ? Math.round((g.totalClics / g.totalImpresiones) * 100 * 10000) / 10000
      : null,
  }));
}

// ─── Importar / reemplazar ──────────────────────────────────────────────────
// Borra cualquier gasto categoria='publicidad' ya cargado en el rango y lo
// reemplaza por el total de Meta Ads convertido a ARS. También reemplaza el
// detalle por conjunto de la tabla meta_ads_detalle.

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
  tipoAudienciaMap: Record<string, 'caliente' | 'fría'>;
  filas: MetaAdsFilaDetalle[];
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

  const { data: importacionData, error: errorImport } = await supabase
    .from('meta_ads_importaciones')
    .upsert(
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
    )
    .select('id')
    .single();

  if (errorImport) return { error: errorImport.message };

  // Reemplazar detalle anterior y cargar el nuevo
  await supabase.from('meta_ads_detalle').delete().eq('importacion_id', importacionData.id);

  const filasConTipo = input.filas.filter((f) => input.tipoAudienciaMap[f.nombreConjunto] !== undefined);
  if (filasConTipo.length > 0) {
    const detalleRows = filasConTipo.map((f) => ({
      importacion_id:          importacionData.id,
      periodo_desde:           input.periodoDesde,
      nombre_campana:          f.nombreCampana  || null,
      nombre_conjunto:         f.nombreConjunto,
      nombre_anuncio:          f.nombreAnuncio  || null,
      tipo_audiencia:          input.tipoAudienciaMap[f.nombreConjunto],
      gasto_usd:               f.gastoUsd,
      gasto_ars:               Math.round(f.gastoUsd * input.tipoCambio * 100) / 100,
      alcance:                 f.alcance,
      impresiones:             f.impresiones,
      conversaciones:          f.conversaciones,
      costo_por_resultado_usd: f.costoResultadoUsd,
      ctr_enlace:              f.ctrEnlace,
      clics_enlace:            f.clicsEnlace,
    }));

    const { error: errorDetalle } = await supabase.from('meta_ads_detalle').insert(detalleRows);
    if (errorDetalle) return { error: errorDetalle.message };
  }

  return { success: true, gastoArs };
}

// Deshace una importación completa: borra la fila de meta_ads_importaciones
// (ON DELETE CASCADE elimina el detalle) y el gasto_operativo si existe.
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
