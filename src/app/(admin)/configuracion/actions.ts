'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getConfiguracion() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('configuracion')
    .select('*')
    .order('clave')
  if (error) throw error

  const config: Record<string, string> = {}
  for (const row of data ?? []) {
    config[row.clave] = row.valor
  }
  return config
}

export async function guardarConfiguracion(formData: FormData) {
  const supabase = await createClient()

  const claves = [
    'cadete_base_minima',
    'cadete_valor_viaje',
    'meta_hamburguesas',
    'meta_nombre',
    'meta_descripcion',
    'alerta_margen_minimo',
    'alerta_publicidad_maxima',
    'producto_consumo_empleado',
    'producto_consumo_cadete',
  ]

  for (const clave of claves) {
    const valor = formData.get(clave) as string
    if (valor == null) continue

    const { data: existing } = await supabase
      .from('configuracion')
      .select('id')
      .eq('clave', clave)
      .single()

    if (existing) {
      await supabase
        .from('configuracion')
        .update({ valor, updated_at: new Date().toISOString() })
        .eq('clave', clave)
    } else {
      await supabase
        .from('configuracion')
        .insert({ clave, valor, descripcion: '' })
    }
  }

  revalidatePath('/configuracion')
  return { success: true }
}

export async function getProductosParaConfig() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('productos')
    .select('id, nombre')
    .eq('activo', true)
    .order('nombre')
  return data ?? []
}

export async function getMapeosPedix() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('mapeo_pedix')
    .select('*, productos(nombre)')
    .order('nombre_pedix')
  return data ?? []
}
