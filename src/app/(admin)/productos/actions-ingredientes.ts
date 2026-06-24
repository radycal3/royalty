'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// Obtiene ingredientes CON su costo vigente en una sola consulta
export async function getIngredientesConCosto() {
  const supabase = await createClient()
  const hoy = new Date().toISOString().split('T')[0]

  // 1. Todos los ingredientes
  const { data: ingredientes, error } = await supabase
    .from('ingredientes')
    .select('*')
    .order('nombre')
  if (error) throw error

  // 2. Todos los costos (para resolver vigentes sin N+1)
  // Desempate por created_at: si hay 2 costos con misma fecha, gana el último cargado
  const { data: todosCostos } = await supabase
    .from('ingredientes_costos')
    .select('ingrediente_id, costo_por_unidad_compra, fecha_vigencia, created_at')
    .lte('fecha_vigencia', hoy)
    .order('fecha_vigencia', { ascending: false })
    .order('created_at', { ascending: false })

  // 3. Mapa de costo vigente por ingrediente (el primero de cada grupo)
  const costoVigente: Record<string, number> = {}
  for (const c of todosCostos ?? []) {
    if (!(c.ingrediente_id in costoVigente)) {
      costoVigente[c.ingrediente_id] = c.costo_por_unidad_compra
    }
  }

  // 4. Merge
  return (ingredientes ?? []).map((ing) => ({
    ...ing,
    costo_vigente: costoVigente[ing.id] ?? null,
  }))
}

export async function getIngredienteConCostos(id: string) {
  const supabase = await createClient()
  const { data: ingrediente } = await supabase
    .from('ingredientes')
    .select('*')
    .eq('id', id)
    .single()

  const { data: costos } = await supabase
    .from('ingredientes_costos')
    .select('*')
    .eq('ingrediente_id', id)
    .order('fecha_vigencia', { ascending: false })
    .order('created_at', { ascending: false })

  return { ingrediente, costos: costos ?? [] }
}

// Helper para checkbox: getAll().includes('true') evita el bug del hidden input
function checkboxValue(formData: FormData, name: string): boolean {
  return formData.getAll(name).includes('true')
}

export async function crearIngrediente(formData: FormData) {
  const supabase = await createClient()
  const nombre = formData.get('nombre') as string
  const unidad_compra = formData.get('unidad_compra') as string
  const unidad_receta = formData.get('unidad_receta') as string
  const factor_conversion = Number(formData.get('factor_conversion'))
  const controlado_stock = checkboxValue(formData, 'controlado_stock')
  const conteo_en_unidad_receta = checkboxValue(formData, 'conteo_en_unidad_receta')
  const costo_inicial = Number(formData.get('costo_inicial'))

  const { data: ingrediente, error } = await supabase
    .from('ingredientes')
    .insert({ nombre, unidad_compra, unidad_receta, factor_conversion, controlado_stock, conteo_en_unidad_receta })
    .select()
    .single()

  if (error) return { error: error.message }

  if (costo_inicial > 0) {
    await supabase.from('ingredientes_costos').insert({
      ingrediente_id: ingrediente.id,
      costo_por_unidad_compra: costo_inicial,
      fecha_vigencia: new Date().toISOString().split('T')[0],
    })
  }

  revalidatePath('/productos')
  return { data: ingrediente }
}

export async function actualizarIngrediente(id: string, formData: FormData) {
  const supabase = await createClient()
  const nombre = formData.get('nombre') as string
  const unidad_compra = formData.get('unidad_compra') as string
  const unidad_receta = formData.get('unidad_receta') as string
  const factor_conversion = Number(formData.get('factor_conversion'))
  const controlado_stock = checkboxValue(formData, 'controlado_stock')
  const conteo_en_unidad_receta = checkboxValue(formData, 'conteo_en_unidad_receta')
  const activo = checkboxValue(formData, 'activo')

  const { error } = await supabase
    .from('ingredientes')
    .update({ nombre, unidad_compra, unidad_receta, factor_conversion, controlado_stock, conteo_en_unidad_receta, activo })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/productos')
  return { success: true }
}

export async function agregarCosto(ingredienteId: string, formData: FormData) {
  const supabase = await createClient()
  const costo = Number(formData.get('costo'))
  const fecha = formData.get('fecha') as string

  const { error } = await supabase.from('ingredientes_costos').insert({
    ingrediente_id: ingredienteId,
    costo_por_unidad_compra: costo,
    fecha_vigencia: fecha,
  })

  if (error) return { error: error.message }
  revalidatePath('/productos')
  return { success: true }
}
