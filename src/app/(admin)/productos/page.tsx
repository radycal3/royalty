'use client'

import { useState, useRef } from 'react'
import { Tabs } from '@/components/ui'
import IngredientesTab from './IngredientesTab'
import ProductosTab, { type ProductosTabHandle } from './ProductosTab'

export default function ProductosPage() {
  const [tab, setTab] = useState('ingredientes')
  const productosRef = useRef<ProductosTabHandle>(null)

  // Cuando cambia un costo de ingrediente, ProductosTab debe recargarse
  function handleIngredienteCostChange() {
    productosRef.current?.reload()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Productos e Ingredientes</h1>
        <Tabs
          tabs={[
            { key: 'ingredientes', label: 'Ingredientes' },
            { key: 'productos', label: 'Productos' },
          ]}
          activeTab={tab}
          onChange={setTab}
        />
      </div>

      <div className={tab !== 'ingredientes' ? 'hidden' : ''}>
        <IngredientesTab onCostChange={handleIngredienteCostChange} />
      </div>
      <div className={tab !== 'productos' ? 'hidden' : ''}>
        <ProductosTab ref={productosRef} />
      </div>
    </div>
  )
}
