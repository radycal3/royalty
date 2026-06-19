'use client';

import {
  CheckCircle2,
  ShoppingCart,
  Package,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  SkipForward,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { formatARS, formatPercent } from '@/lib/utils/format';
import type { ResultadoImportacion } from './actions';

type Props = {
  resultado: ResultadoImportacion;
  onNuevaImportacion: () => void;
};

export default function ResultStep({ resultado, onNuevaImportacion }: Props) {
  const margen =
    resultado.venta_total > 0
      ? ((resultado.venta_total - resultado.costo_total) /
          resultado.venta_total) *
        100
      : 0;

  const margenColor =
    margen >= 50
      ? 'text-positive'
      : margen >= 30
        ? 'text-warning'
        : 'text-negative';

  return (
    <div className="space-y-6">
      {/* Encabezado de éxito */}
      <div className="flex items-center gap-3 p-5 rounded-lg bg-positive-bg border border-border">
        <CheckCircle2 className="h-8 w-8 text-positive shrink-0" />
        <div>
          <p className="text-text-primary font-semibold text-lg">
            Importación completada
          </p>
          <p className="text-text-secondary text-sm mt-0.5">
            Los datos quedaron congelados con los costos vigentes a la fecha de cada pedido.
          </p>
        </div>
      </div>

      {/* Métricas principales */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-surface-alt rounded-lg p-4 border border-border">
          <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
            <ShoppingCart className="h-4 w-4" />
            Pedidos creados
          </div>
          <p className="text-2xl font-semibold text-text-primary">
            {resultado.pedidos_creados}
          </p>
        </div>

        <div className="bg-surface-alt rounded-lg p-4 border border-border">
          <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
            <Package className="h-4 w-4" />
            Líneas
          </div>
          <p className="text-2xl font-semibold text-text-primary">
            {resultado.lineas_creadas}
          </p>
        </div>

        <div className="bg-surface-alt rounded-lg p-4 border border-border">
          <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
            <DollarSign className="h-4 w-4" />
            Venta total
          </div>
          <p className="text-2xl font-semibold text-positive">
            {formatARS(resultado.venta_total)}
          </p>
        </div>

        <div className="bg-surface-alt rounded-lg p-4 border border-border">
          <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
            <TrendingUp className="h-4 w-4" />
            Margen
          </div>
          <p className={`text-2xl font-semibold ${margenColor}`}>
            {formatPercent(margen)}
          </p>
        </div>
      </div>

      {/* Detalle de costos */}
      <div className="bg-surface-alt rounded-lg p-4 border border-border">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">Venta total</span>
            <span className="text-text-primary font-medium">
              {formatARS(resultado.venta_total)}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">Costo total (ingredientes)</span>
            <span className="text-text-primary font-medium">
              {formatARS(resultado.costo_total)}
            </span>
          </div>
          <div className="border-t border-border pt-3 flex items-center justify-between text-sm">
            <span className="text-text-primary font-medium">
              Beneficio bruto (sin gastos)
            </span>
            <span className="text-positive font-semibold">
              {formatARS(resultado.venta_total - resultado.costo_total)}
            </span>
          </div>
        </div>
      </div>

      {/* Pedidos omitidos */}
      {resultado.pedidos_omitidos > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-warning-bg border border-border">
          <SkipForward className="h-5 w-5 text-warning mt-0.5 shrink-0" />
          <div>
            <p className="text-text-primary text-sm font-medium">
              {resultado.pedidos_omitidos}{' '}
              {resultado.pedidos_omitidos === 1
                ? 'pedido omitido'
                : 'pedidos omitidos'}{' '}
              por duplicación
            </p>
            <p className="text-text-secondary text-sm mt-0.5">
              Estos pedidos ya estaban registrados de una importación anterior.
            </p>
          </div>
        </div>
      )}

      {/* Productos sin receta */}
      {resultado.productos_sin_receta.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-negative-bg border border-border">
          <AlertTriangle className="h-5 w-5 text-negative mt-0.5 shrink-0" />
          <div>
            <p className="text-text-primary text-sm font-medium">
              Productos importados con costo $0 (sin receta)
            </p>
            <div className="mt-2 space-y-1">
              {resultado.productos_sin_receta.map((nombre) => (
                <p key={nombre} className="text-text-secondary text-sm">• {nombre}</p>
              ))}
            </div>
            <p className="text-text-muted text-sm mt-2">
              Podés cargar las recetas en Productos y reimportar para recalcular.
            </p>
          </div>
        </div>
      )}

      {/* Acción */}
      <div className="flex justify-end pt-2">
        <Button onClick={onNuevaImportacion}>
          <RotateCcw className="h-4 w-4 mr-2" />
          Nueva importación
        </Button>
      </div>
    </div>
  );
}
