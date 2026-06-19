'use client';

import { useState, useEffect, useTransition, useRef, useCallback } from 'react';
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Trash2,
  UtensilsCrossed,
  AlertTriangle,
  X,
} from 'lucide-react';
import {
  SidePanel,
  Field,
  Input,
  Select,
  Button,
  Badge,
  EmptyState,
  useToast,
} from '@/components/ui';
import { formatARS, formatDate } from '@/lib/utils/format';
import type { ConsumoLinea, ConsumoResumen, ProductoParaConsumo, PeriodoInfo } from './actions';
import {
  obtenerProductosParaConsumo,
  obtenerConsumosPeriodo,
  registrarConsumo,
  eliminarConsumo,
} from './actions';
import {
  obtenerPeriodoActual,
  obtenerPeriodoPorOffset,
  obtenerPeriodoDeFecha,
} from '../gastos/actions';

// ─── Page ──────────────────────────────────────────────────────────────────

export default function ConsumoInternoPage() {
  const [periodo, setPeriodo] = useState<PeriodoInfo | null>(null);
  const [resumen, setResumen] = useState<ConsumoResumen | null>(null);
  const [productos, setProductos] = useState<ProductoParaConsumo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pending, startTransition] = useTransition();
  const { show, Toast } = useToast();
  const requestId = useRef(0);

  useEffect(() => {
    (async () => {
      const [p, prods] = await Promise.all([
        obtenerPeriodoActual(),
        obtenerProductosParaConsumo(),
      ]);
      setPeriodo(p);
      setProductos(prods);
      await loadConsumos(p.viernes);
    })();
  }, []);

  async function loadConsumos(viernes: string) {
    const thisRequest = ++requestId.current;
    const data = await obtenerConsumosPeriodo(viernes);
    if (thisRequest === requestId.current) {
      setResumen(data);
      setLoaded(true);
    }
  }

  async function handleNav(offset: number) {
    if (!periodo) return;
    const nuevo = await obtenerPeriodoPorOffset(periodo.viernes, offset);
    setPeriodo(nuevo);
    setLoaded(false);
    await loadConsumos(nuevo.viernes);
  }

  async function handleRegistrar(fecha: string, nota: string | null, lineas: ConsumoLinea[]) {
    startTransition(async () => {
      try {
        const result = await registrarConsumo({ fecha, nota, lineas });
        show(`Consumo registrado — Costo: ${formatARS(result.costo_total)}`);
        setShowNew(false);

        const periodoDelConsumo = await obtenerPeriodoDeFecha(fecha);
        setPeriodo(periodoDelConsumo);
        await loadConsumos(periodoDelConsumo.viernes);
      } catch (err: any) {
        show(err.message || 'Error al registrar consumo', 'error');
      }
    });
  }

  async function handleEliminar(id: string) {
    if (!periodo) return;
    startTransition(async () => {
      const r = await eliminarConsumo(id);
      if (r.error) { show(r.error, 'error'); return; }
      show('Consumo eliminado');
      await loadConsumos(periodo.viernes);
    });
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Consumo interno</h1>
          <p className="text-text-muted text-sm mt-1">
            Registrá la comida consumida por el equipo. Impacta costos, no ventas.
          </p>
        </div>
        <Button onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Nuevo consumo
        </Button>
      </div>

      {/* Selector de período */}
      {periodo && (
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => handleNav(-1)}
            className="p-2 rounded-lg hover:bg-surface-alt text-text-muted hover:text-text-primary transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="text-center">
            <p className="text-text-primary font-semibold">{periodo.label}</p>
            {periodo.esActual && <Badge color="green">Período actual</Badge>}
          </div>
          <button
            onClick={() => handleNav(1)}
            className="p-2 rounded-lg hover:bg-surface-alt text-text-muted hover:text-text-primary transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Resumen */}
      {resumen && loaded && resumen.consumos.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-surface-alt rounded-lg p-4 border border-border">
            <p className="text-text-muted text-sm mb-1">Consumos</p>
            <p className="text-xl font-semibold text-text-primary">
              {resumen.consumos.length}
            </p>
          </div>
          <div className="bg-surface-alt rounded-lg p-4 border border-border">
            <p className="text-text-muted text-sm mb-1">Unidades</p>
            <p className="text-xl font-semibold text-text-primary">
              {resumen.unidadesTotales}
            </p>
          </div>
          <div className="bg-surface-alt rounded-lg p-4 border border-border">
            <p className="text-text-muted text-sm mb-1">Costo total</p>
            <p className="text-xl font-semibold text-negative">
              {formatARS(resumen.costoTotalPeriodo)}
            </p>
          </div>
        </div>
      )}

      {/* Lista de consumos */}
      {!loaded ? (
        <div className="text-text-muted text-sm py-8 text-center">Cargando consumos...</div>
      ) : resumen && resumen.consumos.length === 0 ? (
        <EmptyState
          icon={<UtensilsCrossed className="w-10 h-10" />}
          title="Sin consumo interno en este período"
          description="Registrá la comida del equipo para incluirla en los costos del período."
        />
      ) : resumen && (
        <div className="space-y-3">
          {resumen.consumos.map((c) => (
            <div
              key={c.id}
              className="bg-surface-alt rounded-lg border border-border p-4"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">
                      {formatDate(c.fecha)}
                    </span>
                    <Badge color="gray">
                      {c.lineas.length} {c.lineas.length === 1 ? 'producto' : 'productos'}
                    </Badge>
                  </div>
                  {c.nota && (
                    <p className="text-text-muted text-sm mt-1">{c.nota}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-negative">
                    {formatARS(c.costo_total)}
                  </span>
                  <button
                    onClick={() => handleEliminar(c.id)}
                    title="Eliminar consumo"
                    className="p-1.5 rounded-lg text-text-muted hover:text-negative transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                {c.lineas.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center justify-between text-sm px-3 py-1.5 rounded bg-surface"
                  >
                    <span className="text-text-secondary">
                      {l.cantidad}× {l.producto_nombre}
                    </span>
                    <span className="text-text-muted">
                      {formatARS(l.costo_unitario_calculado * l.cantidad)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SidePanel: Nuevo consumo */}
      <SidePanel
        open={showNew}
        onClose={() => setShowNew(false)}
        title="Nuevo consumo interno"
      >
        <FormConsumo
          productos={productos}
          onSubmit={handleRegistrar}
          pending={pending}
        />
      </SidePanel>

      <Toast />
    </div>
  );
}

// ─── Formulario de consumo ─────────────────────────────────────────────────

function FormConsumo({
  productos,
  onSubmit,
  pending,
}: {
  productos: ProductoParaConsumo[];
  onSubmit: (fecha: string, nota: string | null, lineas: ConsumoLinea[]) => void;
  pending: boolean;
}) {
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [nota, setNota] = useState('');
  const [lineas, setLineas] = useState<{ productoId: string; cantidad: number }[]>([
    { productoId: '', cantidad: 1 },
  ]);
  const [periodoLabel, setPeriodoLabel] = useState<string | null>(null);

  useEffect(() => {
    if (fecha) {
      obtenerPeriodoDeFecha(fecha).then((p) => setPeriodoLabel(p.label));
    }
  }, [fecha]);

  function addLinea() {
    setLineas([...lineas, { productoId: '', cantidad: 1 }]);
  }

  function removeLinea(index: number) {
    if (lineas.length <= 1) return;
    setLineas(lineas.filter((_, i) => i !== index));
  }

  function updateLinea(index: number, field: 'productoId' | 'cantidad', value: string | number) {
    setLineas(lineas.map((l, i) =>
      i === index ? { ...l, [field]: value } : l
    ));
  }

  const lineasValidas = lineas.filter((l) => l.productoId && l.cantidad > 0);
  const productosSinReceta = lineasValidas.filter((l) => {
    const prod = productos.find((p) => p.id === l.productoId);
    return prod && !prod.tieneReceta;
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (lineasValidas.length === 0) return;
    onSubmit(
      fecha,
      nota.trim() || null,
      lineasValidas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad }))
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Fecha">
        <Input
          type="date"
          required
          value={fecha}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFecha(e.target.value)}
        />
      </Field>

      {periodoLabel && (
        <div className="px-3 py-2 rounded-lg bg-brand-light text-sm text-text-secondary">
          Se asigna al período: <span className="font-medium text-text-primary">{periodoLabel}</span>
        </div>
      )}

      <Field label="Nota (opcional)">
        <Input
          value={nota}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNota(e.target.value)}
          placeholder="Ej: Cena equipo sábado"
        />
      </Field>

      {/* Líneas de productos */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-text-primary">Productos</label>
          <button
            type="button"
            onClick={addLinea}
            className="text-xs text-text-muted hover:text-text-primary transition-colors flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Agregar línea
          </button>
        </div>

        <div className="space-y-2">
          {lineas.map((linea, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={linea.productoId}
                onChange={(e) => updateLinea(i, 'productoId', e.target.value)}
                className="flex-1 bg-surface border border-border rounded-md px-3 py-2
                           text-sm text-text-primary focus:outline-none focus:ring-1
                           focus:ring-brand focus:border-brand"
              >
                <option value="">Seleccionar...</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}{!p.tieneReceta ? ' ⚠ sin receta' : ''}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                value={linea.cantidad}
                onChange={(e) => updateLinea(i, 'cantidad', parseInt(e.target.value) || 1)}
                className="w-20 bg-surface border border-border rounded-md px-3 py-2
                           text-sm text-text-primary text-center focus:outline-none
                           focus:ring-1 focus:ring-brand"
              />
              {lineas.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLinea(i)}
                  className="p-1.5 text-text-muted hover:text-negative transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Advertencia productos sin receta */}
      {productosSinReceta.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-warning-bg border border-border">
          <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
          <p className="text-text-secondary text-sm">
            {productosSinReceta.length === 1
              ? '1 producto no tiene receta — su costo quedará en $0.'
              : `${productosSinReceta.length} productos no tienen receta — su costo quedará en $0.`}
          </p>
        </div>
      )}

      <Button type="submit" disabled={pending || lineasValidas.length === 0}>
        {pending ? 'Registrando...' : `Registrar consumo (${lineasValidas.length} ${lineasValidas.length === 1 ? 'producto' : 'productos'})`}
      </Button>
    </form>
  );
}
