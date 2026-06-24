'use server';

import { createClient } from '@/lib/supabase/server';
import { obtenerConsumoIngredientes } from '../dashboard/actions';

// ─── Types ─────────────────────────────────────────────────────────────────

export type IngredienteStock = {
  id: string;
  nombre: string;
  unidadCompra: string;
  unidadReceta: string;
  factorConversion: number;
  conteoEnUnidadReceta: boolean;
};

export type CompraIngrediente = {
  id: string;
  fecha: string;
  ingredienteId: string;
  ingredienteNombre: string;
  cantidad: number;
  unidad: string;
  costoTotal: number;
  proveedor: string | null;
  nota: string | null;
};

export type TipoConteo = 'inicio_semana' | 'fin_noche';

export type AnalisisMermaIngrediente = {
  ingredienteId: string;
  nombre: string;
  unidadReceta: string;
  unidadCompra: string;
  consumoTeoricoVentas: number;
  consumoInternoRegistrado: number;
  stockInicio: number | null;
  stockInicioFuente: 'inicio_semana' | 'fallback_semana_anterior' | null;
  comprasCantidad: number;
  comprasCosto: number;
  stockFin: number | null;
  consumoReal: number | null;
  merma: number | null;
  mermaPct: number | null;
  mermaPesos: number | null;
  datosCompletos: boolean;
  semaforo: 'verde' | 'amarillo' | 'rojo' | null;
};

export type AnalisisMerma = {
  desde: string;
  hasta: string;
  ingredientes: AnalisisMermaIngrediente[];
  mermaPesosTotal: number;
  ingredientesIncompletos: string[];
};

// ─── Helpers de fecha (sin libs externas, igual criterio que gastos/actions.ts) ──

function formatFechaLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(fecha + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return formatFechaLocal(d);
}

// ─── Ingredientes controlados (compras + conteos solo trabajan con estos) ──

export async function obtenerIngredientesControlados(): Promise<IngredienteStock[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('ingredientes')
    .select('id, nombre, unidad_compra, unidad_receta, factor_conversion, conteo_en_unidad_receta')
    .eq('controlado_stock', true)
    .eq('activo', true)
    .order('nombre');

  if (error) throw new Error(`Error al obtener ingredientes: ${error.message}`);

  return (data || []).map((i: any) => ({
    id: i.id,
    nombre: i.nombre,
    unidadCompra: i.unidad_compra,
    unidadReceta: i.unidad_receta,
    factorConversion: i.factor_conversion,
    conteoEnUnidadReceta: i.conteo_en_unidad_receta,
  }));
}

// ─── Compras (admin) ────────────────────────────────────────────────────────

export async function obtenerComprasPeriodo(desde: string, hasta: string): Promise<CompraIngrediente[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('compras_ingredientes')
    .select('id, fecha, ingrediente_id, cantidad, unidad, costo_total, proveedor, nota, ingredientes ( nombre )')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: false });

  if (error) throw new Error(`Error al obtener compras: ${error.message}`);

  return (data || []).map((c: any) => ({
    id: c.id,
    fecha: c.fecha,
    ingredienteId: c.ingrediente_id,
    ingredienteNombre: c.ingredientes?.nombre ?? 'Desconocido',
    cantidad: c.cantidad,
    unidad: c.unidad,
    costoTotal: c.costo_total,
    proveedor: c.proveedor,
    nota: c.nota,
  }));
}

export async function registrarCompra(input: {
  fecha: string;
  ingredienteId: string;
  cantidad: number;
  unidad: string;
  costoTotal: number;
  proveedor: string | null;
  nota: string | null;
}) {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  if (!input.fecha) return { error: 'La fecha es obligatoria' };
  if (!input.ingredienteId) return { error: 'El ingrediente es obligatorio' };
  if (!input.cantidad || input.cantidad <= 0) return { error: 'La cantidad debe ser mayor a 0' };
  if (input.costoTotal == null || input.costoTotal < 0) return { error: 'El costo total es inválido' };

  const { error } = await supabase.from('compras_ingredientes').insert({
    fecha: input.fecha,
    ingrediente_id: input.ingredienteId,
    cantidad: input.cantidad,
    unidad: input.unidad,
    costo_total: input.costoTotal,
    proveedor: input.proveedor,
    nota: input.nota,
    registrado_por: user.user.id,
  });

  if (error) return { error: error.message };
  return { success: true };
}

export async function eliminarCompra(id: string) {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { error } = await supabase.from('compras_ingredientes').delete().eq('id', id);
  if (error) return { error: error.message };
  return { success: true };
}

// ─── Conteos de stock (empleados + admin) ──────────────────────────────────

