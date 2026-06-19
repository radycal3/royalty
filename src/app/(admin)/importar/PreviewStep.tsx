'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Package,
  ShoppingCart,
  Calendar,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import { formatARS } from '@/lib/utils/format';
import type { ParseResult } from '@/lib/utils/pedix-parser';
import type { ProductoConReceta } from './actions';

type Props = {
  parseResult: ParseResult;
  mapeos: Record<string, string>;
  productosMap: Map<string, ProductoConReceta>;
  onConfirm: () => void;
  onBack: () => void;
  importing: boolean;
};

export default function PreviewStep({
  parseResult,
  mapeos,
  productosMap,
  onConfirm,
  onBack,
  importing,
}: Props) {
  const [confirmoSinReceta, setConfirmoSinReceta] = useState(false);
  const [detalleAbierto, setDetalleAbierto] = useState(false);

  const analisis = useMemo(() => {
    const totalPedidos = parseResult.pedidos.length;
    const totalLineas = parseResult.pedidos.reduce(
      (sum, p) => sum + p.lineas.length, 0
    );

    const fechas = new Set(parseResult.pedidos.map((p) => p.fecha));
    const fechasOrdenadas = Array.from(fechas).sort();

    const ventaEstimada = parseResult.pedidos.reduce(
      (sum, p) => sum + (p.total || 0), 0
    );

    const productosEnArchivo = new Set<string>();
    for (const p of parseResult.pedidos) {
      for (const l of p.lineas) {
        productosEnArchivo.add(l.productoNombre);
      }
    }

    const productosMapeados: string[] = [];
    const productosNoMapeados: string[] = [];
    const productosSinReceta: string[] = [];

    for (const nombre of productosEnArchivo) {
      const productoId = mapeos[nombre];
      if (!productoId) {
        productosNoMapeados.push(nombre);
      } else {
        productosMapeados.push(nombre);
        const producto = productosMap.get(productoId);
        if (!producto || producto.receta.length === 0) {
          productosSinReceta.push(nombre);
        }
      }
    }

    return {
      totalPedidos,
      totalLineas,
      fechasOrdenadas,
      ventaEstimada,
      productosEnArchivo: Array.from(productosEnArchivo).sort(),
      productosMapeados,
      productosNoMapeados,
      productosSinReceta,
    };
  }, [parseResult, mapeos, productosMap]);

  const tieneSinReceta = analisis.productosSinReceta.length > 0;
  const puedeImportar = !tieneSinReceta || confirmoSinReceta;

  return (
    <div className="space-y-6">
      {/* Resumen general */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-surface-alt rounded-lg p-4 border border-border">
          <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
            <ShoppingCart className="h-4 w-4" />
            Pedidos
          </div>
          <p className="text-2xl font-semibold text-text-primary">
            {analisis.totalPedidos}
          </p>
        </div>
        <div className="bg-surface-alt rounded-lg p-4 border border-border">
          <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
            <Package className="h-4 w-4" />
            Líneas
          </div>
          <p className="text-2xl font-semibold text-text-primary">
            {analisis.totalLineas}
          </p>
        </div>
        <div className="bg-surface-alt rounded-lg p-4 border border-border">
          <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
            <Calendar className="h-4 w-4" />
            Fechas
          </div>
          <p className="text-sm font-medium text-text-primary">
            {analisis.fechasOrdenadas.length === 1
              ? analisis.fechasOrdenadas[0]
              : `${analisis.fechasOrdenadas[0]} — ${analisis.fechasOrdenadas[analisis.fechasOrdenadas.length - 1]}`}
          </p>
        </div>
        <div className="bg-surface-alt rounded-lg p-4 border border-border">
          <div className="flex items-center gap-2 text-text-muted text-sm mb-1">
            Venta estimada
          </div>
          <p className="text-2xl font-semibold text-positive">
            {formatARS(analisis.ventaEstimada)}
          </p>
        </div>
      </div>

      {/* Productos detectados */}
      <div className="bg-surface-alt rounded-lg border border-border">
        <button
          className="w-full flex items-center justify-between p-4 text-left"
          onClick={() => setDetalleAbierto(!detalleAbierto)}
        >
          <span className="text-sm font-medium text-text-secondary">
            {analisis.productosEnArchivo.length} productos detectados en el archivo
          </span>
          {detalleAbierto ? (
            <ChevronUp className="h-4 w-4 text-text-muted" />
          ) : (
            <ChevronDown className="h-4 w-4 text-text-muted" />
          )}
        </button>
        {detalleAbierto && (
          <div className="border-t border-border p-4">
            <div className="space-y-2">
              {analisis.productosEnArchivo.map((nombre) => {
                const mapeado = !!mapeos[nombre];
                const sinReceta = analisis.productosSinReceta.includes(nombre);
                return (
                  <div
                    key={nombre}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-text-secondary">{nombre}</span>
                    <div className="flex items-center gap-2">
                      {mapeado ? (
                        <Badge color="green">Mapeado</Badge>
                      ) : (
                        <Badge color="red">Sin mapeo</Badge>
                      )}
                      {mapeado && sinReceta && (
                        <Badge color="yellow">Sin receta</Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Advertencias del parser */}
      {parseResult.errores.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-warning-bg border border-border">
          <AlertTriangle className="h-5 w-5 text-warning mt-0.5 shrink-0" />
          <div>
            <p className="text-warning text-sm font-medium mb-2">
              Advertencias del parser
            </p>
            <ul className="text-text-secondary text-sm space-y-1">
              {parseResult.errores.map((err, i) => (
                <li key={i}>• {err}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Productos sin receta */}
      {tieneSinReceta && (
        <div className="rounded-lg bg-negative-bg border-2 border-negative p-5 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-negative mt-0.5 shrink-0" />
            <div>
              <p className="text-negative font-semibold text-base">
                {analisis.productosSinReceta.length === 1
                  ? '1 producto no tiene receta cargada'
                  : `${analisis.productosSinReceta.length} productos no tienen receta cargada`}
              </p>
              <p className="text-text-secondary text-sm mt-1">
                Estos productos se importarán con costo $0. Esto afectará el
                cálculo de margen y beneficio. Podés cargar las recetas desde
                la pantalla de Productos antes de importar.
              </p>
            </div>
          </div>

          <div className="bg-surface rounded-md p-3 space-y-1">
            {analisis.productosSinReceta.map((nombre) => (
              <p key={nombre} className="text-text-secondary text-sm">• {nombre}</p>
            ))}
          </div>

          <label className="flex items-start gap-3 cursor-pointer select-none pt-2 border-t border-border">
            <input
              type="checkbox"
              checked={confirmoSinReceta}
              onChange={(e) => setConfirmoSinReceta(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-border"
            />
            <span className="text-text-primary text-sm font-medium">
              Entiendo que estos productos tendrán costo $0 y acepto importar de todas formas
            </span>
          </label>
        </div>
      )}

      {/* Todo OK */}
      {!tieneSinReceta &&
        analisis.productosNoMapeados.length === 0 &&
        parseResult.errores.length === 0 && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-positive-bg border border-border">
            <CheckCircle2 className="h-5 w-5 text-positive shrink-0" />
            <p className="text-text-secondary text-sm">
              Todo listo. Todos los productos están mapeados y tienen receta.
              Los costos se calcularán con la fecha de cada pedido.
            </p>
          </div>
        )}

      {/* Acciones */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack} disabled={importing}>
          Volver
        </Button>
        <Button onClick={onConfirm} disabled={!puedeImportar || importing}>
          {importing ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
              Importando...
            </span>
          ) : (
            `Importar ${analisis.totalPedidos} pedidos`
          )}
        </Button>
      </div>
    </div>
  );
}
