'use client';

import { useState, useEffect } from 'react';
import { Beef, ShoppingBag, TrendingUp } from 'lucide-react';
import { obtenerResumenEmpleado, obtenerMargenHistorico, obtenerMetasEquipo } from './actions';
import type { ResumenEmpleado, MargenSemana, MetaEquipo } from './actions';

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
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [r, h, m] = await Promise.all([
        obtenerResumenEmpleado(),
        obtenerMargenHistorico(8),
        obtenerMetasEquipo(),
      ]);
      setResumen(r);
      setHistorico(h);
      setMetas(m);
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatGrande icon={<Beef className="w-6 h-6" />} label="Hamburguesas vendidas" valor={resumen.hamburguesasVendidas.toLocaleString('es-AR')} />
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
