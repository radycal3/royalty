'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  buildRangoSemana,
  buildRangoMes,
  buildRangoTrimestre,
  buildRangoAño,
  buildRangoPersonalizado,
  buildAtajo,
  navegarRango,
  type Rango,
  type TipoRango,
} from '@/lib/dashboard/rangos';
import {
  obtenerKpisRango,
  obtenerGastosDesglose,
  obtenerRankingProductos,
  obtenerConsumoIngredientes,
  type KpisConDelta,
  type GastoDesglose,
  type ProductoRanking,
  type IngredienteConsumo,
} from './actions';
import { formatARS, formatPercent } from '@/lib/utils/format';
import { EmptyState } from '@/components/ui';

// ─── Constantes ──────────────────────────────────────────────────────────

const TIPOS_RANGO: { value: TipoRango; label: string }[] = [
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Mes' },
  { value: 'trimestre', label: 'Trimestre' },
  { value: 'año', label: 'Año' },
  { value: 'personalizado', label: 'Personalizado' },
];

const ATAJOS: { value: 'ultimos7' | 'ultimos30' | 'ultimos90' | 'añoActual'; label: string }[] = [
  { value: 'ultimos7', label: 'Últimos 7 días' },
  { value: 'ultimos30', label: 'Últimos 30 días' },
  { value: 'ultimos90', label: 'Últimos 90 días' },
  { value: 'añoActual', label: 'Año actual' },
];

type RankingTab = 'vendidos' | 'beneficio' | 'margen';

// ─── Subcomponentes ──────────────────────────────────────────────────────

function Delta({
  actual,
  anterior,
  invertido = false,
  sufijo = '%',
  esPuntoPorcentual = false,
}: {
  actual: number;
  anterior: number | null;
  invertido?: boolean;
  sufijo?: string;
  esPuntoPorcentual?: boolean;
}) {
  if (anterior === null) {
    return <span className="text-xs text-text-muted">Sin comparativo</span>;
  }

  if (esPuntoPorcentual) {
    const diff = actual - anterior;
    const subio = diff > 0;
    const sinCambio = Math.abs(diff) < 0.05;
    const positivo = sinCambio ? null : invertido ? !subio : subio;
    return (
      <span
        className={
          sinCambio
            ? 'text-xs text-text-muted'
            : positivo
            ? 'text-xs text-positive'
            : 'text-xs text-negative'
        }
      >
        {sinCambio ? '—' : subio ? '↑' : '↓'} {Math.abs(diff).toFixed(1)}pp
      </span>
    );
  }

  if (anterior === 0) {
    return <span className="text-xs text-text-muted">Sin comparativo</span>;
  }

  const pct = ((actual - anterior) / Math.abs(anterior)) * 100;
  const subio = pct > 0;
  const sinCambio = Math.abs(pct) < 0.05;
  const positivo = sinCambio ? null : invertido ? !subio : subio;

  return (
    <span
      className={
        sinCambio
          ? 'text-xs text-text-muted'
          : positivo
          ? 'text-xs text-positive'
          : 'text-xs text-negative'
      }
    >
      {sinCambio ? '—' : subio ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}
      {sufijo}
    </span>
  );
}

