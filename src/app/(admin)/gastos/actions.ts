'use server';

import { createClient } from '@/lib/supabase/server';

// ─── Types ─────────────────────────────────────────────────────────────────

export type Categoria =
  | 'publicidad'
  | 'cadeteria'
  | 'packaging'
  | 'sueldos'
  | 'servicios'
  | 'impuestos'
  | 'otros';

export type TipoGasto = 'variable' | 'fijo';

export type GastoOperativo = {
  id: string;
  fecha: string;
  categoria: Categoria;
  tipo: TipoGasto;
  monto: number;
  nota: string | null;
  created_at: string;
};

export type ResumenGastos = {
  gastos: GastoOperativo[];
  totalVariable: number;
  totalFijo: number;
  totalGeneral: number;
  porCategoria: { categoria: Categoria; tipo: TipoGasto; total: number; count: number }[];
};

export type PeriodoInfo = {
  viernes: string;        // YYYY-MM-DD del viernes
  fechaDesde: string;     // viernes
  fechaHasta: string;     // domingo
  label: string;          // "Vie 12 — Dom 14 Jun 2026"
  esActual: boolean;
};

// ─── Helpers de período ────────────────────────────────────────────────────
// Replica periodo_de() de la migración en JS para cálculos client-friendly.

function periodoDeJS(fecha: Date): Date {
  // ISODOW: 1=Lun...7=Dom. getDay(): 0=Dom...6=Sáb
  // Convertir getDay a ISODOW
  const day = fecha.getDay();
  const isodow = day === 0 ? 7 : day; // Dom=7
  const offset = ((isodow - 5 + 7) % 7);
  const viernes = new Date(fecha);
  viernes.setDate(fecha.getDate() - offset);
  return viernes;
}

function formatFechaLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// "Hoy" en hora de Argentina. CRÍTICO: estas funciones corren server-side
// ('use server'); el servidor de Vercel está en UTC, así que `new Date()` con
// getDay()/getDate() daría el día UTC. Entre ~21:00 y 00:00 ART el server ya
// cree que es el día siguiente → calcularía mal el período "actual" (ej. un
// jueves de noche lo tomaría como viernes). Se arma la fecha ARG explícita.
function hoyArgentina(): Date {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()); // "YYYY-MM-DD" en ARG
  return new Date(s + 'T12:00:00'); // mediodía: evita bordes de huso
}

const MESES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

function buildPeriodoInfo(viernesStr: string): PeriodoInfo {
  const viernes = new Date(viernesStr + 'T12:00:00');
  const domingo = new Date(viernes);
  domingo.setDate(viernes.getDate() + 2);

  const hoy = hoyArgentina();
  const periodoHoy = periodoDeJS(hoy);
  const esActual = formatFechaLocal(periodoHoy) === viernesStr;

  const vD = viernes.getDate();
  const dD = domingo.getDate();
  const mes = MESES[viernes.getMonth()];
  const mesD = MESES[domingo.getMonth()];
  const year = viernes.getFullYear();

  const label = mes === mesD
    ? `Vie ${vD} — Dom ${dD} ${mes} ${year}`
    : `Vie ${vD} ${mes} — Dom ${dD} ${mesD} ${year}`;

  return {
    viernes: viernesStr,
    fechaDesde: viernesStr,
    fechaHasta: formatFechaLocal(domingo),
    label,
    esActual,
  };
}

// ─── Obtener período actual ────────────────────────────────────────────────

export async function obtenerPeriodoActual(): Promise<PeriodoInfo> {
  const hoy = hoyArgentina();
  const viernes = periodoDeJS(hoy);
  return buildPeriodoInfo(formatFechaLocal(viernes));
}

// ─── Obtener período por offset (navegar ← →) ─────────────────────────────

export async function obtenerPeriodoPorOffset(
  viernesActual: string,
  offset: number // -1 = anterior, +1 = siguiente
): Promise<PeriodoInfo> {
  const fecha = new Date(viernesActual + 'T12:00:00');
  fecha.setDate(fecha.getDate() + offset * 7);
  return buildPeriodoInfo(formatFechaLocal(fecha));
}

