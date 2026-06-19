'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, Link2, CheckCircle2 } from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import { guardarMapeo } from './actions';

type Props = {
  productosSinMapeo: string[];
  productosDisponibles: { id: string; nombre: string }[];
  mapeos: Record<string, string>;
  onMapeoChange: (nombre: string, productoId: string) => void;
  onComplete: () => void;
  onBack: () => void;
};

export default function MappingStep({
  productosSinMapeo,
  productosDisponibles,
  mapeos,
  onMapeoChange,
  onComplete,
  onBack,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [guardando, setGuardando] = useState<Record<string, boolean>>({});
  const [guardados, setGuardados] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selecciones, setSelecciones] = useState<Record<string, string>>({});

  const todosResueltos = productosSinMapeo.every(
    (nombre) => guardados.has(nombre) || !!mapeos[nombre]
  );

  async function handleGuardar(nombrePedix: string) {
    const productoId = selecciones[nombrePedix];
    if (!productoId) return;

    setGuardando((prev) => ({ ...prev, [nombrePedix]: true }));
    setErrorMsg(null);

    try {
      startTransition(async () => {
        await guardarMapeo(nombrePedix, productoId);
        onMapeoChange(nombrePedix, productoId);
        setGuardados((prev) => new Set(prev).add(nombrePedix));
        setGuardando((prev) => ({ ...prev, [nombrePedix]: false }));
      });
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al guardar mapeo');
      setGuardando((prev) => ({ ...prev, [nombrePedix]: false }));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 p-4 rounded-lg bg-warning-bg border border-border">
        <AlertTriangle className="h-5 w-5 text-warning mt-0.5 shrink-0" />
        <div>
          <p className="text-text-primary text-sm font-medium">
            {productosSinMapeo.length === 1
              ? '1 producto del archivo no tiene mapeo'
              : `${productosSinMapeo.length} productos del archivo no tienen mapeo`}
          </p>
          <p className="text-text-secondary text-sm mt-1">
            Asigná cada nombre de Pedix al producto interno correspondiente. El
            mapeo se guarda y no vas a tener que hacerlo de nuevo en futuras
            importaciones.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {productosSinMapeo.map((nombre) => {
          const yaResuelto = guardados.has(nombre) || !!mapeos[nombre];

          return (
            <div
              key={nombre}
              className={`rounded-lg border p-4 ${
                yaResuelto
                  ? 'bg-positive-bg border-border'
                  : 'bg-surface-alt border-border'
              }`}
            >
              <div className="flex items-center gap-2 mb-3">
                <Link2 className="h-4 w-4 text-text-muted" />
                <span className="text-sm font-medium text-text-primary">
                  {nombre}
                </span>
                {yaResuelto && (
                  <Badge color="green">Guardado</Badge>
                )}
              </div>

              {!yaResuelto && (
                <div className="flex items-center gap-3">
                  <select
                    className="flex-1 bg-surface border border-border rounded-md px-3 py-2
                               text-sm text-text-primary focus:outline-none focus:ring-1
                               focus:ring-brand focus:border-brand"
                    value={selecciones[nombre] || ''}
                    onChange={(e) =>
                      setSelecciones((prev) => ({
                        ...prev,
                        [nombre]: e.target.value,
                      }))
                    }
                  >
                    <option value="">Seleccionar producto...</option>
                    {productosDisponibles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    onClick={() => handleGuardar(nombre)}
                    disabled={!selecciones[nombre] || guardando[nombre] || isPending}
                  >
                    {guardando[nombre] ? 'Guardando...' : 'Guardar'}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-negative-bg border border-border">
          <p className="text-negative text-sm">{errorMsg}</p>
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack}>
          Volver
        </Button>
        <Button onClick={onComplete} disabled={!todosResueltos}>
          {todosResueltos
            ? 'Continuar a previsualización'
            : `Faltan ${productosSinMapeo.filter((n) => !guardados.has(n) && !mapeos[n]).length} mapeos`}
        </Button>
      </div>
    </div>
  );
}
