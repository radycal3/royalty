'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

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

export type FaltanteItem = {
  productoId: string;
  productoNombre: string;
  cantidad: number;
  precioUnitarioVenta: number;
};

export type QuejaItem = {
  descripcion: string;
};

export type ProductoCatalogo = {
  id: string;
  nombre: string;
  precioVigente: number | null;
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

// ─── Catálogo de productos con precio vigente ───────────────────────────────

export async function obtenerProductosCatalogo(): Promise<ProductoCatalogo[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const hoy = new Date().toISOString().split('T')[0];

  const { data: productos, error } = await supabase
    .from('productos')
    .select('id, nombre')
    .eq('activo', true)
    .order('nombre');

  if (error) throw new Error(`Error al obtener productos: ${error.message}`);

  const { data: precios } = await supabase
    .from('productos_precios')
    .select('producto_id, precio, fecha_vigencia, created_at')
    .lte('fecha_vigencia', hoy)
    .order('fecha_vigencia', { ascending: false })
    .order('created_at', { ascending: false });

  const precioVigente: Record<string, number> = {};
  for (const p of precios ?? []) {
    if (!(p.producto_id in precioVigente)) {
      precioVigente[p.producto_id] = p.precio;
    }
  }

  return (productos ?? []).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    precioVigente: precioVigente[p.id] ?? null,
  }));
}

// ─── Métricas semanales del equipo ──────────────────────────────────────────

export type MetricasEquipoSemana = {
  periodoDesde: string;
  periodoHasta: string;
  mensajesRecibidos: number | null;
  mensajesConvertidos: number | null;
  tiempoPromedioProduccionMin: number | null;
  quejasFaltantes: number | null;
  quejasCalidad: number | null;
  faltantesDetalle: FaltanteItem[];
  quejasDetalle: QuejaItem[];
  pedidosEnPeriodo: number | null;
};

function mapMetrica(d: any, pedidosEnPeriodo: number | null = null): MetricasEquipoSemana {
  return {
    periodoDesde: d.periodo_desde,
    periodoHasta: d.periodo_hasta,
    mensajesRecibidos: d.mensajes_recibidos,
    mensajesConvertidos: d.mensajes_convertidos,
    tiempoPromedioProduccionMin: d.tiempo_promedio_produccion_min,
    quejasFaltantes: d.quejas_faltantes,
    quejasCalidad: d.quejas_calidad,
    faltantesDetalle: (d.metricas_faltantes_detalle ?? []).map((f: any) => ({
      productoId: f.producto_id,
      productoNombre: f.producto_nombre,
      cantidad: f.cantidad,
      precioUnitarioVenta: f.precio_unitario_venta,
    })),
    quejasDetalle: (d.metricas_quejas_detalle ?? []).map((q: any) => ({
      descripcion: q.descripcion,
    })),
    pedidosEnPeriodo,
  };
}

// Admin client bypasa RLS — empleados no tienen acceso a importaciones/pedidos.
// El auth del caller ya fue verificado con createClient() antes de llamar a esto.
async function fetchImpIds(): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin.from('importaciones').select('id').eq('estado', 'activa');
  return (data ?? []).map((i: any) => i.id as string);
}

const METRICA_SELECT = '*, metricas_faltantes_detalle(*), metricas_quejas_detalle(*)';

export async function obtenerMetricasPeriodo(periodoDesde: string): Promise<MetricasEquipoSemana | null> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('metricas_equipo_semana')
    .select(METRICA_SELECT)
    .eq('periodo_desde', periodoDesde)
    .maybeSingle();

  if (error) throw new Error(`Error al obtener métricas: ${error.message}`);
  if (!data) return null;

  const impIds = await fetchImpIds();
  let pedidosEnPeriodo: number | null = null;
  if (impIds.length > 0) {
    const admin = createAdminClient();
    const { count } = await admin
      .from('pedidos')
      .select('id', { count: 'exact', head: true })
      .gte('fecha', data.periodo_desde)
      .lte('fecha', data.periodo_hasta)
      .in('importacion_id', impIds);
    pedidosEnPeriodo = count ?? 0;
  }

  return mapMetrica(data, pedidosEnPeriodo);
}

