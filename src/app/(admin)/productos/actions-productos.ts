'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

function checkboxValue(formData: FormData, name: string): boolean {
  return formData.getAll(name).includes('true')
}

// Obtiene productos CON precio vigente y costo calculado en una sola pasada
export async function getProductosConMetricas() {
  const supabase = await createClient()
  const hoy = new Date().toISOString().split('T')[0]

  // 1. Productos
  const { data: productos, error } = await supabase
    .from('productos')
    .select('*')
    .order('nombre')
  if (error) throw error

  // 2. Todos los precios vigentes
  const { data: todosPrecios } = await supabase
    .from('productos_precios')
    .select('producto_id, precio, fecha_vigencia, created_at')
    .lte('fecha_vigencia', hoy)
    .order('fecha_vigencia', { ascending: false })
    .order('created_at', { ascending: false })

  const precioVigente: Record<string, number> = {}
  for (const p of todosPrecios ?? []) {
    if (!(p.producto_id in precioVigente)) {
      precioVigente[p.producto_id] = p.precio
    }
  }

  // 3. Todas las recetas con ingredientes
  const { data: todasRecetas } = await supabase
    .from('recetas')
    .select('producto_id, cantidad, ingredientes(id, factor_conversion)')

  // 4. Todos los costos de ingredientes vigentes
  const { data: todosCostos } = await supabase
    .from('ingredientes_costos')
    .select('ingrediente_id, costo_por_unidad_compra, fecha_vigencia, created_at')
    .lte('fecha_vigencia', hoy)
    .order('fecha_vigencia', { ascending: false })
    .order('created_at', { ascending: false })

  const costoIngVigente: Record<string, number> = {}
  for (const c of todosCostos ?? []) {
    if (!(c.ingrediente_id in costoIngVigente)) {
      costoIngVigente[c.ingrediente_id] = c.costo_por_unidad_compra
    }
  }

  // 5. Calcular costo por producto
  const costoProducto: Record<string, number> = {}
  for (const r of todasRecetas ?? []) {
    const ing = r.ingredientes as any
    if (!ing) continue
    const costoUnitCompra = costoIngVigente[ing.id] ?? 0
    const costoUnitReceta = costoUnitCompra / (ing.factor_conversion ?? 1)
    const parcial = costoUnitReceta * r.cantidad
    costoProducto[r.producto_id] = (costoProducto[r.producto_id] ?? 0) + parcial
  }

  // 6. Merge
  return (productos ?? []).map((prod) => {
    const precio = precioVigente[prod.id] ?? null
    const costo = costoProducto[prod.id] ?? null
    const margen = precio && costo != null && precio > 0
      ? ((precio - costo) / precio) * 100
      : null
    return { ...prod, precio_vigente: precio, costo_calculado: costo, margen }
  })
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
    .order('created_at', { ascending: false })

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

// Duplica un producto existente: mismo categoria, copia la receta completa
// (ingrediente + cantidad) y el precio vigente (si tiene). No copia los
// alias de mapeo_pedix — son específicos del nombre que usa Pedix para el
// producto original y `nombre_pedix` es único, así que copiarlos chocaría
// contra esa restricción.
export async function duplicarProducto(id: string, nuevoNombre: string) {
  const supabase = await createClient()

  const { data: original, error: errorOriginal } = await supabase
    .from('productos')
    .select('categoria')
    .eq('id', id)
    .single()
  if (errorOriginal || !original) {
    return { error: errorOriginal?.message || 'Producto original no encontrado' }
  }

  const { data: nuevo, error: errorNuevo } = await supabase
    .from('productos')
    .insert({ nombre: nuevoNombre, categoria: original.categoria })
    .select()
    .single()
  if (errorNuevo) return { error: errorNuevo.message }

  const { data: receta } = await supabase
    .from('recetas')
    .select('ingrediente_id, cantidad')
    .eq('producto_id', id)

  if (receta && receta.length > 0) {
    const filas = receta.map((r) => ({
      producto_id: nuevo.id,
      ingrediente_id: r.ingrediente_id,
      cantidad: r.cantidad,
    }))
    const { error: errorReceta } = await supabase.from('recetas').insert(filas)
    if (errorReceta) {
      revalidatePath('/productos')
      return {
        error: `Producto "${nuevoNombre}" creado, pero falló al copiar la receta: ${errorReceta.message}`,
        data: nuevo,
      }
    }
  }

  const hoy = new Date().toISOString().split('T')[0]
  const { data: precioVigente } = await supabase
    .from('productos_precios')
    .select('precio')
    .eq('producto_id', id)
    .lte('fecha_vigencia', hoy)
    .order('fecha_vigencia', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (precioVigente && precioVigente.precio > 0) {
    await supabase.from('productos_precios').insert({
      producto_id: nuevo.id,
      precio: precioVigente.precio,
      fecha_vigencia: hoy,
    })
  }

  revalidatePath('/productos')
  return { data: nuevo }
}

export async function actualizarProducto(id: string, formData: FormData) {
  const supabase = await createClient()
  const nombre = formData.get('nombre') as string
  const categoria = formData.get('categoria') as string
  const activo = checkboxValue(formData, 'activo')

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

export async function eliminarItemReceta(recetaId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('recetas').delete().eq('id', recetaId)
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
  const { error } = await supabase.from('mapeo_pedix').delete().eq('id', aliasId)
  if (error) return { error: error.message }
  revalidatePath('/productos')
  return { success: true }
}

// ─── Cálculo de costo detallado (para panel lateral) ───

export async function calcularCostoProducto(productoId: string) {
  const supabase = await createClient()
  const hoy = new Date().toISOString().split('T')[0]

  const { data: receta } = await supabase
    .from('recetas')
    .select('*, ingredientes(*)')
    .eq('producto_id', productoId)

  if (!receta || receta.length === 0) return { costo: null, detalle: [] }

  // Obtener costos de todos los ingredientes de esta receta en una sola query
  const ingIds = receta.map((r) => r.ingrediente_id)
  const { data: costosData } = await supabase
    .from('ingredientes_costos')
    .select('ingrediente_id, costo_por_unidad_compra, fecha_vigencia, created_at')
    .in('ingrediente_id', ingIds)
    .lte('fecha_vigencia', hoy)
    .order('fecha_vigencia', { ascending: false })
    .order('created_at', { ascending: false })

  const costoVigente: Record<string, number> = {}
  for (const c of costosData ?? []) {
    if (!(c.ingrediente_id in costoVigente)) {
      costoVigente[c.ingrediente_id] = c.costo_por_unidad_compra
    }
  }

  const detalle = []
  let costoTotal = 0

  for (const item of receta) {
    const costoPorUnidadCompra = costoVigente[item.ingrediente_id] ?? 0
    const factor = (item.ingredientes as any)?.factor_conversion ?? 1
    const costoPorUnidadReceta = costoPorUnidadCompra / factor
    const costoParcial = costoPorUnidadReceta * item.cantidad

    detalle.push({
      receta_id: item.id,
      ingrediente_id: item.ingrediente_id,
      ingrediente_nombre: (item.ingredientes as any)?.nombre ?? '',
      unidad_receta: (item.ingredientes as any)?.unidad_receta ?? '',
      cantidad: item.cantidad,
      costo_por_unidad_receta: costoPorUnidadReceta,
      costo_parcial: costoParcial,
    })

    costoTotal += costoParcial
  }

  const { data: precioData } = await supabase
    .from('productos_precios')
    .select('precio')
    .eq('producto_id', productoId)
    .lte('fecha_vigencia', hoy)
    .order('fecha_vigencia', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  const precio = precioData?.precio ?? 0
  const margen = precio > 0 ? ((precio - costoTotal) / precio) * 100 : 0
  const beneficio = precio - costoTotal

  return { costo: costoTotal, precio, margen, beneficio, detalle }
}
