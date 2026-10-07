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

export function periodoDeJS(fecha: Date): Date {
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

// ─── Rango OPERATIVO ───────────────────────────────────────────────────────
// Una "semana operativa" va de viernes a jueves (7 días): se vende Vie-Sáb-Dom
// pero los COSTOS pueden caer cualquier día (ej. un sueldo pagado el lunes).
// Para que ningún gasto se pierda y para que un mes sea exactamente la SUMA de
// sus semanas, los rangos de mes/trimestre/año se arman como el span de las
// semanas operativas cuyo VIERNES cae dentro del período calendario — el mismo
// criterio que usa el Informe mensual (periodo_de / decomponerMesEnSemanas).
function primerViernesEnRango(desde: Date): Date {
  const d = new Date(desde);
  const add = ((5 - d.getDay()) + 7) % 7; // getDay 5 = viernes
  d.setDate(d.getDate() + add);
  return d;
}
function ultimoViernesEnRango(hasta: Date): Date {
  const d = new Date(hasta);
  const sub = ((d.getDay() - 5) + 7) % 7;
  d.setDate(d.getDate() - sub);
  return d;
}
function rangoOperativo(calDesde: Date, calHasta: Date): { desde: string; hasta: string } {
  const primerVie = primerViernesEnRango(calDesde);
  const ultimoVie = ultimoViernesEnRango(calHasta);
  const finJueves = new Date(ultimoVie);
  finJueves.setDate(ultimoVie.getDate() + 6); // jueves de la última semana
  return { desde: fmt(primerVie), hasta: fmt(finJueves) };
}

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MESES_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ─── Construcción de rangos ────────────────────────────────────────────────

export function buildRangoSemana(referencia?: Date): Rango {
  const ref = referencia || new Date();
  const viernes = periodoDeJS(ref);
  const domingo = new Date(viernes);
  domingo.setDate(viernes.getDate() + 2);  // solo para el label (días de venta)
  const jueves = new Date(viernes);
  jueves.setDate(viernes.getDate() + 6);   // fin de la semana operativa (7 días)

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
    // hasta = jueves (no domingo): captura los gastos de Lun-Jue que pertenecen
    // a esta semana operativa. Las ventas solo ocurren Vie-Dom, así que esto NO
    // cambia ventas/pedidos; solo suma los costos de media semana que antes se
    // perdían. El label y el botón "Cerrar semana" siguen basados en el domingo.
    hasta: fmt(jueves),
    tipo: 'semana',
    label,
    esActual: fmt(viernes) === fmt(viernesHoy),
  };
}

export function buildRangoMes(year: number, month: number): Rango {
  const hoy = new Date();
  // Operativo: semanas cuyo viernes cae en el mes calendario. Así el mes es la
  // suma exacta de sus semanas y coincide con el "Informe para IA".
  const { desde, hasta } = rangoOperativo(
    new Date(year, month, 1),
    new Date(year, month, ultimoDiaMes(year, month))
  );

  return {
    desde,
    hasta,
    tipo: 'mes',
    label: `${MESES_FULL[month]} ${year}`,
    esActual: hoy.getFullYear() === year && hoy.getMonth() === month,
  };
}

export function buildRangoTrimestre(year: number, quarter: number): Rango {
  const hoy = new Date();
  const mesInicio = quarter * 3;
  const mesFin = mesInicio + 2;
  const { desde, hasta } = rangoOperativo(
    new Date(year, mesInicio, 1),
    new Date(year, mesFin, ultimoDiaMes(year, mesFin))
  );

  const qActual = Math.floor(hoy.getMonth() / 3);

  return {
    desde,
    hasta,
    tipo: 'trimestre',
    label: `Q${quarter + 1} ${year}`,
    esActual: hoy.getFullYear() === year && qActual === quarter,
  };
}

export function buildRangoAño(year: number): Rango {
  const hoy = new Date();
  const { desde, hasta } = rangoOperativo(
    new Date(year, 0, 1),
    new Date(year, 11, 31)
  );
  return {
    desde,
    hasta,
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
