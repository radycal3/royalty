'use client'

import { useState, useEffect, useTransition } from 'react'
import { Plus, Search, Trash2 } from 'lucide-react'
import { SidePanel, Field, Input, Select, Button, Badge, EmptyState, useToast } from '@/components/ui'
import { formatARS, formatPercent, formatDate } from '@/lib/utils/format'
import {
  getProductos,
  getProductoCompleto,
  crearProducto,
  actualizarProducto,
  agregarPrecio,
  agregarItemReceta,
  actualizarItemReceta,
  eliminarItemReceta,
  agregarAlias,
  eliminarAlias,
  calcularCostoProducto,
} from './actions-productos'
import { getIngredientes } from './actions-ingredientes'

type Producto = { id: string; nombre: string; categoria: string; activo: boolean }
type Ingrediente = { id: string; nombre: string; unidad_receta: string; factor_conversion: number; activo: boolean }
type RecetaItem = {
  id: string; ingrediente_id: string; cantidad: number;
  ingredientes: Ingrediente
}
type PrecioHist = { id: string; precio: number; fecha_vigencia: string }
type Alias = { id: string; nombre_pedix: string }
type CostoDetalle = {
  receta_id: string; ingrediente_nombre: string; unidad_receta: string;
  cantidad: number; costo_por_unidad_receta: number; costo_parcial: number
}
type CostoCalc = {
  costo: number | null; precio: number; margen: number;
  beneficio: number; detalle: CostoDetalle[]
}

