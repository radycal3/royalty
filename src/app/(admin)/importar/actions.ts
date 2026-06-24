'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { PedidoParsed, LineaParsed } from '@/lib/utils/pedix-parser';

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

type CostoVigente = {
  ingrediente_id: string;
  costo_por_unidad_compra: number;
  fecha_vigencia: string;
};

export type ResultadoImportacion = {
  importacion_id: string;
  pedidos_creados: number;
  pedidos_omitidos: number;
  lineas_creadas: number;
  venta_total: number;
  costo_total: number;
  productos_sin_receta: string[];
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

// ─── Resolver costos vigentes por fecha (bulk) ─────────────────────────────
// Pre-carga TODOS los costos y resuelve en memoria para evitar N+1.
// Para cada ingrediente, el costo vigente en una fecha X es el que tiene
// fecha_vigencia <= X, ordenado por fecha_vigencia DESC, created_at DESC.

async function cargarTodosCostos(): Promise<CostoVigente[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('ingredientes_costos')
    .select('ingrediente_id, costo_por_unidad_compra, fecha_vigencia, created_at')
    .order('fecha_vigencia', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Error costos: ${error.message}`);
  return data || [];
}

function resolverCostoVigente(
  todosCostos: CostoVigente[],
  ingredienteId: string,
  fechaPedido: string // YYYY-MM-DD
): CostoVigente | null {
  // Los costos ya vienen ordenados por fecha_vigencia DESC, created_at DESC.
  // Buscar el primero cuya fecha_vigencia <= fechaPedido para este ingrediente.
  for (const c of todosCostos) {
    if (c.ingrediente_id === ingredienteId && c.fecha_vigencia <= fechaPedido) {
      return c;
    }
  }
  return null;
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
  if (!authUser.user) throw new Error('No autenticado');

  // Verificar rol admin
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('rol')
    .eq('id', authUser.user.id)
    .single();

  if (!usuario || usuario.rol !== 'admin') {
    throw new Error('Solo admin puede importar');
  }

  // Usar admin client para la transacción (bypasea RLS para inserts complejos)
  const admin = createAdminClient();

  // ── Paso 1: Verificar hash duplicado ──
  const { data: existente } = await admin
    .from('importaciones')
    .select('id')
    .eq('hash_archivo', input.hashArchivo)
    .limit(1)
    .single();

  if (existente) {
    throw new Error('Este archivo ya fue importado anteriormente');
  }

  // ── Paso 2: Bulk load de datos necesarios ──
  const [productosData, todosCostos, recetasData, pedidosExistentes, ingredientesData] =
    await Promise.all([
      admin
        .from('productos')
        .select('id, nombre')
        .then((r) => r.data || []),
      cargarTodosCostos(),
      admin
        .from('recetas')
        .select('producto_id, ingrediente_id, cantidad')
        .then((r) => r.data || []),
      // FIX: el dedup de pedido_pedix_id debe ignorar pedidos que
      // pertenecen a importaciones ANULADAS — de lo contrario, anular una
      // importación y reimportar el mismo archivo (con datos corregidos,
      // como un parser arreglado) hace que TODOS los pedidos se salten
      // por "duplicados", aunque su importación original ya no cuenta
      // para nada en el dashboard. El filtro usa el join implícito de
      // PostgREST (importaciones!inner) para traer solo pedidos cuya
      // importación tiene estado = 'activa'.
      admin
        .from('pedidos')
        .select('pedido_pedix_id, importaciones!inner(estado)')
        .eq('importaciones.estado', 'activa')
        .then((r) => new Set((r.data || []).map((p: any) => p.pedido_pedix_id))),
      admin
        .from('ingredientes')
        .select('id, factor_conversion')
        .then((r) => r.data || []),
    ]);

  // Indexar factor_conversion por ingrediente_id
  const factorPorIngrediente = new Map<string, number>();
  for (const ing of ingredientesData) {
    factorPorIngrediente.set(ing.id, ing.factor_conversion ?? 1);
  }

  // Indexar recetas por producto_id
  const recetasPorProducto = new Map<
    string,
    { ingrediente_id: string; cantidad: number }[]
  >();
  for (const r of recetasData) {
    const arr = recetasPorProducto.get(r.producto_id) || [];
    arr.push({ ingrediente_id: r.ingrediente_id, cantidad: r.cantidad });
    recetasPorProducto.set(r.producto_id, arr);
  }

  // ── Paso 3: Crear registro de importación ──
  // Esquema real: id, nombre_archivo, hash_archivo, fecha_desde, fecha_hasta,
  //               total_pedidos, total_productos, importado_por, created_at, estado
  const { data: importacion, error: errImp } = await admin
    .from('importaciones')
    .insert({
      nombre_archivo: input.nombreArchivo,
      hash_archivo: input.hashArchivo,
      estado: 'activa',
      importado_por: authUser.user.id,
      fecha_desde: input.pedidos.reduce((min, p) => p.fecha < min ? p.fecha : min, input.pedidos[0]?.fecha ?? ''),
      fecha_hasta: input.pedidos.reduce((max, p) => p.fecha > max ? p.fecha : max, input.pedidos[0]?.fecha ?? ''),
      total_pedidos: input.pedidos.length,
      total_productos: new Set(input.pedidos.flatMap(p => p.lineas.map(l => l.productoNombre))).size,
    })
    .select('id')
    .single();

  if (errImp || !importacion) {
    throw new Error(`Error al crear importación: ${errImp?.message}`);
  }

  const importacionId = importacion.id;

  // ── Paso 4: Procesar pedidos ──
  let pedidosCreados = 0;
  let pedidosOmitidos = 0;
  let lineasCreadas = 0;
  let ventaTotal = 0;
  let costoTotal = 0;
  const productosSinReceta = new Set<string>();

  try {
    for (const pedido of input.pedidos) {
      // Dedup nivel pedido
      if (pedidosExistentes.has(pedido.pedidoId)) {
        pedidosOmitidos++;
        continue;
      }

      // Extraer fecha del pedido como YYYY-MM-DD para resolución de costos
      const fechaPedido = pedido.fecha; // Ya viene como YYYY-MM-DD del parser

      // ── Resolver cliente por celular ────────────────────────────────
      // Si el pedido tiene celular normalizado, hace upsert en clientes
      // y obtiene el cliente_id. Si no tiene celular, sigue sin cliente.
      // El upsert usa el celular normalizado como clave única — así
      // "341-621-4667" y "3416214667" resuelven al mismo cliente.
      // El nombre se actualiza siempre con el más reciente (last write
      // wins): es solo una referencia legible, no un dato financiero.
      let clienteId: string | null = null;

      if (pedido.celular) {
        const { data: clienteData } = await admin
          .from('clientes')
          .upsert(
            { celular: pedido.celular, nombre_referencia: pedido.cliente || null },
            { onConflict: 'celular', ignoreDuplicates: false }
          )
          .select('id')
          .single();
        clienteId = clienteData?.id || null;
      }

      // Insertar pedido
      // Esquema real: id, importacion_id, pedido_pedix_id, fecha, hora,
      //               envio_cobrado, cliente_id, cliente_celular,
      //               cliente_nombre, cliente_direccion, created_at
      const { data: pedidoRow, error: errPed } = await admin
        .from('pedidos')
        .insert({
          importacion_id: importacionId,
          pedido_pedix_id: pedido.pedidoId,
          fecha: pedido.fecha,
          hora: pedido.hora || null,
          envio_cobrado: pedido.envioCobrado || 0,
          cliente_id: clienteId,
          cliente_celular: pedido.celular || null,
          cliente_nombre: pedido.cliente || null,
          cliente_direccion: pedido.direccion || null,
        })
        .select('id')
        .single();

      if (errPed) {
        // Si falla por UNIQUE (pedido duplicado concurrente), omitir
        if (errPed.code === '23505') {
          pedidosOmitidos++;
          continue;
        }
        throw new Error(`Error pedido ${pedido.pedidoId}: ${errPed.message}`);
      }

      pedidosCreados++;

      // ── Paso 5: Procesar líneas del pedido ──
      for (const linea of pedido.lineas) {
        // Resolver producto_id desde mapeo
        const productoId = input.mapeos[linea.productoNombre];
        if (!productoId) {
          // Producto no mapeado — no debería llegar aquí si el flujo de UI es correcto
          continue;
        }

        const precioUnitarioVendido = linea.cantidad > 0
          ? linea.total / linea.cantidad
          : 0;

        // Calcular costo unitario desde receta
        // Fórmula idéntica a calcularCostoProducto de Fase 1:
        //   (costo_por_unidad_compra / factor_conversion) × cantidad_receta
        const receta = recetasPorProducto.get(productoId);
        let costoUnitarioCalculado = 0;
        const ingredientesCongelados: {
          ingrediente_id: string;
          cantidad_receta: number;
          costo_unitario_ingrediente: number;
          costo_compra_usado: number;
          factor_conversion_usado: number;
        }[] = [];

        if (receta && receta.length > 0) {
          for (const item of receta) {
            const costo = resolverCostoVigente(
              todosCostos,
              item.ingrediente_id,
              fechaPedido
            );

            if (costo) {
              const factor = factorPorIngrediente.get(item.ingrediente_id) ?? 1;
              const costoIngrediente =
                (costo.costo_por_unidad_compra / factor) * item.cantidad;
              costoUnitarioCalculado += costoIngrediente;

              ingredientesCongelados.push({
                ingrediente_id: item.ingrediente_id,
                cantidad_receta: item.cantidad,
                costo_unitario_ingrediente: costoIngrediente,
                costo_compra_usado: costo.costo_por_unidad_compra,
                factor_conversion_usado: factor,
              });
            } else {
              // Ingrediente sin costo vigente para esta fecha
              ingredientesCongelados.push({
                ingrediente_id: item.ingrediente_id,
                cantidad_receta: item.cantidad,
                costo_unitario_ingrediente: 0,
                costo_compra_usado: 0,
                factor_conversion_usado: 1,
              });
            }
          }
        } else {
          // Producto sin receta — costo queda en 0
          productosSinReceta.add(linea.productoNombre);
        }

        // Insertar línea de pedido
        // Esquema real: id, pedido_id, producto_id, cantidad,
        //               precio_unitario_vendido, costo_unitario_calculado, created_at
        const { data: lineaRow, error: errLinea } = await admin
          .from('pedidos_lineas')
          .insert({
            pedido_id: pedidoRow.id,
            producto_id: productoId,
            cantidad: linea.cantidad,
            precio_unitario_vendido: precioUnitarioVendido,
            costo_unitario_calculado: costoUnitarioCalculado,
          })
          .select('id')
          .single();

        if (errLinea) {
          throw new Error(
            `Error línea ${linea.productoNombre}: ${errLinea.message}`
          );
        }

        lineasCreadas++;
        ventaTotal += precioUnitarioVendido * linea.cantidad;
        costoTotal += costoUnitarioCalculado * linea.cantidad;

        // ── Paso 6: Congelar consumo de ingredientes ──
        if (ingredientesCongelados.length > 0) {
          const ingredientesRows = ingredientesCongelados.map((ing) => ({
            pedido_linea_id: lineaRow.id,
            ingrediente_id: ing.ingrediente_id,
            cantidad_receta: ing.cantidad_receta,
            cantidad_consumida: ing.cantidad_receta * linea.cantidad,
            costo_unitario_ingrediente: ing.costo_unitario_ingrediente,
            costo_compra_usado: ing.costo_compra_usado,
            factor_conversion_usado: ing.factor_conversion_usado,
          }));

          const { error: errIng } = await admin
            .from('pedidos_lineas_ingredientes')
            .insert(ingredientesRows);

          if (errIng) {
            throw new Error(
              `Error ingredientes línea: ${errIng.message}`
            );
          }
        }
      }
    }
  } catch (error) {
    // Si falla, eliminar la importación y todo lo asociado (cascada)
    await admin.from('importaciones').delete().eq('id', importacionId);
    throw error;
  }

  return {
    importacion_id: importacionId,
    pedidos_creados: pedidosCreados,
    pedidos_omitidos: pedidosOmitidos,
    lineas_creadas: lineasCreadas,
    venta_total: ventaTotal,
    costo_total: costoTotal,
    productos_sin_receta: Array.from(productosSinReceta),
  };
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
