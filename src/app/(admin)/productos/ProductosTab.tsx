'use client'

import { useState, useEffect, useRef, useTransition, forwardRef, useImperativeHandle } from 'react'
import { Plus, Search, Trash2, Archive, ArchiveRestore, Download, Copy } from 'lucide-react'
import { SidePanel, Field, Input, Select, Button, Badge, EmptyState, useToast } from '@/components/ui'
import { formatARS, formatPercent, formatDate } from '@/lib/utils/format'
import { exportToExcel } from '@/lib/utils/export'
import {
  getProductosConMetricas,
  getProductoCompleto,
  crearProducto,
  actualizarProducto,
  duplicarProducto,
  agregarPrecio,
  agregarItemReceta,
  eliminarItemReceta,
  agregarAlias,
  eliminarAlias,
  calcularCostoProducto,
} from './actions-productos'
import { getIngredientesConCosto } from './actions-ingredientes'

type ProductoConMetricas = {
  id: string; nombre: string; categoria: string; activo: boolean;
  precio_vigente: number | null; costo_calculado: number | null; margen: number | null;
}
type IngredienteMin = { id: string; nombre: string; activo: boolean }
type PrecioHist = { id: string; precio: number; fecha_vigencia: string }
type Alias = { id: string; nombre_pedix: string }
type CostoDetalle = {
  receta_id: string; ingrediente_nombre: string; unidad_receta: string;
  cantidad: number; costo_por_unidad_receta: number; costo_parcial: number;
}
type CostoCalc = {
  costo: number | null; precio: number; margen: number;
  beneficio: number; detalle: CostoDetalle[];
}

export type ProductosTabHandle = { reload: () => void }