export async function guardarMetricasPeriodo(input: {
  periodoDesde: string;
  periodoHasta: string;
  mensajesRecibidos: number | null;
  mensajesConvertidos: number | null;
  tiempoPromedioProduccionMin: number | null;
  faltantesInput: { productoId: string; cantidad: number }[];
  quejasInput: string[];
}) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) throw new Error('No autenticado');

  const hoy = new Date().toISOString().split('T')[0];

  // Congelar nombre y precio de venta al momento de guardar
  type FaltanteCongelado = {
    producto_id: string;
    producto_nombre: string;
    cantidad: number;
    precio_unitario_venta: number;
  };
  const faltantesCongelados: FaltanteCongelado[] = [];

  if (input.faltantesInput.length > 0) {
    const productoIds = input.faltantesInput.map((f) => f.productoId);

    const { data: productosData, error: prodError } = await supabase
      .from('productos')
      .select('id, nombre')
      .in('id', productoIds);

    if (prodError) return { error: `Error al obtener productos: ${prodError.message}` };

    const nombrePorId: Record<string, string> = {};
    for (const p of productosData ?? []) nombrePorId[p.id] = p.nombre;

    const { data: preciosData, error: precError } = await supabase
      .from('productos_precios')
      .select('producto_id, precio, fecha_vigencia, created_at')
      .in('producto_id', productoIds)
      .lte('fecha_vigencia', hoy)
      .order('fecha_vigencia', { ascending: false })
      .order('created_at', { ascending: false });

    if (precError) return { error: `Error al obtener precios: ${precError.message}` };

    const precioPorId: Record<string, number> = {};
    for (const p of preciosData ?? []) {
      if (!(p.producto_id in precioPorId)) precioPorId[p.producto_id] = p.precio;
    }

    for (const f of input.faltantesInput) {
      const nombre = nombrePorId[f.productoId] ?? f.productoId;
      if (!(f.productoId in precioPorId)) {
        return { error: `El producto "${nombre}" no tiene precio vigente` };
      }
      faltantesCongelados.push({
        producto_id: f.productoId,
        producto_nombre: nombre,
        cantidad: f.cantidad,
        precio_unitario_venta: precioPorId[f.productoId],
      });
    }
  }

  // Upsert de métricas base, obteniendo el id para el detalle
  const { data: metricaData, error: upsertError } = await supabase
    .from('metricas_equipo_semana')
    .upsert(
      {
        periodo_desde: input.periodoDesde,
        periodo_hasta: input.periodoHasta,
        mensajes_recibidos: input.mensajesRecibidos,
        mensajes_convertidos: input.mensajesConvertidos,
        tiempo_promedio_produccion_min: input.tiempoPromedioProduccionMin,
        quejas_faltantes: input.faltantesInput.length > 0 ? input.faltantesInput.length : null,
        quejas_calidad: input.quejasInput.length > 0 ? input.quejasInput.length : null,
        registrado_por: authData.user.id,
      },
      { onConflict: 'periodo_desde' }
    )
    .select('id')
    .single();

  if (upsertError) return { error: upsertError.message };
  const metricaId = metricaData.id;

  // Reemplazar detalle de faltantes (delete + insert)
  const { error: delFaltErr } = await supabase
    .from('metricas_faltantes_detalle')
    .delete()
    .eq('metrica_id', metricaId);
  if (delFaltErr) return { error: delFaltErr.message };

  if (faltantesCongelados.length > 0) {
    const { error: insFaltErr } = await supabase
      .from('metricas_faltantes_detalle')
      .insert(
        faltantesCongelados.map((f) => ({
          metrica_id: metricaId,
          periodo_desde: input.periodoDesde,
          ...f,
        }))
      );
    if (insFaltErr) return { error: insFaltErr.message };
  }

  // Reemplazar detalle de quejas (delete + insert)
  const { error: delQuejaErr } = await supabase
    .from('metricas_quejas_detalle')
    .delete()
    .eq('metrica_id', metricaId);
  if (delQuejaErr) return { error: delQuejaErr.message };

  if (input.quejasInput.length > 0) {
    const { error: insQuejaErr } = await supabase
      .from('metricas_quejas_detalle')
      .insert(
        input.quejasInput.map((desc) => ({
          metrica_id: metricaId,
          descripcion: desc,
        }))
      );
    if (insQuejaErr) return { error: insQuejaErr.message };
  }

  return { success: true };
}

export async function obtenerMetricasHistorico(n: number = 8): Promise<MetricasEquipoSemana[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('metricas_equipo_semana')
    .select(METRICA_SELECT)
    .order('periodo_desde', { ascending: false })
    .limit(n);

  if (error) throw new Error(`Error al obtener histórico: ${error.message}`);

  const rawRows = data || [];
  if (rawRows.length === 0) return [];

  // Una query de importaciones + una de pedidos para todos los períodos.
  // Admin client porque empleados no tienen RLS sobre importaciones/pedidos.
  const impIds = await fetchImpIds();
  const pedidosCountByPeriodo: Record<string, number> = {};

  if (impIds.length > 0) {
    const admin = createAdminClient();
    const minDate = rawRows[rawRows.length - 1].periodo_desde; // más antiguo (orden DESC)
    const maxDate = rawRows[0].periodo_hasta;                   // más nuevo

    const { data: pedidosData } = await admin
      .from('pedidos')
      .select('fecha')
      .gte('fecha', minDate)
      .lte('fecha', maxDate)
      .in('importacion_id', impIds);

    for (const r of rawRows) pedidosCountByPeriodo[r.periodo_desde] = 0;
    for (const p of pedidosData ?? []) {
      for (const r of rawRows) {
        if (p.fecha >= r.periodo_desde && p.fecha <= r.periodo_hasta) {
          pedidosCountByPeriodo[r.periodo_desde]++;
          break;
        }
      }
    }
  }

  return rawRows
    .map((d) => mapMetrica(d, pedidosCountByPeriodo[d.periodo_desde] ?? null))
    .reverse();
}
