// ─── Informe mensual por semana operativa ───────────────────────────────────
// Módulo puro (sin 'use server'): arma el texto en Markdown a partir de los
// ContextoSemana ya calculados. Pensado para pegarse directo en un chat con
// Claude — por eso es autocontenido (incluye contexto del negocio) y muestra
// únicamente números reales, sin interpretación (principio 2.9 del handoff).

import { periodoDeJS } from '@/lib/dashboard/rangos';
import { formatARS, formatPercent } from '@/lib/utils/format';
import type { ContextoSemana } from './contexto-semana';

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toDate(s: string): Date {
  return new Date(s + 'T12:00:00');
}

// Devuelve las semanas operativas (Vie→Dom) cuyo viernes cae dentro de
// [desde, hasta]. Es la misma noción de "semana" que usa periodo_de() en SQL
// y el resto del dashboard: una semana pertenece al mes de su viernes.
export function decomponerMesEnSemanas(desde: string, hasta: string): { desde: string; hasta: string }[] {
  const inicio = toDate(desde);
  const fin = toDate(hasta);

  let viernes = periodoDeJS(inicio);
  if (viernes < inicio) {
    viernes = new Date(viernes);
    viernes.setDate(viernes.getDate() + 7);
  }

  const semanas: { desde: string; hasta: string }[] = [];
  while (viernes <= fin) {
    const domingo = new Date(viernes);
    domingo.setDate(viernes.getDate() + 2);
    semanas.push({ desde: fmt(viernes), hasta: fmt(domingo) });
    viernes = new Date(viernes);
    viernes.setDate(viernes.getDate() + 7);
  }
  return semanas;
}

export type SemanaInforme = {
  desde: string;
  hasta: string;
  enCurso: boolean;
  contexto: ContextoSemana;
};

