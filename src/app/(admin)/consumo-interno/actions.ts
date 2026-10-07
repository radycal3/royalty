'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// ─── Types ─────────────────────────────────────────────────────────────────

export type ConsumoLinea = {
  productoId: string;
  cantidad: number;
};

export type ConsumoRegistrado = {
  id: string;
  fecha: string;
  nota: string | null;
  created_at: string;
  lineas: {
    id: string;
    producto_id: string;
    producto_nombre: string;
    cantidad: number;
    costo_unitario_calculado: number;
  }[];
  costo_total: number;
};

export type ConsumoResumen = {
  consumos: ConsumoRegistrado[];
  costoTotalPeriodo: number;
  unidadesTotales: number;
};

export type ProductoParaConsumo = {
  id: string;
  nombre: string;
  tieneReceta: boolean;
  costoEstimado: number | null;
};

type CostoVigente = {
  ingrediente_id: string;
  costo_por_unidad_compra: number;
  fecha_vigencia: string;
};

// ─── Helpers de período (replicados de gastos/actions.ts) ──────────────────

function periodoDeJS(fecha: Date): Date {
  const day = fecha.getDay();
  const isodow = day === 0 ? 7 : day;
  const offset = ((isodow - 5 + 7) % 7);
  const viernes = new Date(fecha);
  viernes.setDate(fecha.getDate() - offset);
  return viernes;
}

function formatFechaLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Verifica rol admin. Defensa en profundidad: este módulo maneja costos en
// pesos y usa createAdminClient() (que bypasea RLS), así que el rol del caller
// debe verificarse en el server action, no solo confiar en el gate de ruta.
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
}

// ─── Obtener productos para el selector ────────────────────────────────────

export async function obtenerProductosParaConsumo(): Promise<ProductoParaConsumo[]> {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data: productos } = await supabase
    .from('productos')
    .select('id, nombre')
    .eq('activo', true)
    .order('nombre');

  const { data: recetas } = await supabase
    .from('recetas')
    .select('producto_id');

  const productosConReceta = new Set(
    (recetas || []).map((r) => r.producto_id)
  );

  return (productos || []).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    tieneReceta: productosConReceta.has(p.id),
    costoEstimado: null, // Se calcula al registrar
  }));
}

// ─── Listar consumos de un período ─────────────────────────────────────────