function KpiCard({
  titulo,
  valor,
  children,
}: {
  titulo: string;
  valor: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs text-text-muted">{titulo}</div>
      <div className="mt-1 text-xl font-semibold text-text-primary">{valor}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function FilaCascada({
  label,
  valor,
  pct,
  esTotal = false,
  negativo = false,
  indent = false,
}: {
  label: string;
  valor: number;
  pct?: number;
  esTotal?: boolean;
  negativo?: boolean;
  indent?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-2 ${
        esTotal ? 'border-t border-border font-semibold' : ''
      } ${indent ? 'pl-4' : ''}`}
    >
      <span className={esTotal ? 'text-text-primary' : 'text-text-secondary'}>{label}</span>
      <div className="flex items-center gap-3">
        {pct !== undefined && (
          <span className="w-14 text-right text-xs text-text-muted">{formatPercent(pct)}</span>
        )}
        <span
          className={`w-32 text-right tabular-nums ${
            esTotal ? 'text-text-primary' : negativo ? 'text-negative' : 'text-text-primary'
          }`}
        >
          {negativo ? `(${formatARS(Math.abs(valor))})` : formatARS(valor)}
        </span>
      </div>
    </div>
  );
}

// ─── Componente principal ───────────────────────────────────────────────

export default function DashboardPage() {
  const [rango, setRango] = useState<Rango>(() => buildRangoSemana());
  const [tipoSeleccionado, setTipoSeleccionado] = useState<TipoRango>('semana');

  const [kpis, setKpis] = useState<KpisConDelta | null>(null);
  const [gastos, setGastos] = useState<GastoDesglose[]>([]);
  const [ranking, setRanking] = useState<ProductoRanking[]>([]);
  const [ingredientes, setIngredientes] = useState<IngredienteConsumo[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [rankingTab, setRankingTab] = useState<RankingTab>('vendidos');

  // Inputs de fecha para "Personalizado"
  const [desdeInput, setDesdeInput] = useState(rango.desde);
  const [hastaInput, setHastaInput] = useState(rango.hasta);

  const requestIdRef = useRef(0);

  async function loadData(r: Rango) {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const [kpisData, gastosData, rankingData, ingredientesData] = await Promise.all([
        obtenerKpisRango(r),
        obtenerGastosDesglose(r.desde, r.hasta),
        obtenerRankingProductos(r.desde, r.hasta),
        obtenerConsumoIngredientes(r.desde, r.hasta),
      ]);

      if (requestId !== requestIdRef.current) return; // respuesta obsoleta, ignorar

      setKpis(kpisData);
      setGastos(gastosData);
      setRanking(rankingData);
      setIngredientes(ingredientesData);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Error al cargar el dashboard');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    loadData(rango);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rango]);

  function cambiarTipo(tipo: TipoRango) {
    setTipoSeleccionado(tipo);
    let nuevoRango: Rango;
    const hoy = new Date();

    switch (tipo) {
      case 'semana':
        nuevoRango = buildRangoSemana();
        break;
      case 'mes':
        nuevoRango = buildRangoMes(hoy.getFullYear(), hoy.getMonth());
        break;
      case 'trimestre':
        nuevoRango = buildRangoTrimestre(hoy.getFullYear(), Math.floor(hoy.getMonth() / 3));
        break;
      case 'año':
        nuevoRango = buildRangoAño(hoy.getFullYear());
        break;
      case 'personalizado':
        nuevoRango = buildRangoPersonalizado(rango.desde, rango.hasta);
        setDesdeInput(rango.desde);
        setHastaInput(rango.hasta);
        break;
    }

    startTransition(() => setRango(nuevoRango));
  }

  function aplicarAtajo(atajo: 'ultimos7' | 'ultimos30' | 'ultimos90' | 'añoActual') {
    const nuevoRango = buildAtajo(atajo);
    setTipoSeleccionado('personalizado');
    setDesdeInput(nuevoRango.desde);
    setHastaInput(nuevoRango.hasta);
    startTransition(() => setRango(nuevoRango));
  }

  function navegar(offset: number) {
    const nuevoRango = navegarRango(rango, offset);
    if (nuevoRango.tipo === 'personalizado') {
      setDesdeInput(nuevoRango.desde);
      setHastaInput(nuevoRango.hasta);
    }
    startTransition(() => setRango(nuevoRango));
  }

  function aplicarPersonalizado() {
    if (!desdeInput || !hastaInput) return;
    if (desdeInput > hastaInput) {
      setError('La fecha "desde" no puede ser posterior a "hasta"');
      return;
    }
    const nuevoRango = buildRangoPersonalizado(desdeInput, hastaInput);
    startTransition(() => setRango(nuevoRango));
  }

  function irAHoy() {
    cambiarTipo('semana');
  }

  const puedeNavegar = tipoSeleccionado !== 'personalizado' || (!!desdeInput && !!hastaInput);

  return (
    <div className="space-y-6">
      {/* ── Header + selector de rango ──────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-text-primary">Dashboard</h1>

          {/* Selector de tipo de rango */}
          <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-alt p-1">
            {TIPOS_RANGO.map((t) => (
              <button
                key={t.value}
                onClick={() => cambiarTipo(t.value)}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  tipoSeleccionado === t.value
                    ? 'bg-brand-light text-text-primary font-medium'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Atajos rápidos */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-muted">Atajos:</span>
          {ATAJOS.map((a) => (
            <button
              key={a.value}
              onClick={() => aplicarAtajo(a.value)}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-alt hover:text-text-primary"
            >
              {a.label}
            </button>
          ))}
        </div>

        {/* Navegación de período */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3">
          {tipoSeleccionado === 'personalizado' ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={desdeInput}
                onChange={(e) => setDesdeInput(e.target.value)}
                className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text-primary"
              />
              <span className="text-text-muted">—</span>
              <input
                type="date"
                value={hastaInput}
                onChange={(e) => setHastaInput(e.target.value)}
                className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text-primary"
              />
              <button
                onClick={aplicarPersonalizado}
                className="rounded-md bg-brand-light px-3 py-1 text-sm font-medium text-text-primary hover:opacity-90"
              >
                Aplicar
              </button>
            </div>
          ) : (
            <button
              onClick={() => navegar(-1)}
              disabled={!puedeNavegar}
              aria-label="Período anterior"
              className="rounded-md border border-border px-2.5 py-1.5 text-text-secondary hover:bg-surface-alt disabled:opacity-40"
            >
              ←
            </button>
          )}

          <div className="flex flex-1 items-center justify-center gap-2 text-sm font-medium text-text-primary">
            {rango.label}
            {rango.esActual && (
              <span className="rounded-full bg-positive-bg px-2 py-0.5 text-xs font-medium text-positive">
                En curso
              </span>
            )}
          </div>

          {tipoSeleccionado !== 'personalizado' && (
            <button
              onClick={() => navegar(1)}
              aria-label="Período siguiente"
              className="rounded-md border border-border px-2.5 py-1.5 text-text-secondary hover:bg-surface-alt"
            >
              →
            </button>
          )}

          {!rango.esActual && (
            <button
              onClick={irAHoy}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-surface-alt"
            >
              Hoy
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-negative bg-negative-bg px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      {loading && !kpis ? (
        <div className="py-16 text-center text-sm text-text-muted">Cargando dashboard…</div>
      ) : kpis ? (
        <div className={loading ? 'space-y-6 opacity-60 transition-opacity' : 'space-y-6'}>
          {/* ── KPI Cards ──────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard titulo="Pedidos" valor={kpis.actual.pedidos.toString()}>
              <Delta actual={kpis.actual.pedidos} anterior={kpis.anterior?.pedidos ?? null} />
            </KpiCard>
            <KpiCard titulo="Ventas" valor={formatARS(kpis.actual.ventas)}>
              <Delta actual={kpis.actual.ventas} anterior={kpis.anterior?.ventas ?? null} />
            </KpiCard>
            <KpiCard titulo="Costo ingredientes" valor={formatARS(kpis.actual.costoIngredientes)}>
              <Delta
                actual={kpis.actual.costoIngredientes}
                anterior={kpis.anterior?.costoIngredientes ?? null}
                invertido
              />
            </KpiCard>
            <KpiCard titulo="Beneficio bruto" valor={formatARS(kpis.actual.beneficioBruto)}>
              <Delta
                actual={kpis.actual.beneficioBruto}
                anterior={kpis.anterior?.beneficioBruto ?? null}
              />
            </KpiCard>
            <KpiCard titulo="Margen bruto" valor={formatPercent(kpis.actual.margenBruto)}>
              <Delta
                actual={kpis.actual.margenBruto}
                anterior={kpis.anterior?.margenBruto ?? null}
                esPuntoPorcentual
              />
            </KpiCard>
            <KpiCard titulo="Consumo interno" valor={formatARS(kpis.actual.costoConsumoInterno)}>
              <Delta
                actual={kpis.actual.costoConsumoInterno}
                anterior={kpis.anterior?.costoConsumoInterno ?? null}
                invertido
              />
            </KpiCard>
            <KpiCard titulo="Gastos operativos" valor={formatARS(kpis.actual.gastosTotal)}>
              <Delta
                actual={kpis.actual.gastosTotal}
                anterior={kpis.anterior?.gastosTotal ?? null}
                invertido
              />
            </KpiCard>
            <KpiCard titulo="Beneficio neto" valor={formatARS(kpis.actual.beneficioNeto)}>
              <Delta
                actual={kpis.actual.beneficioNeto}
                anterior={kpis.anterior?.beneficioNeto ?? null}
              />
            </KpiCard>
            <KpiCard titulo="Margen neto" valor={formatPercent(kpis.actual.margenNeto)}>
              <Delta
                actual={kpis.actual.margenNeto}
                anterior={kpis.anterior?.margenNeto ?? null}
                esPuntoPorcentual
              />
            </KpiCard>
            <KpiCard titulo="Ticket promedio" valor={formatARS(kpis.actual.ticketPromedio)}>
              <Delta
                actual={kpis.actual.ticketPromedio}
                anterior={kpis.anterior?.ticketPromedio ?? null}
              />
            </KpiCard>
          </div>

          {/* ── Cascada P&L ────────────────────────────────────────── */}
          <div className="rounded-lg border border-border bg-surface p-5">
            <h2 className="mb-2 text-sm font-semibold text-text-primary">
              Cascada de rentabilidad
            </h2>
            <div className="divide-y divide-border/50">
              <FilaCascada label="Ventas brutas" valor={kpis.actual.ventas} pct={100} />
              <FilaCascada
                label="Costo ingredientes"
                valor={kpis.actual.costoIngredientes}
                pct={
                  kpis.actual.ventas > 0
                    ? (kpis.actual.costoIngredientes / kpis.actual.ventas) * 100
                    : 0
                }
                negativo
              />
              <FilaCascada
                label="Beneficio bruto"
                valor={kpis.actual.beneficioBruto}
                pct={kpis.actual.margenBruto}
                esTotal
              />
              <FilaCascada
                label="Consumo interno"
                valor={kpis.actual.costoConsumoInterno}
                pct={
                  kpis.actual.ventas > 0
                    ? (kpis.actual.costoConsumoInterno / kpis.actual.ventas) * 100
                    : 0
                }
                negativo
              />

              {gastos
                .filter((g) => g.tipo === 'variable')
                .map((g) => (
                  <FilaCascada
                    key={`var-${g.categoria}`}
                    label={g.categoria.charAt(0).toUpperCase() + g.categoria.slice(1)}
                    valor={g.total}
                    pct={kpis.actual.ventas > 0 ? (g.total / kpis.actual.ventas) * 100 : 0}
                    negativo
                    indent
                  />
                ))}

              {gastos
                .filter((g) => g.tipo === 'fijo')
                .map((g) => (
                  <FilaCascada
                    key={`fijo-${g.categoria}`}
                    label={g.categoria.charAt(0).toUpperCase() + g.categoria.slice(1)}
                    valor={g.total}
                    pct={kpis.actual.ventas > 0 ? (g.total / kpis.actual.ventas) * 100 : 0}
                    negativo
                    indent
                  />
                ))}

              {gastos.length === 0 && (
                <div className="py-2 pl-4 text-xs text-text-muted">
                  Sin gastos registrados en este período
                </div>
              )}

              <FilaCascada
                label="Beneficio neto"
                valor={kpis.actual.beneficioNeto}
                pct={kpis.actual.margenNeto}
                esTotal
              />
            </div>
          </div>

          {/* ── Rankings de productos ──────────────────────────────── */}
          <div className="rounded-lg border border-border bg-surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">Ranking de productos</h2>
              <div className="flex gap-1 rounded-lg bg-surface-alt p-1">
                <button
                  onClick={() => setRankingTab('vendidos')}
                  className={`rounded-md px-3 py-1 text-xs ${
                    rankingTab === 'vendidos'
                      ? 'bg-brand-light font-medium text-text-primary'
                      : 'text-text-secondary'
                  }`}
                >
                  Más vendidos
                </button>
                <button
                  onClick={() => setRankingTab('beneficio')}
                  className={`rounded-md px-3 py-1 text-xs ${
                    rankingTab === 'beneficio'
                      ? 'bg-brand-light font-medium text-text-primary'
                      : 'text-text-secondary'
                  }`}
                >
                  Mayor beneficio
                </button>
                <button
                  onClick={() => setRankingTab('margen')}
                  className={`rounded-md px-3 py-1 text-xs ${
                    rankingTab === 'margen'
                      ? 'bg-brand-light font-medium text-text-primary'
                      : 'text-text-secondary'
                  }`}
                >
                  Mejor margen
                </button>
              </div>
            </div>

            {ranking.length === 0 ? (
              <EmptyState message="Sin ventas registradas en este período" />
            ) : (
              <>
                <div
                  className={rankingTab === 'vendidos' ? 'block' : 'hidden'}
                >
                  <TablaRanking items={[...ranking].sort((a, b) => b.unidades - a.unidades)} />
                </div>
                <div
                  className={rankingTab === 'beneficio' ? 'block' : 'hidden'}
                >
                  <TablaRanking items={[...ranking].sort((a, b) => b.beneficio - a.beneficio)} />
                </div>
                <div className={rankingTab === 'margen' ? 'block' : 'hidden'}>
                  <TablaRanking items={[...ranking].sort((a, b) => b.margen - a.margen)} />
                </div>
              </>
            )}
          </div>

          {/* ── Consumo de ingredientes ────────────────────────────── */}
          <div className="rounded-lg border border-border bg-surface p-5">
            <h2 className="mb-3 text-sm font-semibold text-text-primary">
              Consumo de ingredientes
            </h2>
            {ingredientes.length === 0 ? (
              <EmptyState message="Sin consumo de ingredientes en este período" />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-muted">
                    <th className="pb-2 font-medium">Ingrediente</th>
                    <th className="pb-2 text-right font-medium">Cantidad</th>
                    <th className="pb-2 text-right font-medium">Costo</th>
                    <th className="pb-2 text-right font-medium">Participación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {ingredientes.map((ing) => (
                    <tr key={ing.nombre}>
                      <td className="py-2 text-text-primary">{ing.nombre}</td>
                      <td className="py-2 text-right tabular-nums text-text-secondary">
                        {ing.cantidad.toLocaleString('es-AR', { maximumFractionDigits: 2 })}{' '}
                        {ing.unidad}
                      </td>
                      <td className="py-2 text-right tabular-nums text-text-primary">
                        {formatARS(ing.costo)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-text-muted">
                        {formatPercent(ing.participacion)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Tabla de ranking reutilizada por los 3 tabs ────────────────────────

function TablaRanking({ items }: { items: ProductoRanking[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs text-text-muted">
          <th className="pb-2 font-medium">Producto</th>
          <th className="pb-2 text-right font-medium">Unidades</th>
          <th className="pb-2 text-right font-medium">Venta</th>
          <th className="pb-2 text-right font-medium">Costo</th>
          <th className="pb-2 text-right font-medium">Beneficio</th>
          <th className="pb-2 text-right font-medium">Margen</th>
          <th className="pb-2 text-right font-medium">Particip.</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/50">
        {items.map((p) => (
          <tr key={p.nombre}>
            <td className="py-2 text-text-primary">{p.nombre}</td>
            <td className="py-2 text-right tabular-nums text-text-secondary">{p.unidades}</td>
            <td className="py-2 text-right tabular-nums text-text-primary">
              {formatARS(p.venta)}
            </td>
            <td className="py-2 text-right tabular-nums text-text-secondary">
              {formatARS(p.costo)}
            </td>
            <td className="py-2 text-right tabular-nums text-text-primary">
              {formatARS(p.beneficio)}
            </td>
            <td className="py-2 text-right tabular-nums text-text-secondary">
              {formatPercent(p.margen)}
            </td>
            <td className="py-2 text-right tabular-nums text-text-muted">
              {formatPercent(p.participacion)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
