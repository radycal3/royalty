'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  obtenerConfigCadetes,
  obtenerCadetesActivos,
  obtenerJornadasDeFecha,
  registrarJornadas,
  obtenerJornadas,
  editarJornada,
  eliminarJornada,
  type ConfigCadetes,
  type CadeteActivo,
  type JornadaRegistrada,
  type ResumenJornadas,
} from './actions';
import { formatARS } from '@/lib/utils/format';
import { EmptyState, useToast, SidePanel, Field, Input, Button } from '@/components/ui';

// ─── Helpers de fecha (mismo patrón simple que el resto del proyecto) ────

function hoyISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function hace7DiasISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── Subcomponentes ──────────────────────────────────────────────────────

function ResumenCard({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs text-text-muted">{titulo}</div>
      <div className="mt-1 text-xl font-semibold text-text-primary">{valor}</div>
    </div>
  );
}

// ─── Componente principal ───────────────────────────────────────────────

export default function CadetesPage() {
  const { show: showToast, Toast } = useToast();

  const [config, setConfig] = useState<ConfigCadetes | null>(null);
  const [cadetes, setCadetes] = useState<CadeteActivo[]>([]);
  const [fecha, setFecha] = useState(hoyISO());
  const [viajesPorCadete, setViajesPorCadete] = useState<Record<string, string>>({});
  const [yaRegistrados, setYaRegistrados] = useState<Set<string>>(new Set());

  const [rangoDesde, setRangoDesde] = useState(hace7DiasISO());
  const [rangoHasta, setRangoHasta] = useState(hoyISO());
  const [jornadas, setJornadas] = useState<JornadaRegistrada[]>([]);
  const [resumen, setResumen] = useState<ResumenJornadas | null>(null);

  const [loadingInicial, setLoadingInicial] = useState(true);
  const [loadingHistorico, setLoadingHistorico] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edición de jornada
  const [jornadaEnEdicion, setJornadaEnEdicion] = useState<JornadaRegistrada | null>(null);
  const [editFecha, setEditFecha] = useState('');
  const [editViajes, setEditViajes] = useState('');
  const [editObservacion, setEditObservacion] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);

  // Confirmación de borrado
  const [jornadaAEliminar, setJornadaAEliminar] = useState<JornadaRegistrada | null>(null);
  const [eliminando, setEliminando] = useState(false);

  const [, startTransition] = useTransition();
  const requestIdHistorico = useRef(0);

  // Carga inicial: config + cadetes activos (no cambian por fecha/rango)
  useEffect(() => {
    async function cargarInicial() {
      setLoadingInicial(true);
      setError(null);
      try {
        const [configData, cadetesData] = await Promise.all([
          obtenerConfigCadetes(),
          obtenerCadetesActivos(),
        ]);
        setConfig(configData);
        setCadetes(cadetesData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar configuración inicial');
      } finally {
        setLoadingInicial(false);
      }
    }
    cargarInicial();
  }, []);

  // Recarga jornadas ya cargadas cada vez que cambia la fecha del formulario
  useEffect(() => {
    async function cargarYaRegistrados() {
      try {
        const set = await obtenerJornadasDeFecha(fecha);
        setYaRegistrados(set);
      } catch {
        // No bloquea el formulario si esto falla — el UNIQUE constraint
        // de la base es el guardrail real, esto es solo conveniencia visual.
        setYaRegistrados(new Set());
      }
    }
    cargarYaRegistrados();
  }, [fecha]);

  // Recarga histórico + resumen cada vez que cambia el rango
  async function cargarHistorico() {
    const requestId = ++requestIdHistorico.current;
    setLoadingHistorico(true);
    try {
      const { jornadas: j, resumen: r } = await obtenerJornadas(rangoDesde, rangoHasta);
      if (requestId !== requestIdHistorico.current) return;
      setJornadas(j);
      setResumen(r);
    } catch (err) {
      if (requestId !== requestIdHistorico.current) return;
      setError(err instanceof Error ? err.message : 'Error al cargar histórico');
    } finally {
      if (requestId === requestIdHistorico.current) setLoadingHistorico(false);
    }
  }

  useEffect(() => {
    cargarHistorico();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangoDesde, rangoHasta]);

  function setViajes(equipoId: string, valor: string) {
    setViajesPorCadete((prev) => ({ ...prev, [equipoId]: valor }));
  }

  function calcularPago(viajes: number): number {
    if (!config) return 0;
    return Math.max(config.cadeteBaseMinima, viajes * config.cadeteValorViaje);
  }

  const cadetesConViajes = cadetes
    .filter((c) => !yaRegistrados.has(c.id))
    .map((c) => {
      const raw = viajesPorCadete[c.id] || '';
      const viajes = parseInt(raw, 10);
      const viajesValidos = Number.isFinite(viajes) && viajes > 0 ? viajes : 0;
      return {
        ...c,
        viajes: viajesValidos,
        pago: viajesValidos > 0 ? calcularPago(viajesValidos) : 0,
      };
    });

  const totalAConfirmar = cadetesConViajes.filter((c) => c.viajes > 0);
  const totalPagoPreview = totalAConfirmar.reduce((s, c) => s + c.pago, 0);
  const totalCostoEmpresaPreview = totalAConfirmar.length * (config?.costoEmpresaCadete || 0);

  async function confirmarRegistro() {
    if (totalAConfirmar.length === 0) {
      showToast('Cargá al menos un cadete con viajes antes de confirmar', 'error');
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      const { exitosos, errores } = await registrarJornadas(
        fecha,
        totalAConfirmar.map((c) => ({ equipoId: c.id, viajesRealizados: c.viajes }))
      );

      if (errores.length > 0) {
        const nombres = errores
          .map((e) => cadetes.find((c) => c.id === e.equipoId)?.nombre || e.equipoId)
          .join(', ');
        showToast(`${exitosos} jornada(s) registrada(s). Falló: ${nombres}`, 'error');
      } else {
        showToast(`${exitosos} jornada(s) registrada(s) correctamente`);
      }

      // Limpiar el formulario y refrescar listas
      setViajesPorCadete({});
      const set = await obtenerJornadasDeFecha(fecha);
      setYaRegistrados(set);
      startTransition(() => {
        cargarHistorico();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar jornadas');
    } finally {
      setGuardando(false);
    }
  }

  // ── Edición de jornada ──────────────────────────────────────────────

  function abrirEdicion(j: JornadaRegistrada) {
    setJornadaEnEdicion(j);
    setEditFecha(j.fecha);
    setEditViajes(j.viajesRealizados.toString());
    setEditObservacion(j.observacion || '');
    setEditError(null);
  }

  function cerrarEdicion() {
    setJornadaEnEdicion(null);
  }

  // Preview del nuevo pago usando los valores YA congelados de la fila en
  // edición — nunca los de config vigente, igual que hace el servidor.
  const previewPagoEdicion = (() => {
    if (!jornadaEnEdicion) return 0;
    const viajes = parseInt(editViajes, 10);
    if (!Number.isFinite(viajes) || viajes <= 0) return 0;
    return Math.max(
      jornadaEnEdicion.cadeteBaseMinimaUsada,
      viajes * jornadaEnEdicion.cadeteValorViajeUsado
    );
  })();

  async function guardarEdicion() {
    if (!jornadaEnEdicion) return;

    const viajes = parseInt(editViajes, 10);
    if (!Number.isFinite(viajes) || viajes <= 0) {
      setEditError('Ingresá una cantidad de viajes válida (mayor a 0).');
      return;
    }
    if (!editFecha) {
      setEditError('Ingresá una fecha válida.');
      return;
    }

    setGuardandoEdicion(true);
    setEditError(null);

    try {
      const resultado = await editarJornada({
        id: jornadaEnEdicion.id,
        fecha: editFecha,
        viajesRealizados: viajes,
        observacion: editObservacion || undefined,
      });

      if (!resultado.ok) {
        setEditError(resultado.mensaje);
        return;
      }

      showToast('Jornada actualizada correctamente');
      setJornadaEnEdicion(null);
      cargarHistorico();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Error al editar la jornada');
    } finally {
      setGuardandoEdicion(false);
    }
  }

  // ── Eliminación de jornada ──────────────────────────────────────────

  async function confirmarEliminacion() {
    if (!jornadaAEliminar) return;

    setEliminando(true);
    try {
      const resultado = await eliminarJornada(jornadaAEliminar.id);
      if (!resultado.ok) {
        showToast(resultado.mensaje, 'error');
      } else {
        showToast('Jornada eliminada');
        cargarHistorico();
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al eliminar la jornada', 'error');
    } finally {
      setEliminando(false);
      setJornadaAEliminar(null);
    }
  }

  if (loadingInicial) {
    return <div className="py-16 text-center text-sm text-text-muted">Cargando…</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-text-primary">Cadetes</h1>

      {error && (
        <div className="rounded-lg border border-negative bg-negative-bg px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      {/* ── Valores vigentes (referencia, no editable acá) ────────────── */}
      {config && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ResumenCard titulo="Base mínima vigente" valor={formatARS(config.cadeteBaseMinima)} />
          <ResumenCard titulo="Valor por viaje vigente" valor={formatARS(config.cadeteValorViaje)} />
          <ResumenCard
            titulo="Costo empresa por cadete"
            valor={formatARS(config.costoEmpresaCadete)}
          />
        </div>
      )}

      {/* ── Formulario de carga ────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-text-primary">Registrar jornada</h2>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-muted" htmlFor="fecha-jornada">
              Fecha
            </label>
            <input
              id="fecha-jornada"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text-primary"
            />
          </div>
        </div>

        {cadetes.length === 0 ? (
          <EmptyState message="No hay cadetes activos cargados en Equipo" />
        ) : (
          <>
            <div className="divide-y divide-border/50">
              {cadetesConViajes.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-4 py-3">
                  <span className="flex-1 text-sm text-text-primary">{c.nombre}</span>
                  <input
                    type="number"
                    min={0}
                    placeholder="Viajes"
                    value={viajesPorCadete[c.id] || ''}
                    onChange={(e) => setViajes(c.id, e.target.value)}
                    className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-right text-sm text-text-primary"
                  />
                  <span className="w-32 text-right text-sm tabular-nums text-text-secondary">
                    {c.viajes > 0 ? formatARS(c.pago) : '—'}
                  </span>
                </div>
              ))}

              {cadetes.filter((c) => yaRegistrados.has(c.id)).length > 0 && (
                <div className="py-3 text-xs text-text-muted">
                  Ya cargados para esta fecha:{' '}
                  {cadetes
                    .filter((c) => yaRegistrados.has(c.id))
                    .map((c) => c.nombre)
                    .join(', ')}
                </div>
              )}
            </div>

            {totalAConfirmar.length > 0 && (
              <div className="mt-4 rounded-md bg-surface-alt p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary">
                    {totalAConfirmar.length} cadete(s) — pago total
                  </span>
                  <span className="font-medium tabular-nums text-text-primary">
                    {formatARS(totalPagoPreview)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-text-secondary">Costo empresa cadetería</span>
                  <span className="font-medium tabular-nums text-text-primary">
                    {formatARS(totalCostoEmpresaPreview)}
                  </span>
                </div>
              </div>
            )}

            <button
              onClick={confirmarRegistro}
              disabled={guardando || totalAConfirmar.length === 0}
              className="mt-4 rounded-md bg-brand-light px-4 py-2 text-sm font-medium text-text-primary hover:opacity-90 disabled:opacity-40"
            >
              {guardando ? 'Registrando…' : 'Confirmar y registrar jornada'}
            </button>
          </>
        )}
      </div>

      {/* ── Histórico + resumen del rango ──────────────────────────────── */}
      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-text-primary">Histórico de jornadas</h2>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={rangoDesde}
              onChange={(e) => setRangoDesde(e.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text-primary"
            />
            <span className="text-text-muted">—</span>
            <input
              type="date"
              value={rangoHasta}
              onChange={(e) => setRangoHasta(e.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text-primary"
            />
          </div>
        </div>

        {resumen && (
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ResumenCard titulo="Total pagado a cadetes" valor={formatARS(resumen.totalPagadoCadetes)} />
            <ResumenCard titulo="Total costo empresa" valor={formatARS(resumen.totalCostoEmpresa)} />
            <ResumenCard titulo="Total costo delivery" valor={formatARS(resumen.totalCostoDelivery)} />
            <ResumenCard titulo="Total viajes" valor={resumen.totalViajes.toString()} />
          </div>
        )}

        {loadingHistorico ? (
          <div className="py-8 text-center text-sm text-text-muted">Cargando histórico…</div>
        ) : jornadas.length === 0 ? (
          <EmptyState message="Sin jornadas registradas en este rango" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="pb-2 font-medium">Fecha</th>
                <th className="pb-2 font-medium">Cadete</th>
                <th className="pb-2 text-right font-medium">Viajes</th>
                <th className="pb-2 text-right font-medium">Pago</th>
                <th className="pb-2 text-right font-medium">Costo empresa</th>
                <th className="pb-2 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {jornadas.map((j) => (
                <tr key={j.id}>
                  <td className="py-2 text-text-secondary">{j.fecha}</td>
                  <td className="py-2 text-text-primary">{j.nombreCadete}</td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">
                    {j.viajesRealizados}
                  </td>
                  <td className="py-2 text-right tabular-nums text-text-primary">
                    {formatARS(j.pagoCadete)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-text-secondary">
                    {formatARS(j.costoEmpresaCadeteUsado)}
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => abrirEdicion(j)}
                        aria-label={`Editar jornada de ${j.nombreCadete}`}
                        className="rounded-md p-1.5 text-text-muted hover:bg-surface-alt hover:text-text-primary"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => setJornadaAEliminar(j)}
                        aria-label={`Eliminar jornada de ${j.nombreCadete}`}
                        className="rounded-md p-1.5 text-text-muted hover:bg-negative-bg hover:text-negative"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Panel de edición de jornada ─────────────────────────────────── */}
      <SidePanel
        open={jornadaEnEdicion !== null}
        onClose={cerrarEdicion}
        title={jornadaEnEdicion ? `Editar jornada — ${jornadaEnEdicion.nombreCadete}` : ''}
      >
        {jornadaEnEdicion && (
          <div className="space-y-4">
            {editError && (
              <div className="rounded-lg border border-negative bg-negative-bg px-3 py-2 text-sm text-negative">
                {editError}
              </div>
            )}

            <Field label="Fecha">
              <Input
                type="date"
                value={editFecha}
                onChange={(e) => setEditFecha(e.target.value)}
              />
            </Field>

            <Field label="Viajes realizados">
              <Input
                type="number"
                min={1}
                value={editViajes}
                onChange={(e) => setEditViajes(e.target.value)}
              />
            </Field>

            <Field label="Observación" hint="Opcional">
              <Input
                type="text"
                value={editObservacion}
                onChange={(e) => setEditObservacion(e.target.value)}
              />
            </Field>

            <div className="rounded-md bg-surface-alt p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Pago recalculado</span>
                <span className="font-medium tabular-nums text-text-primary">
                  {formatARS(previewPagoEdicion)}
                </span>
              </div>
              <div className="mt-1 text-xs text-text-muted">
                Calculado con la base mínima y el valor por viaje que ya estaban congelados en
                esta jornada — no con los valores vigentes hoy en Configuración.
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={cerrarEdicion}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={guardarEdicion} disabled={guardandoEdicion}>
                {guardandoEdicion ? 'Guardando…' : 'Guardar cambios'}
              </Button>
            </div>
          </div>
        )}
      </SidePanel>

      {/* ── Confirmación de eliminación ─────────────────────────────────── */}
      {jornadaAEliminar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/20"
            onClick={() => !eliminando && setJornadaAEliminar(null)}
          />
          <div className="relative w-full max-w-sm rounded-lg border border-border bg-surface p-5 shadow-xl">
            <h3 className="text-sm font-semibold text-text-primary">¿Eliminar jornada?</h3>
            <p className="mt-2 text-sm text-text-secondary">
              Se eliminará la jornada de <strong>{jornadaAEliminar.nombreCadete}</strong> del{' '}
              {jornadaAEliminar.fecha} ({jornadaAEliminar.viajesRealizados} viajes,{' '}
              {formatARS(jornadaAEliminar.pagoCadete)}). Esta acción no se puede deshacer.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setJornadaAEliminar(null)}
                disabled={eliminando}
              >
                Cancelar
              </Button>
              <Button variant="danger" onClick={confirmarEliminacion} disabled={eliminando}>
                {eliminando ? 'Eliminando…' : 'Eliminar'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Toast />
    </div>
  );
}
