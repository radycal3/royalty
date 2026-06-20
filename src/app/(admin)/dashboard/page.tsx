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
import {
  validarCierre,
  cerrarPeriodo,
  obtenerPeriodoActual,
  obtenerEvolucion,
  obtenerRecords,
  type ValidacionCierre,
  type PeriodoCerrado,
  type RecordHistorico,
} from '../evolucion/actions';
import { formatARS, formatPercent } from '@/lib/utils/format';
import { EmptyState, useToast } from '@/components/ui';

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
  signoAutomatico = false,
  indent = false,
}: {
  label: string;
  valor: number;
  pct?: number;
  esTotal?: boolean;
  negativo?: boolean;
  signoAutomatico?: boolean;
  indent?: boolean;
}) {
  // signoAutomatico: para filas como "Resultado Delivery" que pueden ser
  // positivas o negativas según el período (a diferencia de costos/gastos,
  // que siempre restan).
  const esNegativoReal = signoAutomatico ? valor < 0 : negativo;

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
            esTotal
              ? 'text-text-primary'
              : esNegativoReal
              ? 'text-negative'
              : signoAutomatico
              ? 'text-positive'
              : 'text-text-primary'
          }`}
        >
          {esNegativoReal
            ? `(${formatARS(Math.abs(valor))})`
            : signoAutomatico
            ? `+${formatARS(valor)}`
            : formatARS(valor)}
        </span>
      </div>
    </div>
  );
}

// ─── Mini gráfico (sparkline) para la sección Evolución ─────────────────

function MiniGrafico({
  titulo,
  valores,
  formato,
  record,
}: {
  titulo: string;
  valores: number[];
  formato: (n: number) => string;
  record?: RecordHistorico | null;
}) {
  if (valores.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="text-xs text-text-muted">{titulo}</div>
        <div className="mt-6 text-center text-xs text-text-muted">Sin datos</div>
      </div>
    );
  }

  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const rango = max - min || 1;
  const w = 240;
  const h = 56;
  const pad = 4;

  const puntos = valores.map((v, i) => {
    const x = valores.length > 1 ? (i / (valores.length - 1)) * (w - pad * 2) + pad : w / 2;
    const y = h - pad - ((v - min) / rango) * (h - pad * 2);
    return `${x},${y}`;
  });

  const primero = valores[0];
  const ultimo = valores[valores.length - 1];
  const subio = ultimo > primero;

  const pctRecord =
    record && record.valor > 0 ? Math.round((ultimo / record.valor) * 100) : null;

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs text-text-muted">{titulo}</div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className={`mt-2 w-full ${subio ? 'text-positive' : 'text-negative'}`}
        style={{ height: h }}
      >
        <polyline points={puntos.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="tabular-nums text-text-secondary">{formato(primero)}</span>
        <span className="tabular-nums text-text-secondary">→</span>
        <span className="tabular-nums font-medium text-text-primary">{formato(ultimo)}</span>
      </div>
      {pctRecord !== null && record && (
        <div className="mt-2 border-t border-border/50 pt-2 text-xs text-text-muted">
          <span className="font-medium text-text-secondary">{pctRecord}% del récord</span>
          <div>
            Récord: {formato(record.valor)} · {record.label}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Línea de la tarjeta de Tendencia reciente ───────────────────────────

function TendenciaItem({
  label,
  actual,
  anterior,
  formato,
  invertido = false,
}: {
  label: string;
  actual: number;
  anterior: number;
  formato: (n: number) => string;
  invertido?: boolean;
}) {
  const diff = actual - anterior;
  const subio = diff > 0;
  const sinCambio = Math.abs(diff) < 0.005 * Math.max(Math.abs(actual), 1);
  const positivo = sinCambio ? null : invertido ? !subio : subio;

  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-text-secondary">{label}</span>
      <span
        className={`font-medium ${
          sinCambio ? 'text-text-muted' : positivo ? 'text-positive' : 'text-negative'
        }`}
      >
        {sinCambio ? '—' : subio ? '↑' : '↓'} {formato(Math.abs(diff))}
      </span>
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

  const { show: showToast, Toast } = useToast();

  // ── Cierre de período ───────────────────────────────────────────────
  const [periodoCerradoActual, setPeriodoCerradoActual] = useState<PeriodoCerrado | null>(null);
  const [modalCierreAbierto, setModalCierreAbierto] = useState(false);
  const [validacionCierre, setValidacionCierre] = useState<ValidacionCierre | null>(null);
  const [validandoCierre, setValidandoCierre] = useState(false);
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);

  // ── Evolución ────────────────────────────────────────────────────────
  const [evolucionCantidad, setEvolucionCantidad] = useState<number | null>(8);
  const [evolucionDatos, setEvolucionDatos] = useState<PeriodoCerrado[]>([]);
  const [records, setRecords] = useState<{
    ventas: RecordHistorico | null;
    beneficioNeto: RecordHistorico | null;
    hamburguesasVendidas: RecordHistorico | null;
  } | null>(null);
  const [loadingEvolucion, setLoadingEvolucion] = useState(true);

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

      // El estado de "cerrada / no cerrada" solo aplica a semanas — Mes,
      // Trimestre, Año y Personalizado no tienen cierre propio.
      if (r.tipo === 'semana') {
        const periodo = await obtenerPeriodoActual(r.desde, r.hasta);
        if (requestId === requestIdRef.current) setPeriodoCerradoActual(periodo);
      } else {
        setPeriodoCerradoActual(null);
      }
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

  // Evolución: independiente del rango seleccionado arriba — siempre lee
  // el histórico de semanas YA cerradas, según el filtro de cantidad.
  async function loadEvolucion() {
    setLoadingEvolucion(true);
    try {
      const [datos, recordsData] = await Promise.all([
        obtenerEvolucion(evolucionCantidad),
        obtenerRecords(),
      ]);
      setEvolucionDatos(datos);
      setRecords(recordsData);
    } catch {
      // La sección de Evolución no es crítica para el resto del dashboard
      // — si falla, no bloquea ni muestra el error global de arriba.
      setEvolucionDatos([]);
    } finally {
      setLoadingEvolucion(false);
    }
  }

  useEffect(() => {
    loadEvolucion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evolucionCantidad]);

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

  // ── Flujo de cierre de período ──────────────────────────────────────

  const semanaTerminada = tipoSeleccionado === 'semana' && !rango.esActual;

  async function abrirModalCierre() {
    if (!kpis) return;
    setModalCierreAbierto(true);
    setValidandoCierre(true);
    setValidacionCierre(null);
    try {
      const v = await validarCierre(rango, kpis.actual);
      setValidacionCierre(v);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al validar el cierre', 'error');
      setModalCierreAbierto(false);
    } finally {
      setValidandoCierre(false);
    }
  }

  async function confirmarCierre() {
    if (!kpis) return;
    setConfirmandoCierre(true);
    try {
      const r = await cerrarPeriodo(rango, kpis.actual);
      if (!r.ok) {
        showToast(r.mensaje, 'error');
      } else {
        showToast('Semana cerrada correctamente');
        setModalCierreAbierto(false);
        const periodo = await obtenerPeriodoActual(rango.desde, rango.hasta);
        setPeriodoCerradoActual(periodo);
        loadEvolucion();
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al cerrar el período', 'error');
    } finally {
      setConfirmandoCierre(false);
    }
  }

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

          {semanaTerminada &&
            (periodoCerradoActual ? (
              <span className="rounded-full bg-positive-bg px-3 py-1.5 text-xs font-medium text-positive">
                ✓ Cerrada el{' '}
                {new Date(periodoCerradoActual.cerradoEn).toLocaleDateString('es-AR')}
              </span>
            ) : (
              <button
                onClick={abrirModalCierre}
                className="rounded-md bg-brand-light px-3 py-1.5 text-xs font-medium text-text-primary hover:opacity-90"
              >
                Cerrar semana
              </button>
            ))}
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
            <KpiCard
              titulo="ROAS"
              valor={kpis.actual.roas > 0 ? `${kpis.actual.roas.toFixed(2)}x` : '—'}
            >
              {kpis.actual.gastoPublicidad === 0 ? (
                <span className="text-xs text-text-muted">Sin gasto en publicidad</span>
              ) : kpis.anterior && kpis.anterior.gastoPublicidad === 0 ? (
                // Hay período anterior, pero sin gasto en publicidad: el ROAS
                // anterior da 0 por ausencia de dato, no por mal desempeño.
                // No es "sin comparativo" — es que la pauta arrancó este período.
                <span className="text-xs text-text-muted">Publicidad nueva este período</span>
              ) : (
                <Delta actual={kpis.actual.roas} anterior={kpis.anterior?.roas ?? null} />
              )}
            </KpiCard>
            <KpiCard titulo="Publicidad % s/ventas" valor={formatPercent(kpis.actual.publicidadPct)}>
              <Delta
                actual={kpis.actual.publicidadPct}
                anterior={kpis.anterior?.publicidadPct ?? null}
                invertido
                esPuntoPorcentual
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
                .filter((g) => g.tipo === 'variable' && !g.legacy)
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
                .filter((g) => g.tipo === 'fijo' && !g.legacy)
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

              {gastos.filter((g) => !g.legacy).length === 0 && (
                <div className="py-2 pl-4 text-xs text-text-muted">
                  Sin gastos registrados en este período
                </div>
              )}

              <FilaCascada
                label="Envíos cobrados"
                valor={kpis.actual.enviosCobrados}
                pct={
                  kpis.actual.ventas > 0
                    ? (kpis.actual.enviosCobrados / kpis.actual.ventas) * 100
                    : 0
                }
                indent
              />
              <FilaCascada
                label="Pagos a cadetes"
                valor={kpis.actual.pagosCadetes}
                pct={
                  kpis.actual.ventas > 0
                    ? (kpis.actual.pagosCadetes / kpis.actual.ventas) * 100
                    : 0
                }
                negativo
                indent
              />
              <FilaCascada
                label="Base cadetería"
                valor={kpis.actual.costoBaseCadeteria}
                pct={
                  kpis.actual.ventas > 0
                    ? (kpis.actual.costoBaseCadeteria / kpis.actual.ventas) * 100
                    : 0
                }
                negativo
                indent
              />
              <FilaCascada
                label="Resultado Delivery"
                valor={kpis.actual.resultadoDelivery}
                pct={
                  kpis.actual.ventas > 0
                    ? (kpis.actual.resultadoDelivery / kpis.actual.ventas) * 100
                    : 0
                }
                signoAutomatico
              />

              <FilaCascada
                label="Beneficio neto"
                valor={kpis.actual.beneficioNeto}
                pct={kpis.actual.margenNeto}
                esTotal
              />
            </div>

            {gastos.some((g) => g.legacy) && (
              <div className="mt-4 rounded-md border border-border bg-warning-bg px-3 py-2.5 text-xs text-warning">
                <div className="font-medium">⚠ Cadetería (legacy)</div>
                <div className="mt-0.5 text-text-secondary">
                  Este gasto proviene del sistema anterior y no participa del cálculo actual de
                  Resultado Delivery. La fuente de verdad para cadetería es el cierre operativo
                  de cadetes (viajes realizados) + envíos cobrados.
                </div>
                <div className="mt-2 space-y-1">
                  {gastos
                    .filter((g) => g.legacy)
                    .map((g) => (
                      <div
                        key={`legacy-${g.tipo}-${g.categoria}`}
                        className="flex items-center justify-between text-text-secondary"
                      >
                        <span>
                          Cadetería ({g.tipo}) — registro histórico
                        </span>
                        <span className="tabular-nums">{formatARS(g.total)}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
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

      {/* ── Evolución ──────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-text-primary">Evolución</h2>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-text-muted">Mostrar:</span>
            <select
              value={evolucionCantidad === null ? 'todo' : evolucionCantidad}
              onChange={(e) =>
                setEvolucionCantidad(e.target.value === 'todo' ? null : parseInt(e.target.value, 10))
              }
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text-primary"
            >
              <option value={8}>Últimas 8 semanas</option>
              <option value={12}>Últimas 12 semanas</option>
              <option value={26}>Últimas 26 semanas</option>
              <option value="todo">Todo el histórico</option>
            </select>
          </div>
        </div>

        {loadingEvolucion ? (
          <div className="py-12 text-center text-sm text-text-muted">Cargando evolución…</div>
        ) : evolucionDatos.length < 2 ? (
          <div className="rounded-lg border border-border bg-surface p-8 text-center">
            <p className="text-sm text-text-muted">
              Todavía no hay suficientes semanas cerradas para mostrar evolución. Cerrá la semana
              actual o anteriores desde el selector de período arriba.
            </p>
          </div>
        ) : (
          <>
            {/* Tarjeta de tendencia reciente */}
            {(() => {
              const ultima = evolucionDatos[evolucionDatos.length - 1];
              const anterior = evolucionDatos[evolucionDatos.length - 2];
              return (
                <div className="rounded-lg border border-border bg-surface p-5">
                  <h3 className="text-sm font-semibold text-text-primary">Tendencia reciente</h3>
                  <p className="mt-1 text-xs text-text-muted">
                    {ultima.label} vs. {anterior.label}
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                    <TendenciaItem
                      label="Ventas"
                      actual={ultima.ventas}
                      anterior={anterior.ventas}
                      formato={formatARS}
                    />
                    <TendenciaItem
                      label="Beneficio neto"
                      actual={ultima.beneficioNeto}
                      anterior={anterior.beneficioNeto}
                      formato={formatARS}
                    />
                    <TendenciaItem
                      label="Margen neto"
                      actual={ultima.margenNeto}
                      anterior={anterior.margenNeto}
                      formato={(n) => `${n.toFixed(1)}pp`}
                    />
                    <TendenciaItem
                      label="ROAS"
                      actual={ultima.roas}
                      anterior={anterior.roas}
                      formato={(n) => `${n.toFixed(2)}x`}
                    />
                    <TendenciaItem
                      label="Publicidad % s/ventas"
                      actual={ultima.publicidadPct}
                      anterior={anterior.publicidadPct}
                      formato={(n) => `${n.toFixed(1)}pp`}
                      invertido
                    />
                    <TendenciaItem
                      label="Costo por pedido"
                      actual={ultima.costoPorPedido}
                      anterior={anterior.costoPorPedido}
                      formato={formatARS}
                      invertido
                    />
                    <TendenciaItem
                      label="Hamburguesas vendidas"
                      actual={ultima.hamburguesasVendidas}
                      anterior={anterior.hamburguesasVendidas}
                      formato={(n) => `${n} uds`}
                    />
                    <TendenciaItem
                      label="Beneficio por pedido"
                      actual={ultima.beneficioPorPedido}
                      anterior={anterior.beneficioPorPedido}
                      formato={formatARS}
                    />
                  </div>
                </div>
              );
            })()}

            {/* Grid de mini gráficos */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <MiniGrafico
                titulo="Ventas"
                valores={evolucionDatos.map((p) => p.ventas)}
                formato={formatARS}
                record={records?.ventas}
              />
              <MiniGrafico
                titulo="Beneficio neto"
                valores={evolucionDatos.map((p) => p.beneficioNeto)}
                formato={formatARS}
                record={records?.beneficioNeto}
              />
              <MiniGrafico
                titulo="Margen neto %"
                valores={evolucionDatos.map((p) => p.margenNeto)}
                formato={(n) => `${n.toFixed(1)}%`}
              />
              <MiniGrafico
                titulo="ROAS"
                valores={evolucionDatos.map((p) => p.roas)}
                formato={(n) => `${n.toFixed(2)}x`}
              />
              <MiniGrafico
                titulo="Publicidad % s/ventas"
                valores={evolucionDatos.map((p) => p.publicidadPct)}
                formato={(n) => `${n.toFixed(1)}%`}
              />
              <MiniGrafico
                titulo="Costo por pedido"
                valores={evolucionDatos.map((p) => p.costoPorPedido)}
                formato={formatARS}
              />
              <MiniGrafico
                titulo="Hamburguesas vendidas"
                valores={evolucionDatos.map((p) => p.hamburguesasVendidas)}
                formato={(n) => `${n} uds`}
                record={records?.hamburguesasVendidas}
              />
              <MiniGrafico
                titulo="Beneficio por pedido"
                valores={evolucionDatos.map((p) => p.beneficioPorPedido)}
                formato={formatARS}
              />
              <MiniGrafico
                titulo="Resultado Delivery"
                valores={evolucionDatos.map((p) => p.resultadoDelivery)}
                formato={formatARS}
              />
            </div>
          </>
        )}
      </div>

      {/* ── Modal de cierre de período ───────────────────────────────────── */}
      {modalCierreAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/20"
            onClick={() => !confirmandoCierre && setModalCierreAbierto(false)}
          />
          <div className="relative w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-xl">
            <h3 className="text-sm font-semibold text-text-primary">
              Cerrar {rango.label}
            </h3>

            {validandoCierre ? (
              <div className="py-8 text-center text-sm text-text-muted">Validando…</div>
            ) : validacionCierre ? (
              <div className="mt-4 space-y-4">
                {validacionCierre.yaCerrada ? (
                  <div className="rounded-md border border-negative bg-negative-bg px-3 py-2 text-sm text-negative">
                    Esta semana ya fue cerrada anteriormente.
                  </div>
                ) : (
                  <>
                    {validacionCierre.advertencias.length > 0 && (
                      <div className="space-y-2">
                        {validacionCierre.advertencias.map((a) => (
                          <div
                            key={a.codigo}
                            className="rounded-md border border-border bg-warning-bg px-3 py-2 text-xs text-warning"
                          >
                            ⚠ {a.mensaje}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="rounded-md bg-surface-alt p-3 text-sm">
                      <div className="mb-2 text-xs font-medium text-text-muted">
                        Se va a congelar:
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        <span className="text-text-secondary">Ventas</span>
                        <span className="text-right tabular-nums text-text-primary">
                          {formatARS(validacionCierre.preview.ventas)}
                        </span>
                        <span className="text-text-secondary">Beneficio neto</span>
                        <span className="text-right tabular-nums text-text-primary">
                          {formatARS(validacionCierre.preview.beneficioNeto)}
                        </span>
                        <span className="text-text-secondary">Hamburguesas vendidas</span>
                        <span className="text-right tabular-nums text-text-primary">
                          {validacionCierre.preview.hamburguesasVendidas}
                        </span>
                        <span className="text-text-secondary">ROAS</span>
                        <span className="text-right tabular-nums text-text-primary">
                          {validacionCierre.preview.roas.toFixed(2)}x
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-text-muted">
                      Una vez cerrada, esta semana no se vuelve a recalcular aunque cambien
                      costos, recetas o configuración más adelante.
                    </p>
                  </>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setModalCierreAbierto(false)}
                    disabled={confirmandoCierre}
                    className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-alt"
                  >
                    Cancelar
                  </button>
                  {!validacionCierre.yaCerrada && (
                    <button
                      onClick={confirmarCierre}
                      disabled={confirmandoCierre}
                      className="rounded-md bg-brand-light px-3 py-1.5 text-sm font-medium text-text-primary hover:opacity-90 disabled:opacity-40"
                    >
                      {confirmandoCierre ? 'Cerrando…' : 'Confirmar cierre'}
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <Toast />
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
