'use client';

import { useEffect, useState } from 'react';
import {
  obtenerConfigCadeteria,
  guardarConfigCadeteria,
  obtenerConfigMeta,
  guardarConfigMeta,
  obtenerConfigAlertas,
  guardarConfigAlertas,
  obtenerConfigProductosConsumo,
  guardarConfigProductosConsumo,
  obtenerProductosActivos,
  obtenerMetasEquipoConfig,
  actualizarMetaEquipo,
  crearMetaEquipo,
  type ConfigCadeteria,
  type ConfigMeta,
  type ConfigAlertas,
  type ConfigProductosConsumo,
  type ProductoOpcion,
  type MetaEquipoConfig,
  type ColorMeta,
} from './actions';
import { Field, Input, Select, Button, useToast } from '@/components/ui';

// ─── Sección genérica: contenedor con título + botón Guardar propio ──────

function Seccion({
  titulo,
  descripcion,
  children,
  onGuardar,
  guardando,
}: {
  titulo: string;
  descripcion?: string;
  children: React.ReactNode;
  onGuardar: () => void;
  guardando: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-text-primary">{titulo}</h2>
      {descripcion && <p className="mt-1 text-xs text-text-muted">{descripcion}</p>}
      <div className="mt-4 space-y-4">{children}</div>
      <div className="mt-4 flex justify-end">
        <Button variant="primary" size="sm" onClick={onGuardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </div>
  );
}

// ─── Componente principal ───────────────────────────────────────────────

export default function ConfiguracionPage() {
  const { show: showToast, Toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cadetería
  const [cadeteria, setCadeteria] = useState<ConfigCadeteria | null>(null);
  const [guardandoCadeteria, setGuardandoCadeteria] = useState(false);

  // Meta
  const [meta, setMeta] = useState<ConfigMeta | null>(null);
  const [guardandoMeta, setGuardandoMeta] = useState(false);

  // Alertas
  const [alertas, setAlertas] = useState<ConfigAlertas | null>(null);
  const [guardandoAlertas, setGuardandoAlertas] = useState(false);

  // Productos de consumo
  const [productosConsumo, setProductosConsumo] = useState<ConfigProductosConsumo | null>(null);
  const [productosOpciones, setProductosOpciones] = useState<ProductoOpcion[]>([]);
  const [guardandoProductos, setGuardandoProductos] = useState(false);

  // Metas del equipo
  const [metasEquipo, setMetasEquipo] = useState<MetaEquipoConfig[]>([]);

  useEffect(() => {
    async function cargarTodo() {
      setLoading(true);
      setError(null);
      try {
        const [c, m, a, pc, opciones, metas] = await Promise.all([
          obtenerConfigCadeteria(),
          obtenerConfigMeta(),
          obtenerConfigAlertas(),
          obtenerConfigProductosConsumo(),
          obtenerProductosActivos(),
          obtenerMetasEquipoConfig(),
        ]);
        setCadeteria(c);
        setMeta(m);
        setAlertas(a);
        setProductosConsumo(pc);
        setProductosOpciones(opciones);
        setMetasEquipo(metas);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al cargar configuración');
      } finally {
        setLoading(false);
      }
    }
    cargarTodo();
  }, []);

  async function recargarMetas() {
    setMetasEquipo(await obtenerMetasEquipoConfig());
  }

  async function handleGuardarCadeteria() {
    if (!cadeteria) return;
    setGuardandoCadeteria(true);
    try {
      const r = await guardarConfigCadeteria(cadeteria);
      if (!r.ok) showToast(r.mensaje, 'error');
      else showToast('Cadetería actualizada. Afecta solo jornadas futuras.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al guardar', 'error');
    } finally {
      setGuardandoCadeteria(false);
    }
  }

  async function handleGuardarMeta() {
    if (!meta) return;
    setGuardandoMeta(true);
    try {
      const r = await guardarConfigMeta(meta);
      if (!r.ok) showToast(r.mensaje, 'error');
      else showToast('Meta semanal actualizada.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al guardar', 'error');
    } finally {
      setGuardandoMeta(false);
    }
  }

  async function handleGuardarAlertas() {
    if (!alertas) return;
    setGuardandoAlertas(true);
    try {
      const r = await guardarConfigAlertas(alertas);
      if (!r.ok) showToast(r.mensaje, 'error');
      else showToast('Alertas actualizadas.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al guardar', 'error');
    } finally {
      setGuardandoAlertas(false);
    }
  }

  async function handleGuardarProductos() {
    if (!productosConsumo) return;
    setGuardandoProductos(true);
    try {
      const r = await guardarConfigProductosConsumo(productosConsumo);
      if (!r.ok) showToast(r.mensaje, 'error');
      else showToast('Productos de consumo actualizados.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Error al guardar', 'error');
    } finally {
      setGuardandoProductos(false);
    }
  }

  if (loading) {
    return <div className="py-16 text-center text-sm text-text-muted">Cargando…</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-text-primary">Configuración</h1>

      {error && (
        <div className="rounded-lg border border-negative bg-negative-bg px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      {/* ── Cadetería ──────────────────────────────────────────────────── */}
      {cadeteria && (
        <Seccion
          titulo="Cadetería"
          descripcion="Afecta únicamente jornadas que se registren después de guardar. Las jornadas ya cargadas mantienen los valores con los que se liquidaron."
          onGuardar={handleGuardarCadeteria}
          guardando={guardandoCadeteria}
        >
          <Field label="Base mínima por noche (ARS)">
            <Input
              type="number"
              min={0}
              value={cadeteria.cadeteBaseMinima}
              onChange={(e) =>
                setCadeteria({ ...cadeteria, cadeteBaseMinima: parseFloat(e.target.value) || 0 })
              }
            />
          </Field>
          <Field label="Valor por viaje (ARS)">
            <Input
              type="number"
              min={0}
              value={cadeteria.cadeteValorViaje}
              onChange={(e) =>
                setCadeteria({ ...cadeteria, cadeteValorViaje: parseFloat(e.target.value) || 0 })
              }
            />
          </Field>
          <Field label="Costo empresa de cadetería por cadete activo (ARS)">
            <Input
              type="number"
              min={0}
              value={cadeteria.costoEmpresaCadete}
              onChange={(e) =>
                setCadeteria({
                  ...cadeteria,
                  costoEmpresaCadete: parseFloat(e.target.value) || 0,
                })
              }
            />
          </Field>
        </Seccion>
      )}

      {/* ── Meta semanal ───────────────────────────────────────────────── */}
      {meta && (
        <Seccion
          titulo="Meta semanal"
          onGuardar={handleGuardarMeta}
          guardando={guardandoMeta}
        >
          <Field label="Nombre de la meta">
            <Input
              type="text"
              value={meta.metaNombre}
              onChange={(e) => setMeta({ ...meta, metaNombre: e.target.value })}
            />
          </Field>
          <Field label="Descripción">
            <Input
              type="text"
              value={meta.metaDescripcion}
              onChange={(e) => setMeta({ ...meta, metaDescripcion: e.target.value })}
            />
          </Field>
          <Field label="Cantidad de hamburguesas">
            <Input
              type="number"
              min={0}
              value={meta.metaHamburguesas}
              onChange={(e) =>
                setMeta({ ...meta, metaHamburguesas: parseFloat(e.target.value) || 0 })
              }
            />
          </Field>
        </Seccion>
      )}

      {/* ── Alertas ────────────────────────────────────────────────────── */}
      {alertas && (
        <Seccion
          titulo="Alertas"
          descripcion="Umbrales usados para destacar valores fuera de rango en el dashboard."
          onGuardar={handleGuardarAlertas}
          guardando={guardandoAlertas}
        >
          <Field label="Margen mínimo — zona Alerta (%)" hint="Por debajo de este valor se considera zona Problema">
            <Input
              type="number"
              min={0}
              max={100}
              value={alertas.alertaMargenMinimo}
              onChange={(e) =>
                setAlertas({ ...alertas, alertaMargenMinimo: parseFloat(e.target.value) || 0 })
              }
            />
          </Field>
          <Field
            label="Margen mínimo — zona Objetivo (%)"
            hint="Entre Alerta y Objetivo: margen aceptable pero con margen de mejora"
          >
            <Input
              type="number"
              min={0}
              max={100}
              value={alertas.margenObjetivoMinimo}
              onChange={(e) =>
                setAlertas({ ...alertas, margenObjetivoMinimo: parseFloat(e.target.value) || 0 })
              }
            />
          </Field>
          <Field
            label="Margen mínimo — zona Excelente (%)"
            hint="Por encima de este valor el negocio está en zona Excelente de rentabilidad"
          >
            <Input
              type="number"
              min={0}
              max={100}
              value={alertas.margenExcelenteMinimo}
              onChange={(e) =>
                setAlertas({ ...alertas, margenExcelenteMinimo: parseFloat(e.target.value) || 0 })
              }
            />
          </Field>
          <Field
            label="Publicidad máxima sobre ventas (%)"
            hint="Por encima de este valor se considera alto"
          >
            <Input
              type="number"
              min={0}
              max={100}
              value={alertas.alertaPublicidadMaxima}
              onChange={(e) =>
                setAlertas({
                  ...alertas,
                  alertaPublicidadMaxima: parseFloat(e.target.value) || 0,
                })
              }
            />
          </Field>
        </Seccion>
      )}

      {/* ── Productos de consumo ──────────────────────────────────────── */}
      {productosConsumo && (
        <Seccion
          titulo="Productos de consumo interno"
          descripcion="Producto que se usa al registrar consumo interno de empleados y de cadetes."
          onGuardar={handleGuardarProductos}
          guardando={guardandoProductos}
        >
          {productosOpciones.length === 0 ? (
            <p className="text-sm text-text-muted">
              No hay productos activos disponibles para seleccionar.
            </p>
          ) : (
            <>
              <Field label="Producto para consumo de empleado">
                <Select
                  value={productosConsumo.productoConsumoEmpleado || ''}
                  onChange={(e) =>
                    setProductosConsumo({
                      ...productosConsumo,
                      productoConsumoEmpleado: e.target.value || null,
                    })
                  }
                >
                  <option value="">Seleccionar producto…</option>
                  {productosOpciones.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Producto para consumo de cadete">
                <Select
                  value={productosConsumo.productoConsumoCadete || ''}
                  onChange={(e) =>
                    setProductosConsumo({
                      ...productosConsumo,
                      productoConsumoCadete: e.target.value || null,
                    })
                  }
                >
                  <option value="">Seleccionar producto…</option>
                  {productosOpciones.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
        </Seccion>
      )}

      {/* ── Metas del equipo ──────────────────────────────────────────── */}
      <SeccionMetasEquipo metas={metasEquipo} onCambio={recargarMetas} showToast={showToast} />

      <Toast />
    </div>
  );
}

// ─── Metas del equipo (dashboard de empleados, /panel) ─────────────────────

const COLORES_META: ColorMeta[] = ['gray', 'yellow', 'green', 'red'];

function SeccionMetasEquipo({
  metas,
  onCambio,
  showToast,
}: {
  metas: MetaEquipoConfig[];
  onCambio: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}) {
  const [guardandoId, setGuardandoId] = useState<string | null>(null);
  const [agregando, setAgregando] = useState(false);

  async function handleGuardar(m: MetaEquipoConfig) {
    setGuardandoId(m.id);
    const r = await actualizarMetaEquipo(m.id, {
      margenMinimo: m.margenMinimo,
      descripcion: m.descripcion,
      color: m.color,
      activo: m.activo,
    });
    if (!r.ok) showToast(r.mensaje, 'error');
    else showToast('Meta actualizada');
    setGuardandoId(null);
    onCambio();
  }

  async function handleAgregar() {
    const siguienteNivel = metas.length > 0 ? Math.max(...metas.map((m) => m.nivel)) + 1 : 1;
    if (siguienteNivel > 5) return;
    setAgregando(true);
    const r = await crearMetaEquipo({
      nivel: siguienteNivel,
      margenMinimo: 0,
      descripcion: 'Nuevo nivel',
      color: 'gray',
    });
    if (!r.ok) showToast(r.mensaje, 'error');
    setAgregando(false);
    onCambio();
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold text-text-primary">Metas del equipo</h2>
      <p className="mt-1 text-xs text-text-muted">
        Niveles de recompensa por margen neto, visibles para empleados en /panel. Evitá poner
        montos en pesos en la descripción — los empleados nunca ven montos en pesos.
      </p>
      <div className="mt-4 space-y-3">
        {metas.map((m) => (
          <FilaMeta key={m.id} meta={m} guardando={guardandoId === m.id} onGuardar={handleGuardar} />
        ))}
      </div>
      {metas.length < 5 && (
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" size="sm" onClick={handleAgregar} disabled={agregando}>
            {agregando ? 'Agregando…' : '+ Agregar nivel'}
          </Button>
        </div>
      )}
    </div>
  );
}

function FilaMeta({
  meta,
  guardando,
  onGuardar,
}: {
  meta: MetaEquipoConfig;
  guardando: boolean;
  onGuardar: (m: MetaEquipoConfig) => void;
}) {
  const [local, setLocal] = useState(meta);

  return (
    <div className="grid grid-cols-12 gap-2 items-end border-b border-border pb-3 last:border-0 last:pb-0">
      <div className="col-span-1 text-xs text-text-muted pb-2">Nivel {local.nivel}</div>
      <div className="col-span-4">
        <Field label="Descripción">
          <Input
            type="text"
            value={local.descripcion}
            onChange={(e) => setLocal({ ...local, descripcion: e.target.value })}
          />
        </Field>
      </div>
      <div className="col-span-2">
        <Field label="Desde (%)">
          <Input
            type="number"
            value={local.margenMinimo}
            onChange={(e) => setLocal({ ...local, margenMinimo: parseFloat(e.target.value) || 0 })}
          />
        </Field>
      </div>
      <div className="col-span-2">
        <Field label="Color">
          <Select
            value={local.color}
            onChange={(e) => setLocal({ ...local, color: e.target.value as ColorMeta })}
          >
            {COLORES_META.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="col-span-1 pb-2">
        <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={local.activo}
            onChange={(e) => setLocal({ ...local, activo: e.target.checked })}
            className="rounded border-border"
          />
          Activo
        </label>
      </div>
      <div className="col-span-2 pb-0.5">
        <Button size="sm" onClick={() => onGuardar(local)} disabled={guardando} className="w-full">
          {guardando ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </div>
  );
}
