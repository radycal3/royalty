'use client';

import { useState, useEffect, useTransition, useRef } from 'react';
import { Plus, KeyRound, UserCog, Archive, ArchiveRestore, Dices } from 'lucide-react';
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
import { formatDate } from '@/lib/utils/format';
import type { Usuario } from './actions';
import { obtenerUsuarios, crearUsuario, toggleActivoUsuario } from './actions';

// ─── Page ──────────────────────────────────────────────────────────────────

export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pending, startTransition] = useTransition();
  const { show, Toast } = useToast();
  const requestId = useRef(0);

  useEffect(() => {
    loadUsuarios();
  }, []);

  async function loadUsuarios() {
    const thisRequest = ++requestId.current;
    const data = await obtenerUsuarios();
    if (thisRequest === requestId.current) {
      setUsuarios(data);
      setLoaded(true);
    }
  }

  async function handleCrear(fd: FormData) {
    startTransition(async () => {
      const r = await crearUsuario(fd);
      if (r.error) { show(r.error, 'error'); return; }
      show('Usuario creado');
      setShowNew(false);
      await loadUsuarios();
    });
  }

  async function handleToggleActivo(u: Usuario) {
    startTransition(async () => {
      const r = await toggleActivoUsuario(u.id, !u.activo);
      if (r.error) { show(r.error, 'error'); return; }
      show(u.activo ? 'Acceso desactivado' : 'Acceso reactivado');
      await loadUsuarios();
    });
  }

  const totalActivos = usuarios.filter((u) => u.activo).length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Usuarios</h1>
          <p className="text-text-muted text-sm mt-1">
            Cuentas de acceso al sistema — {totalActivos} con acceso activo.
          </p>
        </div>
        <Button onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Nuevo usuario
        </Button>
      </div>

      {!loaded ? (
        <div className="text-text-muted text-sm py-8 text-center">Cargando usuarios...</div>
      ) : usuarios.length === 0 ? (
        <EmptyState
          icon={<UserCog className="w-10 h-10" />}
          title="Sin usuarios cargados"
          description="Creá cuentas de acceso para vos y para tu equipo."
        />
      ) : (
        <div className="bg-surface-alt rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 font-medium text-text-secondary">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary">Email</th>
                <th className="text-center px-4 py-3 font-medium text-text-secondary">Rol</th>
                <th className="text-center px-4 py-3 font-medium text-text-secondary">Estado</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary">Creado</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0 hover:bg-surface transition-colors">
                  <td className="px-4 py-3 font-medium text-text-primary">{u.nombre}</td>
                  <td className="px-4 py-3 text-text-secondary">{u.email}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge color={u.rol === 'admin' ? 'green' : 'gray'}>
                      {u.rol === 'admin' ? 'Admin' : 'Empleado'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge color={u.activo ? 'green' : 'red'}>
                      {u.activo ? 'Activo' : 'Sin acceso'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{formatDate(u.created_at.split('T')[0])}</td>
                  <td className="px-2 py-3">
                    <button
                      onClick={() => handleToggleActivo(u)}
                      title={u.activo ? 'Desactivar acceso' : 'Reactivar acceso'}
                      className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-alt transition-colors"
                    >
                      {u.activo ? <Archive className="w-4 h-4" /> : <ArchiveRestore className="w-4 h-4" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SidePanel open={showNew} onClose={() => setShowNew(false)} title="Nuevo usuario">
        <FormUsuario onSubmit={handleCrear} pending={pending} />
      </SidePanel>

      <Toast />
    </div>
  );
}

// ─── Formulario ────────────────────────────────────────────────────────────

function generarPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function FormUsuario({
  onSubmit,
  pending,
}: {
  onSubmit: (fd: FormData) => void;
  pending: boolean;
}) {
  const [password, setPassword] = useState('');

  return (
    <form action={onSubmit} className="space-y-4">
      <Field label="Nombre">
        <Input name="nombre" required placeholder="Ej: María Pérez" />
      </Field>

      <Field label="Email">
        <Input name="email" type="email" required placeholder="maria@royalty.com" />
      </Field>

      <Field label="Rol">
        <Select name="rol" defaultValue="empleado">
          <option value="empleado">Empleado</option>
          <option value="admin">Admin</option>
        </Select>
      </Field>

      <Field
        label="Contraseña temporal"
        hint="Compartila con la persona — puede ser cualquier contraseña, no hace falta que la cambie."
      >
        <div className="flex gap-2">
          <Input
            name="password"
            type="text"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres"
          />
          <Button type="button" variant="secondary" onClick={() => setPassword(generarPassword())}>
            <Dices className="w-4 h-4" />
          </Button>
        </div>
      </Field>

      <Button type="submit" disabled={pending}>
        <KeyRound className="w-4 h-4 mr-2" />
        Crear usuario
      </Button>
    </form>
  );
}
