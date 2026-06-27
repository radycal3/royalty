'use client';

import { useState, useEffect, useTransition, useRef } from 'react';
import {
  Plus,
  Search,
  Archive,
  ArchiveRestore,
  Phone,
  Users,
} from 'lucide-react';
import {
  SidePanel,
  Field,
  Input,
  Select,
  Button,
  Badge,
  EmptyState,
  Tabs,
  useToast,
} from '@/components/ui';
import type {
  Rol,
  Miembro,
  MetricasEquipoSemana,
  FaltanteItem,
  QuejaItem,
  ProductoCatalogo,
} from './actions';
import {
  obtenerEquipo,
  crearMiembro,
  actualizarMiembro,
  toggleActivoMiembro,
  obtenerMetricasPeriodo,
  guardarMetricasPeriodo,
  obtenerProductosCatalogo,
} from './actions';
import type { PeriodoInfo } from '../gastos/actions';
import { obtenerPeriodoActual, obtenerPeriodoPorOffset } from '../gastos/actions';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatARS } from '@/lib/utils/format';

// ─── Constantes ────────────────────────────────────────────────────────────

type BadgeColor = 'gray' | 'green' | 'red' | 'yellow';

const ROLES: { value: Rol; label: string; color: BadgeColor }[] = [
  { value: 'cadete', label: 'Cadete', color: 'yellow' },
  { value: 'cocina', label: 'Cocina', color: 'red' },
  { value: 'caja', label: 'Caja', color: 'green' },
  { value: 'general', label: 'General', color: 'gray' },
];

const ROL_LABELS: Record<string, string> = Object.fromEntries(
  ROLES.map((r) => [r.value, r.label])
);

const ROL_COLORS: Record<string, BadgeColor> = Object.fromEntries(
  ROLES.map((r) => [r.value, r.color])
);

// ─── Estilos reutilizables ─────────────────────────────────────────────────

const inputClass =
  'bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary ' +
  'placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand w-full';

const selectClass =
  'bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary ' +
  'focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand';

// ─── Page ──────────────────────────────────────────────────────────────────

