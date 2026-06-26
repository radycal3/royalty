'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { contarDecisionesEvaluablesTrasCierre } from '../laboratorio/actions';
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
  obtenerSaludClientes,
  obtenerContactosCliente,
  registrarContacto,
  type KpisConDelta,
  type GastoDesglose,
  type ProductoRanking,
  type IngredienteConsumo,
  type SaludClientes,
  type ClienteValioso,
  type ClienteContacto,
  type MetodoContacto,
} from './actions';
import {
  validarCierre,
  cerrarPeriodo,
  obtenerPeriodoActual,
  obtenerEvolucion,
  obtenerRecords,
  obtenerBandasMargen,
  eliminarCierre,
  type ValidacionCierre,
  type PeriodoCerrado,
  type RecordHistorico,
  type BandasMargen,
} from '../evolucion/actions';
import {
  obtenerSemaforoEnVivo,
  compararUltimasDosSemanas,
  type Semaforo,
  type EstadoSalud,
  type ComparacionPeriodos,
} from '../auditoria/actions';
import { formatARS, formatPercent, formatDate } from '@/lib/utils/format';
import { EmptyState, useToast, SidePanel, Field, Input, Select, Button, Badge } from '@/components/ui';

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

function KpiCardHero({
  titulo,
  valor,
  colorValor,
  children,
}: {
  titulo: string;
  valor: string;
  colorValor?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5" data-print="section">
      <div className="text-xs font-medium uppercase tracking-wide text-text-muted">{titulo}</div>
      <div className={`mt-2 text-3xl font-bold tabular-nums ${colorValor ?? 'text-text-primary'}`}>
        {valor}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function ZonaDivisor({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1" data-print="hidden">
      <div className="h-px flex-1 bg-border" />
      <span className="shrink-0 text-xs font-medium text-text-muted">{label}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function SeccionColapsable({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-surface">
      <button
        onClick={() => setAbierto((a) => !a)}
        className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-surface-alt"
      >
        <span className="text-sm font-semibold text-text-primary">{titulo}</span>
        <span className="text-xs text-text-muted">{abierto ? '▲ ocultar' : '▼ ver'}</span>
      </button>
      {abierto && (
        <div className="border-t border-border px-5 pb-5 pt-4">
          {children}
        </div>
      )}
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

// ─── Semáforo de salud ────────────────────────────────────────────────

const COLORES_SALUD: Record<EstadoSalud, string> = {
  verde: 'bg-positive-bg text-positive',
  amarillo: 'bg-warning-bg text-warning',
  rojo: 'bg-negative-bg text-negative',
  sin_datos: 'bg-surface-alt text-text-muted',
};

const ICONOS_SALUD: Record<EstadoSalud, string> = {
  verde: '●',
  amarillo: '●',
  rojo: '●',
  sin_datos: '○',
};

const LABELS_INDICADOR: Record<string, string> = {
  margen_neto: 'Margen neto',
  publicidad: 'Publicidad',
  delivery: 'Delivery',
  roas: 'ROAS',
  tendencia_ventas: 'Tendencia de ventas',
};

function SemaforoSalud({ semaforo }: { semaforo: Semaforo }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">Salud del negocio</h2>
        {semaforo.fuente === 'en_vivo' ? (
          <span className="rounded-full bg-warning-bg px-2.5 py-1 text-xs font-medium text-warning">
            Semana en curso — valores sujetos a cambio hasta el cierre
          </span>
        ) : (
          <span className="rounded-full bg-positive-bg px-2.5 py-1 text-xs font-medium text-positive">
            Snapshot congelado
          </span>
        )}
      </div>

      <div className="space-y-2">
        {semaforo.indicadores.map((ind) => (
          <div
            key={ind.nombre}
            className="flex items-start gap-3 rounded-md border border-border/50 p-3"
          >
            <span
              className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs ${COLORES_SALUD[ind.estado]}`}
            >
              {ICONOS_SALUD[ind.estado]}
            </span>
            <div className="flex-1">
              <div className="text-sm font-medium text-text-primary">
                {LABELS_INDICADOR[ind.nombre]}
              </div>
              <div className="mt-0.5 text-xs text-text-secondary">{ind.explicacion}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── "¿Qué cambió?" — comparación entre períodos cerrados ───────────────

// Genera el resumen ejecutivo automático a partir de los datos ya calculados.
// Reglas: sin inventar causalidad, solo describir los hechos en orden de impacto.
function generarResumenEjecutivo(comparacion: ComparacionPeriodos): {
  subio: boolean;
  frases: string[];
} {
  const { deltaBeneficioNeto, beneficioNetoA, contribuciones } = comparacion;
  const subio = deltaBeneficioNeto >= 0;

  // Separar impulsores y frenos por impacto absoluto
  const positivas = [...contribuciones]
    .filter((c) => c.impactoEnNeto > 1)
    .sort((a, b) => b.impactoEnNeto - a.impactoEnNeto);
  const negativas = [...contribuciones]
    .filter((c) => c.impactoEnNeto < -1)
    .sort((a, b) => a.impactoEnNeto - b.impactoEnNeto);

  // Genera la frase correcta según la naturaleza del componente:
  // - Ventas/Delivery: subir es positivo → "subieron / bajaron"
  // - Costos/Gastos: bajar es positivo para el neto → describir el movimiento del costo,
  //   no del impacto ("bajaron $X" en vez de "aportaron $X")
  function describir(c: ComparacionPeriodos['contribuciones'][0], esImpulsor: boolean): string {
    const monto = formatARS(Math.abs(c.impactoEnNeto));
    const delta = c.valorB - c.valorA;
    const subioElValor = delta > 0;

    switch (c.componente) {
      case 'ventas':
        return esImpulsor
          ? `Las ventas subieron ${formatARS(delta)} — principal impulsor del resultado.`
          : `Las ventas cayeron ${formatARS(Math.abs(delta))} — principal freno del resultado.`;
      case 'costoIngredientes':
        return esImpulsor
          ? `El costo de ingredientes bajó ${monto}, mejorando el margen bruto.`
          : `El costo de ingredientes subió ${monto}, presionando el margen bruto.`;
      case 'gastosVariables':
        return esImpulsor
          ? `Los gastos variables bajaron ${formatARS(Math.abs(delta))}, liberando ${monto} de margen.`
          : `Los gastos variables subieron ${formatARS(delta)}, restando ${monto} al resultado.`;
      case 'gastosFijos':
        return esImpulsor
          ? `Los gastos fijos bajaron ${formatARS(Math.abs(delta))}, aportando ${monto} al resultado.`
          : `Los gastos fijos subieron ${formatARS(delta)}, restando ${monto} al resultado.`;
      case 'costoConsumoInterno':
        return esImpulsor
          ? `El consumo interno bajó ${monto}.`
          : `El consumo interno subió ${monto}.`;
      case 'resultadoDelivery':
        return esImpulsor
          ? `El resultado de delivery mejoró ${monto}.`
          : `El resultado de delivery empeoró ${monto}.`;
      default:
        return esImpulsor
          ? `${c.label} mejoró ${monto}.`
          : `${c.label} empeoró ${monto}.`;
    }
  }

  const frases: string[] = [];

  if (positivas.length > 0) frases.push(describir(positivas[0], true));
  if (negativas.length > 0) frases.push(describir(negativas[0], false));

  // Segundo freno relevante (>20% del primero)
  if (
    negativas.length > 1 &&
    Math.abs(negativas[1].impactoEnNeto) > Math.abs(negativas[0].impactoEnNeto) * 0.2
  ) {
    frases.push(describir(negativas[1], false));
  }

  // Encabezado con variación absoluta y porcentual
  if (beneficioNetoA !== 0 && Math.abs(beneficioNetoA) > 1000) {
    const pct = (deltaBeneficioNeto / Math.abs(beneficioNetoA)) * 100;
    const pctStr = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    frases.unshift(
      `El beneficio neto ${subio ? 'mejoró' : 'cayó'} ${formatARS(Math.abs(deltaBeneficioNeto))} (${pctStr}) respecto a la semana anterior.`
    );
  } else {
    frases.unshift(
      `El beneficio neto ${subio ? 'mejoró' : 'cayó'} ${formatARS(Math.abs(deltaBeneficioNeto))} respecto a la semana anterior.`
    );
  }

  return { subio, frases };
}

function FilaContribucion({
  label, valorA, valorB, impacto,
}: {
  label: string; valorA: number; valorB: number; impacto: number;
}) {
  const impactoPositivo = impacto > 0;
  const sinCambio = Math.abs(impacto) < 1;
  // El valor subyacente subió o bajó — dato independiente del impacto en neto
  // (un gasto que baja tiene impacto positivo, pero el valor bajó)
  const valorSubio = valorB > valorA;
  const deltaValor = valorB - valorA;

  return (
    <div className="flex items-center justify-between py-2.5 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-text-secondary">{label}</span>
        {!sinCambio && (
          <span className="text-xs text-text-muted">
            {valorSubio ? '↑' : '↓'} {formatARS(Math.abs(deltaValor))}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span className="text-xs text-text-muted tabular-nums">
          {formatARS(valorA)} → {formatARS(valorB)}
        </span>
        <span className={`w-28 text-right font-semibold tabular-nums ${
          sinCambio ? 'text-text-muted' : impactoPositivo ? 'text-positive' : 'text-negative'
        }`}>
          {sinCambio ? '—' : impactoPositivo ? '+' : ''}{formatARS(impacto)}
        </span>
      </div>
    </div>
  );
}

// Sección de productos o gastos — separada en impulsores y frenos
function SeccionDestacados({
  titulo,
  items,
  cambioRef,
}: {
  titulo: string;
  items: ComparacionPeriodos['productosDestacados'];
  cambioRef: number; // para calcular participación relativa honesta
}) {
  const [expandido, setExpandido] = useState(false);

  const impulsores = items.filter((i) => i.diferencia > 0).sort((a, b) => b.diferencia - a.diferencia);
  const frenos     = items.filter((i) => i.diferencia < 0).sort((a, b) => a.diferencia - b.diferencia);

  const LIMITE = 5;

  function listaItems(grupo: typeof items, esPositivo: boolean) {
    const visibles = expandido ? grupo : grupo.slice(0, LIMITE);
    return visibles.map((item) => (
      <div key={item.nombre} className="flex items-center justify-between py-1.5 text-xs">
        <span className="text-text-secondary">{item.nombre}</span>
        <span className={`tabular-nums font-medium ${esPositivo ? 'text-positive' : 'text-negative'}`}>
          {esPositivo ? '+' : ''}{formatARS(item.diferencia)}
        </span>
      </div>
    ));
  }

  if (items.length === 0) {
    return (
      <div>
        <div className="mb-2 text-xs font-semibold text-text-secondary">{titulo}</div>
        <div className="text-xs text-text-muted">Sin cambios relevantes en este período.</div>
      </div>
    );
  }

  const totalImpulsores = impulsores.reduce((s, i) => s + i.diferencia, 0);
  const totalFrenos     = frenos.reduce((s, i) => s + i.diferencia, 0);
  const hayMas = (impulsores.length > LIMITE || frenos.length > LIMITE) && !expandido;

  return (
    <div>
      <div className="mb-3 text-xs font-semibold text-text-secondary">{titulo}</div>

      {impulsores.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-positive">↑ Impulsaron</span>
            <span className="text-xs tabular-nums text-positive">+{formatARS(totalImpulsores)}</span>
          </div>
          <div className="divide-y divide-border/30">
            {listaItems(impulsores, true)}
          </div>
        </div>
      )}

      {frenos.length > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-negative">↓ Frenaron</span>
            <span className="text-xs tabular-nums text-negative">{formatARS(totalFrenos)}</span>
          </div>
          <div className="divide-y divide-border/30">
            {listaItems(frenos, false)}
          </div>
        </div>
      )}

      {hayMas && (
        <button
          onClick={() => setExpandido(true)}
          className="mt-2 text-xs text-text-muted underline hover:text-text-secondary"
        >
          Ver todos ({items.length} en total)
        </button>
      )}
      {expandido && items.length > LIMITE && (
        <button
          onClick={() => setExpandido(false)}
          className="mt-2 text-xs text-text-muted underline hover:text-text-secondary"
        >
          Ver menos
        </button>
      )}
    </div>
  );
}

function QueCambio({ comparacion }: { comparacion: ComparacionPeriodos }) {
  const { subio, frases } = generarResumenEjecutivo(comparacion);

  // Ordenar contribuciones por impacto absoluto descendente
  const contribucionesOrdenadas = [...comparacion.contribuciones].sort(
    (a, b) => Math.abs(b.impactoEnNeto) - Math.abs(a.impactoEnNeto)
  );

  // Variación porcentual del beneficio neto (usando los valores explícitos del backend)
  const pctVariacion =
    comparacion.beneficioNetoA !== 0 && Math.abs(comparacion.beneficioNetoA) > 1000
      ? (comparacion.deltaBeneficioNeto / Math.abs(comparacion.beneficioNetoA)) * 100
      : null;

  const cambioTotalVentas = comparacion.contribuciones.find(c => c.componente === 'ventas');
  const cambioRefProductos = cambioTotalVentas ? Math.abs(cambioTotalVentas.valorB - cambioTotalVentas.valorA) : 1;
  const cambioRefGastos    = Math.abs(comparacion.deltaBeneficioNeto) || 1;

  return (
    <div className="rounded-lg border border-border bg-surface p-5">

      {/* Header */}
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">¿Qué cambió?</h2>
        <span className="rounded-full bg-positive-bg px-2.5 py-1 text-xs font-medium text-positive">
          Snapshot congelado
        </span>
      </div>
      <p className="text-xs text-text-muted">
        {comparacion.periodoA.label} vs. {comparacion.periodoB.label}
      </p>

      {/* Resumen ejecutivo */}
      <div className={`mt-4 rounded-md border p-4 ${
        subio ? 'border-positive/30 bg-positive-bg' : 'border-negative/30 bg-negative-bg'
      }`}>
        <div className="space-y-1.5">
          {frases.map((f, i) => (
            <p key={i} className={`text-sm ${i === 0 ? 'font-medium text-text-primary' : 'text-text-secondary'}`}>
              {f}
            </p>
          ))}
        </div>
      </div>

      {/* Resultado neto — valores absolutos y porcentual */}
      <div className="mt-4 flex items-center justify-between rounded-md bg-surface-alt px-4 py-3">
        <div>
          <div className="text-xs text-text-muted">Beneficio neto</div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="tabular-nums text-sm text-text-secondary">
              {formatARS(comparacion.beneficioNetoA)}
            </span>
            <span className="text-text-muted">→</span>
            <span className={`tabular-nums text-sm font-semibold ${
              comparacion.beneficioNetoB >= 0 ? 'text-text-primary' : 'text-negative'
            }`}>
              {formatARS(comparacion.beneficioNetoB)}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-bold tabular-nums ${
            comparacion.deltaBeneficioNeto >= 0 ? 'text-positive' : 'text-negative'
          }`}>
            {comparacion.deltaBeneficioNeto >= 0 ? '+' : ''}{formatARS(comparacion.deltaBeneficioNeto)}
          </div>
          {pctVariacion !== null && (
            <div className={`text-xs tabular-nums font-medium ${
              pctVariacion >= 0 ? 'text-positive' : 'text-negative'
            }`}>
              {pctVariacion >= 0 ? '+' : ''}{pctVariacion.toFixed(1)}% vs semana anterior
            </div>
          )}
        </div>
      </div>

      {/* Contribuciones ordenadas por impacto absoluto */}
      <div className="mt-1 divide-y divide-border/50">
        {contribucionesOrdenadas.map((c) => (
          <FilaContribucion
            key={c.componente}
            label={c.label}
            valorA={c.valorA}
            valorB={c.valorB}
            impacto={c.impactoEnNeto}
          />
        ))}
      </div>

      {/* Detalle por producto y gasto — separado en impulsores y frenos */}
      {comparacion.tieneDetalle ? (
        <div className="mt-5 grid grid-cols-1 gap-6 border-t border-border pt-5 sm:grid-cols-2">
          <SeccionDestacados
            titulo="Por producto"
            items={comparacion.productosDestacados}
            cambioRef={cambioRefProductos}
          />
          <SeccionDestacados
            titulo="Por categoría de gasto"
            items={comparacion.gastosDestacados}
            cambioRef={cambioRefGastos}
          />
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-border bg-surface-alt px-3 py-2 text-xs text-text-muted">
          Detalle por producto y por categoría de gasto no disponible para uno o ambos períodos
          (se congela solo a partir de cierres realizados después de esta actualización).
        </div>
      )}
    </div>
  );
}

// ─── Gráfico de área con bandas de salud para Margen Neto ───────────────

function GraficoMargenBandas({
  datos,
  bandas,
  metricas,
}: {
  datos: PeriodoCerrado[];
  bandas: BandasMargen;
  metricas: { key: keyof PeriodoCerrado; label: string; color: string; activa: boolean }[];
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);

  const W = 800;
  const H = 240;
  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 32;

  const w = W - padL - padR;
  const h = H - padT - padB;

  // Eje Y dinámico — se ajusta al rango real de los datos para que los
  // márgenes negativos sean siempre visibles, con padding de 5pp hacia abajo.
  const valoresMargen = datos.map(p => p.margenNeto);
  const maxY = 100; // siempre mostramos hasta 100%
  const minYRaw = Math.min(0, ...valoresMargen);
  const minY = Math.floor((minYRaw - 5) / 10) * 10; // pad 5pp, redondeado a décena
  const rango = maxY - minY;

  const hayNegativos = minY < 0;

  function yPos(valor: number) {
    return padT + h - ((valor - minY) / rango) * h;
  }

  function xPos(i: number) {
    return padL + (datos.length > 1 ? (i / (datos.length - 1)) * w : w / 2);
  }

  function polyline(key: keyof PeriodoCerrado) {
    return datos
      .map((p, i) => `${xPos(i).toFixed(1)},${yPos(Number(p[key]) || 0).toFixed(1)}`)
      .join(' ');
  }

  function zonaMargen(margenNeto: number) {
    if (margenNeto < 0)                       return { label: 'Pérdida',   color: '#8B0000' };
    if (margenNeto >= bandas.excelenteMinimo) return { label: 'Excelente', color: '#1D9E75' };
    if (margenNeto >= bandas.objetivoMinimo)  return { label: 'Objetivo',  color: '#1D9E75' };
    if (margenNeto >= bandas.alertaMinimo)    return { label: 'Alerta',    color: '#EAB308' };
    return                                           { label: 'Problema',  color: '#E24B4A' };
  }

  // Al mover el mouse sobre el SVG, encontramos el punto más cercano en X
  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * W;
    let closestIdx = 0;
    let closestDist = Infinity;
    datos.forEach((_, i) => {
      const dist = Math.abs(xPos(i) - mouseX);
      if (dist < closestDist) { closestDist = dist; closestIdx = i; }
    });
    setHoverId(datos[closestIdx]?.id ?? null);
  }

  // Etiquetas del eje Y cada 10pp, cubriendo el rango dinámico
  const etiquetasY: number[] = [];
  for (let v = minY; v <= maxY; v += 10) etiquetasY.push(v);

  const BANDA_PERDIDA   = 'rgba(139,0,0,0.08)';     // rojo oscuro muy suave para pérdidas
  const BANDA_PROBLEMA  = 'rgba(226,75,74,0.10)';
  const BANDA_ALERTA    = 'rgba(234,179,8,0.10)';
  const BANDA_OBJETIVO  = 'rgba(29,158,117,0.08)';
  const BANDA_EXCELENTE = 'rgba(29,158,117,0.18)';

  const hoverPeriodo = hoverId ? datos.find(p => p.id === hoverId) : null;
  const hoverIdx     = hoverId ? datos.findIndex(p => p.id === hoverId) : -1;

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-text-muted">
        {hayNegativos && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-4 rounded-sm" style={{ background: BANDA_PERDIDA }} />
            Pérdida (&lt;0%)
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm" style={{ background: BANDA_PROBLEMA }} />
          Problema (&lt;{bandas.alertaMinimo}%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm" style={{ background: BANDA_ALERTA }} />
          Alerta ({bandas.alertaMinimo}–{bandas.objetivoMinimo}%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm" style={{ background: BANDA_OBJETIVO }} />
          Objetivo ({bandas.objetivoMinimo}–{bandas.excelenteMinimo}%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm" style={{ background: BANDA_EXCELENTE }} />
          Excelente (&gt;{bandas.excelenteMinimo}%)
        </span>
      </div>

      {/* Tooltip — visible cuando hay un punto seleccionado */}
      {hoverPeriodo && (() => {
        const zona = zonaMargen(hoverPeriodo.margenNeto);
        return (
          <div className="mb-3 flex flex-wrap items-center gap-4 rounded-md bg-surface-alt px-3 py-2 text-xs">
            <span className="font-medium text-text-primary">{hoverPeriodo.label}</span>
            <span className="tabular-nums text-text-secondary">
              Ventas: <span className="text-text-primary">{formatARS(hoverPeriodo.ventas)}</span>
            </span>
            <span className="tabular-nums text-text-secondary">
              Beneficio neto: <span className="text-text-primary">{formatARS(hoverPeriodo.beneficioNeto)}</span>
            </span>
            <span className="tabular-nums text-text-secondary">
              Margen neto: <span className="font-medium text-text-primary">{hoverPeriodo.margenNeto.toFixed(1)}%</span>
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ background: zona.color + '22', color: zona.color }}
            >
              {zona.label}
            </span>
          </div>
        );
      })()}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair"
        style={{ height: H }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverId(null)}
      >
        {/* Bandas de salud */}
        {/* Pérdida (solo si hay valores negativos) */}
        {hayNegativos && (
          <rect x={padL} y={yPos(0)} width={w}
            height={yPos(minY) - yPos(0)} fill={BANDA_PERDIDA} />
        )}
        <rect x={padL} y={yPos(Math.min(bandas.alertaMinimo, maxY))} width={w}
          height={yPos(Math.max(0, minY)) - yPos(Math.min(bandas.alertaMinimo, maxY))} fill={BANDA_PROBLEMA} />
        <rect x={padL} y={yPos(Math.min(bandas.objetivoMinimo, maxY))} width={w}
          height={yPos(bandas.alertaMinimo) - yPos(Math.min(bandas.objetivoMinimo, maxY))} fill={BANDA_ALERTA} />
        <rect x={padL} y={yPos(Math.min(bandas.excelenteMinimo, maxY))} width={w}
          height={yPos(bandas.objetivoMinimo) - yPos(Math.min(bandas.excelenteMinimo, maxY))} fill={BANDA_OBJETIVO} />
        <rect x={padL} y={padT} width={w} height={yPos(bandas.excelenteMinimo) - padT} fill={BANDA_EXCELENTE} />

        {/* Línea de cero — referencia visual clave cuando hay negativos */}
        {hayNegativos && (
          <line
            x1={padL} y1={yPos(0)} x2={padL + w} y2={yPos(0)}
            stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.5}
            className="text-text-muted"
          />
        )}

        {/* Línea vertical del hover */}
        {hoverIdx >= 0 && (
          <line
            x1={xPos(hoverIdx)} y1={padT}
            x2={xPos(hoverIdx)} y2={padT + h}
            stroke="currentColor" strokeOpacity={0.2} strokeWidth={1}
            className="text-text-muted"
          />
        )}

        {/* Líneas de umbral */}
        {[bandas.alertaMinimo, bandas.objetivoMinimo, bandas.excelenteMinimo].map((v) => (
          <line key={v} x1={padL} y1={yPos(v)} x2={padL + w} y2={yPos(v)}
            stroke="currentColor" strokeOpacity={0.15} strokeWidth={1} strokeDasharray="4 3"
            className="text-text-muted" />
        ))}

        {/* Eje Y */}
        {etiquetasY.map((v) => (
          <g key={v}>
            <line x1={padL - 4} y1={yPos(v)} x2={padL} y2={yPos(v)}
              stroke="currentColor" strokeOpacity={0.2} strokeWidth={1} className="text-text-muted" />
            <text x={padL - 6} y={yPos(v)} textAnchor="end" dominantBaseline="middle"
              fontSize={9} fill="currentColor" fillOpacity={0.4} className="text-text-muted">
              {v}%
            </text>
          </g>
        ))}

        {/* Líneas de métricas */}
        {metricas.filter(m => m.activa).map((m) => (
          <polyline key={String(m.key)} points={polyline(m.key)}
            fill="none" stroke={m.color} strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" />
        ))}

        {/* Puntos — el hovered es más grande */}
        {datos.map((p, i) => {
          const esHover = p.id === hoverId;
          return (
            <circle
              key={p.id}
              cx={xPos(i)} cy={yPos(p.margenNeto)}
              r={esHover ? 5 : 3}
              fill={metricas[0].color}
              stroke={esHover ? 'white' : 'none'}
              strokeWidth={esHover ? 1.5 : 0}
            />
          );
        })}

        {/* Eje X */}
        {datos.map((p, i) => {
          const mostrar = datos.length <= 8 || i % Math.ceil(datos.length / 8) === 0 || i === datos.length - 1;
          if (!mostrar) return null;
          const partes = p.label.split('—');
          const labelCorto = partes[0]?.trim().replace(/^Vie /, '') || p.label;
          return (
            <text key={p.id} x={xPos(i)} y={H - padB + 14} textAnchor="middle" fontSize={9}
              fill="currentColor" fillOpacity={p.id === hoverId ? 0.8 : 0.4}
              fontWeight={p.id === hoverId ? 'bold' : 'normal'}
              className="text-text-muted">
              {labelCorto}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Salud de Clientes — subcomponentes y tab ────────────────────────────

const UMBRAL_MUESTRA_CONFIABLE = 30;

// Convierte +54XXXXXXXXXX a formato wa.me (sin + ni espacios)
function waLink(celular: string): string {
  const limpio = celular.replace(/[^0-9]/g, '');
  return `https://wa.me/${limpio}`;
}

// Formatea fecha ISO a string legible en es-AR
function formatFecha(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Lógica de semáforo de cartera
// Inputs: retencionCartera (%) y diff de tendencia (pp)
// Sin datos suficientes → estado especial
type EstadoCartera = 'excelente' | 'aceptable' | 'atencion' | 'critico' | 'sin_datos';

function calcularEstadoCartera(
  retencionCartera: number,
  diffTendencia: number,
  sinDatosTendencia: boolean
): EstadoCartera {
  if (retencionCartera === 0) return 'sin_datos';
  if (retencionCartera >= 60 && (sinDatosTendencia || diffTendencia >= -2)) return 'excelente';
  if (retencionCartera >= 40 && (sinDatosTendencia || diffTendencia >= -5)) return 'aceptable';
  if (retencionCartera >= 40 && diffTendencia < -5) return 'atencion';
  if (retencionCartera < 40 && (sinDatosTendencia || diffTendencia >= -2)) return 'atencion';
  return 'critico';
}

const CONFIG_SEMAFORO: Record<EstadoCartera, {
  icono: string;
  label: string;
  claseIcono: string;
  claseFondo: string;
  claseBorde: string;
}> = {
  excelente:  { icono: '●', label: 'Excelente',  claseIcono: 'text-positive',    claseFondo: 'bg-positive-bg',  claseBorde: 'border-positive/30'  },
  aceptable:  { icono: '●', label: 'Aceptable',  claseIcono: 'text-positive',    claseFondo: 'bg-surface',      claseBorde: 'border-border'        },
  atencion:   { icono: '●', label: 'Atención',   claseIcono: 'text-warning',     claseFondo: 'bg-warning-bg',   claseBorde: 'border-warning/30'    },
  critico:    { icono: '●', label: 'Crítico',    claseIcono: 'text-negative',    claseFondo: 'bg-negative-bg',  claseBorde: 'border-negative/30'   },
  sin_datos:  { icono: '○', label: 'Sin datos',  claseIcono: 'text-text-muted',  claseFondo: 'bg-surface-alt',  claseBorde: 'border-border'        },
};

function etiquetaTendencia(diff: number): { label: string; color: string } {
  if (diff <= -5)  return { label: 'Deterioro significativo', color: 'text-negative' };
  if (diff < -2)   return { label: 'Leve deterioro',          color: 'text-warning'  };
  if (diff <= 2)   return { label: 'Estable',                 color: 'text-text-muted' };
  return               { label: 'Mejorando',                  color: 'text-positive'  };
}

function CardCategoria({
  label, valor, descripcion, color,
}: {
  label: string; valor: number; descripcion: string; color: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs text-text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{valor}</div>
      <div className="mt-1 text-xs text-text-secondary">{descripcion}</div>
    </div>
  );
}

function MetricaCliente({
  label, valor, subtexto,
}: {
  label: string; valor: string; subtexto?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-text-primary">{valor}</div>
      {subtexto && <div className="mt-1 text-xs text-text-secondary">{subtexto}</div>}
    </div>
  );
}

// Fila de tendencia — layout visual de tres columnas: anterior → actual → variación+etiqueta
function FilaTendencia({
  label, actual, anterior, formato, muestraActual, muestraAnterior,
}: {
  label: string;
  actual: number;
  anterior: number;
  formato: (n: number) => string;
  muestraActual: number;
  muestraAnterior: number;
}) {
  const diff = actual - anterior;
  const sinCambio = Math.abs(diff) < 0.05;
  const muestraInsuficiente =
    muestraActual < UMBRAL_MUESTRA_CONFIABLE || muestraAnterior < UMBRAL_MUESTRA_CONFIABLE;
  const { label: etiqueta, color: etiquetaColor } = etiquetaTendencia(diff);
  const colorDiff = sinCambio ? 'text-text-muted' : diff > 0 ? 'text-positive' : 'text-negative';

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="mb-2 text-xs font-medium text-text-secondary">{label}</div>
      <div className="flex items-center gap-3">
        {/* Anterior */}
        <div className="text-center">
          <div className="text-xs text-text-muted">Anterior</div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums text-text-secondary">
            {formato(anterior)}
          </div>
        </div>
        {/* Flecha */}
        <div className={`text-2xl ${colorDiff}`}>→</div>
        {/* Actual */}
        <div className="text-center">
          <div className="text-xs text-text-muted">Actual</div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums text-text-primary">
            {formato(actual)}
          </div>
        </div>
        {/* Separador */}
        <div className="mx-1 h-8 w-px bg-border" />
        {/* Variación + etiqueta */}
        <div>
          <div className={`text-xl font-bold tabular-nums ${colorDiff}`}>
            {sinCambio ? '—' : diff > 0 ? '+' : ''}{diff.toFixed(1)} pp
          </div>
          <div className={`mt-0.5 text-xs font-medium ${
            muestraInsuficiente ? 'text-warning' : sinCambio ? 'text-text-muted' : etiquetaColor
          }`}>
            {muestraInsuficiente ? '⚠ muestra pequeña' : sinCambio ? 'Sin cambio' : etiqueta}
          </div>
        </div>
      </div>
      {muestraInsuficiente && (
        <div className="mt-1.5 text-xs text-text-muted">
          Anterior: {muestraAnterior} clientes · Actual: {muestraActual} clientes
        </div>
      )}
    </div>
  );
}

// Modal de clientes de alto valor en riesgo
function ModalAltoValor({
  clientes,
  ventanaDias,
  onClose,
  onContactar,
}: {
  clientes: ClienteValioso[];
  ventanaDias: number;
  onClose: () => void;
  onContactar: (c: ClienteValioso) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-lg border border-border bg-surface p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              Clientes de alto valor en riesgo
            </h3>
            <p className="mt-0.5 text-xs text-text-muted">
              3+ pedidos · último hace más de {ventanaDias} días · ordenados por urgencia
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-alt hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="pb-2 font-medium">Nombre</th>
                <th className="pb-2 text-right font-medium">Pedidos</th>
                <th className="pb-2 text-right font-medium">Facturación acumulada</th>
                <th className="pb-2 text-right font-medium">Sin comprar</th>
                <th className="pb-2 text-center font-medium">Contacto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {clientes.map((c, i) => (
                <tr key={i}>
                  <td className="py-2.5 text-text-primary">{c.nombre || '—'}</td>
                  <td className="py-2.5 text-right tabular-nums text-text-secondary">
                    {c.totalPedidos}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-text-primary">
                    {formatARS(c.ventasTotales)}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    <span className={`font-medium ${
                      (c.diasSinComprar ?? 0) > ventanaDias * 2 ? 'text-negative'
                      : 'text-warning'
                    }`}>
                      {c.diasSinComprar ?? '—'} días
                    </span>
                  </td>
                  <td className="py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {c.celular ? (
                        <a
                          href={waLink(c.celular)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-alt hover:text-text-primary"
                        >
                          WhatsApp
                        </a>
                      ) : (
                        <span className="text-xs text-text-muted">Sin teléfono</span>
                      )}
                      {c.clienteId && (
                        <button
                          onClick={() => onContactar(c)}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-alt hover:text-text-primary"
                        >
                          Registrar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Sección: entraron en riesgo esta semana ───────────────────────────────

function SeccionNuevosEnRiesgo({
  clientes,
  ventanaDias,
  onContactar,
}: {
  clientes: ClienteValioso[];
  ventanaDias: number;
  onContactar: (c: ClienteValioso) => void;
}) {
  if (clientes.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4 text-sm text-text-muted">
        Nadie cruzó a &quot;en riesgo&quot; en los últimos 7 días.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-text-primary">Entraron en riesgo esta semana</h3>
        <p className="mt-0.5 text-xs text-text-muted">
          Cruzaron los {ventanaDias} días sin comprar en los últimos 7 días — todavía frescos para contactar.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted">
              <th className="pb-2 font-medium">Nombre</th>
              <th className="pb-2 text-right font-medium">Pedidos</th>
              <th className="pb-2 text-right font-medium">Sin comprar</th>
              <th className="pb-2 text-center font-medium">Contacto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {clientes.map((c, i) => (
              <tr key={i}>
                <td className="py-2.5 text-text-primary">{c.nombre || '—'}</td>
                <td className="py-2.5 text-right tabular-nums text-text-secondary">{c.totalPedidos}</td>
                <td className="py-2.5 text-right tabular-nums font-medium text-warning">
                  {c.diasSinComprar ?? '—'} días
                </td>
                <td className="py-2.5 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    {c.celular ? (
                      <a
                        href={waLink(c.celular)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-alt hover:text-text-primary"
                      >
                        WhatsApp
                      </a>
                    ) : (
                      <span className="text-xs text-text-muted">Sin teléfono</span>
                    )}
                    {c.clienteId && (
                      <button
                        onClick={() => onContactar(c)}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-alt hover:text-text-primary"
                      >
                        Registrar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Panel: historial de contacto + registrar nuevo ────────────────────────

const METODOS_CONTACTO: { value: MetodoContacto; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'llamada', label: 'Llamada' },
  { value: 'otro', label: 'Otro' },
];

function PanelContactoCliente({
  cliente,
  onClose,
}: {
  cliente: { id: string; nombre: string } | null;
  onClose: () => void;
}) {
  const [contactos, setContactos] = useState<ClienteContacto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();
  const { show, Toast } = useToast();

  useEffect(() => {
    if (!cliente) return;
    setLoaded(false);
    obtenerContactosCliente(cliente.id).then((data) => {
      setContactos(data);
      setLoaded(true);
    });
  }, [cliente]);

  if (!cliente) return null;

  function handleGuardar(fd: FormData) {
    startTransition(async () => {
      const r = await registrarContacto({
        clienteId: cliente!.id,
        fecha: fd.get('fecha') as string,
        metodo: fd.get('metodo') as MetodoContacto,
        nota: (fd.get('nota') as string)?.trim() || null,
      });
      if (r.error) { show(r.error, 'error'); return; }
      show('Contacto registrado');
      const data = await obtenerContactosCliente(cliente!.id);
      setContactos(data);
    });
  }

  return (
    <SidePanel open={!!cliente} onClose={onClose} title={`Contacto — ${cliente.nombre || 'Cliente'}`}>
      <div className="space-y-6">
        <form action={handleGuardar} className="space-y-3">
          <Field label="Fecha">
            <Input name="fecha" type="date" required defaultValue={new Date().toISOString().split('T')[0]} />
          </Field>
          <Field label="Medio">
            <Select name="metodo" defaultValue="whatsapp">
              {METODOS_CONTACTO.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Nota (opcional)">
            <Input name="nota" placeholder="Ej: le ofrecí 2x1 en hamburguesas" />
          </Field>
          <Button type="submit" disabled={pending} className="w-full">
            Registrar contacto
          </Button>
        </form>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
            Historial
          </h4>
          {!loaded ? (
            <p className="text-sm text-text-muted">Cargando...</p>
          ) : contactos.length === 0 ? (
            <p className="text-sm text-text-muted">Todavía no se registró ningún contacto.</p>
          ) : (
            <div className="space-y-2">
              {contactos.map((c) => (
                <div key={c.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-text-primary">{formatDate(c.fecha)}</span>
                    <div className="flex items-center gap-2">
                      <Badge color="gray">{METODOS_CONTACTO.find((m) => m.value === c.metodo)?.label ?? c.metodo}</Badge>
                      <Badge color={c.volvioAComprar ? 'green' : 'yellow'}>
                        {c.volvioAComprar ? 'Volvió a comprar' : 'Sin compra todavía'}
                      </Badge>
                    </div>
                  </div>
                  {c.nota && <p className="mt-1 text-text-secondary">{c.nota}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <Toast />
    </SidePanel>
  );
}

function TabSaludClientes({
  salud,
  loading,
}: {
  salud: SaludClientes | null;
  loading: boolean;
}) {
  const [modalAltoValorAbierto, setModalAltoValorAbierto] = useState(false);
  const [contactoCliente, setContactoCliente] = useState<{ id: string; nombre: string } | null>(null);

  function handleContactar(c: ClienteValioso) {
    if (!c.clienteId) return;
    setContactoCliente({ id: c.clienteId, nombre: c.nombre });
  }

  if (loading) {
    return <div className="py-12 text-center text-sm text-text-muted">Cargando salud de clientes…</div>;
  }
  if (!salud) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm text-text-muted">No se pudo cargar la información de clientes.</p>
      </div>
    );
  }

  const conVeredicto = salud.activo + salud.enRiesgo + salud.nuevoPerdido;
  const historialCorto = salud.tendAnterior.nClientes < UMBRAL_MUESTRA_CONFIABLE;
  const diffTendencia = salud.tendActual.tasaRetencion - salud.tendAnterior.tasaRetencion;
  const sinDatosTendencia = salud.tendAnterior.nClientes === 0;
  const estadoCartera = calcularEstadoCartera(salud.retencionCartera, diffTendencia, sinDatosTendencia);
  const cfg = CONFIG_SEMAFORO[estadoCartera];

  // Frase del semáforo: basada 100% en los números, sin adjetivos inventados
  function fraseSemaforo(s: SaludClientes): string {
    const partes: string[] = [];
    partes.push(`Retención de cartera ${s.retencionCartera.toFixed(1)}%`);
    if (!sinDatosTendencia) {
      const { label } = etiquetaTendencia(diffTendencia);
      partes.push(`${label.toLowerCase()} en tendencia reciente (${diffTendencia > 0 ? '+' : ''}${diffTendencia.toFixed(1)} pp)`);
    } else {
      partes.push('tendencia sin datos suficientes');
    }
    if (s.altoValorEnRiesgo > 0) {
      partes.push(`${s.altoValorEnRiesgo} cliente${s.altoValorEnRiesgo !== 1 ? 's' : ''} de alto valor sin volver`);
    }
    return partes.join(', ') + '.';
  }

  return (
    <div className="space-y-5">

      {/* ── Semáforo de cartera ─────────────────────────────────────────── */}
      <div className={`rounded-lg border p-5 ${cfg.claseFondo} ${cfg.claseBorde}`}>
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm ${cfg.claseIcono} bg-white/60`}>
            {cfg.icono}
          </span>
          <div className="flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className={`text-sm font-bold ${cfg.claseIcono}`}>{cfg.label}</span>
              <span className="text-sm text-text-primary">{fraseSemaforo(salud)}</span>
            </div>
            {salud.altoValorEnRiesgo > 0 && (
              <button
                onClick={() => setModalAltoValorAbierto(true)}
                className="mt-2 text-xs font-medium text-text-secondary underline underline-offset-2 hover:text-text-primary"
              >
                Ver {salud.altoValorEnRiesgo} cliente{salud.altoValorEnRiesgo !== 1 ? 's' : ''} →
              </button>
            )}
          </div>
          <div className="flex-shrink-0 text-right">
            <div className={`text-2xl font-bold tabular-nums ${cfg.claseIcono}`}>
              {salud.retencionCartera.toFixed(1)}%
            </div>
            <div className="mt-0.5 text-xs text-text-muted">retención de cartera</div>
          </div>
        </div>
      </div>

      {/* ── Entraron en riesgo esta semana ──────────────────────────────── */}
      <SeccionNuevosEnRiesgo
        clientes={salud.nuevosEnRiesgoDetalle}
        ventanaDias={salud.ventanaDias}
        onContactar={handleContactar}
      />

      {/* Aviso de historial corto */}
      {historialCorto && (
        <div className="rounded-md border border-border bg-warning-bg px-4 py-3 text-xs text-warning">
          <span className="font-medium">Historial todavía corto.</span>{' '}
          La ventana anterior tiene solo {salud.tendAnterior.nClientes} cliente
          {salud.tendAnterior.nClientes !== 1 ? 's' : ''} — las tendencias son orientativas.
        </div>
      )}

      {/* ── Categorías de clientes ─────────────────────────────────────── */}
      <div>
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold text-text-primary">Estado de la base de clientes</h3>
          <span className="text-xs text-text-muted">
            {salud.totalUnicos} clientes únicos · ventana de recompra esperada:{' '}
            <span className="font-medium">{salud.ventanaDias} días</span>
            {salud.medianaDiasEntreCompras > 0 && (
              <> (mediana real: {salud.medianaDiasEntreCompras} días · promedio: {salud.promedioDiasEntreCompras} días)</>
            )}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <CardCategoria label="Activos" valor={salud.activo}
            descripcion={`2+ pedidos, último hace <${salud.ventanaDias} días`} color="text-positive" />
          <CardCategoria label="En riesgo" valor={salud.enRiesgo}
            descripcion={`2+ pedidos, último hace >${salud.ventanaDias} días`} color="text-warning" />
          <CardCategoria label="Nuevo perdido" valor={salud.nuevoPerdido}
            descripcion={`1 pedido, hace >${salud.ventanaDias} días`} color="text-negative" />
          <CardCategoria label="Reciente sin veredicto" valor={salud.recienteSinVeredicto}
            descripcion={`1er pedido hace <${salud.ventanaDias} días`} color="text-text-muted" />
        </div>
        {salud.recienteSinVeredicto > 0 && (
          <p className="mt-2 text-xs text-text-muted">
            Los {salud.recienteSinVeredicto} clientes recientes no participan de las métricas de retención — todavía no tuvieron tiempo de volver.
          </p>
        )}
      </div>

      {/* ── Clientes de alto valor en riesgo ──────────────────────────── */}
      {salud.altoValorEnRiesgo > 0 ? (
        <div className="rounded-lg border border-negative bg-negative-bg p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-lg">⚠</span>
              <div>
                <div className="text-sm font-semibold text-negative">
                  {salud.altoValorEnRiesgo} cliente{salud.altoValorEnRiesgo !== 1 ? 's' : ''} de alto valor en riesgo
                </div>
                <div className="mt-1 text-xs text-text-secondary">
                  3+ pedidos · hace más de {salud.ventanaDias} días sin volver ·{' '}
                  facturación histórica acumulada: <span className="font-medium">{formatARS(salud.altoValorVentasHistoricas)}</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setModalAltoValorAbierto(true)}
              className="flex-shrink-0 rounded-md border border-negative/40 bg-white/40 px-3 py-1.5 text-xs font-medium text-negative hover:bg-white/60"
            >
              Ver lista →
            </button>
          </div>
        </div>
      ) : salud.enRiesgo > 0 ? (
        <div className="rounded-md border border-border bg-positive-bg px-4 py-2.5 text-xs text-positive">
          ✓ Ningún cliente de 3+ pedidos está en riesgo actualmente.
        </div>
      ) : null}

      {/* ── Historial de clientes en riesgo ───────────────────────────── */}
      {salud.enRiesgo > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">
            Historial de clientes en riesgo
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-text-muted">Facturación acumulada</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                {formatARS(salud.enRiesgoVentasHistoricas)}
              </div>
              <div className="mt-0.5 text-xs text-text-muted">del total que gastaron</div>
            </div>
            <div>
              <div className="text-xs text-text-muted">Ticket promedio histórico</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                {formatARS(salud.enRiesgoTicketPromedio)}
              </div>
              <div className="mt-0.5 text-xs text-text-muted">por pedido en toda su historia</div>
            </div>
            <div>
              <div className="text-xs text-text-muted">Pedidos acumulados</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                {salud.enRiesgoPedidosTotales}
              </div>
              <div className="mt-0.5 text-xs text-text-muted">en total entre los {salud.enRiesgo} clientes</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-text-muted">
            Datos históricos acumulados de los {salud.enRiesgo} clientes en riesgo — no son una proyección de pérdida futura.
          </p>
        </div>
      )}

      {/* ── Métricas de retención ──────────────────────────────────────── */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-text-primary">Métricas de retención</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricaCliente label="Retención de cartera" valor={`${salud.retencionCartera.toFixed(1)}%`}
            subtexto="activos / (activos + en riesgo)" />
          <MetricaCliente label="% facturación de repetidores" valor={`${salud.pctFacturacionRepetidores.toFixed(1)}%`}
            subtexto={formatARS(salud.ventasRepetidores)} />
          <MetricaCliente label="% clientes repetidores" valor={`${salud.pctClientesRepetidores.toFixed(1)}%`}
            subtexto={`sobre ${conVeredicto} con veredicto`} />
          <MetricaCliente label="Tasa de retención" valor={`${salud.tasaRetencion.toFixed(1)}%`}
            subtexto="volvieron al menos 1 vez" />
        </div>
      </div>

      {/* ── Tendencia ─────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-text-primary">Tendencia — ventanas de 28 días</h3>
          <span className="text-xs text-text-muted">Universo: clientes con primer pedido en cada ventana</span>
        </div>
        <p className="mb-5 text-xs text-text-muted">
          ¿Qué fracción de los clientes nuevos de cada período volvió a comprar?
        </p>
        <div className="divide-y divide-border/50">
          <FilaTendencia
            label="Tasa de retención de primera compra"
            actual={salud.tendActual.tasaRetencion}
            anterior={salud.tendAnterior.tasaRetencion}
            formato={(n) => `${n.toFixed(1)}%`}
            muestraActual={salud.tendActual.nClientes}
            muestraAnterior={salud.tendAnterior.nClientes}
          />
          <FilaTendencia
            label="% facturación de repetidores"
            actual={salud.tendActual.pctFacturacion}
            anterior={salud.tendAnterior.pctFacturacion}
            formato={(n) => `${n.toFixed(1)}%`}
            muestraActual={salud.tendActual.nClientes}
            muestraAnterior={salud.tendAnterior.nClientes}
          />
        </div>
        {/* Tamaños de muestra como contexto secundario */}
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4">
          <div className="rounded-md bg-surface-alt p-3 text-xs">
            <div className="font-medium text-text-secondary">Ventana anterior</div>
            <div className="mt-1 text-text-muted">
              {new Date(salud.tendAnterior.desde).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
              {' – '}
              {new Date(salud.tendAnterior.hasta).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
            </div>
            <div className="mt-2 tabular-nums text-text-primary">
              <span className="text-lg font-semibold">{salud.tendAnterior.nClientes}</span>
              <span className="ml-1 text-text-muted">clientes</span>
              {' · '}
              <span>{salud.tendAnterior.nRetuvieron} retuvieron</span>
            </div>
            {salud.tendAnterior.nClientes < UMBRAL_MUESTRA_CONFIABLE && (
              <div className="mt-0.5 text-warning">· muestra pequeña</div>
            )}
          </div>
          <div className="rounded-md bg-surface-alt p-3 text-xs">
            <div className="font-medium text-text-secondary">Ventana actual</div>
            <div className="mt-1 text-text-muted">
              {new Date(salud.tendActual.desde).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
              {' – '}
              {new Date(salud.tendActual.hasta).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
            </div>
            <div className="mt-2 tabular-nums text-text-primary">
              <span className="text-lg font-semibold">{salud.tendActual.nClientes}</span>
              <span className="ml-1 text-text-muted">clientes</span>
              {' · '}
              <span>{salud.tendActual.nRetuvieron} retuvieron</span>
            </div>
            {salud.tendActual.nClientes < UMBRAL_MUESTRA_CONFIABLE && (
              <div className="mt-0.5 text-warning">· muestra pequeña</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Clientes más valiosos ──────────────────────────────────────── */}
      {salud.topRepetidores.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Clientes más valiosos</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="pb-2 font-medium">Nombre</th>
                <th className="pb-2 text-right font-medium">Pedidos</th>
                <th className="pb-2 text-right font-medium">Facturación acumulada</th>
                <th className="pb-2 text-right font-medium">Último pedido</th>
                <th className="pb-2 text-center font-medium">Contacto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {salud.topRepetidores.map((c, i) => (
                <tr key={i}>
                  <td className="py-2.5 text-text-primary">{c.nombre || '—'}</td>
                  <td className="py-2.5 text-right tabular-nums text-text-secondary">{c.totalPedidos}</td>
                  <td className="py-2.5 text-right tabular-nums text-text-primary">{formatARS(c.ventasTotales)}</td>
                  <td className="py-2.5 text-right tabular-nums text-text-muted">{formatFecha(c.ultimoPedido)}</td>
                  <td className="py-2.5 text-center">
                    {c.celular ? (
                      <a
                        href={waLink(c.celular)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-surface-alt hover:text-text-primary"
                      >
                        WhatsApp
                      </a>
                    ) : (
                      <span className="text-xs text-text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de alto valor en riesgo */}
      {modalAltoValorAbierto && salud.altoValorDetalle.length > 0 && (
        <ModalAltoValor
          clientes={salud.altoValorDetalle}
          ventanaDias={salud.ventanaDias}
          onClose={() => setModalAltoValorAbierto(false)}
          onContactar={handleContactar}
        />
      )}

      <PanelContactoCliente cliente={contactoCliente} onClose={() => setContactoCliente(null)} />

    </div>
  );
}


// ─── Tab Tabla Semanal ──────────────────────────────────────────────────

function exportarCSV(periodos: PeriodoCerrado[]) {
  // CSV puro — sin dependencias externas, sin imports dinámicos.
  // Excel, Google Sheets y Numbers lo abren directamente.
  const encabezado = [
    'Semana',
    'Pedidos',
    'Ventas',
    'Ben. bruto',
    'Margen bruto %',
    'Publicidad %',
    'ROAS',
    'Result. delivery',
    'Ben. neto',
    'Margen neto %',
    'Ticket promedio',
    'Hamb. vendidas',
  ].join(',');

  const filas = periodos.map((p) =>
    [
      `"${p.label}"`,
      p.pedidos,
      p.ventas,
      p.beneficioBruto,
      p.margenBruto.toFixed(1),
      p.publicidadPct.toFixed(1),
      p.roas.toFixed(2),
      p.resultadoDelivery,
      p.beneficioNeto,
      p.margenNeto.toFixed(1),
      p.ticketPromedio.toFixed(0),
      p.hamburguesasVendidas,
    ].join(',')
  );

  const csv = [encabezado, ...filas].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `royalty-evolucion-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function colorMargen(margen: number, bandas: BandasMargen | null): string {
  if (!bandas) return 'text-text-primary';
  if (margen >= bandas.excelenteMinimo) return 'text-positive';
  if (margen >= bandas.objetivoMinimo)  return 'text-positive';
  if (margen >= bandas.alertaMinimo)    return 'text-warning';
  if (margen >= 0)                      return 'text-warning';
  return 'text-negative';
}

function bgMargen(margen: number, bandas: BandasMargen | null): string {
  if (!bandas) return '';
  if (margen >= bandas.excelenteMinimo) return 'bg-positive-bg';
  if (margen >= bandas.objetivoMinimo)  return 'bg-positive-bg';
  if (margen >= bandas.alertaMinimo)    return 'bg-warning-bg';
  if (margen >= 0)                      return 'bg-warning-bg';
  return 'bg-negative-bg';
}

function AccionEliminarCierre({ periodo, onEliminado }: { periodo: PeriodoCerrado; onEliminado: () => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [pending, setPending] = useState(false);
  const { show, Toast } = useToast();

  async function handleConfirmar() {
    setPending(true);
    const r = await eliminarCierre(periodo.id);
    setPending(false);
    if (!r.ok) { show(r.mensaje, 'error'); return; }
    show('Cierre eliminado. Podés corregir los gastos y volver a cerrar la semana.');
    setConfirmando(false);
    onEliminado();
  }

  if (confirmando) {
    return (
      <div className="flex items-center justify-end gap-2 whitespace-nowrap">
        <span className="text-[11px] text-negative">¿Borrar el snapshot de esta semana?</span>
        <button
          onClick={handleConfirmar}
          disabled={pending}
          className="rounded-md bg-negative px-2 py-1 text-[11px] font-medium text-white hover:opacity-90"
        >
          {pending ? '...' : 'Sí, eliminar'}
        </button>
        <button
          onClick={() => setConfirmando(false)}
          disabled={pending}
          className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-alt"
        >
          Cancelar
        </button>
        <Toast />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end">
      <button
        onClick={() => setConfirmando(true)}
        className="text-[11px] text-text-muted underline underline-offset-2 hover:text-negative"
        title="Elimina el cierre congelado de esta semana para poder corregirla y volver a cerrarla"
      >
        Eliminar cierre
      </button>
      <Toast />
    </div>
  );
}

function TabTablaSemanal({
  periodos,
  bandas,
  onEliminado,
}: {
  periodos: PeriodoCerrado[];
  bandas: BandasMargen | null;
  onEliminado: () => void;
}) {
  if (periodos.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm text-text-muted">
          No hay semanas cerradas todavía. Cerrá la primera semana para ver la evolución aquí.
        </p>
      </div>
    );
  }

  // Promedios para la fila de resumen
  const n = periodos.length;
  const avg = (fn: (p: PeriodoCerrado) => number) =>
    periodos.reduce((s, p) => s + fn(p), 0) / n;
  const sum = (fn: (p: PeriodoCerrado) => number) =>
    periodos.reduce((s, p) => s + fn(p), 0);

  // Mostrar más reciente primero en la tabla
  const ordenadas = [...periodos].reverse();

  return (
    <div className="space-y-3">
      {/* Header con botón de exportación */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">
          {n} semana{n !== 1 ? 's' : ''} cerrada{n !== 1 ? 's' : ''} · más reciente primero
        </p>
        <button
          onClick={() => exportarCSV(periodos)}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-alt hover:text-text-primary"
        >
          ↓ Exportar CSV
        </button>
      </div>

      {/* Tabla — scroll horizontal en pantallas chicas */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-alt text-left text-xs text-text-muted">
              <th className="px-3 py-2.5 font-medium">Semana</th>
              <th className="px-3 py-2.5 text-right font-medium">Pedidos</th>
              <th className="px-3 py-2.5 text-right font-medium">Ventas</th>
              <th className="px-3 py-2.5 text-right font-medium">Ben. bruto</th>
              <th className="px-3 py-2.5 text-right font-medium">Mg. bruto</th>
              <th className="px-3 py-2.5 text-right font-medium">Publicidad</th>
              <th className="px-3 py-2.5 text-right font-medium">ROAS</th>
              <th className="px-3 py-2.5 text-right font-medium">Delivery</th>
              <th className="px-3 py-2.5 text-right font-medium">Ben. neto</th>
              <th className="px-3 py-2.5 text-right font-medium">Mg. neto</th>
              <th className="px-3 py-2.5 text-right font-medium">Ticket prom.</th>
              <th className="px-3 py-2.5 text-right font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {ordenadas.map((p) => (
              <tr key={p.id} className="hover:bg-surface-alt/50">
                <td className="px-3 py-2 text-xs text-text-secondary">{p.label}</td>
                <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{p.pedidos}</td>
                <td className="px-3 py-2 text-right tabular-nums text-text-primary font-medium">
                  {formatARS(p.ventas)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                  {formatARS(p.beneficioBruto)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                  {p.margenBruto.toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                  {p.publicidadPct.toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                  {p.roas.toFixed(2)}x
                </td>
                <td className={`px-3 py-2 text-right tabular-nums font-medium ${
                  p.resultadoDelivery >= 0 ? 'text-positive' : 'text-negative'
                }`}>
                  {p.resultadoDelivery >= 0 ? '+' : ''}{formatARS(p.resultadoDelivery)}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums font-medium ${
                  p.beneficioNeto >= 0 ? 'text-positive' : 'text-negative'
                }`}>
                  {formatARS(p.beneficioNeto)}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums font-semibold rounded-sm ${colorMargen(p.margenNeto, bandas)} ${bgMargen(p.margenNeto, bandas)}`}>
                  {p.margenNeto.toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                  {formatARS(p.ticketPromedio)}
                </td>
                <td className="px-3 py-2 text-right">
                  <AccionEliminarCierre periodo={p} onEliminado={onEliminado} />
                </td>
              </tr>
            ))}
          </tbody>
          {/* Fila de promedios */}
          <tfoot>
            <tr className="border-t-2 border-border bg-surface-alt font-medium text-xs">
              <td className="px-3 py-2.5 text-text-muted">Promedio ({n} sem.)</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                {Math.round(avg(p => p.pedidos))}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-text-primary">
                {formatARS(avg(p => p.ventas))}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                {formatARS(avg(p => p.beneficioBruto))}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                {avg(p => p.margenBruto).toFixed(1)}%
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                {avg(p => p.publicidadPct).toFixed(1)}%
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                {avg(p => p.roas).toFixed(2)}x
              </td>
              <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${
                avg(p => p.resultadoDelivery) >= 0 ? 'text-positive' : 'text-negative'
              }`}>
                {avg(p => p.resultadoDelivery) >= 0 ? '+' : ''}{formatARS(avg(p => p.resultadoDelivery))}
              </td>
              <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${
                avg(p => p.beneficioNeto) >= 0 ? 'text-positive' : 'text-negative'
              }`}>
                {formatARS(avg(p => p.beneficioNeto))}
              </td>
              <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${
                colorMargen(avg(p => p.margenNeto), bandas)
              }`}>
                {avg(p => p.margenNeto).toFixed(1)}%
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                {formatARS(avg(p => p.ticketPromedio))}
              </td>
              <td className="px-3 py-2.5"></td>
            </tr>
          </tfoot>
        </table>
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

  const { show: showToast, Toast } = useToast();

  // ── Cierre de período ───────────────────────────────────────────────
  const [periodoCerradoActual, setPeriodoCerradoActual] = useState<PeriodoCerrado | null>(null);
  const [modalCierreAbierto, setModalCierreAbierto] = useState(false);
  const [validacionCierre, setValidacionCierre] = useState<ValidacionCierre | null>(null);
  const [validandoCierre, setValidandoCierre] = useState(false);
  // Aviso opcional post-cierre — no forma parte de la lógica de cierre,
  // es un paso adicional que se puede ignorar sin consecuencias.
  const [decisionesLabPendientes, setDecisionesLabPendientes] = useState(0);
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);

  // ── Evolución ────────────────────────────────────────────────────────
  const [evolucionTab, setEvolucionTab] = useState<'resumen' | 'rentabilidad' | 'clientes' | 'tabla'>('resumen');
  const [evolucionCantidad, setEvolucionCantidad] = useState<number | null>(8);
  const [evolucionDatos, setEvolucionDatos] = useState<PeriodoCerrado[]>([]);
  const [records, setRecords] = useState<{
    ventas: RecordHistorico | null;
    beneficioNeto: RecordHistorico | null;
    hamburguesasVendidas: RecordHistorico | null;
  } | null>(null);
  const [bandasMargen, setBandasMargen] = useState<BandasMargen | null>(null);
  const [loadingEvolucion, setLoadingEvolucion] = useState(true);

  // ── Salud de Clientes ────────────────────────────────────────────────
  // Carga independiente del rango — es un análisis en vivo, no por período.
  const [saludClientes, setSaludClientes] = useState<SaludClientes | null>(null);
  const [loadingSalud, setLoadingSalud] = useState(true);

  // ── Auditoría Financiera Inteligente ────────────────────────────────
  const [semaforoEnVivo, setSemaforoEnVivo] = useState<Semaforo | null>(null);
  const [comparacionReciente, setComparacionReciente] = useState<ComparacionPeriodos | null>(
    null
  );
  const [loadingAuditoria, setLoadingAuditoria] = useState(true);

  async function loadAuditoria(kpisActual: KpisConDelta | null) {
    setLoadingAuditoria(true);
    try {
      const [comparacion] = await Promise.all([compararUltimasDosSemanas()]);
      setComparacionReciente(comparacion);

      if (kpisActual) {
        const sem = await obtenerSemaforoEnVivo(kpisActual.actual);
        setSemaforoEnVivo(sem);
      }
    } catch {
      // La Auditoría no es crítica para el resto del dashboard — si falla,
      // simplemente no se muestra esa sección.
      setComparacionReciente(null);
      setSemaforoEnVivo(null);
    } finally {
      setLoadingAuditoria(false);
    }
  }

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

      if (requestId === requestIdRef.current) {
        loadAuditoria(kpisData);
      }

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
      const [datos, recordsData, bandas] = await Promise.all([
        obtenerEvolucion(evolucionCantidad),
        obtenerRecords(),
        obtenerBandasMargen(),
      ]);
      setEvolucionDatos(datos);
      setRecords(recordsData);
      setBandasMargen(bandas);
    } catch {
      setEvolucionDatos([]);
    } finally {
      setLoadingEvolucion(false);
    }
  }

  useEffect(() => {
    loadEvolucion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evolucionCantidad]);

  async function loadSaludClientes() {
    setLoadingSalud(true);
    try {
      const data = await obtenerSaludClientes();
      setSaludClientes(data);
    } catch {
      setSaludClientes(null);
    } finally {
      setLoadingSalud(false);
    }
  }

  useEffect(() => {
    loadSaludClientes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const r = await cerrarPeriodo(rango, kpis.actual, ranking, gastos);
      if (!r.ok) {
        showToast(r.mensaje, 'error');
      } else {
        showToast('Semana cerrada correctamente, con detalle de productos y gastos');
        setModalCierreAbierto(false);
        const periodo = await obtenerPeriodoActual(rango.desde, rango.hasta);
        setPeriodoCerradoActual(periodo);
        loadEvolucion();
        loadAuditoria(kpis);

        // Paso adicional opcional, no bloqueante — si falla, no afecta el
        // cierre que ya se confirmó arriba.
        try {
          const n = await contarDecisionesEvaluablesTrasCierre(rango.desde);
          setDecisionesLabPendientes(n);
        } catch {
          setDecisionesLabPendientes(0);
        }
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al cerrar el período', 'error');
    } finally {
      setConfirmandoCierre(false);
    }
  }

  return (
    <div className="space-y-6" id="dashboard-root">
      {/* ── Cabecera visible solo en impresión ──────────────────────── */}
      <div data-print="only" className="hidden border-b border-border pb-4 mb-2">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xl font-bold text-text-primary">Royalty Burgers</div>
            <div className="mt-0.5 text-sm text-text-secondary">Resumen ejecutivo de gestión</div>
          </div>
          <div className="text-right text-sm text-text-muted">
            <div className="font-medium text-text-primary">{rango.label}</div>
            <div>Generado el {new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
          </div>
        </div>
      </div>

      {/* ── Aviso post-cierre: decisiones del Laboratorio listas para evaluar ── */}
      {decisionesLabPendientes > 0 && (
        <div data-print="hidden" className="flex items-center justify-between gap-3 rounded-lg border border-border bg-brand-light px-4 py-3 text-sm">
          <span className="text-text-primary">
            Semana cerrada. Hay {decisionesLabPendientes} decisión{decisionesLabPendientes !== 1 ? 'es' : ''} del Laboratorio
            lista{decisionesLabPendientes !== 1 ? 's' : ''} para evaluar con estos resultados.
          </span>
          <div className="flex items-center gap-3 shrink-0">
            <Link href="/laboratorio" className="font-medium text-text-primary underline underline-offset-2 hover:no-underline">
              Ir a Laboratorio →
            </Link>
            <button
              onClick={() => setDecisionesLabPendientes(0)}
              className="text-text-muted hover:text-text-primary"
              title="Descartar"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── Header + selector de rango ──────────────────────────────── */}
      <div className="space-y-4" data-print="hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-text-primary">Dashboard</h1>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-alt hover:text-text-primary"
              title="Exportar PDF"
            >
              ↓ Exportar PDF
            </button>
          </div>

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
        <div data-print="hidden" className="rounded-lg border border-negative bg-negative-bg px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      {loading && !kpis ? (
        <div className="py-16 text-center text-sm text-text-muted">Cargando dashboard…</div>
      ) : kpis ? (
        <div className={loading ? 'space-y-6 opacity-60 transition-opacity' : 'space-y-6'}>
          {/* ── Zona 1: Resultado rápido ───────────────────────────── */}
          <div data-print="section" className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <KpiCardHero titulo="Ventas" valor={formatARS(kpis.actual.ventas)}>
              <Delta actual={kpis.actual.ventas} anterior={kpis.anterior?.ventas ?? null} />
            </KpiCardHero>
            <KpiCardHero
              titulo="Beneficio neto"
              valor={formatARS(kpis.actual.beneficioNeto)}
              colorValor={kpis.actual.beneficioNeto < 0 ? 'text-negative' : 'text-text-primary'}
            >
              <Delta actual={kpis.actual.beneficioNeto} anterior={kpis.anterior?.beneficioNeto ?? null} />
            </KpiCardHero>
            <KpiCardHero
              titulo="Margen neto"
              valor={formatPercent(kpis.actual.margenNeto)}
              colorValor={kpis.actual.margenNeto < 0 ? 'text-negative' : 'text-text-primary'}
            >
              <Delta
                actual={kpis.actual.margenNeto}
                anterior={kpis.anterior?.margenNeto ?? null}
                esPuntoPorcentual
              />
            </KpiCardHero>
            <KpiCardHero
              titulo="ROAS"
              valor={kpis.actual.roas > 0 ? `${kpis.actual.roas.toFixed(2)}x` : '—'}
            >
              {kpis.actual.gastoPublicidad === 0 ? (
                <span className="text-xs text-text-muted">Sin gasto en publicidad</span>
              ) : kpis.anterior && kpis.anterior.gastoPublicidad === 0 ? (
                <span className="text-xs text-text-muted">Publicidad nueva este período</span>
              ) : (
                <Delta actual={kpis.actual.roas} anterior={kpis.anterior?.roas ?? null} />
              )}
            </KpiCardHero>
            <KpiCardHero
              titulo="Clientes que volvieron"
              valor={kpis.actual.pedidosRepetidores.toString()}
            >
              <Delta
                actual={kpis.actual.pedidosRepetidores}
                anterior={kpis.anterior?.pedidosRepetidores ?? null}
              />
            </KpiCardHero>
            <KpiCardHero
              titulo="% facturación repetidores"
              valor={formatPercent(kpis.actual.pctVentasRepetidores)}
            >
              <Delta
                actual={kpis.actual.pctVentasRepetidores}
                anterior={kpis.anterior?.pctVentasRepetidores ?? null}
                esPuntoPorcentual
              />
            </KpiCardHero>
          </div>

          <ZonaDivisor label="Por qué ese resultado" />

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

          {/* ── Auditoría Financiera Inteligente ─────────────────────── */}
          {!loadingAuditoria && semaforoEnVivo && (
            <SemaforoSalud semaforo={semaforoEnVivo} />
          )}

          {!loadingAuditoria && comparacionReciente && (
            <QueCambio comparacion={comparacionReciente} />
          )}

          {!loadingAuditoria && !comparacionReciente && (
            <div className="rounded-lg border border-border bg-surface p-5 text-center">
              <p className="text-sm text-text-muted">
                ¿Qué cambió? necesita al menos 2 semanas cerradas para comparar. Cerrá la semana
                actual o anteriores desde el selector de período arriba.
              </p>
            </div>
          )}

          <ZonaDivisor label="Evolución e inteligencia" />

          {/* ── Rankings de productos ──────────────────────────────── */}
          <SeccionColapsable titulo="Ranking de productos">
            <div className="mb-3 flex items-center justify-end">
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
          </SeccionColapsable>

          {/* ── Consumo de ingredientes ────────────────────────────── */}
          <SeccionColapsable titulo="Consumo de ingredientes">
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
          </SeccionColapsable>
        </div>
      ) : null}

      {/* ── Evolución ──────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div data-print="hidden" className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-text-primary">Evolución</h2>
            <div className="flex gap-1 rounded-lg bg-surface-alt p-1">
              <button
                onClick={() => setEvolucionTab('resumen')}
                className={`rounded-md px-3 py-1 text-xs ${
                  evolucionTab === 'resumen'
                    ? 'bg-surface font-medium text-text-primary shadow-sm'
                    : 'text-text-secondary'
                }`}
              >
                Resumen general
              </button>
              <button
                onClick={() => setEvolucionTab('rentabilidad')}
                className={`rounded-md px-3 py-1 text-xs ${
                  evolucionTab === 'rentabilidad'
                    ? 'bg-surface font-medium text-text-primary shadow-sm'
                    : 'text-text-secondary'
                }`}
              >
                Rentabilidad
              </button>
              <button
                onClick={() => setEvolucionTab('clientes')}
                className={`rounded-md px-3 py-1 text-xs ${
                  evolucionTab === 'clientes'
                    ? 'bg-surface font-medium text-text-primary shadow-sm'
                    : 'text-text-secondary'
                }`}
              >
                Clientes
              </button>
              <button
                onClick={() => setEvolucionTab('tabla')}
                className={`rounded-md px-3 py-1 text-xs ${
                  evolucionTab === 'tabla'
                    ? 'bg-surface font-medium text-text-primary shadow-sm'
                    : 'text-text-secondary'
                }`}
              >
                Tabla semanal
              </button>
            </div>
          </div>
          <div className={`flex items-center gap-2 text-sm ${evolucionTab === 'clientes' || evolucionTab === 'tabla' ? 'invisible' : ''}`}>
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
            {/* ── Tab: Resumen general (9 mini gráficos) ── */}
            <div className={evolucionTab === 'resumen' ? 'block' : 'hidden'} data-print="section">
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
            </div>{/* cierre tab Resumen */}

            {/* ── Tab: Rentabilidad en profundidad ── */}
            <div className={evolucionTab === 'rentabilidad' ? 'block print:block' : 'hidden print:block'} data-print="section">
              {bandasMargen ? (
                <div className="space-y-4">
                  <GraficoMargenBandas
                    datos={evolucionDatos}
                    bandas={bandasMargen}
                    metricas={[
                      { key: 'margenNeto',      label: 'Margen neto',          color: '#1D9E75', activa: true  },
                      { key: 'margenBruto',     label: 'Margen bruto',         color: '#6366f1', activa: false },
                      { key: 'publicidadPct',   label: 'Publicidad % s/ventas',color: '#f59e0b', activa: false },
                    ]}
                  />

                  <div className="rounded-lg border border-border bg-surface p-4">
                    <div className="text-xs font-medium text-text-muted mb-3">
                      Evolución semana a semana — Margen Neto %
                    </div>
                    <div className="divide-y divide-border/50">
                      {[...evolucionDatos].reverse().map((p) => {
                        const zona =
                          p.margenNeto >= bandasMargen.excelenteMinimo
                            ? { label: 'Excelente', clase: 'text-positive' }
                            : p.margenNeto >= bandasMargen.objetivoMinimo
                            ? { label: 'Objetivo', clase: 'text-positive' }
                            : p.margenNeto >= bandasMargen.alertaMinimo
                            ? { label: 'Alerta', clase: 'text-warning' }
                            : { label: 'Problema', clase: 'text-negative' };
                        return (
                          <div key={p.id} className="flex items-center justify-between py-2 text-sm">
                            <span className="text-text-secondary">{p.label}</span>
                            <div className="flex items-center gap-3">
                              <span className={`text-xs font-medium ${zona.clase}`}>
                                {zona.label}
                              </span>
                              <span className="w-14 text-right tabular-nums font-medium text-text-primary">
                                {p.margenNeto.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-text-muted">
                  Cargando bandas de configuración…
                </div>
              )}
            </div>

            {/* ── Tab: Clientes ── */}
            <div className={evolucionTab === 'clientes' ? 'block print:block' : 'hidden print:block'} data-print="section">
              <TabSaludClientes salud={saludClientes} loading={loadingSalud} />
            </div>

            {/* ── Tab: Tabla semanal ── */}
            <div className={evolucionTab === 'tabla' ? 'block' : 'hidden'} data-print="section">
              <TabTablaSemanal periodos={evolucionDatos} bandas={bandasMargen} onEliminado={loadEvolucion} />
            </div>
          </>
        )}
      </div>

      {/* ── Modal de cierre de período ───────────────────────────────────── */}
      {modalCierreAbierto && (
        <div data-print="hidden" className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
