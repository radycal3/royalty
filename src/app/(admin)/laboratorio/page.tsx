'use client';

import { useState, useEffect, useTransition } from 'react';
import { ChevronLeft, ChevronRight, Sparkles, FlaskConical } from 'lucide-react';
import { Field, Input, Button, Badge, EmptyState, useToast } from '@/components/ui';
import { formatDate } from '@/lib/utils/format';
import type { PeriodoInfo } from '../gastos/actions';
import { obtenerPeriodoActual, obtenerPeriodoPorOffset } from '../gastos/actions';
import type { DecisionLaboratorio } from './actions';
import {
  obtenerDecisionesPeriodo,
  obtenerDecisionesPendientesDeResultado,
  generarRecomendaciones,
  registrarDecision,
  registrarResultado,
} from './actions';

export default function LaboratorioPage() {
  const [periodo, setPeriodo] = useState<PeriodoInfo | null>(null);
  const [decisiones, setDecisiones] = useState<DecisionLaboratorio[]>([]);
  const [pendientes, setPendientes] = useState<DecisionLaboratorio[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [pending, startTransition] = useTransition();
  const { show, Toast } = useToast();

  useEffect(() => {
    (async () => {
      const p = await obtenerPeriodoActual();
      setPeriodo(p);
      await Promise.all([loadDecisiones(p.viernes), loadPendientes()]);
    })();
  }, []);

  async function loadDecisiones(viernes: string) {
    const data = await obtenerDecisionesPeriodo(viernes);
    setDecisiones(data);
    setLoaded(true);
  }

  async function loadPendientes() {
    setPendientes(await obtenerDecisionesPendientesDeResultado());
  }

  async function handleNav(offset: number) {
    if (!periodo) return;
    const nuevo = await obtenerPeriodoPorOffset(periodo.viernes, offset);
    setPeriodo(nuevo);
    setLoaded(false);
    await loadDecisiones(nuevo.viernes);
  }

  async function handleGenerar() {
    if (!periodo) return;
    setGenerando(true);
    const r = await generarRecomendaciones(periodo.viernes, periodo.fechaHasta);
    setGenerando(false);
    if (r.error) { show(r.error, 'error'); return; }
    show(`${r.cantidad} recomendaciones generadas`);
    await loadDecisiones(periodo.viernes);
  }

  function handleDecision(id: string, texto: string) {
    startTransition(async () => {
      const r = await registrarDecision(id, texto);
      if (r.error) { show(r.error, 'error'); return; }
      show('Decisión registrada');
      if (periodo) await loadDecisiones(periodo.viernes);
      await loadPendientes();
    });
  }

  function handleResultado(id: string, texto: string) {
    startTransition(async () => {
      const r = await registrarResultado(id, texto);
      if (r.error) { show(r.error, 'error'); return; }
      show('Resultado registrado');
      if (periodo) await loadDecisiones(periodo.viernes);
      await loadPendientes();
    });
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Laboratorio</h1>
        <p className="text-text-muted text-sm mt-1">
          Recomendaciones generadas a partir de los KPIs de la semana, y seguimiento de qué se decidió y qué resultó.
        </p>
      </div>

      {/* Decisiones esperando resultado — de cualquier período, siempre visibles */}
      {pendientes.length > 0 && (
        <div className="rounded-lg border border-warning bg-warning-bg p-4">
          <h2 className="text-sm font-semibold text-warning mb-3">
            {pendientes.length} decisión{pendientes.length !== 1 ? 'es' : ''} esperando resultado
          </h2>
          <div className="space-y-3">
            {pendientes.map((d) => (
              <DecisionPendienteCard key={d.id} decision={d} pending={pending} onResultado={handleResultado} />
            ))}
          </div>
        </div>
      )}

      {/* Selector de período */}
      {periodo && (
        <div className="flex items-center justify-center gap-4">
          <button onClick={() => handleNav(-1)} className="p-2 rounded-lg hover:bg-surface-alt text-text-muted hover:text-text-primary transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="text-center">
            <p className="text-text-primary font-semibold">{periodo.label}</p>
            {periodo.esActual && <Badge color="green">Período actual</Badge>}
          </div>
          <button onClick={() => handleNav(1)} className="p-2 rounded-lg hover:bg-surface-alt text-text-muted hover:text-text-primary transition-colors">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}

      <div className="flex justify-center">
        <Button onClick={handleGenerar} disabled={generando}>
          <Sparkles className="w-4 h-4 mr-2" />
          {generando ? 'Generando...' : 'Generar recomendaciones'}
        </Button>
      </div>

      {!loaded ? (
        <div className="text-text-muted text-sm py-8 text-center">Cargando...</div>
      ) : decisiones.length === 0 ? (
        <EmptyState
          icon={<FlaskConical className="w-10 h-10" />}
          title="Sin recomendaciones para este período"
          description="Tocá 'Generar recomendaciones' para que la IA analice los KPIs de esta semana."
        />
      ) : (
        <div className="space-y-3">
          {decisiones.map((d) => (
            <DecisionCard key={d.id} decision={d} pending={pending} onDecision={handleDecision} onResultado={handleResultado} />
          ))}
        </div>
      )}

      <Toast />
    </div>
  );
}

// ─── Card de una recomendación (en su período) ─────────────────────────────

function DecisionCard({
  decision,
  pending,
  onDecision,
  onResultado,
}: {
  decision: DecisionLaboratorio;
  pending: boolean;
  onDecision: (id: string, texto: string) => void;
  onResultado: (id: string, texto: string) => void;
}) {
  const [decisionTexto, setDecisionTexto] = useState('');
  const [resultadoTexto, setResultadoTexto] = useState(decision.resumenSugerido ?? '');

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <Badge color="gray">{decision.area}</Badge>
        <Badge color={decision.estado === 'evaluada' ? 'green' : decision.estado === 'decidida' ? 'yellow' : 'gray'}>
          {decision.estado === 'evaluada' ? 'Evaluada' : decision.estado === 'decidida' ? 'Decidida' : 'Sugerida'}
        </Badge>
      </div>
      <p className="text-sm font-medium text-text-primary">{decision.recomendacion}</p>
      <p className="mt-1 text-xs text-text-muted">{decision.justificacion}</p>

      {decision.decisionTomada && (
        <div className="mt-3 rounded-md bg-surface-alt p-2.5 text-sm">
          <span className="text-text-muted">Decisión ({decision.fechaDecision && formatDate(decision.fechaDecision)}): </span>
          <span className="text-text-primary">{decision.decisionTomada}</span>
        </div>
      )}
      {decision.resultado && (
        <div className="mt-2 rounded-md bg-positive-bg p-2.5 text-sm">
          <span className="text-text-muted">Resultado ({decision.fechaResultado && formatDate(decision.fechaResultado)}): </span>
          <span className="text-text-primary">{decision.resultado}</span>
        </div>
      )}

      {decision.estado === 'sugerida' && (
        <div className="mt-3 flex gap-2">
          <Input
            value={decisionTexto}
            onChange={(e) => setDecisionTexto(e.target.value)}
            placeholder="¿Qué decidiste hacer?"
            className="flex-1"
          />
          <Button
            size="sm"
            disabled={pending || !decisionTexto.trim()}
            onClick={() => { onDecision(decision.id, decisionTexto); setDecisionTexto(''); }}
          >
            Registrar
          </Button>
        </div>
      )}
      {decision.estado === 'decidida' && (
        <div className="mt-3">
          {decision.resumenSugerido && (
            <p className="mb-1.5 text-xs text-text-muted">
              Comparación automática con la última semana cerrada — revisala y editala antes de confirmar.
            </p>
          )}
          <div className="flex gap-2">
            <textarea
              value={resultadoTexto}
              onChange={(e) => setResultadoTexto(e.target.value)}
              placeholder="¿Qué resultó? (podés volver más adelante)"
              rows={decision.resumenSugerido ? 3 : 1}
              className="flex-1 px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm
                         placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
            <Button
              size="sm"
              disabled={pending || !resultadoTexto.trim()}
              onClick={() => { onResultado(decision.id, resultadoTexto); setResultadoTexto(''); }}
            >
              Registrar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Card compacta para el bloque "esperando resultado" ───────────────────

function DecisionPendienteCard({
  decision,
  pending,
  onResultado,
}: {
  decision: DecisionLaboratorio;
  pending: boolean;
  onResultado: (id: string, texto: string) => void;
}) {
  const [resultadoTexto, setResultadoTexto] = useState(decision.resumenSugerido ?? '');

  return (
    <div className="rounded-md bg-surface p-3 text-sm">
      <div className="flex items-center gap-2 mb-1">
        <Badge color="gray">{decision.area}</Badge>
        <span className="text-xs text-text-muted">
          decidido el {decision.fechaDecision && formatDate(decision.fechaDecision)}
        </span>
      </div>
      <p className="text-text-primary">{decision.decisionTomada}</p>
      {decision.resumenSugerido && (
        <p className="mt-1.5 text-xs text-text-muted">
          Comparación automática con la última semana cerrada — revisala y editala antes de confirmar.
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <textarea
          value={resultadoTexto}
          onChange={(e) => setResultadoTexto(e.target.value)}
          placeholder="¿Qué resultó?"
          rows={decision.resumenSugerido ? 3 : 1}
          className="flex-1 px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm
                     placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        />
        <Button
          size="sm"
          disabled={pending || !resultadoTexto.trim()}
          onClick={() => { onResultado(decision.id, resultadoTexto); setResultadoTexto(''); }}
        >
          Registrar
        </Button>
      </div>
    </div>
  );
}