export default function EquipoPage() {
  const [tab, setTab] = useState('miembros');
  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [filtroRol, setFiltroRol] = useState<string>('todos');
  const [filtroEstado, setFiltroEstado] = useState<string>('activos');
  const [showNew, setShowNew] = useState(false);
  const [editingMiembro, setEditingMiembro] = useState<Miembro | null>(null);
  const [pending, startTransition] = useTransition();
  const { show, Toast } = useToast();
  const requestId = useRef(0);

  useEffect(() => {
    loadEquipo();
  }, []);

  async function loadEquipo() {
    const thisRequest = ++requestId.current;
    const data = await obtenerEquipo();
    if (thisRequest === requestId.current) {
      setMiembros(data);
      setLoaded(true);
    }
  }

  async function handleCrear(fd: FormData) {
    startTransition(async () => {
      const r = await crearMiembro(fd);
      if (r.error) { show(r.error, 'error'); return; }
      show('Miembro agregado');
      setShowNew(false);
      await loadEquipo();
    });
  }

  async function handleActualizar(fd: FormData) {
    if (!editingMiembro) return;
    startTransition(async () => {
      const r = await actualizarMiembro(editingMiembro.id, fd);
      if (r.error) { show(r.error, 'error'); return; }
      show('Miembro actualizado');
      setEditingMiembro(null);
      await loadEquipo();
    });
  }

  async function handleToggleActivo(m: Miembro) {
    startTransition(async () => {
      const r = await toggleActivoMiembro(m.id, !m.activo);
      if (r.error) { show(r.error, 'error'); return; }
      show(m.activo ? 'Miembro archivado' : 'Miembro reactivado');
      await loadEquipo();
    });
  }

  const filtrados = miembros.filter((m) => {
    if (filtroEstado === 'activos' && !m.activo) return false;
    if (filtroEstado === 'inactivos' && m.activo) return false;
    if (filtroRol !== 'todos' && m.rol !== filtroRol) return false;
    if (filtro) {
      const q = filtro.toLowerCase();
      return (
        m.nombre.toLowerCase().includes(q) ||
        m.telefono?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalActivos = miembros.filter((m) => m.activo).length;
  const porRol = ROLES.map((r) => ({
    ...r,
    count: miembros.filter((m) => m.activo && m.rol === r.value).length,
  }));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Equipo</h1>
          <p className="text-text-muted text-sm mt-1">
            {totalActivos} {totalActivos === 1 ? 'miembro activo' : 'miembros activos'}
            {porRol.filter((r) => r.count > 0).length > 0 && (
              <span>
                {' — '}
                {porRol
                  .filter((r) => r.count > 0)
                  .map((r) => `${r.count} ${r.label.toLowerCase()}`)
                  .join(', ')}
              </span>
            )}
          </p>
        </div>
        {tab === 'miembros' && (
          <Button onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Nuevo miembro
          </Button>
        )}
      </div>

      <Tabs
        tabs={[{ key: 'miembros', label: 'Miembros' }, { key: 'metricas', label: 'Métricas semanales' }]}
        activeTab={tab}
        onChange={setTab}
      />

      <div className={tab === 'metricas' ? 'block' : 'hidden'}>
        <TabMetricasEquipo />
      </div>

      <div className={tab === 'miembros' ? 'block space-y-6' : 'hidden'}>
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder="Buscar por nombre o teléfono..."
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-lg text-sm
                         text-text-primary placeholder:text-text-muted focus:outline-none
                         focus:ring-1 focus:ring-brand focus:border-brand"
            />
          </div>
          <select
            value={filtroRol}
            onChange={(e) => setFiltroRol(e.target.value)}
            className="bg-surface border border-border rounded-lg px-3 py-2 text-sm
                       text-text-primary focus:outline-none focus:ring-1 focus:ring-brand"
          >
            <option value="todos">Todos los roles</option>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <select
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
            className="bg-surface border border-border rounded-lg px-3 py-2 text-sm
                       text-text-primary focus:outline-none focus:ring-1 focus:ring-brand"
          >
            <option value="activos">Activos</option>
            <option value="inactivos">Inactivos</option>
            <option value="todos">Todos</option>
          </select>
        </div>

        {!loaded ? (
          <div className="text-text-muted text-sm py-8 text-center">Cargando equipo...</div>
        ) : filtrados.length === 0 ? (
          <EmptyState
            icon={<Users className="w-10 h-10" />}
            title={filtro || filtroRol !== 'todos' ? 'Sin resultados' : 'Sin miembros del equipo'}
            description={
              filtro || filtroRol !== 'todos'
                ? 'Probá con otros filtros.'
                : 'Agregá miembros del equipo para asignar cadetes y registrar consumo interno.'
            }
          />
        ) : (
          <div className="bg-surface-alt rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 font-medium text-text-secondary">Nombre</th>
                  <th className="text-center px-4 py-3 font-medium text-text-secondary">Rol</th>
                  <th className="text-left px-4 py-3 font-medium text-text-secondary">Teléfono</th>
                  <th className="text-center px-4 py-3 font-medium text-text-secondary">Estado</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((m) => (
                  <tr
                    key={m.id}
                    onClick={() => setEditingMiembro(m)}
                    className="border-b border-border last:border-0 hover:bg-surface cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-text-primary">{m.nombre}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge color={ROL_COLORS[m.rol] || 'gray'}>
                        {ROL_LABELS[m.rol] ?? m.rol}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {m.telefono ? (
                        <span className="flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-text-muted" />
                          {m.telefono}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge color={m.activo ? 'green' : 'gray'}>
                        {m.activo ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </td>
                    <td className="px-2 py-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleActivo(m);
                        }}
                        title={m.activo ? 'Archivar' : 'Reactivar'}
                        className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-alt transition-colors"
                      >
                        {m.activo ? (
                          <Archive className="w-4 h-4" />
                        ) : (
                          <ArchiveRestore className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SidePanel open={showNew} onClose={() => setShowNew(false)} title="Nuevo miembro">
        <FormMiembro onSubmit={handleCrear} pending={pending} isNew />
      </SidePanel>

      <SidePanel
        open={!!editingMiembro}
        onClose={() => setEditingMiembro(null)}
        title={editingMiembro?.nombre ?? 'Editar miembro'}
      >
        {editingMiembro && (
          <FormMiembro
            key={editingMiembro.id}
            onSubmit={handleActualizar}
            pending={pending}
            initial={editingMiembro}
          />
        )}
      </SidePanel>

      <Toast />
    </div>
  );
}

// ─── Formulario de miembro ─────────────────────────────────────────────────

function FormMiembro({
  onSubmit,
  pending,
  initial,
  isNew,
}: {
  onSubmit: (fd: FormData) => void;
  pending: boolean;
  initial?: Miembro;
  isNew?: boolean;
}) {
  const [activo, setActivo] = useState(initial?.activo ?? true);

  return (
    <form action={onSubmit} className="space-y-4">
      <Field label="Nombre">
        <Input
          name="nombre"
          required
          defaultValue={initial?.nombre}
          placeholder="Ej: Juan Pérez"
        />
      </Field>

      <Field label="Rol">
        <Select name="rol" defaultValue={initial?.rol ?? 'general'}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Teléfono (opcional)">
        <Input
          name="telefono"
          type="tel"
          defaultValue={initial?.telefono ?? ''}
          placeholder="Ej: 341 555 1234"
        />
      </Field>

      {!isNew && (
        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
          <input type="hidden" name="activo" value="false" />
          <input
            type="checkbox"
            name="activo"
            value="true"
            checked={activo}
            onChange={(e) => setActivo(e.target.checked)}
            className="rounded border-border"
          />
          Activo
        </label>
      )}

      <Button type="submit" disabled={pending}>
        {isNew ? 'Agregar miembro' : 'Guardar cambios'}
      </Button>
    </form>
  );
}

// ─── Tab: Métricas semanales ────────────────────────────────────────────────

type GuardarInput = {
  periodoDesde: string;
  periodoHasta: string;
  mensajesRecibidos: number | null;
  mensajesConvertidos: number | null;
  tiempoPromedioProduccionMin: number | null;
  faltantesInput: { productoId: string; cantidad: number }[];
  quejasInput: string[];
};

function TabMetricasEquipo() {
  const [periodo, setPeriodo] = useState<PeriodoInfo | null>(null);
  const [metricas, setMetricas] = useState<MetricasEquipoSemana | null>(null);
  const [productos, setProductos] = useState<ProductoCatalogo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();
  const { show, Toast } = useToast();

  useEffect(() => {
    (async () => {
      const [p, prods] = await Promise.all([
        obtenerPeriodoActual(),
        obtenerProductosCatalogo(),
      ]);
      setPeriodo(p);
      setProductos(prods);
      await loadMetricas(p.viernes);
    })();
  }, []);

  async function loadMetricas(viernes: string) {
    setLoaded(false);
    const data = await obtenerMetricasPeriodo(viernes);
    setMetricas(data);
    setLoaded(true);
  }

  async function handleNav(offset: number) {
    if (!periodo) return;
    const nuevo = await obtenerPeriodoPorOffset(periodo.viernes, offset);
    setPeriodo(nuevo);
    await loadMetricas(nuevo.viernes);
  }

  function handleGuardar(data: GuardarInput) {
    startTransition(async () => {
      const r = await guardarMetricasPeriodo(data);
      if (r.error) { show(r.error, 'error'); return; }
      show('Métricas guardadas');
      await loadMetricas(data.periodoDesde);
    });
  }

  if (!periodo || !loaded) {
    return <div className="text-text-muted text-sm py-8 text-center">Cargando...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => handleNav(-1)}
          className="p-2 rounded-lg hover:bg-surface-alt text-text-muted hover:text-text-primary transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-center">
          <p className="text-text-primary font-semibold">{periodo.label}</p>
          {periodo.esActual && <Badge color="green">Período actual</Badge>}
        </div>
        <button
          onClick={() => handleNav(1)}
          className="p-2 rounded-lg hover:bg-surface-alt text-text-muted hover:text-text-primary transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <FormMetricas
        key={periodo.viernes}
        metricas={metricas}
        productos={productos}
        periodoDesde={periodo.viernes}
        periodoHasta={periodo.fechaHasta}
        onGuardar={handleGuardar}
        pending={pending}
      />

      <Toast />
    </div>
  );
}

// ─── Formulario de métricas ─────────────────────────────────────────────────

type FaltanteLocal = { _id: string; productoId: string; cantidad: number };
type QuejaLocal = { _id: string; descripcion: string };

function FormMetricas({
  metricas,
  productos,
  periodoDesde,
  periodoHasta,
  onGuardar,
  pending,
}: {
  metricas: MetricasEquipoSemana | null;
  productos: ProductoCatalogo[];
  periodoDesde: string;
  periodoHasta: string;
  onGuardar: (data: GuardarInput) => void;
  pending: boolean;
}) {
  const [mensajesRecibidos, setMensajesRecibidos] = useState(
    metricas?.mensajesRecibidos?.toString() ?? ''
  );
  const [mensajesConvertidos, setMensajesConvertidos] = useState(
    metricas?.mensajesConvertidos?.toString() ?? ''
  );
  const [tiempo, setTiempo] = useState(
    metricas?.tiempoPromedioProduccionMin?.toString() ?? ''
  );
  const [faltantes, setFaltantes] = useState<FaltanteLocal[]>(() =>
    (metricas?.faltantesDetalle ?? []).map((f, i) => ({
      _id: String(i),
      productoId: f.productoId,
      cantidad: f.cantidad,
    }))
  );
  const [quejas, setQuejas] = useState<QuejaLocal[]>(() =>
    (metricas?.quejasDetalle ?? []).map((q, i) => ({
      _id: String(i),
      descripcion: q.descripcion,
    }))
  );
  const nextId = useRef(
    Math.max(
      metricas?.faltantesDetalle.length ?? 0,
      metricas?.quejasDetalle.length ?? 0
    ) + 1
  );

  function parseNum(v: string): number | null {
    return v.trim() === '' ? null : Number(v);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onGuardar({
      periodoDesde,
      periodoHasta,
      mensajesRecibidos: parseNum(mensajesRecibidos),
      mensajesConvertidos: parseNum(mensajesConvertidos),
      tiempoPromedioProduccionMin: parseNum(tiempo),
      faltantesInput: faltantes
        .filter((f) => f.productoId && f.cantidad > 0)
        .map((f) => ({ productoId: f.productoId, cantidad: f.cantidad })),
      quejasInput: quejas
        .filter((q) => q.descripcion.trim() !== '')
        .map((q) => q.descripcion.trim()),
    });
  }

  // Faltantes handlers
  function addFaltante() {
    setFaltantes((prev) => [...prev, { _id: String(nextId.current++), productoId: '', cantidad: 1 }]);
  }
  function removeFaltante(_id: string) {
    setFaltantes((prev) => prev.filter((f) => f._id !== _id));
  }
  function updateFaltanteProducto(_id: string, productoId: string) {
    setFaltantes((prev) => prev.map((f) => (f._id === _id ? { ...f, productoId } : f)));
  }
  function updateFaltanteCantidad(_id: string, cantidad: number) {
    setFaltantes((prev) => prev.map((f) => (f._id === _id ? { ...f, cantidad } : f)));
  }

  // Quejas handlers
  function addQueja() {
    setQuejas((prev) => [...prev, { _id: String(nextId.current++), descripcion: '' }]);
  }
  function removeQueja(_id: string) {
    setQuejas((prev) => prev.filter((q) => q._id !== _id));
  }
  function updateQueja(_id: string, descripcion: string) {
    setQuejas((prev) => prev.map((q) => (q._id === _id ? { ...q, descripcion } : q)));
  }

  const tasa =
    mensajesRecibidos && Number(mensajesRecibidos) > 0 && mensajesConvertidos
      ? ((Number(mensajesConvertidos) / Number(mensajesRecibidos)) * 100).toFixed(1)
      : null;

  const btnAgregar =
    'text-xs px-2.5 py-1 rounded-md border border-border text-text-secondary ' +
    'hover:text-text-primary hover:bg-surface transition-colors';
  const btnRemove =
    'shrink-0 w-7 h-7 flex items-center justify-center rounded text-text-muted ' +
    'hover:text-negative hover:bg-negative-bg transition-colors text-base leading-none';

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-surface-alt rounded-lg border border-border p-5 space-y-5 max-w-md mx-auto"
    >
      {/* Mensajes */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mensajes recibidos">
          <input
            type="number"
            min="0"
            step="1"
            value={mensajesRecibidos}
            onChange={(e) => setMensajesRecibidos(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Mensajes convertidos en pedido">
          <input
            type="number"
            min="0"
            step="1"
            value={mensajesConvertidos}
            onChange={(e) => setMensajesConvertidos(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      {tasa && (
        <p className="text-xs text-text-muted -mt-2">
          Tasa de conversión:{' '}
          <span className="font-medium text-text-primary">{tasa}%</span>
        </p>
      )}

      <Field label="Tiempo promedio de producción (minutos)">
        <input
          type="number"
          min="0"
          step="0.5"
          value={tiempo}
          onChange={(e) => setTiempo(e.target.value)}
          className={inputClass}
        />
      </Field>

      {/* Faltantes */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text-secondary">Faltantes</span>
          <button type="button" onClick={addFaltante} className={btnAgregar}>
            + Agregar faltante
          </button>
        </div>
        {faltantes.length === 0 && (
          <p className="text-xs text-text-muted py-1">Sin faltantes esta semana.</p>
        )}
        {faltantes.map((f) => {
          const prod = productos.find((p) => p.id === f.productoId);
          const valor =
            prod?.precioVigente != null ? prod.precioVigente * f.cantidad : null;
          return (
            <div key={f._id} className="flex items-center gap-2">
              <select
                value={f.productoId}
                onChange={(e) => updateFaltanteProducto(f._id, e.target.value)}
                className={`${selectClass} flex-1 min-w-0`}
              >
                <option value="">Seleccionar producto...</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                step="1"
                value={f.cantidad}
                onChange={(e) => updateFaltanteCantidad(f._id, Math.max(1, Number(e.target.value)))}
                className="bg-surface border border-border rounded-lg px-2 py-2 text-sm text-text-primary
                           focus:outline-none focus:ring-1 focus:ring-brand w-16 text-center"
              />
              {valor != null && (
                <span className="text-xs text-text-muted whitespace-nowrap tabular-nums">
                  {formatARS(valor)}
                </span>
              )}
              <button
                type="button"
                onClick={() => removeFaltante(f._id)}
                className={btnRemove}
                title="Eliminar"
              >
                ×
              </button>
            </div>
          );
        })}
        {faltantes.filter((f) => f.productoId && f.cantidad > 0).length > 0 && (
          <p className="text-xs text-text-muted">
            {(() => {
              const validos = faltantes.filter((f) => f.productoId && f.cantidad > 0);
              const total = validos.reduce((acc, f) => {
                const prod = productos.find((p) => p.id === f.productoId);
                return acc + (prod?.precioVigente != null ? prod.precioVigente * f.cantidad : 0);
              }, 0);
              const count = validos.length;
              return `${count} ${count === 1 ? 'faltante' : 'faltantes'}${total > 0 ? ` — ${formatARS(total)} en ventas perdidas` : ''}`;
            })()}
          </p>
        )}
      </div>

      {/* Quejas de calidad */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text-secondary">Quejas de calidad</span>
          <button type="button" onClick={addQueja} className={btnAgregar}>
            + Agregar queja
          </button>
        </div>
        {quejas.length === 0 && (
          <p className="text-xs text-text-muted py-1">Sin quejas de calidad esta semana.</p>
        )}
        {quejas.map((q) => (
          <div key={q._id} className="flex items-center gap-2">
            <input
              type="text"
              value={q.descripcion}
              onChange={(e) => updateQueja(q._id, e.target.value)}
              placeholder="Ej: vino cruda"
              maxLength={200}
              className={`${inputClass} flex-1`}
            />
            <button
              type="button"
              onClick={() => removeQueja(q._id)}
              className={btnRemove}
              title="Eliminar"
            >
              ×
            </button>
          </div>
        ))}
        {quejas.filter((q) => q.descripcion.trim() !== '').length > 0 && (
          <p className="text-xs text-text-muted">
            {(() => {
              const count = quejas.filter((q) => q.descripcion.trim() !== '').length;
              return `${count} ${count === 1 ? 'queja' : 'quejas'}`;
            })()}
          </p>
        )}
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Guardando...' : 'Guardar métricas'}
      </Button>
    </form>
  );
}
