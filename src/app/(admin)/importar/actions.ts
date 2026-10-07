'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { PedidoParsed } from '@/lib/utils/pedix-parser';
import { importarPedidosCore, type ResultadoImportacion } from '@/lib/import/importar-core';

// La lógica de inserción vive en @/lib/import/importar-core (compartida con el
// backfill de histórico). Acá quedan auth, verificación de rol y chequeo de
// hash duplicado — el gate de la UI — antes de delegar al core.
export type { ResultadoImportacion };

// ─── Types ─────────────────────────────────────────────────────────────────

export type MapeoExistente = {
  id: string;
  nombre_pedix: string;
  producto_id: string | null;
  producto_nombre?: string;
};

export type ProductoConReceta = {
  id: string;
  nombre: string;
  activo: boolean;
  receta: {
    ingrediente_id: string;
    ingrediente_nombre: string;
    cantidad: number;
    unidad: string;
  }[];
};

export type ImportacionHistorial = {
  id: string;
  nombre_archivo: string;
  hash_archivo: string;
  estado: 'activa' | 'anulada';
  pedidos_count: number;
  created_at: string;
};

// ─── Verificar hash duplicado ──────────────────────────────────────────────

export async function verificarHash(hash: string): Promise<{
  duplicado: boolean;
  importacion?: { id: string; nombre_archivo: string; created_at: string };
}> {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data } = await supabase
    .from('importaciones')
    .select('id, nombre_archivo, created_at')
    .eq('hash_archivo', hash)
    .limit(1)
    .single();

  if (data) {
    return { duplicado: true, importacion: data };
  }
  return { duplicado: false };
}

// ─── Obtener mapeos existentes ─────────────────────────────────────────────

export async function obtenerMapeos(): Promise<MapeoExistente[]> {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('mapeo_pedix')
    .select(`
      id,
      nombre_pedix,
      producto_id,
      productos ( nombre )
    `)
    .order('nombre_pedix');

  if (error) throw new Error(`Error al obtener mapeos: ${error.message}`);

  return (data || []).map((m: any) => ({
    id: m.id,
    nombre_pedix: m.nombre_pedix,
    producto_id: m.producto_id,
    producto_nombre: m.productos?.nombre,
  }));
}

// ─── Obtener productos activos (para selector de mapeo) ────────────────────

export async function obtenerProductosActivos(): Promise<
  { id: string; nombre: string }[]
> {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('productos')
    .select('id, nombre')
    .eq('activo', true)
    .order('nombre');

  if (error) throw new Error(`Error al obtener productos: ${error.message}`);
  return data || [];
}

// ─── Guardar nuevo mapeo ───────────────────────────────────────────────────

export async function guardarMapeo(
  nombrePedix: string,
  productoId: string
): Promise<void> {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { error } = await supabase.from('mapeo_pedix').upsert(
    { nombre_pedix: nombrePedix, producto_id: productoId },
    { onConflict: 'nombre_pedix' }
  );

  if (error) throw new Error(`Error al guardar mapeo: ${error.message}`);
}

// ─── Obtener productos con recetas (bulk) ──────────────────────────────────

export async function obtenerProductosConRecetas(): Promise<
  ProductoConReceta[]
> {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data: productos, error: errP } = await supabase
    .from('productos')
    .select('id, nombre, activo');

  if (errP) throw new Error(`Error productos: ${errP.message}`);

  const { data: recetas, error: errR } = await supabase
    .from('recetas')
    .select(`
      producto_id,
      ingrediente_id,
      cantidad,
      ingredientes ( nombre, unidad_receta )
    `);

  if (errR) throw new Error(`Error recetas: ${errR.message}`);

  // Agrupar recetas por producto
  const recetasPorProducto = new Map<string, ProductoConReceta['receta']>();
  for (const r of recetas || []) {
    const ing = (r as any).ingredientes;
    const entry = {
      ingrediente_id: r.ingrediente_id,
      ingrediente_nombre: ing?.nombre || 'Desconocido',
      cantidad: r.cantidad,
      unidad: ing?.unidad_receta || '',
    };
    const existing = recetasPorProducto.get(r.producto_id) || [];
    existing.push(entry);
    recetasPorProducto.set(r.producto_id, existing);
  }

  return (productos || []).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    activo: p.activo,
    receta: recetasPorProducto.get(p.id) || [],
  }));
}

// ─── Importar pedidos (transacción principal) ──────────────────────────────

export async function importarPedidos(input: {
  nombreArchivo: string;
  hashArchivo: string;
  pedidos: PedidoParsed[];
  mapeos: Record<string, string>; // nombre_pedix → producto_id
  confirmoSinReceta: boolean;
}): Promise<ResultadoImportacion> {
  const supabase = await createClient();

  const { data: authUser } = await supabase.auth.getUser();
  if (!authUser.user) throw new Error("No autenticado");

  // Verificar rol admin
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("rol")
    .eq("id", authUser.user.id)
    .single();

  if (!usuario || usuario.rol !== "admin") {
    throw new Error("Solo admin puede importar");
  }

  const admin = createAdminClient();

  // Verificar hash duplicado — gate de la UI. El backfill de histórico, que
  // reimporta el mismo archivo a propósito, NO pasa por acá: borra la
  // importación vieja (liberando el hash y los pedido_pedix_id UNIQUE) y
  // llama a importarPedidosCore directo.
  const { data: existente } = await admin
    .from("importaciones")
    .select("id")
    .eq("hash_archivo", input.hashArchivo)
    .limit(1)
    .single();

  if (existente) {
    throw new Error("Este archivo ya fue importado anteriormente");
  }

  return importarPedidosCore(admin, {
    nombreArchivo: input.nombreArchivo,
    hashArchivo: input.hashArchivo,
    pedidos: input.pedidos,
    mapeos: input.mapeos,
    importadoPor: authUser.user.id,
  });
}

// ─── Historial de importaciones ────────────────────────────────────────────

export async function obtenerHistorial(): Promise<ImportacionHistorial[]> {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('importaciones')
    .select(`
      id,
      nombre_archivo,
      hash_archivo,
      estado,
      created_at,
      pedidos ( id )
    `)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Error historial: ${error.message}`);

  return (data || []).map((imp: any) => ({
    id: imp.id,
    nombre_archivo: imp.nombre_archivo,
    hash_archivo: imp.hash_archivo,
    estado: imp.estado || 'activa',
    pedidos_count: Array.isArray(imp.pedidos) ? imp.pedidos.length : 0,
    created_at: imp.created_at,
  }));
}
