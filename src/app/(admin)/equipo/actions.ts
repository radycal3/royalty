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

// ─── Métricas semanales del equipo ──────────────────────────────────────────
// Carga manual del admin. Sin ningún campo en pesos.

export type MetricasEquipoSemana = {
  periodoDesde: string;
  periodoHasta: string;
  mensajesRecibidos: number | null;
  mensajesConvertidos: number | null;
  tiempoPromedioProduccionMin: number | null;
  quejasFaltantes: number | null;
  quejasCalidad: number | null;
};

export async function obtenerMetricasPeriodo(periodoDesde: string): Promise<MetricasEquipoSemana | null> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('metricas_equipo_semana')
    .select('*')
    .eq('periodo_desde', periodoDesde)
    .maybeSingle();

  if (error) throw new Error(`Error al obtener métricas: ${error.message}`);
  if (!data) return null;

  return {
    periodoDesde: data.periodo_desde,
    periodoHasta: data.periodo_hasta,
    mensajesRecibidos: data.mensajes_recibidos,
    mensajesConvertidos: data.mensajes_convertidos,
    tiempoPromedioProduccionMin: data.tiempo_promedio_produccion_min,
    quejasFaltantes: data.quejas_faltantes,
    quejasCalidad: data.quejas_calidad,
  };
}

export async function guardarMetricasPeriodo(input: {
  periodoDesde: string;
  periodoHasta: string;
  mensajesRecibidos: number | null;
  mensajesConvertidos: number | null;
  tiempoPromedioProduccionMin: number | null;
  quejasFaltantes: number | null;
  quejasCalidad: number | null;
}) {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { error } = await supabase
    .from('metricas_equipo_semana')
    .upsert(
      {
        periodo_desde: input.periodoDesde,
        periodo_hasta: input.periodoHasta,
        mensajes_recibidos: input.mensajesRecibidos,
        mensajes_convertidos: input.mensajesConvertidos,
        tiempo_promedio_produccion_min: input.tiempoPromedioProduccionMin,
        quejas_faltantes: input.quejasFaltantes,
        quejas_calidad: input.quejasCalidad,
        registrado_por: user.user.id,
      },
      { onConflict: 'periodo_desde' }
    );

  if (error) return { error: error.message };
  return { success: true };
}

export async function obtenerMetricasHistorico(n: number = 8): Promise<MetricasEquipoSemana[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('metricas_equipo_semana')
    .select('*')
    .order('periodo_desde', { ascending: false })
    .limit(n);

  if (error) throw new Error(`Error al obtener histórico: ${error.message}`);

  return (data || [])
    .map((d: any) => ({
      periodoDesde: d.periodo_desde,
      periodoHasta: d.periodo_hasta,
      mensajesRecibidos: d.mensajes_recibidos,
      mensajesConvertidos: d.mensajes_convertidos,
      tiempoPromedioProduccionMin: d.tiempo_promedio_produccion_min,
      quejasFaltantes: d.quejas_faltantes,
      quejasCalidad: d.quejas_calidad,
    }))
    .reverse();
}
