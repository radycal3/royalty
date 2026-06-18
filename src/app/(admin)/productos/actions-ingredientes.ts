'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getIngredientes() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ingredientes')
    .select('*')
    .order('nombre')
  if (error) throw error
  return data
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

  return { ingrediente, costos: costos ?? [] }
}

export async function getCostoVigente(ingredienteId: string, fecha?: string) {
  const supabase = await createClient()
  const f = fecha ?? new Date().toISOString().split('T')[0]
  const { data } = await supabase
    .from('ingredientes_costos')
    .select('costo_por_unidad_compra')
    .eq('ingrediente_id', ingredienteId)
    .lte('fecha_vigencia', f)
    .order('fecha_vigencia', { ascending: false })
    .limit(1)
    .single()
  return data?.costo_por_unidad_compra ?? null
}

export async function crearIngrediente(formData: FormData) {
  const supabase = await createClient()
  const nombre = formData.get('nombre') as string
  const unidad_compra = formData.get('unidad_compra') as string
  const unidad_receta = formData.get('unidad_receta') as string
  const factor_conversion = Number(formData.get('factor_conversion'))
  const controlado_stock = formData.get('controlado_stock') === 'true'
  const costo_inicial = Number(formData.get('costo_inicial'))

  const { data: ingrediente, error } = await supabase
    .from('ingredientes')
    .insert({ nombre, unidad_compra, unidad_receta, factor_conversion, controlado_stock })
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
  const controlado_stock = formData.get('controlado_stock') === 'true'
  const activo = formData.get('activo') === 'true'

  const { error } = await supabase
    .from('ingredientes')
    .update({ nombre, unidad_compra, unidad_receta, factor_conversion, controlado_stock, activo })
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
