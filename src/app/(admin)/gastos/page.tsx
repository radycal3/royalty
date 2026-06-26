'use client';

import { useState, useEffect, useTransition, useRef } from 'react';
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Pencil,
  DollarSign,
  TrendingDown,
  Lock,
  Upload,
} from 'lucide-react';
import {
  SidePanel,
  Field,
  Input,
  Select,
  Button,
  Badge,
  EmptyState,
  useToast,
} from '@/components/ui';
import { formatARS, formatDate } from '@/lib/utils/format';
import type {
  Categoria,
  TipoGasto,
  GastoOperativo,
  ResumenGastos,
  PeriodoInfo,
} from './actions';
import {
  obtenerPeriodoActual,
  obtenerPeriodoPorOffset,
  obtenerPeriodoDeFecha,
  obtenerGastosPeriodo,
  crearGasto,
  actualizarGasto,
  eliminarGasto,
} from './actions';
import type { MetaAdsImportacion } from './actions-meta-ads';
import {
  obtenerMetaAdsPeriodo,
  obtenerGastoPublicidadExistente,
  importarMetaAds,
  eliminarMetaAdsPeriodo,
} from './actions-meta-ads';
import { parseMetaAdsCsv, type MetaAdsParseResult } from '@/lib/utils/meta-ads-parser';

// ─── Constantes ────────────────────────────────────────────────────────────

const CATEGORIAS: { value: Categoria; label: string; tipoDefault: TipoGasto }[] = [
  { value: 'publicidad', label: 'Publicidad', tipoDefault: 'variable' },
  { value: 'cadeteria', label: 'Cadetería', tipoDefault: 'variable' },
  { value: 'packaging', label: 'Packaging', tipoDefault: 'variable' },
  { value: 'sueldos', label: 'Sueldos', tipoDefault: 'fijo' },
  { value: 'servicios', label: 'Servicios', tipoDefault: 'fijo' },
  { value: 'impuestos', label: 'Impuestos', tipoDefault: 'fijo' },
  { value: 'otros', label: 'Otros', tipoDefault: 'variable' },
];

const CAT_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORIAS.map((c) => [c.value, c.label])
);

const TIPO_LABELS: Record<string, string> = {
  variable: 'Variable',
  fijo: 'Fijo',
};

// ─── Page ──────────────────────────────────────────────────────────────────

