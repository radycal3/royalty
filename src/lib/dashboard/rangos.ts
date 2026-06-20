// ─── Helpers de rangos de fecha del Dashboard ───────────────────────────────
// Módulo puro (sin 'use server'): cálculos de fechas síncronos, sin acceso a
// datos. Vive fuera de actions.ts para que Next.js no los interprete como
// Server Actions (que exigen ser async).

// ─── Types ───────────────────────────────────────────────────────────────

export type TipoRango = 'semana' | 'mes' | 'trimestre' | 'año' | 'personalizado';

export type Rango = {
  desde: string;   // YYYY-MM-DD
  hasta: string;   // YYYY-MM-DD
  tipo: TipoRango;
  label: string;
  esActual: boolean;
};

// ─── Helpers de fecha ──────────────────────────────────────────────────────

function fmt(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toDate(s: string): Date {
  return new Date(s + 'T12:00:00');
}

function periodoDeJS(fecha: Date): Date {
  const day = fecha.getDay();
  const isodow = day === 0 ? 7 : day;
  const offset = ((isodow - 5 + 7) % 7);
  const v = new Date(fecha);
  v.setDate(fecha.getDate() - offset);
  return v;
}

function ultimoDiaMes(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MESES_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ─── Construcción de rangos ────────────────────────────────────────────────

export function buildRangoSemana(referencia?: Date): Rango {
  const ref = referencia || new Date();
  const viernes = periodoDeJS(ref);
  const domingo = new Date(viernes);
  domingo.setDate(viernes.getDate() + 2);

  const hoy = new Date();
  const viernesHoy = periodoDeJS(hoy);

  const vD = viernes.getDate();
  const dD = domingo.getDate();
  const mesV = MESES[viernes.getMonth()];
  const mesD = MESES[domingo.getMonth()];
  const y = viernes.getFullYear();

  const label = mesV === mesD
    ? `Vie ${vD} — Dom ${dD} ${mesV} ${y}`
    : `Vie ${vD} ${mesV} — Dom ${dD} ${mesD} ${y}`;

  return {
    desde: fmt(viernes),
    hasta: fmt(domingo),
    tipo: 'semana',
    label,
    esActual: fmt(viernes) === fmt(viernesHoy),
  };
}

export function buildRangoMes(year: number, month: number): Rango {
  const hoy = new Date();
  const desde = new Date(year, month, 1);
  const hasta = new Date(year, month, ultimoDiaMes(year, month));

  return {
    desde: fmt(desde),
    hasta: fmt(hasta),
    tipo: 'mes',
    label: `${MESES_FULL[month]} ${year}`,
    esActual: hoy.getFullYear() === year && hoy.getMonth() === month,
  };
}

export function buildRangoTrimestre(year: number, quarter: number): Rango {
  const hoy = new Date();
  const mesInicio = quarter * 3;
  const mesFin = mesInicio + 2;
  const desde = new Date(year, mesInicio, 1);
  const hasta = new Date(year, mesFin, ultimoDiaMes(year, mesFin));

  const qActual = Math.floor(hoy.getMonth() / 3);

  return {
    desde: fmt(desde),
    hasta: fmt(hasta),
    tipo: 'trimestre',
    label: `Q${quarter + 1} ${year}`,
    esActual: hoy.getFullYear() === year && qActual === quarter,
  };
}

export function buildRangoAño(year: number): Rango {
  const hoy = new Date();
  return {
    desde: `${year}-01-01`,
    hasta: `${year}-12-31`,
    tipo: 'año',
    label: `${year}`,
    esActual: hoy.getFullYear() === year,
  };
}

export function buildRangoPersonalizado(desde: string, hasta: string): Rango {
  const d = toDate(desde);
  const h = toDate(hasta);
  const dD = d.getDate();
  const hD = h.getDate();
  const mesD = MESES[d.getMonth()];
  const mesH = MESES[h.getMonth()];
  const yD = d.getFullYear();
  const yH = h.getFullYear();

  let label: string;
  if (yD !== yH) label = `${dD} ${mesD} ${yD} — ${hD} ${mesH} ${yH}`;
  else if (mesD !== mesH) label = `${dD} ${mesD} — ${hD} ${mesH} ${yD}`;
  else label = `${dD} — ${hD} ${mesD} ${yD}`;

  return { desde, hasta, tipo: 'personalizado', label, esActual: false };
}

// Atajos rápidos
export function buildAtajo(tipo: 'ultimos7' | 'ultimos30' | 'ultimos90' | 'añoActual'): Rango {
  const hoy = new Date();
  switch (tipo) {
    case 'ultimos7': {
      const desde = new Date(hoy);
      desde.setDate(hoy.getDate() - 6);
      return { desde: fmt(desde), hasta: fmt(hoy), tipo: 'personalizado', label: 'Últimos 7 días', esActual: true };
    }
    case 'ultimos30': {
      const desde = new Date(hoy);
      desde.setDate(hoy.getDate() - 29);
      return { desde: fmt(desde), hasta: fmt(hoy), tipo: 'personalizado', label: 'Últimos 30 días', esActual: true };
    }
    case 'ultimos90': {
      const desde = new Date(hoy);
      desde.setDate(hoy.getDate() - 89);
      return { desde: fmt(desde), hasta: fmt(hoy), tipo: 'personalizado', label: 'Últimos 90 días', esActual: true };
    }
    case 'añoActual': {
      return { desde: `${hoy.getFullYear()}-01-01`, hasta: fmt(hoy), tipo: 'personalizado', label: `Año ${hoy.getFullYear()}`, esActual: true };
    }
  }
}

// ─── Navegación de rangos ──────────────────────────────────────────────────

export function navegarRango(rango: Rango, offset: number): Rango {
  const desde = toDate(rango.desde);

  switch (rango.tipo) {
    case 'semana': {
      const ref = new Date(desde);
      ref.setDate(ref.getDate() + offset * 7);
      return buildRangoSemana(ref);
    }
    case 'mes': {
      const ref = new Date(desde);
      ref.setMonth(ref.getMonth() + offset);
      return buildRangoMes(ref.getFullYear(), ref.getMonth());
    }
    case 'trimestre': {
      const ref = new Date(desde);
      ref.setMonth(ref.getMonth() + offset * 3);
      const newQ = Math.floor(ref.getMonth() / 3);
      return buildRangoTrimestre(ref.getFullYear(), newQ);
    }
    case 'año': {
      return buildRangoAño(desde.getFullYear() + offset);
    }
    case 'personalizado': {
      // Desplazar por la duración del rango
      const hasta = toDate(rango.hasta);
      const dias = Math.round((hasta.getTime() - desde.getTime()) / 86400000) + 1;
      const newDesde = new Date(desde);
      newDesde.setDate(newDesde.getDate() + offset * dias);
      const newHasta = new Date(newDesde);
      newHasta.setDate(newHasta.getDate() + dias - 1);
      return buildRangoPersonalizado(fmt(newDesde), fmt(newHasta));
    }
  }
}

// ─── Rango anterior (para delta) ───────────────────────────────────────────

export function rangoAnterior(rango: Rango): Rango {
  return navegarRango(rango, -1);
}
