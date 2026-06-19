'use server';

import { createClient } from '@/lib/supabase/server';

// ─── Types ─────────────────────────────────────────────────────────────────

export type Rol = 'cadete' | 'cocina' | 'caja' | 'general';

export type Miembro = {
  id: string;
  nombre: string;
  rol: Rol;
  telefono: string | null;
  activo: boolean;
  created_at: string;
};

// ─── Listar miembros ───────────────────────────────────────────────────────

export async function obtenerEquipo(): Promise<Miembro[]> {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('equipo')
    .select('*')
    .order('nombre');

  if (error) throw new Error(`Error al obtener equipo: ${error.message}`);
  return (data || []) as Miembro[];
}

// ─── Crear miembro ─────────────────────────────────────────────────────────

function checkboxValue(formData: FormData, name: string): boolean {
  return formData.getAll(name).includes('true');
}

export async function crearMiembro(formData: FormData) {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const nombre = (formData.get('nombre') as string)?.trim();
  const rol = formData.get('rol') as Rol;
  const telefono = (formData.get('telefono') as string)?.trim() || null;

  if (!nombre) return { error: 'El nombre es obligatorio' };
  if (!rol) return { error: 'El rol es obligatorio' };

  const { error } = await supabase.from('equipo').insert({
    nombre,
    rol,
    telefono,
  });

  if (error) {
    if (error.code === '23505') return { error: 'Ya existe un miembro con ese nombre' };
    return { error: error.message };
  }
  return { success: true };
}

// ─── Actualizar miembro ────────────────────────────────────────────────────

export async function actualizarMiembro(id: string, formData: FormData) {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const nombre = (formData.get('nombre') as string)?.trim();
  const rol = formData.get('rol') as Rol;
  const telefono = (formData.get('telefono') as string)?.trim() || null;
  const activo = checkboxValue(formData, 'activo');

  if (!nombre) return { error: 'El nombre es obligatorio' };

  const { error } = await supabase
    .from('equipo')
    .update({ nombre, rol, telefono, activo })
    .eq('id', id);

  if (error) return { error: error.message };
  return { success: true };
}

// ─── Toggle activo/inactivo ────────────────────────────────────────────────

export async function toggleActivoMiembro(id: string, activo: boolean) {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { error } = await supabase
    .from('equipo')
    .update({ activo })
    .eq('id', id);

  if (error) return { error: error.message };
  return { success: true };
}
