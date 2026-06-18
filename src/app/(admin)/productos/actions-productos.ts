'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ─── Productos ───

export async function getProductos() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('productos')
    .select('*')
    .order('nombre')
  if (error) throw error
  return data
}

export async function getProductoCompleto(id: string) {
  const supabase = await createClient()

  const { data: producto } = await supabase
    .from('productos')
    .select('*')
    .eq('id', id)
    .single()

  const { data: precios } = await supabase
    .from('productos_precios')
    .select('*')
    .eq('producto_id', id)
    .order('fecha_vigencia', { ascending: false })

  const { data: receta } = await supabase
    .from('recetas')
    .select('*, ingredientes(*)')
    .eq('producto_id', id)

  const { data: aliases } = await supabase
    .from('mapeo_pedix')
    .select('*')
    .eq('producto_id', id)

  return {
    producto,
    precios: precios ?? [],
    receta: receta ?? [],
    aliases: aliases ?? [],
  }
}

export async function getPrecioVigente(productoId: string, fecha?: string) {
  const supabase = await createClient()
  const f = fecha ?? new Date().toISOString().split('T')[0]
  const { data } = await supabase
    .from('productos_precios')
    .select('precio')
    .eq('producto_id', productoId)
    .lte('fecha_vigencia', f)
    .order('fecha_vigencia', { ascending: false })
    .limit(1)
    .single()
  return data?.precio ?? null
}

export async function crearProducto(formData: FormData) {
  const supabase = await createClient()
  const nombre = formData.get('nombre') as string
  const categoria = formData.get('categoria') as string
  const precio = Number(formData.get('precio'))

  const { data: producto, error } = await supabase
    .from('productos')
    .insert({ nombre, categoria })
    .select()
    .single()

  if (error) return { error: error.message }

  if (precio > 0) {
    await supabase.from('productos_precios').insert({
      producto_id: producto.id,
      precio,
      fecha_vigencia: new Date().toISOString().split('T')[0],
    })
  }

  revalidatePath('/productos')
  return { data: producto }
}

export async function actualizarProducto(id: string, formData: FormData) {
  const supabase = await createClient()
  const nombre = formData.get('nombre') as string
  const categoria = formData.get('categoria') as string
  const activo = formData.get('activo') === 'true'

  const { error } = await supabase
    .from('productos')
    .update({ nombre, categoria, activo })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/productos')
  return { success: true }
}

export async function agregarPrecio(productoId: string, formData: FormData) {
  const supabase = await createClient()
  const precio = Number(formData.get('precio'))
  const fecha = formData.get('fecha') as string

  const { error } = await supabase.from('productos_precios').insert({
    producto_id: productoId,
    precio,
    fecha_vigencia: fecha,
  })

  if (error) return { error: error.message }
  revalidatePath('/productos')
  return { success: true }
}

// ─── Recetas ───

export async function agregarItemReceta(productoId: string, formData: FormData) {
  const supabase = await createClient()
  const ingrediente_id = formData.get('ingrediente_id') as string
  const cantidad = Number(formData.get('cantidad'))

  const { error } = await supabase.from('recetas').insert({
    producto_id: productoId,
    ingrediente_id,
    cantidad,
  })

  if (error) {
    if (error.code === '23505') return { error: 'Este ingrediente ya está en la receta' }
    return { error: error.message }
  }
  revalidatePath('/productos')
  return { success: true }
}

export async function actualizarItemReceta(recetaId: string, cantidad: number) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('recetas')
    .update({ cantidad })
    .eq('id', recetaId)

  if (error) return { error: error.message }
  revalidatePath('/productos')
  return { success: true }
}

export async function eliminarItemReceta(recetaId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('recetas')
    .delete()
    .eq('id', recetaId)

  if (error) return { error: error.message }
  revalidatePath('/productos')
  return { success: true }
}

// ─── Mapeo Pedix ───

export async function agregarAlias(productoId: string, formData: FormData) {
  const supabase = await createClient()
  const nombre_pedix = formData.get('nombre_pedix') as string

  const { error } = await supabase.from('mapeo_pedix').insert({
    nombre_pedix,
    producto_id: productoId,
  })

  if (error) {
    if (error.code === '23505') return { error: 'Este alias ya existe' }
    return { error: error.message }
  }
  revalidatePath('/productos')
  return { success: true }
}

export async function eliminarAlias(aliasId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('mapeo_pedix')
    .delete()
    .eq('id', aliasId)

  if (error) return { error: error.message }
  revalidatePath('/productos')
  return { success: true }
}

// ─── Cálculo de costo de producto ───

export async function calcularCostoProducto(productoId: string) {
  const supabase = await createClient()
  const hoy = new Date().toISOString().split('T')[0]

  // Obtener receta
  const { data: receta } = await supabase
    .from('recetas')
    .select('*, ingredientes(*)')
    .eq('producto_id', productoId)

  if (!receta || receta.length === 0) return { costo: null, detalle: [] }

  const detalle = []
  let costoTotal = 0

  for (const item of receta) {
    // Obtener costo vigente del ingrediente
    const { data: costoData } = await supabase
      .from('ingredientes_costos')
      .select('costo_por_unidad_compra')
      .eq('ingrediente_id', item.ingrediente_id)
      .lte('fecha_vigencia', hoy)
      .order('fecha_vigencia', { ascending: false })
      .limit(1)
      .single()

    const costoPorUnidadCompra = costoData?.costo_por_unidad_compra ?? 0
    const costoPorUnidadReceta = costoPorUnidadCompra / (item.ingredientes?.factor_conversion ?? 1)
    const costoParcial = costoPorUnidadReceta * item.cantidad

    detalle.push({
      receta_id: item.id,
      ingrediente_id: item.ingrediente_id,
      ingrediente_nombre: item.ingredientes?.nombre ?? '',
      unidad_receta: item.ingredientes?.unidad_receta ?? '',
      cantidad: item.cantidad,
      costo_por_unidad_receta: costoPorUnidadReceta,
      costo_parcial: costoParcial,
    })

    costoTotal += costoParcial
  }

  // Obtener precio vigente
  const { data: precioData } = await supabase
    .from('productos_precios')
    .select('precio')
    .eq('producto_id', productoId)
    .lte('fecha_vigencia', hoy)
    .order('fecha_vigencia', { ascending: false })
    .limit(1)
    .single()

  const precio = precioData?.precio ?? 0
  const margen = precio > 0 ? ((precio - costoTotal) / precio) * 100 : 0
  const beneficio = precio - costoTotal

  return { costo: costoTotal, precio, margen, beneficio, detalle }
}