export async function obtenerConteo(fecha: string, tipo: TipoConteo): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('conteos_stock')
    .select('ingrediente_id, cantidad')
    .eq('fecha', fecha)
    .eq('tipo', tipo);

  if (error) throw new Error(`Error al obtener conteo: ${error.message}`);

  const out: Record<string, number> = {};
  for (const c of data || []) out[c.ingrediente_id] = c.cantidad;
  return out;
}

export async function registrarConteo(
  fecha: string,
  tipo: TipoConteo,
  valores: { ingredienteId: string; cantidad: number; unidad: string }[]
) {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  if (!fecha) return { error: 'Falta la fecha' };
  if (!valores.length) return { error: 'No hay ingredientes para guardar' };

  const filas = valores
    .filter((v) => v.cantidad != null && v.cantidad >= 0)
    .map((v) => ({
      fecha,
      ingrediente_id: v.ingredienteId,
      cantidad: v.cantidad,
      unidad: v.unidad,
      tipo,
      registrado_por: user.user.id,
    }));

  if (!filas.length) return { error: 'Ingresá al menos una cantidad' };

  const { error } = await supabase
    .from('conteos_stock')
    .upsert(filas, { onConflict: 'fecha,ingrediente_id,tipo' });

  if (error) return { error: error.message };
  return { success: true };
}

// ─── Consumo interno por ingrediente (helper privado, no exportado) ────────
// Misma lógica de join que obtenerConsumoIngredientes pero sobre
// consumo_interno_ingredientes. Se mantiene acá para no tocar el módulo
// de consumo interno (✅ estable).

async function obtenerConsumoInternoPorIngrediente(
  supabase: any,
  desde: string,
  hasta: string
): Promise<Map<string, number>> {
  const { data } = await supabase
    .from('consumo_interno')
    .select(`
      fecha,
      consumo_interno_lineas (
        consumo_interno_ingredientes ( ingrediente_id, cantidad_consumida )
      )
    `)
    .gte('fecha', desde)
    .lte('fecha', hasta);

  const porIngrediente = new Map<string, number>();
  for (const c of data || []) {
    for (const l of c.consumo_interno_lineas || []) {
      for (const i of l.consumo_interno_ingredientes || []) {
        porIngrediente.set(
          i.ingrediente_id,
          (porIngrediente.get(i.ingrediente_id) || 0) + i.cantidad_consumida
        );
      }
    }
  }
  return porIngrediente;
}

// ─── Análisis de merma del período ──────────────────────────────────────────
// Consumo real = stock_inicio + compras − stock_fin, todo normalizado a
// unidad_receta antes de combinarse, para poder compararlo con el consumo
// teórico de ventas (que ya viene en unidad_receta).
//
// Las compras (compras_ingredientes) siempre quedan en unidad_compra — así
// compra Lucas. Los conteos (conteos_stock) pueden estar en unidad_compra
// O en unidad_receta según `ingredientes.conteo_en_unidad_receta` (ej.
// Carne se cuenta en medallones, no en kg, porque es más preciso para el
// equipo). Por eso cada cantidad se convierte individualmente con
// factor_conversion antes de sumar/restar, en vez de convertir el total al
// final — si se mezclan unidades, convertir al final daría un resultado
// incorrecto.
//
// Ventana de compras: lunes a domingo de la semana del período, no solo
// vie-dom — la mercadería suele comprarse en los días previos a abrir.
//
// stock_inicio: conteo 'inicio_semana' del viernes. Si no existe, se usa
// como respaldo el cierre ('fin_noche') del domingo anterior — misma
// realidad física, solo que no se volvió a contar. Se marca la fuente
// para que la pantalla lo deje claro (principio: no ocultar supuestos).

