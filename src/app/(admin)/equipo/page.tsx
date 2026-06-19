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
  useToast,
} from '@/components/ui';
import type { Rol, Miembro } from './actions';
import {
  obtenerEquipo,
  crearMiembro,
  actualizarMiembro,
  toggleActivoMiembro,
} from './actions';

// ─── Constantes ────────────────────────────────────────────────────────────

const ROLES: { value: Rol; label: string; color: string }[] = [
  { value: 'cadete', label: 'Cadete', color: 'yellow' },
  { value: 'cocina', label: 'Cocina', color: 'red' },
  { value: 'caja', label: 'Caja', color: 'green' },
  { value: 'general', label: 'General', color: 'gray' },
];

const ROL_LABELS: Record<string, string> = Object.fromEntries(
  ROLES.map((r) => [r.value, r.label])
);

const ROL_COLORS: Record<string, string> = Object.fromEntries(
  ROLES.map((r) => [r.value, r.color])
);

// ─── Page ──────────────────────────────────────────────────────────────────

export default function EquipoPage() {
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

  // ── Filtrado ──
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

  // Contadores para badges
  const totalActivos = miembros.filter((m) => m.activo).length;
  const porRol = ROLES.map((r) => ({
    ...r,
    count: miembros.filter((m) => m.activo && m.rol === r.value).length,
  }));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
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
        <Button onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Nuevo miembro
        </Button>
      </div>

      {/* Filtros */}
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

      {/* Tabla */}
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

      {/* SidePanel: Nuevo miembro */}
      <SidePanel open={showNew} onClose={() => setShowNew(false)} title="Nuevo miembro">
        <FormMiembro onSubmit={handleCrear} pending={pending} isNew />
      </SidePanel>

      {/* SidePanel: Editar miembro */}
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

// ─── Formulario ────────────────────────────────────────────────────────────

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