// ─── Obtener período de una fecha específica ───────────────────────────────

export async function obtenerPeriodoDeFecha(fecha: string): Promise<PeriodoInfo> {
  const d = new Date(fecha + 'T12:00:00');
  const viernes = periodoDeJS(d);
  return buildPeriodoInfo(formatFechaLocal(viernes));
}

// ─── Listar gastos de un período ───────────────────────────────────────────

export async function obtenerGastosPeriodo(
  viernesPeriodo: string
): Promise<ResumenGastos> {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  // Rango de la semana OPERATIVA: viernes a jueves (7 días). Se extiende más
  // allá del domingo de venta para incluir los gastos cargados Lun-Jue, que
  // pertenecen a esta semana (periodo_de) pero antes quedaban invisibles.
  const viernes = new Date(viernesPeriodo + 'T12:00:00');
  const finSemana = new Date(viernes);
  finSemana.setDate(viernes.getDate() + 6);

  const { data, error } = await supabase
    .from('gastos_operativos')
    .select('*')
    .gte('fecha', viernesPeriodo)
    .lte('fecha', formatFechaLocal(finSemana))
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Error al obtener gastos: ${error.message}`);

  const gastos = (data || []) as GastoOperativo[];

  // Calcular totales
  let totalVariable = 0;
  let totalFijo = 0;
  for (const g of gastos) {
    if (g.tipo === 'variable') totalVariable += g.monto;
    else totalFijo += g.monto;
  }

  // Agrupar por categoría + tipo
  const porCatMap = new Map<string, { categoria: Categoria; tipo: TipoGasto; total: number; count: number }>();
  for (const g of gastos) {
    const key = g.categoria;
    const existing = porCatMap.get(key);
    if (existing) {
      existing.total += g.monto;
      existing.count++;
    } else {
      porCatMap.set(key, {
        categoria: g.categoria,
        tipo: g.tipo,
        total: g.monto,
        count: 1,
      });
    }
  }

  return {
    gastos,
    totalVariable,
    totalFijo,
    totalGeneral: totalVariable + totalFijo,
    porCategoria: Array.from(porCatMap.values()).sort((a, b) => b.total - a.total),
  };
}

// ─── Crear gasto ───────────────────────────────────────────────────────────

export async function crearGasto(formData: FormData) {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const fecha = formData.get('fecha') as string;
  const categoria = formData.get('categoria') as Categoria;
  const tipo = formData.get('tipo') as TipoGasto;
  const monto = Number(formData.get('monto'));
  const nota = (formData.get('nota') as string)?.trim() || null;

  if (!fecha || !categoria || !tipo || !monto || monto <= 0) {
    return { error: 'Todos los campos son obligatorios y el monto debe ser mayor a 0' };
  }

  const { error } = await supabase.from('gastos_operativos').insert({
    fecha,
    categoria,
    tipo,
    monto,
    nota,
    registrado_por: user.user.id,
  });

  if (error) return { error: error.message };
  return { success: true };
}

// ─── Actualizar gasto ──────────────────────────────────────────────────────

export async function actualizarGasto(id: string, formData: FormData) {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const fecha = formData.get('fecha') as string;
  const categoria = formData.get('categoria') as Categoria;
  const tipo = formData.get('tipo') as TipoGasto;
  const monto = Number(formData.get('monto'));
  const nota = (formData.get('nota') as string)?.trim() || null;

  if (!fecha || !categoria || !tipo || !monto || monto <= 0) {
    return { error: 'Todos los campos son obligatorios y el monto debe ser mayor a 0' };
  }

  const { error } = await supabase
    .from('gastos_operativos')
    .update({ fecha, categoria, tipo, monto, nota })
    .eq('id', id);

  if (error) return { error: error.message };
  return { success: true };
}

// ─── Eliminar gasto ────────────────────────────────────────────────────────

export async function eliminarGasto(id: string) {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { error } = await supabase
    .from('gastos_operativos')
    .delete()
    .eq('id', id);

  if (error) return { error: error.message };
  return { success: true };
}
