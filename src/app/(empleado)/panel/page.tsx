'use client';

import { useState, useEffect } from 'react';
import { ShoppingBag, TrendingUp } from 'lucide-react';
import { obtenerResumenEmpleado, obtenerMargenHistorico, obtenerMetasEquipo } from './actions';
import type { ResumenEmpleado, MargenSemana, MetaEquipo } from './actions';
import { obtenerMetricasHistorico } from '../../(admin)/equipo/actions';
import type { MetricasEquipoSemana, FaltanteItem, QuejaItem } from '../../(admin)/equipo/actions';
import { formatDate, formatARS } from '@/lib/utils/format';

const COLOR_BAR: Record<string, string> = {
  gray: '#9ca3af',
  green: '#22c55e',
  yellow: '#eab308',
  red: '#ef4444',
};

const COLOR_BG: Record<string, string> = {
  gray: 'bg-surface-alt text-text-muted',
  green: 'bg-positive-bg text-positive',
  yellow: 'bg-warning-bg text-warning',
  red: 'bg-negative-bg text-negative',
};

export default function PanelEmpleadoPage() {
  const [resumen, setResumen] = useState<ResumenEmpleado | null>(null);
  const [historico, setHistorico] = useState<MargenSemana[]>([]);
  const [metas, setMetas] = useState<MetaEquipo[]>([]);
  const [metricasEquipo, setMetricasEquipo] = useState<MetricasEquipoSemana[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [r, h, m, me] = await Promise.all([
        obtenerResumenEmpleado(),
        obtenerMargenHistorico(8),
        obtenerMetasEquipo(),
        obtenerMetricasHistorico(8),
      ]);
      setResumen(r);
      setHistorico(h);
      setMetas(m);
      setMetricasEquipo(me);
      setLoaded(true);
    })();
  }, []);

  if (!loaded || !resumen) {
    return <div className="text-text-muted text-sm py-12 text-center">Cargando...</div>;
  }

  const metasOrdenadas = [...metas].sort((a, b) => a.margenMinimo - b.margenMinimo);
  const nivelActual = [...metasOrdenadas].reverse().find((m) => resumen.margenNeto >= m.margenMinimo) ?? null;
  const nivelSiguiente = metasOrdenadas.find((m) => m.margenMinimo > resumen.margenNeto) ?? null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-text-primary">Esta semana</h1>
        <p className="text-sm text-text-muted">{resumen.periodoLabel}</p>
      </div>

      {/* Bloque 1: resultado en vivo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatGrande icon={<ShoppingBag className="w-6 h-6" />} label="Pedidos" valor={resumen.pedidos.toLocaleString('es-AR')} />
        <StatGrande icon={<TrendingUp className="w-6 h-6" />} label="Margen neto" valor={`${resumen.margenNeto.toFixed(1)}%`} />
      </div>

      {/* Bloque 3: metas y recompensas */}
      {metasOrdenadas.length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-5">
          <h2 className="text-sm font-semibold text-text-primary mb-1">Metas del equipo</h2>
          <p className="text-sm text-text-secondary mb-4">
            {nivelActual ? (
              <>
                Zona: <span className="font-medium text-text-primary">{nivelActual.descripcion}</span>
                {nivelSiguiente && (
                  <> — faltan {(nivelSiguiente.margenMinimo - resumen.margenNeto).toFixed(1)} puntos para &quot;{nivelSiguiente.descripcion}&quot;</>
                )}
              </>
            ) : (
              <>
                Todavía no llegamos al primer nivel
                {metasOrdenadas[0] && <> — faltan {(metasOrdenadas[0].margenMinimo - resumen.margenNeto).toFixed(1)} puntos para llegar a {metasOrdenadas[0].margenMinimo}%</>}
              </>
            )}
          </p>
          <div className="space-y-2">
            {metasOrdenadas.map((m) => {
              const alcanzado = nivelActual?.nivel === m.nivel;
              return (
                <div
                  key={m.nivel}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${COLOR_BG[m.color]} ${alcanzado ? 'ring-2 ring-offset-1 ring-brand' : ''}`}
                >
                  <span className="font-medium">{m.descripcion}</span>
                  <span>desde {m.margenMinimo}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bloque 2: evolución del margen */}
      <div className="bg-surface rounded-xl border border-border p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-4">Evolución del margen neto</h2>
        {historico.length === 0 ? (
          <p className="text-sm text-text-muted py-6 text-center">Todavía no hay semanas cerradas.</p>
        ) : (
          <GraficoMargen historico={historico} metas={metasOrdenadas} />
        )}
      </div>

      {/* Métricas de equipo — sin montos en pesos */}
      <div className="bg-surface rounded-xl border border-border p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-4">Métricas del equipo</h2>
        <TablaMetricasEquipo metricas={metricasEquipo} />
      </div>
    </div>
  );
}

function textoFaltantes(quejasFaltantes: number | null, detalle: FaltanteItem[]): string {
  if (detalle.length > 0) {
    const items = detalle
      .map((f) => `${f.productoNombre} x${f.cantidad} (${formatARS(f.precioUnitarioVenta * f.cantidad)})`)
      .join(', ');
    const count = detalle.length;
    return `${count} ${count === 1 ? 'faltante' : 'faltantes'} — ${items}`;
  }
  if (quejasFaltantes != null) {
    return `${quejasFaltantes} ${quejasFaltantes === 1 ? 'faltante' : 'faltantes'}`;
  }
  return '—';
}

function textoQuejas(quejasCalidad: number | null, detalle: QuejaItem[]): string {
  if (detalle.length > 0) {
    const textos = detalle.map((q) => q.descripcion).join(', ');
    const count = detalle.length;
    return `${count} ${count === 1 ? 'queja' : 'quejas'} — ${textos}`;
  }
  if (quejasCalidad != null) {
    return `${quejasCalidad} ${quejasCalidad === 1 ? 'queja' : 'quejas'}`;
  }
  return '—';
}

function textoError(m: MetricasEquipoSemana): string {
  const totalErrores =
    m.faltantesDetalle.length > 0 || m.quejasDetalle.length > 0
      ? m.faltantesDetalle.length + m.quejasDetalle.length
      : (m.quejasFaltantes ?? 0) + (m.quejasCalidad ?? 0);

  if (m.pedidosEnPeriodo == null || m.pedidosEnPeriodo === 0) {
    return totalErrores > 0 ? `${totalErrores} errores` : '—';
  }
  const pct = ((totalErrores / m.pedidosEnPeriodo) * 100).toFixed(1);
  return `${pct}% de pedidos con error (${totalErrores} de ${m.pedidosEnPeriodo})`;
}

function TablaMetricasEquipo({ metricas }: { metricas: MetricasEquipoSemana[] }) {
  const conDatos = metricas.filter((m) =>
    m.mensajesRecibidos != null || m.mensajesConvertidos != null ||
    m.tiempoPromedioProduccionMin != null || m.quejasFaltantes != null || m.quejasCalidad != null ||
    m.faltantesDetalle.length > 0 || m.quejasDetalle.length > 0
  );

  if (conDatos.length === 0) {
    return <p className="text-sm text-text-muted py-6 text-center">Todavía no hay métricas cargadas.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-text-muted">
            <th className="pb-2 font-medium pr-4">Semana</th>
            <th className="pb-2 text-right font-medium px-3">Mensajes</th>
            <th className="pb-2 text-right font-medium px-3">Conversión</th>
            <th className="pb-2 text-right font-medium px-3">T. producción</th>
            <th className="pb-2 font-medium pl-4">Faltantes</th>
            <th className="pb-2 font-medium pl-4">Quejas de calidad</th>
            <th className="pb-2 font-medium pl-4">% error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {[...conDatos].reverse().map((m) => {
            const tasa = m.mensajesRecibidos && m.mensajesRecibidos > 0 && m.mensajesConvertidos != null
              ? `${((m.mensajesConvertidos / m.mensajesRecibidos) * 100).toFixed(0)}%`
              : '—';
            return (
              <tr key={m.periodoDesde}>
                <td className="py-2 pr-4 text-text-secondary whitespace-nowrap">{formatDate(m.periodoDesde)}</td>
                <td className="py-2 px-3 text-right tabular-nums text-text-primary whitespace-nowrap">
                  {m.mensajesRecibidos ?? '—'} → {m.mensajesConvertidos ?? '—'}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-text-primary">{tasa}</td>
                <td className="py-2 px-3 text-right tabular-nums text-text-primary whitespace-nowrap">
                  {m.tiempoPromedioProduccionMin != null ? `${m.tiempoPromedioProduccionMin} min` : '—'}
                </td>
                <td className="py-2 pl-4 text-text-primary max-w-xs">
                  {textoFaltantes(m.quejasFaltantes, m.faltantesDetalle)}
                </td>
                <td className="py-2 pl-4 text-text-primary max-w-xs">
                  {textoQuejas(m.quejasCalidad, m.quejasDetalle)}
                </td>
                <td className="py-2 pl-4 text-text-primary whitespace-nowrap">
                  {textoError(m)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatGrande({ icon, label, valor }: { icon: React.ReactNode; label: string; valor: string }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-5 text-center">
      <div className="flex justify-center text-brand mb-2">{icon}</div>
      <div className="text-4xl font-bold text-text-primary tabular-nums">{valor}</div>
      <div className="text-sm text-text-muted mt-1">{label}</div>
    </div>
  );
}

function colorParaMargen(margen: number, metas: MetaEquipo[]): string {
  const nivel = [...metas].reverse().find((m) => margen >= m.margenMinimo);
  return nivel ? COLOR_BAR[nivel.color] : '#ef4444';
}

function GraficoMargen({ historico, metas }: { historico: MargenSemana[]; metas: MetaEquipo[] }) {
  const valores = historico.map((h) => h.margenNeto);
  const umbrales = metas.map((m) => m.margenMinimo);
  const min = Math.min(0, ...valores, ...umbrales) - 5;
  const max = Math.max(0, ...valores, ...umbrales) + 5;
  const rango = max - min || 1;

  return (
    <div className="space-y-2.5">
      {historico.map((h) => {
        const pctDesdeMin = ((h.margenNeto - min) / rango) * 100;
        const pctCero = ((0 - min) / rango) * 100;
        const izquierda = Math.min(pctCero, pctDesdeMin);
        const ancho = Math.abs(pctDesdeMin - pctCero);
        return (
          <div key={h.label} className="flex items-center gap-3">
            <span className="text-xs text-text-muted w-24 shrink-0 truncate">{h.label}</span>
            <div className="flex-1 relative h-5 bg-surface-alt rounded">
              <div
                className="absolute top-0 h-5 rounded"
                style={{
                  left: `${izquierda}%`,
                  width: `${ancho}%`,
                  backgroundColor: colorParaMargen(h.margenNeto, metas),
                }}
              />
            </div>
            <span className="text-xs font-medium text-text-primary w-14 text-right tabular-nums">
              {h.margenNeto.toFixed(1)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
