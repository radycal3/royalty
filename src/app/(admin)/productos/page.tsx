'use client'

import { useState } from 'react'
import { Tabs } from '@/components/ui'
import IngredientesTab from './IngredientesTab'
import ProductosTab from './ProductosTab'

export default function ProductosPage() {
  const [tab, setTab] = useState('ingredientes')

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

      {/* Ambos montados siempre. hidden evita re-mount y re-fetch al cambiar tab */}
      <div className={tab !== 'ingredientes' ? 'hidden' : ''}>
        <IngredientesTab />
      </div>
      <div className={tab !== 'productos' ? 'hidden' : ''}>
        <ProductosTab />
      </div>
    </div>
  )
}