export async function obtenerConsumosPeriodo(
  viernesPeriodo: string
): Promise<ConsumoResumen> {
  await exigirAdmin();
  const supabase = await createClient();

  const viernes = new Date(viernesPeriodo + 'T12:00:00');
  const domingo = new Date(viernes);
  domingo.setDate(viernes.getDate() + 2);

  const { data: consumos, error } = await supabase
    .from('consumo_interno')
    .select(`
      id, fecha, nota, created_at,
      consumo_interno_lineas (
        id, producto_id, cantidad, costo_unitario_calculado,
        productos ( nombre )
      )
    `)
    .gte('fecha', viernesPeriodo)
    .lte('fecha', formatFechaLocal(domingo))
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Error al obtener consumos: ${error.message}`);

  let costoTotalPeriodo = 0;
  let unidadesTotales = 0;

  const resultado: ConsumoRegistrado[] = (consumos || []).map((c: any) => {
    const lineas = (c.consumo_interno_lineas || []).map((l: any) => ({
      id: l.id,
      producto_id: l.producto_id,
      producto_nombre: l.productos?.nombre || 'Desconocido',
      cantidad: l.cantidad,
      costo_unitario_calculado: l.costo_unitario_calculado,
    }));

    const costoConsumo = lineas.reduce(
      (sum: number, l: any) => sum + l.costo_unitario_calculado * l.cantidad,
      0
    );

    costoTotalPeriodo += costoConsumo;
    unidadesTotales += lineas.reduce((sum: number, l: any) => sum + l.cantidad, 0);

    return {
      id: c.id,
      fecha: c.fecha,
      nota: c.nota,
      created_at: c.created_at,
      lineas,
      costo_total: costoConsumo,
    };
  });

  return {
    consumos: resultado,
    costoTotalPeriodo,
    unidadesTotales,
  };
}

// ─── Registrar consumo interno (con congelación de costos) ─────────────────
// Lógica idéntica a importarPedidos de Fase 2:
//   1. Bulk load recetas, costos, factores
//   2. Para cada línea: resolver costo vigente en la FECHA del consumo
//   3. Congelar costo unitario y descomposición por ingrediente

export async function registrarConsumo(input: {
  fecha: string;
  nota: string | null;
  lineas: ConsumoLinea[];
}): Promise<{ consumo_id: string; costo_total: number }> {
  await exigirAdmin();

  if (input.lineas.length === 0) {
    throw new Error('Agregá al menos un producto');
  }

  const admin = createAdminClient();

  // ── Bulk load ──
  const [recetasData, todosCostos, ingredientesData] = await Promise.all([
    admin
      .from('recetas')
      .select('producto_id, ingrediente_id, cantidad')
      .then((r) => r.data || []),
    admin
      .from('ingredientes_costos')
      .select('ingrediente_id, costo_por_unidad_compra, fecha_vigencia, created_at')
      .order('fecha_vigencia', { ascending: false })
      .order('created_at', { ascending: false })
      .then((r) => r.data || []),
    admin
      .from('ingredientes')
      .select('id, factor_conversion')
      .then((r) => r.data || []),
  ]);

  // Indexar
  const recetasPorProducto = new Map<
    string,
    { ingrediente_id: string; cantidad: number }[]
  >();
  for (const r of recetasData) {
    const arr = recetasPorProducto.get(r.producto_id) || [];
    arr.push({ ingrediente_id: r.ingrediente_id, cantidad: r.cantidad });
    recetasPorProducto.set(r.producto_id, arr);
  }

  const factorPorIngrediente = new Map<string, number>();
  for (const ing of ingredientesData) {
    // Guard contra factor_conversion = 0 (error de carga) → evita dividir por
    // cero y guardar un costo Infinity. Un 0 pasaba el `?? 1` sin filtrarse.
    const f = ing.factor_conversion;
    factorPorIngrediente.set(ing.id, f && f > 0 ? f : 1);
  }

  // ── Crear cabecera ──
  const { data: consumo, error: errC } = await admin
    .from('consumo_interno')
   .insert({
      fecha: input.fecha,
      nota: input.nota,
    })
    .select('id')
    .single();

  if (errC || !consumo) {
    throw new Error(`Error al crear consumo: ${errC?.message}`);
  }

  const consumoId = consumo.id;
  let costoTotal = 0;

  try {
    for (const linea of input.lineas) {
      // Calcular costo unitario desde receta
      // Fórmula: (costo_por_unidad_compra / factor_conversion) × cantidad_receta
      const receta = recetasPorProducto.get(linea.productoId);
      let costoUnitario = 0;
      const ingredientesCongelados: {
        ingrediente_id: string;
        cantidad_receta: number;
        costo_unitario_ingrediente: number;
        costo_compra_usado: number;
        factor_conversion_usado: number;
      }[] = [];

      if (receta && receta.length > 0) {
        for (const item of receta) {
          // Resolver costo vigente en la fecha del consumo
          let costoVigente: CostoVigente | null = null;
          for (const c of todosCostos) {
            if (
              c.ingrediente_id === item.ingrediente_id &&
              c.fecha_vigencia <= input.fecha
            ) {
              costoVigente = c;
              break;
            }
          }

          if (costoVigente) {
            const factor = factorPorIngrediente.get(item.ingrediente_id) ?? 1;
            const costoIng =
              (costoVigente.costo_por_unidad_compra / factor) * item.cantidad;
            costoUnitario += costoIng;

            ingredientesCongelados.push({
              ingrediente_id: item.ingrediente_id,
              cantidad_receta: item.cantidad,
              costo_unitario_ingrediente: costoIng,
              costo_compra_usado: costoVigente.costo_por_unidad_compra,
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
      }

      // Insertar línea
      const { data: lineaRow, error: errL } = await admin
        .from('consumo_interno_lineas')
        .insert({
          consumo_id: consumoId,
          producto_id: linea.productoId,
          cantidad: linea.cantidad,
          costo_unitario_calculado: costoUnitario,
        })
        .select('id')
        .single();

      if (errL) throw new Error(`Error línea consumo: ${errL.message}`);

      costoTotal += costoUnitario * linea.cantidad;

      // Congelar ingredientes
      if (ingredientesCongelados.length > 0) {
        const rows = ingredientesCongelados.map((ing) => ({
          consumo_linea_id: lineaRow.id,
          ingrediente_id: ing.ingrediente_id,
          cantidad_receta: ing.cantidad_receta,
          cantidad_consumida: ing.cantidad_receta * linea.cantidad,
          costo_unitario_ingrediente: ing.costo_unitario_ingrediente,
          costo_compra_usado: ing.costo_compra_usado,
          factor_conversion_usado: ing.factor_conversion_usado,
        }));

        const { error: errI } = await admin
          .from('consumo_interno_ingredientes')
          .insert(rows);

        if (errI) throw new Error(`Error ingredientes consumo: ${errI.message}`);
      }
    }
  } catch (error) {
    // Rollback: eliminar consumo (cascade borra líneas e ingredientes)
    await admin.from('consumo_interno').delete().eq('id', consumoId);
    throw error;
  }

  return { consumo_id: consumoId, costo_total: costoTotal };
}

// ─── Eliminar consumo ──────────────────────────────────────────────────────

export async function eliminarConsumo(id: string) {
  await exigirAdmin();
  const supabase = await createClient();

  const { error } = await supabase
    .from('consumo_interno')
    .delete()
    .eq('id', id);

  if (error) return { error: error.message };
  return { success: true };
}
