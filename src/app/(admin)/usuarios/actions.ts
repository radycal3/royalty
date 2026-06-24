'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// ─── Types ─────────────────────────────────────────────────────────────────

export type RolUsuario = 'admin' | 'empleado';

export type Usuario = {
  id: string;
  email: string;
  nombre: string;
  rol: RolUsuario;
  activo: boolean;
  created_at: string;
};

// ─── Helper: exige que quien llama sea admin ───────────────────────────────
// createAdminClient() bypasea RLS por completo, así que esta verificación
// reemplaza la protección que normalmente da la policy de la tabla.

async function exigirAdmin() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('No autenticado');

  const { data: yo } = await supabase
    .from('usuarios')
    .select('rol')
    .eq('id', auth.user.id)
    .single();

  if (yo?.rol !== 'admin') throw new Error('No autorizado');
  return auth.user.id;
}

// ─── Listar usuarios ───────────────────────────────────────────────────────

export async function obtenerUsuarios(): Promise<Usuario[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('usuarios')
    .select('*')
    .order('nombre');

  if (error) throw new Error(`Error al obtener usuarios: ${error.message}`);
  return (data || []) as Usuario[];
}

// ─── Crear usuario (admin o empleado) ──────────────────────────────────────

export async function crearUsuario(formData: FormData) {
  await exigirAdmin();

  const nombre = (formData.get('nombre') as string)?.trim();
  const email = (formData.get('email') as string)?.trim().toLowerCase();
  const password = formData.get('password') as string;
  const rol = formData.get('rol') as RolUsuario;

  if (!nombre) return { error: 'El nombre es obligatorio' };
  if (!email) return { error: 'El email es obligatorio' };
  if (!password || password.length < 8) {
    return { error: 'La contraseña debe tener al menos 8 caracteres' };
  }
  if (rol !== 'admin' && rol !== 'empleado') return { error: 'Rol inválido' };

  const admin = createAdminClient();

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) {
    if (authError.message.toLowerCase().includes('already')) {
      return { error: 'Ya existe un usuario con ese email' };
    }
    return { error: authError.message };
  }

  const { error: insertError } = await admin.from('usuarios').insert({
    id: created.user.id,
    email,
    nombre,
    rol,
    activo: true,
  });

  if (insertError) {
    // Sin esto quedaría un usuario de Auth fantasma, sin fila en `usuarios`,
    // que nunca podría loguearse (el middleware no le encuentra rol).
    await admin.auth.admin.deleteUser(created.user.id);
    if (insertError.code === '23505') return { error: 'Ya existe un usuario con ese email' };
    return { error: insertError.message };
  }

  return { success: true };
}

// ─── Activar / desactivar acceso ───────────────────────────────────────────
// Desactivar no solo apaga el flag `activo` (usado en la lista): también
// bloquea el login a nivel Auth con un ban, porque `activo=false` por si
// solo no impediría que la persona siga iniciando sesión.

export async function toggleActivoUsuario(id: string, activo: boolean) {
  const miId = await exigirAdmin();

  if (id === miId) return { error: 'No podés desactivar tu propia cuenta' };

  const admin = createAdminClient();

  const { error: banError } = await admin.auth.admin.updateUserById(id, {
    ban_duration: activo ? 'none' : '876000h',
  });
  if (banError) return { error: banError.message };

  const { error } = await admin.from('usuarios').update({ activo }).eq('id', id);
  if (error) return { error: error.message };

  return { success: true };
}
