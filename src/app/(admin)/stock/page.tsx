'use client';

import { useState, useEffect, useTransition, useRef } from 'react';
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Package,
  AlertTriangle,
  ClipboardList,
} from 'lucide-react';
import {
  SidePanel,
  Field,
  Input,
  Select,
  Button,
  Badge,
  Tabs,
  EmptyState,
  useToast,
} from '@/components/ui';
import { formatARS, formatDate } from '@/lib/utils/format';
import ConteoForm from '@/components/stock/ConteoForm';
import type { PeriodoInfo } from '../gastos/actions';
import { obtenerPeriodoActual, obtenerPeriodoPorOffset } from '../gastos/actions';
import type { IngredienteStock, CompraIngrediente, AnalisisMerma } from './actions';
import {
  obtenerIngredientesControlados,
  obtenerComprasPeriodo,
  registrarCompra,
  eliminarCompra,
  obtenerAnalisisMerma,
} from './actions';

const SEMAFORO_COLOR: Record<string, 'green' | 'yellow' | 'red' | 'gray'> = {
  verde: 'green',
  amarillo: 'yellow',
  rojo: 'red',
};

export default function StockPage() {
  const [periodo, setPeriodo] = useState<PeriodoInfo | null>(null);
  const [ingredientes, setIngredientes] = useState<IngredienteStock[]>([]);
  const [compras, setCompras] = useState<CompraIngrediente[]>([]);
  const [merma, setMerma] = useState<AnalisisMerma | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState('merma');
  const [showNewCompra, setShowNewCompra] = useState(false);
  const [showConteoInicio, setShowConteoInicio] = useState(false);
  const [showConteoCierre, setShowConteoCierre] = useState(false);
  const [pending, startTransition] = useTransition();
  const { show, Toast } = useToast();
  const requestId = useRef(0);

  useEffect(() => {
    (async () => {
      const [p, ings] = await Promise.all([obtenerPeriodoActual(), obtenerIngredientesControlados()]);
      setPeriodo(p);
      setIngredientes(ings);
      await loadDatos(p.viernes, p.fechaHasta);
    })();
  }, []);

  async function loadDatos(desde: string, hasta: string) {
    const thisRequest = ++requestId.current;
    const [comprasData, mermaData] = await Promise.all([
      obtenerComprasPeriodo(desde, hasta),
      obtenerAnalisisMerma(desde, hasta),
    ]);
    if (thisRequest === requestId.current) {
      setCompras(comprasData);
      setMerma(mermaData);
      setLoaded(true);
    }
  }

  async function handleNav(offset: number) {
    if (!periodo) return;
    const nuevo = await obtenerPeriodoPorOffset(periodo.viernes, offset);
    setPeriodo(nuevo);
    setLoaded(false);
    await loadDatos(nuevo.viernes, nuevo.fechaHasta);
  }

  async function handleCrearCompra(input: Parameters<typeof registrarCompra>[0]) {
    if (!periodo) return;
    startTransition(async () => {
      const r = await registrarCompra(input);
      if (r.error) { show(r.error, 'error'); return; }
      show('Compra registrada');
      setShowNewCompra(false);
      await loadDatos(periodo.viernes, periodo.fechaHasta);
    });
  }

  async function handleEliminarCompra(id: string) {
    if (!periodo) return;
    startTransition(async () => {
      const r = await eliminarCompra(id);
      if (r.error) { show(r.error, 'error'); return; }
      show('Compra eliminada');
      await loadDatos(periodo.viernes, periodo.fechaHasta);
    });
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Stock</h1>
          <p className="text-text-muted text-sm mt-1">
            Compras de ingredientes y análisis de merma por período operativo.
          </p>
        </div>
        {tab === 'compras' && (
          <Button onClick={() => setShowNewCompra(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Nueva compra
          </Button>
        )}
        {tab === 'merma' && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowConteoInicio(true)}>
              <ClipboardList className="w-4 h-4 mr-2" />
              Conteo inicio de semana
            </Button>
            <Button variant="secondary" onClick={() => setShowConteoCierre(true)}>
              <ClipboardList className="w-4 h-4 mr-2" />
              Conteo de cierre
            </Button>
          </div>
        )}
      </div>

      {periodo && (
        <div className="flex items-center justify-center gap-4">
          <button onClick={() => handleNav(-1)} className="p-2 rounded-lg hover:bg-surface-alt text-text-muted hover:text-text-primary transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="text-center">
            <p className="text-text-primary font-semibold">{periodo.label}</p>
            {periodo.esActual && <Badge color="green">Período actual</Badge>}
          </div>
          <button onClick={() => handleNav(1)} className="p-2 rounded-lg hover:bg-surface-alt text-text-muted hover:text-text-primary transition-colors">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}

      <Tabs
        tabs={[{ key: 'merma', label: 'Análisis de merma' }, { key: 'compras', label: 'Compras' }]}
        activeTab={tab}
        onChange={setTab}
      />

      {!loaded ? (
        <div className="text-text-muted text-sm py-8 text-center">Cargando...</div>
      ) : (
        <>
          <div className={tab === 'merma' ? 'block' : 'hidden'}>
            {merma && <TablaMerma merma={merma} />}
          </div>
          <div className={tab === 'compras' ? 'block' : 'hidden'}>
            <TablaCompras compras={compras} onEliminar={handleEliminarCompra} />
          </div>
        </>
      )}

      <SidePanel open={showNewCompra} onClose={() => setShowNewCompra(false)} title="Nueva compra">
        <FormCompra ingredientes={ingredientes} pending={pending} onSubmit={handleCrearCompra} periodo={periodo} />
      </SidePanel>

      <SidePanel open={showConteoInicio} onClose={() => setShowConteoInicio(false)} title="Conteo inicio de semana">
        {periodo && (
          <ConteoForm
            ingredientes={ingredientes}
            fecha={periodo.viernes}
            tipo="inicio_semana"
            titulo={`Stock al abrir — ${periodo.label}`}
            onGuardado={() => loadDatos(periodo.viernes, periodo.fechaHasta)}
          />
        )}
      </SidePanel>

      <SidePanel open={showConteoCierre} onClose={() => setShowConteoCierre(false)} title="Conteo de cierre">
        {periodo && <ConteoCierreAdmin periodo={periodo} ingredientes={ingredientes} onGuardado={() => loadDatos(periodo.viernes, periodo.fechaHasta)} />}
      </SidePanel>

      <Toast />
    </div>
  );
}

// ─── Tabla de merma ─────────────────────────────────────────────────────────

function TablaMerma({ merma }: { merma: AnalisisMerma }) {
  if (!merma.ingredientes.length) {
    return (
      <EmptyState
        icon={<Package className="w-10 h-10" />}
        title="Sin ingredientes controlados"
        description="Marcá 'Controla Stock' en Productos → Ingredientes para los ingredientes que querés monitorear."
      />
    );
  }

  return (
    <div className="space-y-3">
      {merma.ingredientesIncompletos.length > 0 && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-warning-bg text-warning text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Faltan conteos para calcular la merma de: {merma.ingredientesIncompletos.join(', ')}.
            Necesitás el conteo de inicio de semana y el cierre del domingo.
          </span>
        </div>
      )}

      <div className="bg-surface-alt rounded-lg border border-border overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 font-medium text-text-secondary">Ingrediente</th>
              <th className="text-right px-4 py-3 font-medium text-text-secondary">Teórico (ventas)</th>
              <th className="text-right px-4 py-3 font-medium text-text-secondary">Consumo interno</th>
              <th className="text-right px-4 py-3 font-medium text-text-secondary">Consumo real</th>
              <th className="text-right px-4 py-3 font-medium text-text-secondary">Merma</th>
              <th className="text-right px-4 py-3 font-medium text-text-secondary">Merma %</th>
              <th className="text-right px-4 py-3 font-medium text-text-secondary">Merma $</th>
              <th className="text-center px-4 py-3 font-medium text-text-secondary"></th>
            </tr>
          </thead>
          <tbody>
            {merma.ingredientes.map((i) => (
              <tr key={i.ingredienteId} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-text-primary font-medium">
                  {i.nombre}
                  {i.stockInicioFuente === 'fallback_semana_anterior' && (
                    <span className="block text-xs text-text-muted font-normal">
                      stock inicial = cierre de la semana anterior
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-text-secondary">
                  {i.consumoTeoricoVentas.toFixed(1)} {i.unidadReceta}
                </td>
                <td className="px-4 py-3 text-right text-text-secondary">
                  {i.consumoInternoRegistrado.toFixed(1)} {i.unidadReceta}
                </td>
                <td className="px-4 py-3 text-right text-text-secondary">
                  {i.datosCompletos ? `${i.consumoReal!.toFixed(1)} ${i.unidadReceta}` : '—'}
                </td>
                <td className="px-4 py-3 text-right text-text-secondary">
                  {i.datosCompletos ? `${i.merma! > 0 ? '+' : ''}${i.merma!.toFixed(1)} ${i.unidadReceta}` : '—'}
                </td>
                <td className="px-4 py-3 text-right text-text-secondary">
                  {i.mermaPct != null ? `${i.mermaPct > 0 ? '+' : ''}${i.mermaPct.toFixed(1)}%` : '—'}
                </td>
                <td className="px-4 py-3 text-right text-text-primary font-medium">
                  {i.mermaPesos != null ? formatARS(i.mermaPesos) : '—'}
                </td>
                <td className="px-4 py-3 text-center">
                  {i.semaforo && <Badge color={SEMAFORO_COLOR[i.semaforo]}>{i.semaforo}</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
          {merma.mermaPesosTotal !== 0 && (
            <tfoot>
              <tr className="border-t border-border bg-surface">
                <td colSpan={6} className="px-4 py-3 text-right font-medium text-text-secondary">Total merma</td>
                <td className="px-4 py-3 text-right font-semibold text-negative">{formatARS(merma.mermaPesosTotal)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ─── Tabla de compras ───────────────────────────────────────────────────────

function TablaCompras({
  compras,
  onEliminar,
}: {
  compras: CompraIngrediente[];
  onEliminar: (id: string) => void;
}) {
  if (!compras.length) {
    return (
      <EmptyState
        icon={<Package className="w-10 h-10" />}
        title="Sin compras en este período"
        description="Registrá las compras de ingredientes para calcular el consumo real."
      />
    );
  }

  const totalCosto = compras.reduce((s, c) => s + c.costoTotal, 0);

  return (
    <div className="bg-surface-alt rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-4 py-3 font-medium text-text-secondary">Fecha</th>
            <th className="text-left px-4 py-3 font-medium text-text-secondary">Ingrediente</th>
            <th className="text-right px-4 py-3 font-medium text-text-secondary">Cantidad</th>
            <th className="text-left px-4 py-3 font-medium text-text-secondary">Proveedor</th>
            <th className="text-right px-4 py-3 font-medium text-text-secondary">Costo</th>
            <th className="w-10"></th>
          </tr>
        </thead>
        <tbody>
          {compras.map((c) => (
            <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface transition-colors">
              <td className="px-4 py-3 text-text-secondary">{formatDate(c.fecha)}</td>
              <td className="px-4 py-3 text-text-primary font-medium">{c.ingredienteNombre}</td>
              <td className="px-4 py-3 text-right text-text-secondary">{c.cantidad} {c.unidad}</td>
              <td className="px-4 py-3 text-text-muted">{c.proveedor || '—'}</td>
              <td className="px-4 py-3 text-right text-text-primary font-medium">{formatARS(c.costoTotal)}</td>
              <td className="px-2 py-3">
                <button onClick={() => onEliminar(c.id)} title="Eliminar" className="p-1.5 rounded-lg text-text-muted hover:text-negative transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-surface">
            <td colSpan={4} className="px-4 py-3 text-right font-medium text-text-secondary">Total</td>
            <td className="px-4 py-3 text-right font-semibold text-text-primary">{formatARS(totalCosto)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Formulario de compra ───────────────────────────────────────────────────

function FormCompra({
  ingredientes,
  pending,
  onSubmit,
  periodo,
}: {
  ingredientes: IngredienteStock[];
  pending: boolean;
  onSubmit: (input: {
    fecha: string;
    ingredienteId: string;
    cantidad: number;
    unidad: string;
    costoTotal: number;
    proveedor: string | null;
    nota: string | null;
  }) => void;
  periodo: PeriodoInfo | null;
}) {
  const [ingredienteId, setIngredienteId] = useState(ingredientes[0]?.id ?? '');
  const [fecha, setFecha] = useState(periodo?.viernes ?? '');

  const ingredienteSeleccionado = ingredientes.find((i) => i.id === ingredienteId);

  function handleSubmit(fd: FormData) {
    onSubmit({
      fecha: fd.get('fecha') as string,
      ingredienteId: fd.get('ingredienteId') as string,
      cantidad: parseFloat(fd.get('cantidad') as string),
      unidad: ingredienteSeleccionado?.unidadCompra ?? '',
      costoTotal: parseFloat(fd.get('costoTotal') as string),
      proveedor: (fd.get('proveedor') as string)?.trim() || null,
      nota: (fd.get('nota') as string)?.trim() || null,
    });
  }

  if (!ingredientes.length) {
    return (
      <p className="text-sm text-text-muted">
        No hay ingredientes marcados para control de stock. Activá &quot;Controla Stock&quot; en Productos → Ingredientes.
      </p>
    );
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <Field label="Fecha">
        <Input name="fecha" type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </Field>

      <Field label="Ingrediente">
        <Select name="ingredienteId" value={ingredienteId} onChange={(e) => setIngredienteId(e.target.value)}>
          {ingredientes.map((i) => (
            <option key={i.id} value={i.id}>{i.nombre}</option>
          ))}
        </Select>
      </Field>

      <Field label={`Cantidad (${ingredienteSeleccionado?.unidadCompra ?? ''})`}>
        <Input name="cantidad" type="number" min="0.01" step="0.01" required placeholder="0" />
      </Field>

      <Field label="Costo total">
        <Input name="costoTotal" type="number" min="0" step="1" required placeholder="0" />
      </Field>

      <Field label="Proveedor (opcional)">
        <Input name="proveedor" placeholder="Ej: Distribuidora del Sur" />
      </Field>

      <Field label="Nota (opcional)">
        <Input name="nota" placeholder="Ej: Pedido de urgencia" />
      </Field>

      <Button type="submit" disabled={pending}>Registrar compra</Button>
    </form>
  );
}

// ─── Conteo de cierre (admin) ───────────────────────────────────────────────
// El conteo de empleados (/panel/stock) siempre es "esta noche". Acá el
// admin puede elegir cuál de las 3 noches del período está cerrando —
// útil si todavía no hay cuentas de empleado cargando el cierre solas.

function ConteoCierreAdmin({
  periodo,
  ingredientes,
  onGuardado,
}: {
  periodo: PeriodoInfo;
  ingredientes: IngredienteStock[];
  onGuardado: () => void;
}) {
  const domingo = periodo.fechaHasta;
  const viernes = periodo.viernes;
  const sabado = (() => {
    const d = new Date(viernes + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  })();

  const [fecha, setFecha] = useState(domingo);

  const opciones = [
    { value: viernes, label: `Viernes ${formatDate(viernes)}` },
    { value: sabado, label: `Sábado ${formatDate(sabado)}` },
    { value: domingo, label: `Domingo ${formatDate(domingo)}` },
  ];

  return (
    <div className="space-y-4">
      <Field label="Noche que estás cerrando" hint="El cálculo de merma usa el cierre del domingo como stock final de la semana.">
        <Select value={fecha} onChange={(e) => setFecha(e.target.value)}>
          {opciones.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </Field>
      <ConteoForm
        key={fecha}
        ingredientes={ingredientes}
        fecha={fecha}
        tipo="fin_noche"
        titulo="Stock al cerrar"
        onGuardado={onGuardado}
      />
    </div>
  );
}
