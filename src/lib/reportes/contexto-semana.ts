// ─── Contexto semanal compartido (Laboratorio + Informe mensual) ───────────
// Junta financiero + salud de clientes + equipo + Meta Ads + merma de una
// semana operativa en una sola estructura. Es la misma info que recibe la
// IA del Laboratorio para generar recomendaciones — reutilizada acá para
// que el informe exportable muestre exactamente lo mismo que ya "sabe" el
// sistema, sin recalcular nada distinto.

import { calcularKpis, obtenerSaludClientes } from '@/app/(admin)/dashboard/actions';
import { obtenerAnalisisMerma } from '@/app/(admin)/stock/actions';
import { obtenerMetricasPeriodo } from '@/app/(admin)/equipo/actions';
import { obtenerMetaAdsPeriodo, obtenerDetalleMetaAds, type MetaAdsConjuntoResumen } from '@/app/(admin)/gastos/actions-meta-ads';

export type ContextoSemana = {
  periodo: { desde: string; hasta: string };
  financiero: {
    ventas: number;
    costoIngredientes: number;
    beneficioBruto: number;
    margenBruto: number;
    gastosVariables: number;
    gastosFijos: number;
    gastoPublicidad: number;
    publicidadPct: number;
    roas: number;
    costoConsumoInterno: number;
    resultadoDelivery: number;
    beneficioNeto: number;
    margenNeto: number;
    ticketPromedio: number;
    pedidos: number;
    hamburguesasVendidas: number;
    pctVentasRepetidores: number;
  };
  clientes: {
    retencionCartera: number;
    tasaRetencion: number;
    altoValorEnRiesgo: number;
    nuevosEnRiesgoEstaSemana: number;
    pctFacturacionRepetidores: number;
  };
  equipo:
    | {
        mensajesRecibidos: number | null;
        mensajesConvertidos: number | null;
        tiempoPromedioProduccionMin: number | null;
        quejasFaltantes: number | null;
        quejasCalidad: number | null;
      }
    | 'sin_datos_todavia';
  metaAds:
    | {
        gastoUsd: number;
        alcance: number | null;
        impresiones: number | null;
        clics: number | null;
        resultados: number | null;
        porConjunto: MetaAdsConjuntoResumen[];
      }
    | 'sin_datos_todavia';
  merma:
    | { ingrediente: string; mermaPct: number | null; semaforo: 'verde' | 'amarillo' | 'rojo' | null }[]
    | 'sin_datos_todavia';
};

export async function construirContextoSemana(supabase: any, desde: string, hasta: string): Promise<ContextoSemana> {
  const kpis = await calcularKpis(supabase, desde, hasta);
  const salud = await obtenerSaludClientes();

  let merma: ContextoSemana['merma'] = 'sin_datos_todavia';
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

  // Fetch directo por período (no "últimas N semanas" + find), así el
  // contexto es correcto para cualquier semana histórica, no solo recientes.
  const metricaSemana = await obtenerMetricasPeriodo(desde);

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