const ProductosTab = forwardRef<ProductosTabHandle>(function ProductosTab(_, ref) {
  const [productos, setProductos] = useState<ProductoConMetricas[]>([])
  const [ingredientes, setIngredientes] = useState<IngredienteMin[]>([])
  const [loaded, setLoaded] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<{
    producto: any; precios: PrecioHist[]; receta: any[]; aliases: Alias[];
  } | null>(null)
  const [costoCalc, setCostoCalc] = useState<CostoCalc | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [duplicando, setDuplicando] = useState<ProductoConMetricas | null>(null)
  const [pending, startTransition] = useTransition()
  const { show, Toast } = useToast()
  const requestId = useRef(0)

  useEffect(() => { loadProductos(); loadIngredientes() }, [])

  // Exponer reload al padre para sincronización cross-tab
  useImperativeHandle(ref, () => ({
    reload() {
      loadProductos()
      loadIngredientes()
    }
  }))

  async function loadProductos() {
    const thisRequest = ++requestId.current
    const data = await getProductosConMetricas()
    if (thisRequest === requestId.current) {
      setProductos(data)
      setLoaded(true)
    }
  }

  async function loadIngredientes() {
    setIngredientes(await getIngredientesConCosto())
  }

  async function loadDetalle(id: string) {
    const [d, c] = await Promise.all([
      getProductoCompleto(id),
      calcularCostoProducto(id),
    ])
    setDetalle(d as any)
    setCostoCalc(c as any)
  }

  async function handleCrear(fd: FormData) {
    startTransition(async () => {
      const r = await crearProducto(fd)
      if (r.error) { show(r.error, 'error'); return }
      show('Producto creado')
      setShowNew(false)
      await loadProductos()
    })
  }

  async function handleActualizar(fd: FormData) {
    if (!selectedId) return
    startTransition(async () => {
      const r = await actualizarProducto(selectedId, fd)
      if (r.error) { show(r.error, 'error'); return }
      show('Producto actualizado')
      await Promise.all([loadProductos(), loadDetalle(selectedId)])
    })
  }

  async function handleNuevoPrecio(fd: FormData) {
    if (!selectedId) return
    startTransition(async () => {
      const r = await agregarPrecio(selectedId, fd)
      if (r.error) { show(r.error, 'error'); return }
      show('Precio actualizado')
      await Promise.all([loadProductos(), loadDetalle(selectedId)])
    })
  }

  async function handleAgregarReceta(fd: FormData) {
    if (!selectedId) return
    startTransition(async () => {
      const r = await agregarItemReceta(selectedId, fd)
      if (r.error) { show(r.error, 'error'); return }
      show('Ingrediente agregado a la receta')
      await Promise.all([loadProductos(), loadDetalle(selectedId)])
    })
  }

  async function handleEliminarReceta(recetaId: string) {
    if (!selectedId) return
    startTransition(async () => {
      const r = await eliminarItemReceta(recetaId)
      if (r.error) { show(r.error, 'error'); return }
      show('Ingrediente eliminado de la receta')
      await Promise.all([loadProductos(), loadDetalle(selectedId)])
    })
  }

  async function handleAgregarAlias(fd: FormData) {
    if (!selectedId) return
    startTransition(async () => {
      const r = await agregarAlias(selectedId, fd)
      if (r.error) { show(r.error, 'error'); return }
      show('Alias agregado')
      await loadDetalle(selectedId)
    })
  }

  async function handleEliminarAlias(aliasId: string) {
    if (!selectedId) return
    startTransition(async () => {
      const r = await eliminarAlias(aliasId)
      if (r.error) { show(r.error, 'error'); return }
      show('Alias eliminado')
      await loadDetalle(selectedId)
    })
  }

  async function handleDuplicar(fd: FormData) {
    if (!duplicando) return
    const nuevoNombre = fd.get('nombre') as string
    startTransition(async () => {
      const r = await duplicarProducto(duplicando.id, nuevoNombre)
      if (r.error) { show(r.error, 'error'); return }
      show(`"${nuevoNombre}" creado con la receta de "${duplicando.nombre}"`)
      setDuplicando(null)
      await loadProductos()
      if (r.data) handleOpenDetalle(r.data.id)
    })
  }

  async function handleToggleActivo(prod: ProductoConMetricas) {
    startTransition(async () => {
      const fd = new FormData()
      fd.set('nombre', prod.nombre)
      fd.set('categoria', prod.categoria)
      fd.append('activo', String(!prod.activo))
      const r = await actualizarProducto(prod.id, fd)
      if (r.error) { show(r.error, 'error'); return }
      show(prod.activo ? 'Producto archivado' : 'Producto reactivado')
      await loadProductos()
      if (selectedId === prod.id) await loadDetalle(prod.id)
    })
  }

  function handleOpenDetalle(id: string) {
    setSelectedId(id)
    loadDetalle(id)
  }

  function handleExport() {
    const catLabels: Record<string, string> = {
      hamburguesa: 'Hamburguesa', acompanamiento: 'Acompañamiento', bebida: 'Bebida', combo: 'Combo',
    }
    exportToExcel(filtrados, [
      { key: 'nombre', header: 'Producto' },
      { key: 'categoria', header: 'Categoría', format: (v: string) => catLabels[v] ?? v },
      { key: 'precio_vigente', header: 'Precio Venta ($)', format: (v: number | null) => v ?? 'Sin precio' },
      { key: 'costo_calculado', header: 'Costo ($)', format: (v: number | null) => v != null ? Math.round(v) : 'Sin receta' },
      { key: 'margen', header: 'Margen (%)', format: (v: number | null) => v != null ? Number(v.toFixed(1)) : '—' },
      { key: 'activo', header: 'Estado', format: (v: boolean) => v ? 'Activo' : 'Inactivo' },
    ], 'Productos_Royalty')
  }

  const catLabels: Record<string, string> = {
    hamburguesa: 'Hamburguesa', acompanamiento: 'Acompañamiento', bebida: 'Bebida', combo: 'Combo',
  }

  const filtrados = productos.filter((p) =>
    p.nombre.toLowerCase().includes(filtro.toLowerCase())
  )

  const showEmpty = loaded && filtrados.length === 0
  const showTable = filtrados.length > 0
  const showLoading = !loaded

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input placeholder="Buscar producto..." value={filtro} onChange={(e) => setFiltro(e.target.value)} className="pl-9 !w-64" />
        </div>
        <div className="flex items-center gap-2">
          {showTable && (
            <Button variant="secondary" onClick={handleExport}>
              <Download className="w-4 h-4" /> Exportar
            </Button>
          )}
          <Button onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4" /> Nuevo producto
          </Button>
        </div>
      </div>

      {showLoading && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-text-muted">Cargando productos...</p>
        </div>
      )}

      {showEmpty && (
        <EmptyState message="No hay productos cargados todavía." action={<Button onClick={() => setShowNew(true)}>Crear el primero</Button>} />
      )}

      {showTable && (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-alt">
                <th className="text-left px-4 py-3 font-medium text-text-secondary">Producto</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary">Categoría</th>
                <th className="text-right px-4 py-3 font-medium text-text-secondary">Precio</th>
                <th className="text-right px-4 py-3 font-medium text-text-secondary">Costo</th>
                <th className="text-right px-4 py-3 font-medium text-text-secondary">Margen</th>
                <th className="text-center px-4 py-3 font-medium text-text-secondary">Estado</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((p) => (
                <tr key={p.id} onClick={() => handleOpenDetalle(p.id)} className="border-b border-border last:border-0 hover:bg-surface-alt cursor-pointer transition-colors">
                  <td className="px-4 py-3 font-medium text-text-primary">{p.nombre}</td>
                  <td className="px-4 py-3 text-text-secondary">{catLabels[p.categoria] ?? p.categoria}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {p.precio_vigente != null ? formatARS(p.precio_vigente) : <Badge color="yellow">Sin precio</Badge>}
                  </td>
                  <td className="px-4 py-3 text-right text-text-secondary">
                    {p.costo_calculado != null ? formatARS(p.costo_calculado) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.margen != null ? (
                      <span className={p.margen >= 50 ? 'text-positive font-medium' : p.margen >= 30 ? 'text-warning font-medium' : 'text-negative font-medium'}>
                        {formatPercent(p.margen)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge color={p.activo ? 'green' : 'gray'}>{p.activo ? 'Activo' : 'Inactivo'}</Badge>
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={(e) => { e.stopPropagation(); setDuplicando(p) }} title="Duplicar producto" className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-alt transition-colors">
                        <Copy className="w-4 h-4" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleToggleActivo(p) }} title={p.activo ? 'Archivar' : 'Reactivar'} className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-alt transition-colors">
                        {p.activo ? <Archive className="w-4 h-4" /> : <ArchiveRestore className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SidePanel open={showNew} onClose={() => setShowNew(false)} title="Nuevo producto">
        <FormProducto onSubmit={handleCrear} pending={pending} isNew />
      </SidePanel>

      <SidePanel open={!!duplicando} onClose={() => setDuplicando(null)} title={`Duplicar "${duplicando?.nombre ?? ''}"`}>
        {duplicando && (
          <form key={duplicando.id} action={handleDuplicar} className="space-y-4">
            <p className="text-sm text-text-secondary">
              Se crea un producto nuevo con la misma receta (ingredientes y cantidades) y el mismo precio de venta de "{duplicando.nombre}". Después podés editar lo que cambie.
            </p>
            <Field label="Nombre del nuevo producto">
              <Input name="nombre" required defaultValue={`${duplicando.nombre} (copia)`} autoFocus />
            </Field>
            <Button type="submit" disabled={pending}>Duplicar producto</Button>
          </form>
        )}
      </SidePanel>

      <SidePanel open={!!selectedId} onClose={() => { setSelectedId(null); setDetalle(null); setCostoCalc(null) }} title={detalle?.producto?.nombre ?? 'Cargando...'}>
        {detalle?.producto && (
          <div className="space-y-8">
            {costoCalc && costoCalc.costo != null && (
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-surface-alt rounded-lg p-3 text-center">
                  <p className="text-xs text-text-muted">Precio</p>
                  <p className="text-base font-semibold">{formatARS(costoCalc.precio)}</p>
                </div>
                <div className="bg-surface-alt rounded-lg p-3 text-center">
                  <p className="text-xs text-text-muted">Costo</p>
                  <p className="text-base font-semibold">{formatARS(costoCalc.costo)}</p>
                </div>
                <div className={`rounded-lg p-3 text-center ${costoCalc.margen >= 50 ? 'bg-positive-bg' : costoCalc.margen >= 30 ? 'bg-warning-bg' : 'bg-negative-bg'}`}>
                  <p className="text-xs text-text-muted">Margen</p>
                  <p className="text-base font-semibold">{formatPercent(costoCalc.margen)}</p>
                </div>
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Datos del producto</h3>
              <FormProducto key={detalle.producto.id} onSubmit={handleActualizar} pending={pending} initial={detalle.producto} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Historial de precios</h3>
              {detalle.precios.length > 0 ? (
                <div className="space-y-1.5 mb-4">
                  {detalle.precios.map((p: PrecioHist, i: number) => (
                    <div key={p.id} className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${i === 0 ? 'bg-brand-light font-medium' : 'bg-surface-alt'}`}>
                      <span>{formatDate(p.fecha_vigencia)}</span><span>{formatARS(p.precio)}</span>
                    </div>
                  ))}
                </div>
              ) : (<p className="text-sm text-text-muted mb-4">Sin precios registrados.</p>)}
              <form action={handleNuevoPrecio} className="flex items-end gap-2">
                <Field label="Nuevo precio"><Input name="precio" type="number" min="0" step="1" required placeholder="0" /></Field>
                <Field label="Desde"><Input name="fecha" type="date" required defaultValue={new Date().toISOString().split('T')[0]} /></Field>
                <Button type="submit" disabled={pending} size="md">Agregar</Button>
              </form>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Receta</h3>
              {costoCalc?.detalle && costoCalc.detalle.length > 0 ? (
                <div className="bg-surface-alt rounded-lg overflow-hidden mb-4">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-border"><th className="text-left px-3 py-2 text-xs text-text-muted">Ingrediente</th><th className="text-right px-3 py-2 text-xs text-text-muted">Cant.</th><th className="text-right px-3 py-2 text-xs text-text-muted">Costo</th><th className="w-8"></th></tr></thead>
                    <tbody>
                      {costoCalc.detalle.map((d) => (
                        <tr key={d.receta_id} className="border-b border-border last:border-0">
                          <td className="px-3 py-2">{d.ingrediente_nombre}</td>
                          <td className="px-3 py-2 text-right text-text-secondary">{d.cantidad} {d.unidad_receta}</td>
                          <td className="px-3 py-2 text-right font-medium">{formatARS(d.costo_parcial)}</td>
                          <td className="px-1 py-2"><button onClick={() => handleEliminarReceta(d.receta_id)} className="p-1 text-text-muted hover:text-negative"><Trash2 className="w-3.5 h-3.5" /></button></td>
                        </tr>
                      ))}
                      <tr className="bg-surface"><td className="px-3 py-2 font-semibold">Total</td><td></td><td className="px-3 py-2 text-right font-semibold">{formatARS(costoCalc.costo)}</td><td></td></tr>
                    </tbody>
                  </table>
                </div>
              ) : (<p className="text-sm text-text-muted mb-4">Sin receta. Agregá ingredientes para calcular costos.</p>)}
              <form action={handleAgregarReceta} className="flex items-end gap-2">
                <Field label="Ingrediente">
                  <Select name="ingrediente_id" required>
                    <option value="">Seleccionar...</option>
                    {ingredientes.filter((i) => i.activo).map((i) => (<option key={i.id} value={i.id}>{i.nombre}</option>))}
                  </Select>
                </Field>
                <Field label="Cantidad"><Input name="cantidad" type="number" min="0.01" step="0.01" required placeholder="0" /></Field>
                <Button type="submit" disabled={pending} size="md">Agregar</Button>
              </form>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Mapeo Pedix</h3>
              {detalle.aliases.length > 0 && (
                <div className="space-y-1.5 mb-4">
                  {detalle.aliases.map((a: Alias) => (
                    <div key={a.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-alt text-sm">
                      <span className="text-text-secondary truncate mr-2">{a.nombre_pedix}</span>
                      <button onClick={() => handleEliminarAlias(a.id)} className="p-1 text-text-muted hover:text-negative shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
              <form action={handleAgregarAlias} className="flex items-end gap-2">
                <Field label="Nombre en Pedix"><Input name="nombre_pedix" required placeholder='Ej: KING + Papas Fritas' /></Field>
                <Button type="submit" disabled={pending} size="md">Agregar</Button>
              </form>
            </div>
          </div>
        )}
      </SidePanel>

      <Toast />
    </div>
  )
})

export default ProductosTab

function FormProducto({ onSubmit, pending, initial, isNew }: {
  onSubmit: (fd: FormData) => void; pending: boolean; initial?: any; isNew?: boolean;
}) {
  const [activo, setActivo] = useState(initial?.activo ?? true)
  return (
    <form action={onSubmit} className="space-y-4">
      <Field label="Nombre"><Input name="nombre" required defaultValue={initial?.nombre} placeholder="Ej: Royal Doble" /></Field>
      <Field label="Categoría">
        <Select name="categoria" defaultValue={initial?.categoria ?? 'hamburguesa'}>
          <option value="hamburguesa">Hamburguesa</option><option value="acompanamiento">Acompañamiento</option><option value="bebida">Bebida</option><option value="combo">Combo</option>
        </Select>
      </Field>
      {isNew && <Field label="Precio de venta"><Input name="precio" type="number" min="0" step="1" placeholder="0" /></Field>}
      {!isNew && (
        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
          <input type="hidden" name="activo" value="false" />
          <input type="checkbox" name="activo" value="true" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="rounded border-border" />
          Activo
        </label>
      )}
      <Button type="submit" disabled={pending}>{isNew ? 'Crear producto' : 'Guardar cambios'}</Button>
    </form>
  )
}
