// Núcleo de importación de pedidos — COMPARTIDO entre el server action de la
// app (importar/actions.ts) y cualquier proceso que necesite importar con la
// misma lógica exacta (ej. un backfill de histórico). No tiene 'use server':
// es un módulo puro que recibe un cliente Supabase ya construido (admin, con
// service role) y los datos ya parseados. La verificación de auth/rol y del
// hash duplicado son responsabilidad del caller.
//
// Fuente única de verdad del cálculo de costos congelados por línea:
//   costo_parcial = (costo_por_unidad_compra / factor_conversion) × cantidad_receta
// Si se cambia acá, cambia para app y backfill por igual.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PedidoParsed } from '../utils/pedix-parser';

export type ResultadoImportacion = {
  importacion_id: string;
  pedidos_creados: number;
  pedidos_omitidos: number;
  lineas_creadas: number;
  venta_total: number;
  costo_total: number;
  productos_sin_receta: string[];
  // NUEVO: venta de líneas que no se pudieron mapear a un producto y por lo
  // tanto NO se contaron. En el flujo normal de la UI esto es 0 (el paso de
  // mapeo obliga a mapear todo), pero se reporta para no perder plata en
  // silencio si algo se escapa.
  venta_no_mapeada: number;
  productos_no_mapeados: string[];
};

type CostoVigente = {
  ingrediente_id: string;
  costo_por_unidad_compra: number;
  fecha_vigencia: string;
};

// Pre-carga TODOS los costos y resuelve en memoria para evitar N+1.
// Para cada ingrediente, el costo vigente en una fecha X es el que tiene
// fecha_vigencia <= X, ordenado por fecha_vigencia DESC, created_at DESC.
async function cargarTodosCostos(admin: SupabaseClient): Promise<CostoVigente[]> {
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
  fechaPedido: string
): CostoVigente | null {
  for (const c of todosCostos) {
    if (c.ingrediente_id === ingredienteId && c.fecha_vigencia <= fechaPedido) {
      return c;
    }
  }
  return null;
}

export async function importarPedidosCore(
  admin: SupabaseClient,
  input: {
    nombreArchivo: string;
    hashArchivo: string;
    pedidos: PedidoParsed[];
    mapeos: Record<string, string>; // nombre_pedix → producto_id
    importadoPor: string;            // usuarios.id (FK importaciones.importado_por)
  }
): Promise<ResultadoImportacion> {
  // ── Bulk load de datos necesarios ──
  const [todosCostos, recetasData, pedidosExistentes, ingredientesData] =
    await Promise.all([
      cargarTodosCostos(admin),
      admin
        .from('recetas')
        .select('producto_id, ingrediente_id, cantidad')
        .then((r) => r.data || []),
      // El dedup de pedido_pedix_id ignora pedidos de importaciones ANULADAS.
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

  const factorPorIngrediente = new Map<string, number>();
  for (const ing of ingredientesData) {
    factorPorIngrediente.set(ing.id, ing.factor_conversion ?? 1);
  }

  const recetasPorProducto = new Map<
    string,
    { ingrediente_id: string; cantidad: number }[]
  >();
  for (const r of recetasData) {
    const arr = recetasPorProducto.get(r.producto_id) || [];
    arr.push({ ingrediente_id: r.ingrediente_id, cantidad: r.cantidad });
    recetasPorProducto.set(r.producto_id, arr);
  }

  // ── Crear registro de importación ──
  const { data: importacion, error: errImp } = await admin
    .from('importaciones')
    .insert({
      nombre_archivo: input.nombreArchivo,
      hash_archivo: input.hashArchivo,
      estado: 'activa',
      importado_por: input.importadoPor,
      fecha_desde: input.pedidos.reduce(
        (min, p) => (p.fecha < min ? p.fecha : min),
        input.pedidos[0]?.fecha ?? ''
      ),
      fecha_hasta: input.pedidos.reduce(
        (max, p) => (p.fecha > max ? p.fecha : max),
        input.pedidos[0]?.fecha ?? ''
      ),
      total_pedidos: input.pedidos.length,
      total_productos: new Set(
        input.pedidos.flatMap((p) => p.lineas.map((l) => l.productoNombre))
      ).size,
    })
    .select('id')
    .single();

  if (errImp || !importacion) {
    throw new Error(`Error al crear importación: ${errImp?.message}`);
  }

  const importacionId = importacion.id;

  let pedidosCreados = 0;
  let pedidosOmitidos = 0;
  let lineasCreadas = 0;
  let ventaTotal = 0;
  let costoTotal = 0;
  let ventaNoMapeada = 0;
  const productosSinReceta = new Set<string>();
  const productosNoMapeados = new Set<string>();

  try {
    for (const pedido of input.pedidos) {
      if (pedidosExistentes.has(pedido.pedidoId)) {
        pedidosOmitidos++;
        continue;
      }

      const fechaPedido = pedido.fecha;

      // Resolver cliente por celular (upsert por celular normalizado).
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
        if (errPed.code === '23505') {
          pedidosOmitidos++;
          continue;
        }
        throw new Error(`Error pedido ${pedido.pedidoId}: ${errPed.message}`);
      }

      pedidosCreados++;

      for (const linea of pedido.lineas) {
        const productoId = input.mapeos[linea.productoNombre];
        if (!productoId) {
          // Producto no mapeado: NO se descarta en silencio — se contabiliza
          // para reportarlo en el resultado (venta_no_mapeada).
          productosNoMapeados.add(linea.productoNombre);
          ventaNoMapeada += linea.total;
          continue;
        }

        const precioUnitarioVendido =
          linea.cantidad > 0 ? linea.total / linea.cantidad : 0;

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
          productosSinReceta.add(linea.productoNombre);
        }

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
          throw new Error(`Error línea ${linea.productoNombre}: ${errLinea.message}`);
        }

        lineasCreadas++;
        ventaTotal += precioUnitarioVendido * linea.cantidad;
        costoTotal += costoUnitarioCalculado * linea.cantidad;

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
            throw new Error(`Error ingredientes línea: ${errIng.message}`);
          }
        }
      }
    }
  } catch (error) {
    // Si algo falla, se elimina la importación y todo lo asociado (cascada).
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
    venta_no_mapeada: ventaNoMapeada,
    productos_no_mapeados: Array.from(productosNoMapeados),
  };
}
