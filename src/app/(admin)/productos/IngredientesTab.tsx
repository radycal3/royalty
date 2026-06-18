'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { Plus, Search, Archive, ArchiveRestore, Download } from 'lucide-react'
import { SidePanel, Field, Input, Select, Button, Badge, EmptyState, useToast } from '@/components/ui'
import { formatARS, formatDate } from '@/lib/utils/format'
import { exportToExcel } from '@/lib/utils/export'
import {
  getIngredientesConCosto,
  getIngredienteConCostos,
  crearIngrediente,
  actualizarIngrediente,
  agregarCosto,
} from './actions-ingredientes'

type IngredienteConCosto = {
  id: string; nombre: string; unidad_compra: string; unidad_receta: string;
  factor_conversion: number; controlado_stock: boolean; activo: boolean;
  costo_vigente: number | null;
}

type CostoHistorico = {
  id: string; costo_por_unidad_compra: number; fecha_vigencia: string;
}

export default function IngredientesTab({ onCostChange }: { onCostChange?: () => void }) {
  const [ingredientes, setIngredientes] = useState<IngredienteConCosto[]>([])
  const [loaded, setLoaded] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedData, setSelectedData] = useState<{ ingrediente: IngredienteConCosto; costos: CostoHistorico[] } | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [pending, startTransition] = useTransition()
  const { show, Toast } = useToast()
  const requestId = useRef(0)

  useEffect(() => { loadIngredientes() }, [])

  async function loadIngredientes() {
    const thisRequest = ++requestId.current
    const data = await getIngredientesConCosto()
    if (thisRequest === requestId.current) {
      setIngredientes(data)
      setLoaded(true)
    }
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
      await Promise.all([loadIngredientes(), loadDetalle(selectedId)])
    })
  }

  async function handleNuevoCosto(formData: FormData) {
    if (!selectedId) return
    startTransition(async () => {
      const result = await agregarCosto(selectedId, formData)
      if (result.error) { show(result.error, 'error'); return }
      show('Nuevo costo registrado')
      await Promise.all([loadIngredientes(), loadDetalle(selectedId)])
      onCostChange?.() // Avisar a ProductosTab que recargue
    })
  }

  async function handleToggleActivo(ing: IngredienteConCosto) {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('nombre', ing.nombre)
      fd.set('unidad_compra', ing.unidad_compra)
      fd.set('unidad_receta', ing.unidad_receta)
      fd.set('factor_conversion', String(ing.factor_conversion))
      fd.append('controlado_stock', String(ing.controlado_stock))
      fd.append('activo', String(!ing.activo))
      const result = await actualizarIngrediente(ing.id, fd)
      if (result.error) { show(result.error, 'error'); return }
      show(ing.activo ? 'Ingrediente archivado' : 'Ingrediente reactivado')
      await loadIngredientes()
      if (selectedId === ing.id) await loadDetalle(ing.id)
    })
  }

  function handleOpenDetalle(id: string) {
    setSelectedId(id)
    loadDetalle(id)
  }

  function handleExport() {
    exportToExcel(filtrados, [
      { key: 'nombre', header: 'Nombre' },
      { key: 'unidad_compra', header: 'Unidad Compra' },
      { key: 'unidad_receta', header: 'Unidad Receta' },
      { key: 'factor_conversion', header: 'Rendimiento (factor)' },
      { key: 'costo_vigente', header: 'Costo Vigente ($)', format: (v: number | null) => v ?? 'Sin costo' },
      { key: 'controlado_stock', header: 'Controla Stock', format: (v: boolean) => v ? 'Sí' : 'No' },
      { key: 'activo', header: 'Estado', format: (v: boolean) => v ? 'Activo' : 'Inactivo' },
    ], 'Ingredientes_Royalty')
  }

  const filtrados = ingredientes.filter((i) =>
    i.nombre.toLowerCase().includes(filtro.toLowerCase())
  )

  const showEmpty = loaded && filtrados.length === 0
  const showTable = filtrados.length > 0
  const showLoading = !loaded

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input placeholder="Buscar ingrediente..." value={filtro} onChange={(e) => setFiltro(e.target.value)} className="pl-9 !w-64" />
        </div>
        <div className="flex items-center gap-2">
          {showTable && (
            <Button variant="secondary" onClick={handleExport}>
              <Download className="w-4 h-4" /> Exportar
            </Button>
          )}
          <Button onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4" /> Nuevo ingrediente
          </Button>
        </div>
      </div>

      {showLoading && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-text-muted">Cargando ingredientes...</p>
        </div>
      )}

      {showEmpty && (
        <EmptyState message="No hay ingredientes cargados todavía." action={<Button onClick={() => setShowNew(true)}>Crear el primero</Button>} />
      )}

      {showTable && (
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
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((ing) => (
                <tr key={ing.id} onClick={() => handleOpenDetalle(ing.id)} className="border-b border-border last:border-0 hover:bg-surface-alt cursor-pointer transition-colors">
                  <td className="px-4 py-3 font-medium text-text-primary">{ing.nombre}</td>
                  <td className="px-4 py-3 text-text-secondary">{ing.unidad_compra}</td>
                  <td className="px-4 py-3 text-text-secondary">{ing.unidad_receta}</td>
                  <td className="px-4 py-3 text-right text-text-secondary">{ing.factor_conversion}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {ing.costo_vigente != null ? formatARS(ing.costo_vigente) : <Badge color="yellow">Sin costo</Badge>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge color={ing.activo ? 'green' : 'gray'}>{ing.activo ? 'Activo' : 'Inactivo'}</Badge>
                  </td>
                  <td className="px-2 py-3">
                    <button onClick={(e) => { e.stopPropagation(); handleToggleActivo(ing) }} title={ing.activo ? 'Archivar' : 'Reactivar'} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-alt transition-colors">
                      {ing.activo ? <Archive className="w-4 h-4" /> : <ArchiveRestore className="w-4 h-4" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SidePanel open={showNew} onClose={() => setShowNew(false)} title="Nuevo ingrediente">
        <FormIngrediente onSubmit={handleCrear} pending={pending} isNew />
      </SidePanel>

      <SidePanel open={!!selectedId} onClose={() => { setSelectedId(null); setSelectedData(null) }} title={selectedData?.ingrediente?.nombre ?? 'Cargando...'}>
        {selectedData?.ingrediente && (
          <div className="space-y-8">
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Datos del ingrediente</h3>
              <FormIngrediente key={selectedData.ingrediente.id} onSubmit={handleActualizar} pending={pending} initial={selectedData.ingrediente} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Historial de costos</h3>
              {selectedData.costos.length > 0 ? (
                <div className="space-y-1.5 mb-4">
                  {selectedData.costos.map((c, i) => (
                    <div key={c.id} className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${i === 0 ? 'bg-brand-light font-medium' : 'bg-surface-alt'}`}>
                      <span>{formatDate(c.fecha_vigencia)}</span>
                      <span>{formatARS(c.costo_por_unidad_compra)}/{selectedData.ingrediente.unidad_compra}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-muted mb-4">Sin costos registrados.</p>
              )}
              <h4 className="text-xs font-medium text-text-secondary mb-2">Agregar nuevo costo</h4>
              <form action={handleNuevoCosto} className="flex items-end gap-2">
                <Field label={`Costo / ${selectedData.ingrediente.unidad_compra}`}>
                  <Input name="costo" type="number" min="0" step="0.01" required placeholder="0" />
                </Field>
                <Field label="Vigente desde">
                  <Input name="fecha" type="date" required defaultValue={new Date().toISOString().split('T')[0]} />
                </Field>
                <Button type="submit" disabled={pending} size="md">Agregar</Button>
              </form>
            </div>
          </div>
        )}
      </SidePanel>

      <Toast />
    </div>
  )
}

function FormIngrediente({ onSubmit, pending, initial, isNew }: {
  onSubmit: (fd: FormData) => void; pending: boolean; initial?: IngredienteConCosto; isNew?: boolean;
}) {
  const [controladoStock, setControladoStock] = useState(initial?.controlado_stock ?? true)
  const [activo, setActivo] = useState(initial?.activo ?? true)

  return (
    <form action={onSubmit} className="space-y-4">
      <Field label="Nombre"><Input name="nombre" required defaultValue={initial?.nombre} placeholder="Ej: Carne" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Unidad de compra" hint="Cómo comprás">
          <Select name="unidad_compra" defaultValue={initial?.unidad_compra ?? 'kg'}>
            <option value="kg">kg</option><option value="unidad">unidad</option><option value="litro">litro</option><option value="docena">docena</option>
          </Select>
        </Field>
        <Field label="Unidad de receta" hint="Cómo se usa en recetas"><Input name="unidad_receta" required defaultValue={initial?.unidad_receta} placeholder="Ej: medallón" /></Field>
      </div>
      <Field label="Factor de conversión" hint={initial ? `1 ${initial.unidad_compra} = ${initial.factor_conversion} ${initial.unidad_receta}(s)` : 'Cuántas unidades de receta salen de 1 unidad de compra'}>
        <Input name="factor_conversion" type="number" min="0.01" step="0.01" required defaultValue={initial?.factor_conversion ?? 1} />
      </Field>
      {isNew && <Field label="Costo inicial por unidad de compra"><Input name="costo_inicial" type="number" min="0" step="0.01" placeholder="0" /></Field>}
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
          <input type="hidden" name="controlado_stock" value="false" />
          <input type="checkbox" name="controlado_stock" value="true" checked={controladoStock} onChange={(e) => setControladoStock(e.target.checked)} className="rounded border-border" />
          Controlar stock
        </label>
        {!isNew && (
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input type="hidden" name="activo" value="false" />
            <input type="checkbox" name="activo" value="true" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="rounded border-border" />
            Activo
          </label>
        )}
      </div>
      <Button type="submit" disabled={pending}>{isNew ? 'Crear ingrediente' : 'Guardar cambios'}</Button>
    </form>
  )
}