export default function ProductosTab() {
  const [productos, setProductos] = useState<Producto[]>([])
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([])
  const [filtro, setFiltro] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<{
    producto: Producto; precios: PrecioHist[];
    receta: RecetaItem[]; aliases: Alias[]
  } | null>(null)
  const [costoCalc, setCostoCalc] = useState<CostoCalc | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [pending, startTransition] = useTransition()
  const { show, Toast } = useToast()

  useEffect(() => { loadProductos(); loadIngredientes() }, [])

  useEffect(() => {
    if (selectedId) loadDetalle(selectedId)
  }, [selectedId])

  async function loadProductos() { setProductos(await getProductos()) }
  async function loadIngredientes() { setIngredientes(await getIngredientes()) }

  async function loadDetalle(id: string) {
    const d = await getProductoCompleto(id)
    setDetalle(d as any)
    const c = await calcularCostoProducto(id)
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
      await loadProductos()
      await loadDetalle(selectedId)
    })
  }

  async function handleNuevoPrecio(fd: FormData) {
    if (!selectedId) return
    startTransition(async () => {
      const r = await agregarPrecio(selectedId, fd)
      if (r.error) { show(r.error, 'error'); return }
      show('Precio actualizado')
      await loadDetalle(selectedId)
    })
  }

  async function handleAgregarReceta(fd: FormData) {
    if (!selectedId) return
    startTransition(async () => {
      const r = await agregarItemReceta(selectedId, fd)
      if (r.error) { show(r.error, 'error'); return }
      show('Ingrediente agregado a la receta')
      await loadDetalle(selectedId)
    })
  }

  async function handleEliminarReceta(recetaId: string) {
    startTransition(async () => {
      const r = await eliminarItemReceta(recetaId)
      if (r.error) { show(r.error, 'error'); return }
      show('Ingrediente eliminado de la receta')
      if (selectedId) await loadDetalle(selectedId)
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
    startTransition(async () => {
      const r = await eliminarAlias(aliasId)
      if (r.error) { show(r.error, 'error'); return }
      show('Alias eliminado')
      if (selectedId) await loadDetalle(selectedId)
    })
  }

  const filtrados = productos.filter((p) =>
    p.nombre.toLowerCase().includes(filtro.toLowerCase())
  )

  const precioActual = detalle?.precios?.[0]?.precio ?? null

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input placeholder="Buscar producto..." value={filtro} onChange={(e) => setFiltro(e.target.value)} className="pl-9 !w-64" />
        </div>
        <Button onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4" /> Nuevo producto
        </Button>
      </div>

      {/* Table */}
      {filtrados.length === 0 ? (
        <EmptyState message="No hay productos cargados todavía." action={<Button onClick={() => setShowNew(true)}>Crear el primero</Button>} />
      ) : (
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
              </tr>
            </thead>
            <tbody>
              {filtrados.map((p) => (
                <ProductoRow key={p.id} producto={p} onClick={() => setSelectedId(p.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Panel crear */}
      <SidePanel open={showNew} onClose={() => setShowNew(false)} title="Nuevo producto">
        <FormProducto onSubmit={handleCrear} pending={pending} isNew />
      </SidePanel>

      {/* Panel detalle */}
      <SidePanel
        open={!!selectedId}
        onClose={() => { setSelectedId(null); setDetalle(null); setCostoCalc(null) }}
        title={detalle?.producto?.nombre ?? 'Cargando...'}
      >
        {detalle?.producto && (
          <div className="space-y-8">
            {/* Resumen económico */}
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

            {/* Editar producto */}
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Datos del producto</h3>
              <FormProducto onSubmit={handleActualizar} pending={pending} initial={detalle.producto} />
            </div>

            {/* Precios */}
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Historial de precios</h3>
              {detalle.precios.length > 0 ? (
                <div className="space-y-1.5 mb-4">
                  {detalle.precios.map((p, i) => (
                    <div key={p.id} className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${i === 0 ? 'bg-brand-light font-medium' : 'bg-surface-alt'}`}>
                      <span>{formatDate(p.fecha_vigencia)}</span>
                      <span>{formatARS(p.precio)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-muted mb-4">Sin precios registrados.</p>
              )}
              <form action={handleNuevoPrecio} className="flex items-end gap-2">
                <Field label="Nuevo precio">
                  <Input name="precio" type="number" min="0" step="1" required placeholder="0" />
                </Field>
                <Field label="Desde">
                  <Input name="fecha" type="date" required defaultValue={new Date().toISOString().split('T')[0]} />
                </Field>
                <Button type="submit" disabled={pending} size="md">Agregar</Button>
              </form>
            </div>

            {/* Receta */}
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Receta</h3>
              {costoCalc?.detalle && costoCalc.detalle.length > 0 ? (
                <div className="bg-surface-alt rounded-lg overflow-hidden mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-3 py-2 text-xs text-text-muted">Ingrediente</th>
                        <th className="text-right px-3 py-2 text-xs text-text-muted">Cant.</th>
                        <th className="text-right px-3 py-2 text-xs text-text-muted">Costo</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {costoCalc.detalle.map((d) => (
                        <tr key={d.receta_id} className="border-b border-border last:border-0">
                          <td className="px-3 py-2">{d.ingrediente_nombre}</td>
                          <td className="px-3 py-2 text-right text-text-secondary">{d.cantidad} {d.unidad_receta}</td>
                          <td className="px-3 py-2 text-right font-medium">{formatARS(d.costo_parcial)}</td>
                          <td className="px-1 py-2">
                            <button onClick={() => handleEliminarReceta(d.receta_id)} className="p-1 text-text-muted hover:text-negative">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-surface">
                        <td className="px-3 py-2 font-semibold">Total</td>
                        <td></td>
                        <td className="px-3 py-2 text-right font-semibold">{formatARS(costoCalc.costo)}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-text-muted mb-4">Sin receta. Agregá ingredientes para calcular costos.</p>
              )}

              <form action={handleAgregarReceta} className="flex items-end gap-2">
                <Field label="Ingrediente">
                  <Select name="ingrediente_id" required>
                    <option value="">Seleccionar...</option>
                    {ingredientes.filter(i => i.activo).map((i) => (
                      <option key={i.id} value={i.id}>{i.nombre}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Cantidad">
                  <Input name="cantidad" type="number" min="0.01" step="0.01" required placeholder="0" />
                </Field>
                <Button type="submit" disabled={pending} size="md">Agregar</Button>
              </form>
            </div>

            {/* Mapeo Pedix */}
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-3">Mapeo Pedix</h3>
              {detalle.aliases.length > 0 && (
                <div className="space-y-1.5 mb-4">
                  {detalle.aliases.map((a) => (
                    <div key={a.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-alt text-sm">
                      <span className="text-text-secondary truncate mr-2">{a.nombre_pedix}</span>
                      <button onClick={() => handleEliminarAlias(a.id)} className="p-1 text-text-muted hover:text-negative shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <form action={handleAgregarAlias} className="flex items-end gap-2">
                <Field label="Nombre en Pedix">
                  <Input name="nombre_pedix" required placeholder='Ej: KING + Papas Fritas' />
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

// ─── Row con cálculo ───

function ProductoRow({ producto, onClick }: { producto: Producto; onClick: () => void }) {
  const [calc, setCalc] = useState<CostoCalc | null>(null)

  useEffect(() => {
    import('./actions-productos').then(({ calcularCostoProducto }) =>
      calcularCostoProducto(producto.id).then((c) => setCalc(c as any))
    )
  }, [producto.id])

  const catLabels: Record<string, string> = {
    hamburguesa: 'Hamburguesa',
    acompanamiento: 'Acompañamiento',
    bebida: 'Bebida',
    combo: 'Combo',
  }

  return (
    <tr onClick={onClick} className="border-b border-border last:border-0 hover:bg-surface-alt cursor-pointer transition-colors">
      <td className="px-4 py-3 font-medium text-text-primary">{producto.nombre}</td>
      <td className="px-4 py-3 text-text-secondary">{catLabels[producto.categoria] ?? producto.categoria}</td>
      <td className="px-4 py-3 text-right font-medium">
        {calc?.precio ? formatARS(calc.precio) : <Badge color="yellow">Sin precio</Badge>}
      </td>
      <td className="px-4 py-3 text-right text-text-secondary">
        {calc?.costo != null ? formatARS(calc.costo) : '—'}
      </td>
      <td className="px-4 py-3 text-right">
        {calc?.costo != null && calc.precio > 0 ? (
          <span className={calc.margen >= 50 ? 'text-positive font-medium' : calc.margen >= 30 ? 'text-warning font-medium' : 'text-negative font-medium'}>
            {formatPercent(calc.margen)}
          </span>
        ) : '—'}
      </td>
      <td className="px-4 py-3 text-center">
        <Badge color={producto.activo ? 'green' : 'gray'}>
          {producto.activo ? 'Activo' : 'Inactivo'}
        </Badge>
      </td>
    </tr>
  )
}

// ─── Form ───

function FormProducto({
  onSubmit,
  pending,
  initial,
  isNew,
}: {
  onSubmit: (fd: FormData) => void
  pending: boolean
  initial?: Producto
  isNew?: boolean
}) {
  return (
    <form action={onSubmit} className="space-y-4">
      <Field label="Nombre">
        <Input name="nombre" required defaultValue={initial?.nombre} placeholder="Ej: Royal Doble" />
      </Field>
      <Field label="Categoría">
        <Select name="categoria" defaultValue={initial?.categoria ?? 'hamburguesa'}>
          <option value="hamburguesa">Hamburguesa</option>
          <option value="acompanamiento">Acompañamiento</option>
          <option value="bebida">Bebida</option>
          <option value="combo">Combo</option>
        </Select>
      </Field>
      {isNew && (
        <Field label="Precio de venta">
          <Input name="precio" type="number" min="0" step="1" placeholder="0" />
        </Field>
      )}
      {!isNew && (
        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
          <input type="hidden" name="activo" value="false" />
          <input type="checkbox" name="activo" value="true" defaultChecked={initial?.activo ?? true} className="rounded border-border" />
          Activo
        </label>
      )}
      <Button type="submit" disabled={pending}>
        {isNew ? 'Crear producto' : 'Guardar cambios'}
      </Button>
    </form>
  )
}
