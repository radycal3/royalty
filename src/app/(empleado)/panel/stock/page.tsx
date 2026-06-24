'use client';

import { useState, useEffect } from 'react';
import { CheckCircle2 } from 'lucide-react';
import ConteoForm from '@/components/stock/ConteoForm';
import { obtenerIngredientesControlados } from '@/app/(admin)/stock/actions';
import type { IngredienteStock } from '@/app/(admin)/stock/actions';
import { obtenerFechaHoy } from '../actions';

export default function StockEmpleadoPage() {
  const [ingredientes, setIngredientes] = useState<IngredienteStock[]>([]);
  const [fecha, setFecha] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  useEffect(() => {
    (async () => {
      const [ings, hoy] = await Promise.all([obtenerIngredientesControlados(), obtenerFechaHoy()]);
      setIngredientes(ings);
      setFecha(hoy);
    })();
  }, []);

  if (!fecha) {
    return <div className="text-text-muted text-sm py-12 text-center">Cargando...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-text-primary">Conteo de stock</h1>
        <p className="text-sm text-text-muted">¿Cuánto quedó al cerrar esta noche?</p>
      </div>

      <div className="bg-surface rounded-xl border border-border p-5">
        <ConteoForm
          ingredientes={ingredientes}
          fecha={fecha}
          tipo="fin_noche"
          titulo="Stock al cerrar"
          onGuardado={() => setGuardado(true)}
        />
      </div>

      {guardado && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-positive-bg text-positive text-sm font-medium">
          <CheckCircle2 className="w-4 h-4" />
          Guardado correctamente
        </div>
      )}
    </div>
  );
}
