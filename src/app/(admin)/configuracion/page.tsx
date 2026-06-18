'use client'

import { useState, useEffect, useTransition } from 'react'
import { Field, Input, Select, Button, useToast } from '@/components/ui'
import { getConfiguracion, guardarConfiguracion, getProductosParaConfig, getMapeosPedix } from './actions'

export default function ConfiguracionPage() {
  const [config, setConfig] = useState<Record<string, string>>({})
  const [productos, setProductos] = useState<{ id: string; nombre: string }[]>([])
  const [mapeos, setMapeos] = useState<any[]>([])
  const [pending, startTransition] = useTransition()
  const { show, Toast } = useToast()

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const [c, p, m] = await Promise.all([
      getConfiguracion(),
      getProductosParaConfig(),
      getMapeosPedix(),
    ])
    setConfig(c)
    setProductos(p)
    setMapeos(m)
  }

  async function handleGuardar(fd: FormData) {
    startTransition(async () => {
      const r = await guardarConfiguracion(fd)
      if (r.success) {
        show('Configuración guardada')
        await loadAll()
      }
    })
  }

  if (!config.cadete_base_minima) {
    return <div className="text-sm text-text-muted">Cargando configuración...</div>
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-text-primary mb-6">Configuración</h1>

      <form action={handleGuardar} className="space-y-8">
        {/* Cadetería */}
        <section className="bg-surface rounded-xl border border-border p-6">
          <h2 className="text-sm font-semibold text-text-primary mb-4">Cadetería</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Base mínima ($)">
              <Input name="cadete_base_minima" type="number" min="0" step="1" defaultValue={config.cadete_base_minima} />
            </Field>
            <Field label="Valor por viaje ($)">
              <Input name="cadete_valor_viaje" type="number" min="0" step="1" defaultValue={config.cadete_valor_viaje} />
            </Field>
          </div>
        </section>

        {/* Consumo interno */}
        <section className="bg-surface rounded-xl border border-border p-6">
          <h2 className="text-sm font-semibold text-text-primary mb-4">Consumo interno</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Producto empleado" hint="Se consume 1 por noche trabajada">
              <Select name="producto_consumo_empleado" defaultValue={config.producto_consumo_empleado ?? ''}>
                <option value="">Sin configurar</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </Select>
            </Field>
            <Field label="Producto cadete" hint="Se consume 1 si supera la base">
              <Select name="producto_consumo_cadete" defaultValue={config.producto_consumo_cadete ?? ''}>
                <option value="">Sin configurar</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </Select>
            </Field>
          </div>
        </section>

        {/* Metas */}
        <section className="bg-surface rounded-xl border border-border p-6">
          <h2 className="text-sm font-semibold text-text-primary mb-4">Meta del equipo</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Nombre de la meta">
                <Input name="meta_nombre" defaultValue={config.meta_nombre} />
              </Field>
              <Field label="Hamburguesas objetivo">
                <Input name="meta_hamburguesas" type="number" min="1" defaultValue={config.meta_hamburguesas} />
              </Field>
            </div>
            <Field label="Descripción (opcional)">
              <Input name="meta_descripcion" defaultValue={config.meta_descripcion ?? ''} />
            </Field>
          </div>
        </section>

        {/* Alertas */}
        <section className="bg-surface rounded-xl border border-border p-6">
          <h2 className="text-sm font-semibold text-text-primary mb-4">Alertas del dashboard</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Margen mínimo (%)" hint="Alerta si baja de este valor">
              <Input name="alerta_margen_minimo" type="number" min="0" max="100" defaultValue={config.alerta_margen_minimo} />
            </Field>
            <Field label="Publicidad máxima (% de ventas)" hint="Alerta si supera este valor">
              <Input name="alerta_publicidad_maxima" type="number" min="0" max="100" defaultValue={config.alerta_publicidad_maxima} />
            </Field>
          </div>
        </section>

        <Button type="submit" disabled={pending}>Guardar cambios</Button>
      </form>

      {/* Mapeos Pedix (solo lectura) */}
      <section className="bg-surface rounded-xl border border-border p-6 mt-8">
        <h2 className="text-sm font-semibold text-text-primary mb-4">Mapeo Pedix</h2>
        <p className="text-xs text-text-muted mb-4">Los mapeos se gestionan desde el panel lateral de cada producto.</p>
        {mapeos.length > 0 ? (
          <div className="space-y-1.5">
            {mapeos.map((m: any) => (
              <div key={m.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-alt text-sm">
                <span className="text-text-secondary truncate">{m.nombre_pedix}</span>
                <span className="text-text-primary font-medium">{m.productos?.nombre ?? '—'}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-text-muted">No hay mapeos todavía. Cargalos desde cada producto.</p>
        )}
      </section>

      <Toast />
    </div>
  )
}
