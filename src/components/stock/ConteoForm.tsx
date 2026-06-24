'use client';

import { useState, useEffect, useTransition } from 'react';
import { Button, useToast } from '@/components/ui';
import type { IngredienteStock, TipoConteo } from '@/app/(admin)/stock/actions';
import { obtenerConteo, registrarConteo } from '@/app/(admin)/stock/actions';

export default function ConteoForm({
  ingredientes,
  fecha,
  tipo,
  titulo,
  onGuardado,
}: {
  ingredientes: IngredienteStock[];
  fecha: string;
  tipo: TipoConteo;
  titulo: string;
  onGuardado?: () => void;
}) {
  const [valores, setValores] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();
  const { show, Toast } = useToast();

  useEffect(() => {
    setLoaded(false);
    obtenerConteo(fecha, tipo).then((existentes) => {
      const iniciales: Record<string, string> = {};
      for (const ing of ingredientes) {
        iniciales[ing.id] = existentes[ing.id] != null ? String(existentes[ing.id]) : '';
      }
      setValores(iniciales);
      setLoaded(true);
    });
  }, [fecha, tipo, ingredientes]);

  function handleGuardar() {
    const filas = ingredientes
      .filter((ing) => valores[ing.id] !== '' && valores[ing.id] !== undefined)
      .map((ing) => ({
        ingredienteId: ing.id,
        cantidad: parseFloat(valores[ing.id]),
        unidad: ing.conteoEnUnidadReceta ? ing.unidadReceta : ing.unidadCompra,
      }));

    if (!filas.length) {
      show('Ingresá al menos una cantidad', 'error');
      return;
    }

    startTransition(async () => {
      const r = await registrarConteo(fecha, tipo, filas);
      if (r.error) { show(r.error, 'error'); return; }
      show('Conteo guardado correctamente');
      onGuardado?.();
    });
  }

  if (!loaded) {
    return <div className="text-text-muted text-sm py-6 text-center">Cargando ingredientes...</div>;
  }

  if (!ingredientes.length) {
    return (
      <p className="text-sm text-text-muted py-4">
        No hay ingredientes marcados para control de stock. Activá &quot;Controla Stock&quot; en Productos → Ingredientes.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-text-primary">{titulo}</h3>
      <div className="space-y-3">
        {ingredientes.map((ing) => (
          <div key={ing.id} className="flex items-center justify-between gap-3">
            <label htmlFor={`conteo-${ing.id}`} className="text-sm text-text-secondary">
              {ing.nombre}
            </label>
            <div className="flex items-center gap-2">
              <input
                id={`conteo-${ing.id}`}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={valores[ing.id] ?? ''}
                onChange={(e) => setValores((v) => ({ ...v, [ing.id]: e.target.value }))}
                placeholder="0"
                className="w-24 px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-right
                           placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
              <span className="text-xs text-text-muted w-16">{ing.conteoEnUnidadReceta ? ing.unidadReceta : ing.unidadCompra}</span>
            </div>
          </div>
        ))}
      </div>
      <Button onClick={handleGuardar} disabled={pending} className="w-full">
        {pending ? 'Guardando...' : 'Guardar conteo'}
      </Button>
      <Toast />
    </div>
  );
}
