'use client'

import { useState, useEffect, useTransition } from 'react'
import { Plus, Search } from 'lucide-react'
import { SidePanel, Field, Input, Select, Button, Badge, EmptyState, useToast } from '@/components/ui'
import { formatARS, formatDate } from '@/lib/utils/format'
import {
  getIngredientes,
  getIngredienteConCostos,
  crearIngrediente,
  actualizarIngrediente,
  agregarCosto,
} from './actions-ingredientes'

type Ingrediente = {
  id: string
  nombre: string
  unidad_compra: string
  unidad_receta: string
  factor_conversion: number
  controlado_stock: boolean
  activo: boolean
}

type CostoHistorico = {
  id: string
  costo_por_unidad_compra: number
  fecha_vigencia: string
}

export default function IngredientesTab() {
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([])
  const [filtro, setFiltro] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedData, setSelectedData] = useState<{ ingrediente: Ingrediente; costos: CostoHistorico[] } | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [pending, startTransition] = useTransition()
  const { show, Toast } = useToast()

  useEffect(() => { loadIngredientes() }, [])

  useEffect(() => {
    if (selectedId) loadDetalle(selectedId)
  }, [selectedId])

  async function loadIngredientes() {
    const data = await getIngredientes()
    setIngredientes(data)
  }

  async function loadDetalle(id: string) {
    const data = await getIngredienteConCostos(id)
    setSelectedData(data as any)
  }

  async function handleCrear(formData: FormData) {
    startTransition(async () => {
      const result = await crearIngrediente(formData)
      if (result.error) { show(result.error, 'error'); return }
      show('Ingrediente creado')
      setShowNew(false)
      await loadIngredientes()
    })
  }

  async function handleActualizar(formData: FormData) {
    if (!selectedId) return
    startTransition(async () => {
      const result = await actualizarIngrediente(selectedId, formData)
      if (result.error) { show(result.error, 'error'); return }
      show('Ingrediente actualizado')
      await loadIngredientes()
      await loadDetalle(selectedId)
    })
  }

  async function handleNuevoCosto(formData: FormData) {
    if (!selectedId) return
    startTransition(async () => {
      const result = await agregarCosto(selectedId, formData)
      if (result.error) { show(result.error, 'error'); return }
      show('Nuevo costo registrado')
      await loadIngredientes()
      await loadDetalle(selectedId)
    })
  }

  const filtrados = ingredientes.filter((i) =>
    i.nombre.toLowerCase().includes(filtro.toLowerCase())
  )

  const costoActual = selectedData?.costos?.[0]?.costo_por_unidad_compra

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            placeholder="Buscar ingrediente..."
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            className="pl-9 !w-64"
          />
        </div>
        <Button onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4" /> Nuevo ingrediente
        </Button>
      </div>

      {/* Table */}
      {filtrados.length === 0 ? (
        <EmptyState
          message="No hay ingredientes cargados todavía."
          action={<Button onClick={() => setShowNew(true)}>Crear el primero</Button>}
        />
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-alt">
                <th className="text-left px-4 py-3 font-medium text-text-secondary">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary">U. Compra</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary">U. Receta</th>
                <th className="text-right px-4 py-3 font-medium text-text-secondary">Factor</th>
                <th className="text-right px-4 py-3 font-medium text-text-secondary">Costo actual</th>
                <th className="text-center px-4 py-3 font-medium text-text-secondary">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((ing) => (
                <IngredienteRow key={ing.id} ingrediente={ing} onClick={() => setSelectedId(ing.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Panel crear */}
      <SidePanel open={showNew} onClose={() => setShowNew(false)} title="Nuevo ingrediente">
        <FormIngrediente onSubmit={handleCrear} pending={pending} isNew />
      </SidePanel>

      {/* Panel detalle */}
      <SidePanel
        open={!!selectedId}
        onClose={() => { setSelectedId(null); setSelectedData(null) }}
        title={selectedData?.ingrediente?.nombre ?? 'Cargando...'}
      >
        {selectedData?.ingrediente && (
          <div className="space-y-8">
            {/* Editar */}
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Datos del ingrediente</h3>
              <FormIngrediente
                onSubmit={handleActualizar}
                pending={pending}
                initial={selectedData.ingrediente}
              />
            </div>

            {/* Historial de costos */}
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Historial de costos</h3>
              {selectedData.costos.length > 0 ? (
                <div className="space-y-1.5 mb-4">
                  {selectedData.costos.map((c, i) => (
                    <div
                      key={c.id}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                        i === 0 ? 'bg-brand-light font-medium' : 'bg-surface-alt'
                      }`}
                    >
                      <span>{formatDate(c.fecha_vigencia)}</span>
                      <span>{formatARS(c.costo_por_unidad_compra)}/{selectedData.ingrediente.unidad_compra}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-muted mb-4">Sin costos registrados.</p>
              )}

              <h4 className="text-xs font-medium text-text-secondary mb-2">Agregar nuevo costo</h4>
              <form
                action={handleNuevoCosto}
                className="flex items-end gap-2"
              >
                <Field label={`Costo / ${selectedData.ingrediente.unidad_compra}`}>
                  <Input name="costo" type="number" min="0" step="0.01" required placeholder="0" />
                </Field>
                <Field label="Vigente desde">
                  <Input name="fecha" type="date" required defaultValue={new Date().toISOString().split('T')[0]} />
                </Field>
                <Button type="submit" disabled={pending} size="md">
                  Agregar
                </Button>
              </form>
            </div>
          </div>
        )}
      </SidePanel>

      <Toast />
    </div>
  )
}

// ─── Row ───

function IngredienteRow({ ingrediente, onClick }: { ingrediente: Ingrediente; onClick: () => void }) {
  const [costo, setCosto] = useState<number | null>(null)

  useEffect(() => {
    import('./actions-ingredientes').then(({ getCostoVigente }) =>
      getCostoVigente(ingrediente.id).then(setCosto)
    )
  }, [ingrediente.id])

  return (
    <tr
      onClick={onClick}
      className="border-b border-border last:border-0 hover:bg-surface-alt cursor-pointer transition-colors"
    >
      <td className="px-4 py-3 font-medium text-text-primary">{ingrediente.nombre}</td>
      <td className="px-4 py-3 text-text-secondary">{ingrediente.unidad_compra}</td>
      <td className="px-4 py-3 text-text-secondary">{ingrediente.unidad_receta}</td>
      <td className="px-4 py-3 text-right text-text-secondary">{ingrediente.factor_conversion}</td>
      <td className="px-4 py-3 text-right font-medium">
        {costo != null ? formatARS(costo) : <Badge color="yellow">Sin costo</Badge>}
      </td>
      <td className="px-4 py-3 text-center">
        <Badge color={ingrediente.activo ? 'green' : 'gray'}>
          {ingrediente.activo ? 'Activo' : 'Inactivo'}
        </Badge>
      </td>
    </tr>
  )
}

// ─── Form ───

function FormIngrediente({
  onSubmit,
  pending,
  initial,
  isNew,
}: {
  onSubmit: (fd: FormData) => void
  pending: boolean
  initial?: Ingrediente
  isNew?: boolean
}) {
  return (
    <form action={onSubmit} className="space-y-4">
      <Field label="Nombre">
        <Input name="nombre" required defaultValue={initial?.nombre} placeholder="Ej: Carne" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Unidad de compra" hint="Cómo comprás">
          <Select name="unidad_compra" defaultValue={initial?.unidad_compra ?? 'kg'}>
            <option value="kg">kg</option>
            <option value="unidad">unidad</option>
            <option value="litro">litro</option>
            <option value="docena">docena</option>
          </Select>
        </Field>
        <Field label="Unidad de receta" hint="Cómo se usa en recetas">
          <Input name="unidad_receta" required defaultValue={initial?.unidad_receta} placeholder="Ej: medallón" />
        </Field>
      </div>
      <Field label="Factor de conversión" hint={initial ? `1 ${initial.unidad_compra} = ${initial.factor_conversion} ${initial.unidad_receta}(s)` : 'Cuántas unidades de receta salen de 1 unidad de compra'}>
        <Input name="factor_conversion" type="number" min="0.01" step="0.01" required defaultValue={initial?.factor_conversion ?? 1} />
      </Field>
      {isNew && (
        <Field label="Costo inicial por unidad de compra">
          <Input name="costo_inicial" type="number" min="0" step="0.01" placeholder="0" />
        </Field>
      )}
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
          <input type="hidden" name="controlado_stock" value="false" />
          <input
            type="checkbox"
            name="controlado_stock"
            value="true"
            defaultChecked={initial?.controlado_stock ?? true}
            className="rounded border-border"
          />
          Controlar stock
        </label>
        {!isNew && (
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input type="hidden" name="activo" value="false" />
            <input
              type="checkbox"
              name="activo"
              value="true"
              defaultChecked={initial?.activo ?? true}
              className="rounded border-border"
            />
            Activo
          </label>
        )}
      </div>
      <Button type="submit" disabled={pending}>
        {isNew ? 'Crear ingrediente' : 'Guardar cambios'}
      </Button>
    </form>
  )
}