export function formatearInformeMensual(mesLabel: string, semanas: SemanaInforme[]): string {
  const l: string[] = [];

  l.push(`# Informe Royalty Burgers — ${mesLabel}`);
  l.push('');
  l.push(
    'Royalty Burgers es una hamburguesería en Rosario, Argentina, que opera viernes, sábado y domingo. ' +
      'El "período operativo" es siempre Vie-Sáb-Dom. Este informe reúne los KPIs reales de cada semana ' +
      'operativa del mes tal como están registrados en el sistema, sin ninguna interpretación agregada — ' +
      'la lectura y las conclusiones quedan para el análisis.'
  );
  l.push('');

  const cerradas = semanas.filter((s) => !s.enCurso);
  const sumar = (f: (c: ContextoSemana) => number) => semanas.reduce((acc, s) => acc + f(s.contexto), 0);
  const ventasTotal = sumar((c) => c.financiero.ventas);
  const beneficioNetoTotal = sumar((c) => c.financiero.beneficioNeto);
  const margenNetoMes = ventasTotal !== 0 ? (beneficioNetoTotal / ventasTotal) * 100 : 0;
  const pedidosTotal = sumar((c) => c.financiero.pedidos);
  const hamburguesasTotal = sumar((c) => c.financiero.hamburguesasVendidas);
  const resultadoDeliveryTotal = sumar((c) => c.financiero.resultadoDelivery);
  const publicidadTotal = sumar((c) => c.financiero.gastoPublicidad);

  const estadoResumen =
    cerradas.length === semanas.length
      ? `${semanas.length} semana${semanas.length !== 1 ? 's' : ''} operativa${semanas.length !== 1 ? 's' : ''}, todas cerradas`
      : `${semanas.length} semanas operativas — ${cerradas.length} cerrada${cerradas.length !== 1 ? 's' : ''} + ${semanas.length - cerradas.length} en curso`;

  l.push(`## Resumen del mes (${estadoResumen})`);
  l.push(`- Ventas totales: ${formatARS(ventasTotal)}`);
  l.push(`- Beneficio neto total: ${formatARS(beneficioNetoTotal)}`);
  l.push(`- Margen neto del mes (beneficio neto / ventas): ${formatPercent(margenNetoMes)}`);
  l.push(`- Pedidos totales: ${pedidosTotal}`);
  l.push(`- Hamburguesas vendidas: ${hamburguesasTotal}`);
  l.push(`- Publicidad invertida: ${formatARS(publicidadTotal)}`);
  l.push(`- Resultado Delivery total: ${formatARS(resultadoDeliveryTotal)}`);
  l.push('');

  l.push('## Comparativa semana a semana');
  l.push('');
  l.push('| Semana | Estado | Ventas | Margen neto | Beneficio neto | ROAS | Publicidad % ventas | Resultado Delivery |');
  l.push('|---|---|---|---|---|---|---|---|');
  semanas.forEach((s, i) => {
    const f = s.contexto.financiero;
    l.push(
      `| Semana ${i + 1} (${s.desde} — ${s.hasta}) | ${s.enCurso ? 'EN CURSO' : 'Cerrada'} | ${formatARS(f.ventas)} | ${formatPercent(f.margenNeto)} | ${formatARS(f.beneficioNeto)} | ${f.roas.toFixed(2)} | ${formatPercent(f.publicidadPct)} | ${formatARS(f.resultadoDelivery)} |`
    );
  });
  l.push('');

  l.push('## Detalle por semana');
  semanas.forEach((s, i) => {
    const f = s.contexto.financiero;
    l.push('');
    l.push(`### Semana ${i + 1}: ${s.desde} — ${s.hasta} ${s.enCurso ? '(EN CURSO — datos parciales, semana todavía no cerrada)' : '(cerrada)'}`);
    l.push('');
    l.push('**Financiero:**');
    l.push(`- Ventas: ${formatARS(f.ventas)} | Pedidos: ${f.pedidos} | Ticket promedio: ${formatARS(f.ticketPromedio)}`);
    l.push(`- Costo ingredientes: ${formatARS(f.costoIngredientes)} → Beneficio bruto: ${formatARS(f.beneficioBruto)} (margen bruto ${formatPercent(f.margenBruto)})`);
    l.push(`- Gastos variables: ${formatARS(f.gastosVariables)} | Gastos fijos: ${formatARS(f.gastosFijos)} | Consumo interno: ${formatARS(f.costoConsumoInterno)}`);
    l.push(`- Publicidad: ${formatARS(f.gastoPublicidad)} (${formatPercent(f.publicidadPct)} de ventas) | ROAS: ${f.roas.toFixed(2)}`);
    l.push(`- Resultado Delivery: ${formatARS(f.resultadoDelivery)}`);
    l.push(`- Beneficio neto: ${formatARS(f.beneficioNeto)} (margen neto ${formatPercent(f.margenNeto)})`);
    l.push(`- Hamburguesas vendidas: ${f.hamburguesasVendidas} | % ventas de clientes repetidores: ${formatPercent(f.pctVentasRepetidores)}`);

    l.push('');
    l.push('**Equipo:**');
    if (s.contexto.equipo === 'sin_datos_todavia') {
      l.push('- Sin datos cargados para esta semana.');
    } else {
      const eq = s.contexto.equipo;
      l.push(`- Mensajes recibidos: ${eq.mensajesRecibidos ?? '—'} | Convertidos: ${eq.mensajesConvertidos ?? '—'}`);
      l.push(`- Tiempo promedio de producción: ${eq.tiempoPromedioProduccionMin ?? '—'} min`);
      l.push(`- Quejas por faltantes: ${eq.quejasFaltantes ?? '—'} | Quejas de calidad: ${eq.quejasCalidad ?? '—'}`);
    }

    l.push('');
    l.push('**Meta Ads:**');
    if (s.contexto.metaAds === 'sin_datos_todavia') {
      l.push('- Sin datos importados para esta semana.');
    } else {
      const ma = s.contexto.metaAds;
      l.push(`- Gasto: USD ${ma.gastoUsd.toFixed(2)} | Alcance: ${ma.alcance ?? '—'} | Impresiones: ${ma.impresiones ?? '—'} | Clics: ${ma.clics ?? '—'} | Resultados: ${ma.resultados ?? '—'}`);
      if (ma.porConjunto.length > 0) {
        l.push('- Por conjunto (recordá: solo comparar costo por conversación entre conjuntos del mismo tipo de audiencia):');
        ma.porConjunto.forEach((c) => {
          l.push(
            `  - ${c.nombre} (${c.tipoAudiencia}): gasto ${formatARS(c.gastoArs)}, conversaciones ${c.conversaciones}, costo por conversación ${c.costoPorConversacion != null ? formatARS(c.costoPorConversacion) : '—'}, CTR ${c.ctrEnlace != null ? formatPercent(c.ctrEnlace) : '—'}`
          );
        });
      }
    }

    l.push('');
    l.push('**Merma:**');
    if (s.contexto.merma === 'sin_datos_todavia') {
      l.push('- Sin conteos de stock completos para esta semana.');
    } else {
      s.contexto.merma.forEach((m) => {
        l.push(`- ${m.ingrediente}: ${formatPercent(m.mermaPct)} (semáforo ${m.semaforo ?? '—'})`);
      });
    }
  });

  const salud = semanas[semanas.length - 1]?.contexto.clientes;
  if (salud) {
    l.push('');
    l.push('## Salud de clientes (estado actual de la cartera — no es un corte histórico por semana)');
    l.push(`- Retención de cartera: ${formatPercent(salud.retencionCartera)}`);
    l.push(`- Tasa de retención (histórico): ${formatPercent(salud.tasaRetencion)}`);
    l.push(`- Clientes de alto valor en riesgo: ${salud.altoValorEnRiesgo}`);
    l.push(`- Nuevos clientes que entraron en riesgo esta semana: ${salud.nuevosEnRiesgoEstaSemana}`);
    l.push(`- % de facturación de clientes repetidores: ${formatPercent(salud.pctFacturacionRepetidores)}`);
  }

  return l.join('\n');
}
