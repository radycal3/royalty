'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { calcularKpis } from '../../(admin)/dashboard/actions';
import { obtenerPeriodoActual } from '../../(admin)/gastos/actions';

// ─── Types ─────────────────────────────────────────────────────────────────
// Ninguno de estos tipos incluye un campo en pesos — principio 2.10.

export type ResumenEmpleado = {
  periodoLabel: string;
  pedidos: number;
  hamburguesasVendidas: number;
  margenNeto: number;
};

export type MargenSemana = {
  label: string;
  margenNeto: number;
};

export type MetaEquipo = {
  nivel: number;
  margenMinimo: number;
  descripcion: string;
  color: 'gray' | 'green' | 'yellow' | 'red';
};

// ─── Fecha de hoy (servidor) ────────────────────────────────────────────────
// Nunca usar `new Date()` en el cliente para esto — mismatch de hidratación.
// Se calcula en el servidor dentro de un server action, no en el render.

export async function obtenerFechaHoy(): Promise<string> {
  const hoy = new Date();
  const y = hoy.getFullYear();
  const m = String(hoy.getMonth() + 1).padStart(2, '0');
  const d = String(hoy.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─── Resumen de la semana en curso (en vivo) ───────────────────────────────
// calcularKpis() devuelve KpisPeriodo completo (con $). Se usa el admin
// client porque un empleado no tiene RLS para leer pedidos/gastos/etc., y
// acá se descartan todos los campos en pesos antes de retornar — nunca
// salen del server action.

export async function obtenerResumenEmpleado(): Promise<ResumenEmpleado> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('No autenticado');

  const periodo = await obtenerPeriodoActual();
  const admin = createAdminClient();
  const kpis = await calcularKpis(admin, periodo.fechaDesde, periodo.fechaHasta);

  return {
    periodoLabel: periodo.label,
    pedidos: kpis.pedidos,
    hamburguesasVendidas: kpis.hamburguesasVendidas,
    margenNeto: kpis.margenNeto,
  };
}

// ─── Evolución del margen neto (semanas cerradas) ──────────────────────────
// Lee la vista periodos_margen_empleado (migración 030), que solo expone
// label/desde/hasta/margen_neto. La tabla `periodos` en sí es admin-only.

export async function obtenerMargenHistorico(n: number = 8): Promise<MargenSemana[]> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('periodos_margen_empleado')
    .select('label, margen_neto, desde')
    .order('desde', { ascending: false })
    .limit(n);

  if (error) throw new Error(`Error al obtener evolución: ${error.message}`);

  return (data || [])
    .map((p: any) => ({ label: p.label, margenNeto: p.margen_neto }))
    .reverse();
}

// ─── Metas / niveles de recompensa configurados por el admin ──────────────

export async function obtenerMetasEquipo(): Promise<MetaEquipo[]> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('metas_equipo')
    .select('nivel, margen_minimo, descripcion, color')
    .eq('activo', true)
    .order('nivel');

  if (error) throw new Error(`Error al obtener metas: ${error.message}`);

  return (data || []).map((m: any) => ({
    nivel: m.nivel,
    margenMinimo: m.margen_minimo,
    descripcion: m.descripcion,
    color: m.color,
  }));
}