export async function obtenerAnalisisMerma(desde: string, hasta: string): Promise<AnalisisMerma> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const lunes = sumarDias(desde, -4);
  const domingoAnterior = sumarDias(desde, -5);

  const [
    { data: ingredientesData, error: ingError },
    consumoTeorico,
    { data: comprasData },
    { data: inicioData },
    { data: finData },
    { data: fallbackData },
  ] = await Promise.all([
    supabase
      .from('ingredientes')
      .select('id, nombre, unidad_compra, unidad_receta, factor_conversion, conteo_en_unidad_receta')
      .eq('controlado_stock', true)
      .eq('activo', true)
      .order('nombre'),
    obtenerConsumoIngredientes(desde, hasta),
    supabase.from('compras_ingredientes').select('ingrediente_id, cantidad, costo_total').gte('fecha', lunes).lte('fecha', hasta),
    supabase.from('conteos_stock').select('ingrediente_id, cantidad').eq('fecha', desde).eq('tipo', 'inicio_semana'),
    supabase.from('conteos_stock').select('ingrediente_id, cantidad').eq('fecha', hasta).eq('tipo', 'fin_noche'),
    supabase.from('conteos_stock').select('ingrediente_id, cantidad').eq('fecha', domingoAnterior).eq('tipo', 'fin_noche'),
  ]);

  if (ingError) throw new Error(`Error al obtener ingredientes: ${ingError.message}`);

  const consumoInternoPorIng = await obtenerConsumoInternoPorIngrediente(supabase, desde, hasta);

  const teoricoPorNombre = new Map(consumoTeorico.map((c) => [c.nombre, c]));

  const comprasPorIng = new Map<string, { cantidad: number; costo: number }>();
  for (const c of comprasData || []) {
    const e = comprasPorIng.get(c.ingrediente_id) || { cantidad: 0, costo: 0 };
    e.cantidad += c.cantidad;
    e.costo += c.costo_total;
    comprasPorIng.set(c.ingrediente_id, e);
  }

  const inicioPorIng = new Map((inicioData || []).map((c: any) => [c.ingrediente_id, c.cantidad]));
  const finPorIng = new Map((finData || []).map((c: any) => [c.ingrediente_id, c.cantidad]));
  const fallbackPorIng = new Map((fallbackData || []).map((c: any) => [c.ingrediente_id, c.cantidad]));

  let mermaPesosTotal = 0;
  const ingredientesIncompletos: string[] = [];

  const ingredientes: AnalisisMermaIngrediente[] = (ingredientesData || []).map((ing: any) => {
    const teo = teoricoPorNombre.get(ing.nombre);
    const consumoTeoricoVentas = teo?.cantidad ?? 0;
    const costoTeorico = teo?.costo ?? 0;
    const costoUnitarioRecetaPromedio = consumoTeoricoVentas > 0 ? costoTeorico / consumoTeoricoVentas : null;

    const consumoInternoRegistrado = consumoInternoPorIng.get(ing.id) ?? 0;

    const compra = comprasPorIng.get(ing.id);
    const comprasCantidad = compra?.cantidad ?? 0;
    const comprasCosto = compra?.costo ?? 0;

    let stockInicio: number | null = null;
    let stockInicioFuente: 'inicio_semana' | 'fallback_semana_anterior' | null = null;
    if (inicioPorIng.has(ing.id)) {
      stockInicio = inicioPorIng.get(ing.id)!;
      stockInicioFuente = 'inicio_semana';
    } else if (fallbackPorIng.has(ing.id)) {
      stockInicio = fallbackPorIng.get(ing.id)!;
      stockInicioFuente = 'fallback_semana_anterior';
    }

    const stockFin = finPorIng.has(ing.id) ? finPorIng.get(ing.id)! : null;
    const datosCompletos = stockInicio !== null && stockFin !== null;

    let consumoReal: number | null = null;
    let merma: number | null = null;
    let mermaPct: number | null = null;
    let mermaPesos: number | null = null;
    let semaforo: 'verde' | 'amarillo' | 'rojo' | null = null;

    if (datosCompletos) {
      // Cada término se pasa a unidad_receta de forma independiente antes
      // de combinarlos — stockInicio/stockFin pueden venir en unidad_receta
      // (si conteo_en_unidad_receta) o en unidad_compra; las compras
      // siempre están en unidad_compra.
      const stockInicioReceta = ing.conteo_en_unidad_receta
        ? stockInicio!
        : stockInicio! * ing.factor_conversion;
      const stockFinReceta = ing.conteo_en_unidad_receta
        ? stockFin!
        : stockFin! * ing.factor_conversion;
      const comprasReceta = comprasCantidad * ing.factor_conversion;

      consumoReal = stockInicioReceta + comprasReceta - stockFinReceta;
      merma = consumoReal - consumoTeoricoVentas - consumoInternoRegistrado;
      mermaPct = consumoReal > 0 ? (merma / consumoReal) * 100 : null;
      mermaPesos = costoUnitarioRecetaPromedio !== null ? merma * costoUnitarioRecetaPromedio : null;

      if (mermaPct !== null) {
        const abs = Math.abs(mermaPct);
        semaforo = abs < 3 ? 'verde' : abs <= 6 ? 'amarillo' : 'rojo';
      }
      if (mermaPesos !== null) mermaPesosTotal += mermaPesos;
    } else {
      ingredientesIncompletos.push(ing.nombre);
    }

    return {
      ingredienteId: ing.id,
      nombre: ing.nombre,
      unidadReceta: ing.unidad_receta,
      unidadCompra: ing.unidad_compra,
      consumoTeoricoVentas,
      consumoInternoRegistrado,
      stockInicio,
      stockInicioFuente,
      comprasCantidad,
      comprasCosto,
      stockFin,
      consumoReal,
      merma,
      mermaPct,
      mermaPesos,
      datosCompletos,
      semaforo,
    };
  });

  return { desde, hasta, ingredientes, mermaPesosTotal, ingredientesIncompletos };
}