export default function GastosPage() {
  const [periodo, setPeriodo] = useState<PeriodoInfo | null>(null);
  const [resumen, setResumen] = useState<ResumenGastos | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showImportMeta, setShowImportMeta] = useState(false);
  const [editingGasto, setEditingGasto] = useState<GastoOperativo | null>(null);
  const [pending, startTransition] = useTransition();
  const { show, Toast } = useToast();
  const requestId = useRef(0);

  // ── Carga inicial ──
  useEffect(() => {
    (async () => {
      const p = await obtenerPeriodoActual();
      setPeriodo(p);
      await loadGastos(p.viernes);
    })();
  }, []);

  async function loadGastos(viernes: string) {
    const thisRequest = ++requestId.current;
    const data = await obtenerGastosPeriodo(viernes);
    if (thisRequest === requestId.current) {
      setResumen(data);
      setLoaded(true);
    }
  }

  // ── Navegación de períodos ──
  async function handleNav(offset: number) {
    if (!periodo) return;
    const nuevo = await obtenerPeriodoPorOffset(periodo.viernes, offset);
    setPeriodo(nuevo);
    setLoaded(false);
    await loadGastos(nuevo.viernes);
  }

  // ── CRUD handlers ──
  async function handleCrear(fd: FormData) {
    startTransition(async () => {
      const r = await crearGasto(fd);
      if (r.error) { show(r.error, 'error'); return; }
      show('Gasto registrado');
      setShowNew(false);

      // Si la fecha del gasto cae en otro período, navegar a ese período
      const fecha = fd.get('fecha') as string;
      const periodoDelGasto = await obtenerPeriodoDeFecha(fecha);
      setPeriodo(periodoDelGasto);
      await loadGastos(periodoDelGasto.viernes);
    });
  }

  async function handleActualizar(fd: FormData) {
    if (!editingGasto || !periodo) return;
    startTransition(async () => {
      const r = await actualizarGasto(editingGasto.id, fd);
      if (r.error) { show(r.error, 'error'); return; }
      show('Gasto actualizado');
      setEditingGasto(null);
      await loadGastos(periodo.viernes);
    });
  }

  async function handleEliminar(id: string) {
    if (!periodo) return;
    startTransition(async () => {
      const r = await eliminarGasto(id);
      if (r.error) { show(r.error, 'error'); return; }
      show('Gasto eliminado');
      await loadGastos(periodo.viernes);
    });
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Gastos operativos</h1>
          <p className="text-text-muted text-sm mt-1">
            Registrá los gastos de cada período para calcular el beneficio neto.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setShowImportMeta(true)}>
            <Upload className="w-4 h-4 mr-2" />
            Importar Meta Ads
          </Button>
          <Button onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Nuevo gasto
          </Button>
        </div>
      </div>

      {/* Selector de período */}
      {periodo && (
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => handleNav(-1)}
            className="p-2 rounded-lg hover:bg-surface-alt text-text-muted hover:text-text-primary transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="text-center">
            <p className="text-text-primary font-semibold">{periodo.label}</p>
            {periodo.esActual && (
              <Badge color="green">Período actual</Badge>
            )}
          </div>
          <button
            onClick={() => handleNav(1)}
            className="p-2 rounded-lg hover:bg-surface-alt text-text-muted hover:text-text-primary transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Resumen de totales */}
      {resumen && loaded && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-surface-alt rounded-lg p-4 border border-border">
            <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
              <TrendingDown className="h-4 w-4" />
              Gastos variables
            </div>
            <p className="text-xl font-semibold text-text-primary">
              {formatARS(resumen.totalVariable)}
            </p>
          </div>
          <div className="bg-surface-alt rounded-lg p-4 border border-border">
            <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
              <Lock className="h-4 w-4" />
              Gastos fijos
            </div>
            <p className="text-xl font-semibold text-text-primary">
              {formatARS(resumen.totalFijo)}
            </p>
          </div>
          <div className="bg-surface-alt rounded-lg p-4 border border-border">
            <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
              <DollarSign className="h-4 w-4" />
              Total gastos
            </div>
            <p className="text-xl font-semibold text-negative">
              {formatARS(resumen.totalGeneral)}
            </p>
          </div>
        </div>
      )}

      {/* Totales por categoría */}
      {resumen && resumen.porCategoria.length > 0 && (
        <div className="bg-surface-alt rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 font-medium text-text-secondary">Categoría</th>
                <th className="text-center px-4 py-3 font-medium text-text-secondary">Tipo</th>
                <th className="text-right px-4 py-3 font-medium text-text-secondary">Registros</th>
                <th className="text-right px-4 py-3 font-medium text-text-secondary">Total</th>
              </tr>
            </thead>
            <tbody>
              {resumen.porCategoria.map((cat) => (
                <tr key={cat.categoria} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 text-text-primary font-medium">
                    {CAT_LABELS[cat.categoria] ?? cat.categoria}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge color={cat.tipo === 'variable' ? 'yellow' : 'gray'}>
                      {TIPO_LABELS[cat.tipo]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right text-text-secondary">{cat.count}</td>
                  <td className="px-4 py-3 text-right text-text-primary font-medium">
                    {formatARS(cat.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Lista de gastos */}
      {!loaded ? (
        <div className="text-text-muted text-sm py-8 text-center">Cargando gastos...</div>
      ) : resumen && resumen.gastos.length === 0 ? (
        <EmptyState
          icon={<DollarSign className="w-10 h-10" />}
          title="Sin gastos en este período"
          description="Registrá publicidad, packaging, sueldos y otros gastos para calcular el beneficio neto."
        />
      ) : resumen && (
        <div>
          <h2 className="text-sm font-semibold text-text-primary mb-3">
            Detalle ({resumen.gastos.length} {resumen.gastos.length === 1 ? 'gasto' : 'gastos'})
          </h2>
          <div className="bg-surface-alt rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 font-medium text-text-secondary">Fecha</th>
                  <th className="text-left px-4 py-3 font-medium text-text-secondary">Categoría</th>
                  <th className="text-center px-4 py-3 font-medium text-text-secondary">Tipo</th>
                  <th className="text-left px-4 py-3 font-medium text-text-secondary">Nota</th>
                  <th className="text-right px-4 py-3 font-medium text-text-secondary">Monto</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody>
                {resumen.gastos.map((g) => (
                  <tr key={g.id} className="border-b border-border last:border-0 hover:bg-surface transition-colors">
                    <td className="px-4 py-3 text-text-secondary">
                      {formatDate(g.fecha)}
                    </td>
                    <td className="px-4 py-3 text-text-primary font-medium">
                      {CAT_LABELS[g.categoria] ?? g.categoria}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge color={g.tipo === 'variable' ? 'yellow' : 'gray'}>
                        {TIPO_LABELS[g.tipo]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-text-muted truncate max-w-48">
                      {g.nota || '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-text-primary font-medium">
                      {formatARS(g.monto)}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditingGasto(g)}
                          title="Editar"
                          className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-alt transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleEliminar(g.id)}
                          title="Eliminar"
                          className="p-1.5 rounded-lg text-text-muted hover:text-negative transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SidePanel: Nuevo gasto */}
      <SidePanel open={showNew} onClose={() => setShowNew(false)} title="Nuevo gasto">
        <FormGasto
          onSubmit={handleCrear}
          pending={pending}
          periodoActual={periodo}
        />
      </SidePanel>

      {/* SidePanel: Editar gasto */}
      <SidePanel
        open={!!editingGasto}
        onClose={() => setEditingGasto(null)}
        title="Editar gasto"
      >
        {editingGasto && (
          <FormGasto
            key={editingGasto.id}
            onSubmit={handleActualizar}
            pending={pending}
            initial={editingGasto}
            periodoActual={periodo}
          />
        )}
      </SidePanel>

      {/* SidePanel: Importar Meta Ads */}
      <SidePanel open={showImportMeta} onClose={() => setShowImportMeta(false)} title="Importar Meta Ads">
        {periodo && (
          <FormImportarMetaAds
            periodo={periodo}
            onDone={() => { setShowImportMeta(false); loadGastos(periodo.viernes); }}
          />
        )}
      </SidePanel>

      <Toast />
    </div>
  );
}

// ─── Formulario de gasto ───────────────────────────────────────────────────

function FormGasto({
  onSubmit,
  pending,
  initial,
  periodoActual,
}: {
  onSubmit: (fd: FormData) => void;
  pending: boolean;
  initial?: GastoOperativo;
  periodoActual: PeriodoInfo | null;
}) {
  const [categoria, setCategoria] = useState<Categoria>(
    initial?.categoria ?? 'publicidad'
  );
  const [tipo, setTipo] = useState<TipoGasto>(initial?.tipo ?? 'variable');
  const [fecha, setFecha] = useState(
    initial?.fecha ?? new Date().toISOString().split('T')[0]
  );
  const [periodoAsignado, setPeriodoAsignado] = useState<string | null>(null);

  // Calcular período asignado cuando cambia la fecha
  useEffect(() => {
    if (fecha) {
      obtenerPeriodoDeFecha(fecha).then((p) => {
        setPeriodoAsignado(p.label);
      });
    }
  }, [fecha]);

  // Auto-set tipo cuando cambia categoría (solo si no es edición)
  function handleCategoriaChange(newCat: Categoria) {
    setCategoria(newCat);
    if (!initial) {
      const catInfo = CATEGORIAS.find((c) => c.value === newCat);
      if (catInfo) setTipo(catInfo.tipoDefault);
    }
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <Field label="Fecha">
        <Input
          name="fecha"
          type="date"
          required
          value={fecha}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFecha(e.target.value)}
        />
      </Field>

      {periodoAsignado && (
        <div className="px-3 py-2 rounded-lg bg-brand-light text-sm text-text-secondary">
          Se asigna al período: <span className="font-medium text-text-primary">{periodoAsignado}</span>
        </div>
      )}

      <Field label="Categoría">
        <Select
          name="categoria"
          value={categoria}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            handleCategoriaChange(e.target.value as Categoria)
          }
        >
          {CATEGORIAS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Tipo">
        <Select
          name="tipo"
          value={tipo}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            setTipo(e.target.value as TipoGasto)
          }
        >
          <option value="variable">Variable</option>
          <option value="fijo">Fijo</option>
        </Select>
      </Field>

      <Field label="Monto">
        <Input
          name="monto"
          type="number"
          min="1"
          step="1"
          required
          placeholder="0"
          defaultValue={initial?.monto}
        />
      </Field>

      <Field label="Nota (opcional)">
        <Input
          name="nota"
          placeholder="Ej: Meta Ads campaña hamburguesas"
          defaultValue={initial?.nota ?? ''}
        />
      </Field>

      <Button type="submit" disabled={pending}>
        {initial ? 'Guardar cambios' : 'Registrar gasto'}
      </Button>
    </form>
  );
}

// ─── Importar Meta Ads ──────────────────────────────────────────────────────

function FormImportarMetaAds({
  periodo,
  onDone,
}: {
  periodo: PeriodoInfo;
  onDone: () => void;
}) {
  const [importacionExistente, setImportacionExistente] = useState<MetaAdsImportacion | null>(null);
  const [gastoPublicidadExistente, setGastoPublicidadExistente] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null);
  const [parsed, setParsed] = useState<MetaAdsParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [tipoCambio, setTipoCambio] = useState('');
  const [paso, setPaso] = useState<1 | 2>(1);
  const [tipoAudienciaMap, setTipoAudienciaMap] = useState<Record<string, 'caliente' | 'fría'>>({});
  const [pending, setPending] = useState(false);
  const { show, Toast } = useToast();

  useEffect(() => {
    (async () => {
      const [imp, gastoExistente] = await Promise.all([
        obtenerMetaAdsPeriodo(periodo.viernes),
        obtenerGastoPublicidadExistente(periodo.viernes, periodo.fechaHasta),
      ]);
      setImportacionExistente(imp);
      setGastoPublicidadExistente(gastoExistente);
      setLoaded(true);
    })();
  }, [periodo.viernes]);

  function handleArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setParsed(null);
    setPaso(1);
    setTipoAudienciaMap({});
    setNombreArchivo(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const resultado = parseMetaAdsCsv(String(reader.result));
        setParsed(resultado);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'No se pudo leer el archivo');
      }
    };
    reader.onerror = () => setParseError('No se pudo leer el archivo');
    reader.readAsText(file);
  }

  const tipoCambioNum = parseFloat(tipoCambio);
  const gastoArs = parsed && tipoCambioNum > 0 ? Math.round(parsed.gastoUsd * tipoCambioNum * 100) / 100 : null;

  const todasClasificadas = parsed
    ? parsed.conjuntosDetectados.every((c) => tipoAudienciaMap[c] !== undefined)
    : false;

  async function handleConfirmar() {
    if (!parsed || !tipoCambioNum || tipoCambioNum <= 0) return;
    setPending(true);
    const r = await importarMetaAds({
      periodoDesde: periodo.viernes,
      periodoHasta: periodo.fechaHasta,
      gastoUsd: parsed.gastoUsd,
      tipoCambio: tipoCambioNum,
      alcance: parsed.alcance,
      impresiones: parsed.impresiones,
      clics: parsed.clics,
      resultados: parsed.resultados,
      nombreArchivo,
      tipoAudienciaMap,
      filas: parsed.filas,
    });
    setPending(false);
    if ('error' in r) { show(r.error, 'error'); return; }
    show('Meta Ads importado correctamente');
    onDone();
  }

  async function handleEliminarImportacion() {
    setPending(true);
    const r = await eliminarMetaAdsPeriodo(periodo.viernes);
    setPending(false);
    if (r.error) { show(r.error, 'error'); return; }
    show('Importación eliminada');
    onDone();
  }

  if (!loaded) {
    return <div className="text-text-muted text-sm py-6 text-center">Cargando...</div>;
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-text-secondary">
        Período: <span className="font-medium text-text-primary">{periodo.label}</span>
      </p>

      {importacionExistente && (
        <div className="rounded-lg border border-border bg-surface-alt p-3 text-sm">
          <p className="text-text-primary font-medium">Ya hay una importación para esta semana</p>
          <p className="mt-1 text-text-secondary">
            USD {importacionExistente.gastoUsd.toLocaleString('es-AR')} × ${importacionExistente.tipoCambio} ={' '}
            {formatARS(importacionExistente.gastoArs)}
            {importacionExistente.nombreArchivo && <> ({importacionExistente.nombreArchivo})</>}
          </p>
          <button
            onClick={handleEliminarImportacion}
            disabled={pending}
            className="mt-2 text-xs text-negative underline underline-offset-2 hover:no-underline"
          >
            Eliminar esta importación
          </button>
        </div>
      )}

      {!importacionExistente && gastoPublicidadExistente > 0 && (
        <div className="rounded-lg border border-warning bg-warning-bg px-3 py-2.5 text-sm text-warning">
          Ya hay {formatARS(gastoPublicidadExistente)} cargado como publicidad esta semana (manual). Importar acá lo
          va a reemplazar.
        </div>
      )}

      {/* ── Paso 1: archivo + tipo de cambio ── */}
      {paso === 1 && (
        <>
          <Field label="Archivo CSV exportado de Meta Ads Manager">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleArchivo}
              className="block w-full text-sm text-text-secondary"
            />
          </Field>

          {parseError && (
            <p className="text-sm text-negative bg-negative-bg rounded-lg px-3 py-2">{parseError}</p>
          )}

          {parsed && (
            <div className="rounded-lg border border-border bg-surface-alt p-3 text-sm space-y-1">
              <p className="text-text-primary font-medium">
                Detectado ({parsed.filasDetectadas} fila{parsed.filasDetectadas !== 1 ? 's' : ''}, {parsed.conjuntosDetectados.length} conjunto{parsed.conjuntosDetectados.length !== 1 ? 's' : ''}):
              </p>
              <p className="text-text-secondary">Gasto: USD {parsed.gastoUsd.toLocaleString('es-AR')}</p>
              {parsed.alcance != null && <p className="text-text-secondary">Alcance: {parsed.alcance.toLocaleString('es-AR')}</p>}
              {parsed.impresiones != null && <p className="text-text-secondary">Impresiones: {parsed.impresiones.toLocaleString('es-AR')}</p>}
              {parsed.clics != null && <p className="text-text-secondary">Clics: {parsed.clics.toLocaleString('es-AR')}</p>}
              {parsed.resultados != null && <p className="text-text-secondary">Conversaciones: {parsed.resultados.toLocaleString('es-AR')}</p>}
            </div>
          )}

          <Field label="Tipo de cambio del día" hint="Ej: 1250">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={tipoCambio}
              onChange={(e) => setTipoCambio(e.target.value)}
              placeholder="1250"
            />
          </Field>

          {gastoArs != null && (
            <p className="text-sm text-text-primary">
              Gasto total a cargar: <span className="font-semibold">{formatARS(gastoArs)}</span>
            </p>
          )}

          <Button
            onClick={() => setPaso(2)}
            disabled={!parsed || !tipoCambioNum || tipoCambioNum <= 0}
            className="w-full"
          >
            Continuar — clasificar audiencias
          </Button>
        </>
      )}

      {/* ── Paso 2: clasificar conjuntos ── */}
      {paso === 2 && parsed && (
        <>
          <div className="rounded-lg border border-border bg-surface-alt p-3 text-sm space-y-0.5">
            <p className="text-text-primary font-medium">Resumen a importar</p>
            <p className="text-text-secondary">
              USD {parsed.gastoUsd.toLocaleString('es-AR')} × ${tipoCambioNum} ={' '}
              <span className="font-medium text-text-primary">{gastoArs != null ? formatARS(gastoArs) : '—'}</span>
            </p>
          </div>

          {parsed.conjuntosDetectados.length === 0 ? (
            <p className="text-sm text-text-muted bg-surface-alt rounded-lg px-3 py-2">
              No se detectaron conjuntos con actividad. Se importarán solo los totales.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium text-text-primary">
                Tipo de audiencia por conjunto de anuncios:
              </p>
              {parsed.conjuntosDetectados.map((conjunto) => (
                <div key={conjunto} className="rounded-lg border border-border bg-surface p-3">
                  <p className="text-sm font-medium text-text-primary mb-2">{conjunto}</p>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-1.5 cursor-pointer text-sm text-text-secondary">
                      <input
                        type="radio"
                        name={`tipo-${conjunto}`}
                        value="caliente"
                        checked={tipoAudienciaMap[conjunto] === 'caliente'}
                        onChange={() => setTipoAudienciaMap((m) => ({ ...m, [conjunto]: 'caliente' }))}
                        className="accent-brand"
                      />
                      Caliente (seguidores / compradores)
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-sm text-text-secondary">
                      <input
                        type="radio"
                        name={`tipo-${conjunto}`}
                        value="fría"
                        checked={tipoAudienciaMap[conjunto] === 'fría'}
                        onChange={() => setTipoAudienciaMap((m) => ({ ...m, [conjunto]: 'fría' }))}
                        className="accent-brand"
                      />
                      Fría (audiencia nueva)
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}

          {parsed.conjuntosDetectados.length > 0 && !todasClasificadas && (
            <p className="text-xs text-text-muted">
              Clasificá todos los conjuntos para continuar.
            </p>
          )}

          <div className="flex flex-col gap-2">
            <Button
              onClick={handleConfirmar}
              disabled={pending || (parsed.conjuntosDetectados.length > 0 && !todasClasificadas)}
              className="w-full"
            >
              {pending ? 'Importando...' : 'Confirmar importación'}
            </Button>
            <button
              onClick={() => setPaso(1)}
              disabled={pending}
              className="text-sm text-text-muted underline underline-offset-2 hover:no-underline"
            >
              ← Volver
            </button>
          </div>
        </>
      )}

      <Toast />
    </div>
  );
}
