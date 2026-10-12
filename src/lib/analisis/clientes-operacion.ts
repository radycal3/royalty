// Bloques de la "película" que miran al CLIENTE y a la OPERACIÓN, no al P&L:
// adquisición y recompra (cohortes), horario de pedidos, delivery/cadetería y
// entrega/pago/cupones. Todo determinístico a partir de `pedidos` (una lectura
// liviana de todo el histórico, sin líneas), `gastos_operativos` y
// `cadetes_jornadas`. La IA solo interpreta estos números.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AdquisicionSemana,
  CohorteSemana,
  CuponResumen,
  DeliveryDia,
  DeliveryResumen,
  DeliverySemana,
  EntregaPago,
  EntregaPagoSemana,
  HorarioFranja,
  HorarioResumen,
  Recompra,
} from './tipos';
import { periodoDeJS } from '@/lib/dashboard/rangos';

const r0 = (n: number) => Math.round(n || 0);
const r1 = (n: number) => Math.round((n || 0) * 10) / 10;
const pct = (a: number, b: number) => (b > 0 ? r1((a / b) * 100) : 0);
const fmtD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const aFecha = (s: string) => new Date(s + 'T12:00:00');
const semanaDe = (fecha: string) => fmtD(periodoDeJS(aFecha(fecha)));
const sumarDias = (fecha: string, n: number) => { const d = aFecha(fecha); d.setDate(d.getDate() + n); return fmtD(d); };
const diasEntre = (a: string, b: string) => Math.round((aFecha(b).getTime() - aFecha(a).getTime()) / 86400000);
const NOMBRE_DIA: Record<number, 'Viernes' | 'Sábado' | 'Domingo' | undefined> = { 5: 'Viernes', 6: 'Sábado', 0: 'Domingo' };

// Ventana de los bloques de clientes/operación: termina en el último domingo con
// datos importados (semana completa) — o en `hastaRef` si es posterior — y abarca
// `semanas` semanas operativas hacia atrás.
export function ventanaClientes(pedidos: PedidoLiviano[], hastaRef: string, semanas: number, extenderHastaDatos: boolean) {
  let hasta = hastaRef;
  if (extenderHastaDatos && pedidos.length) {
    const ultima = pedidos.reduce((m, p) => (p.fecha > m ? p.fecha : m), '0000-01-01');
    const d = aFecha(ultima);
    d.setDate(d.getDate() - d.getDay()); // domingo de esa fecha o anterior
    const ultimoDomingo = fmtD(d);
    if (ultimoDomingo > hasta) hasta = ultimoDomingo;
  }
  const desde = sumarDias(semanaDe(hasta), -7 * (semanas - 1));
  return { desde, hasta };
}

export type PedidoLiviano = {
  fecha: string;
  hora: string | null;
  cliente_id: string | null;
  envio_cobrado: number | null;
  tipo_entrega?: string | null;
  medio_pago?: string | null;
  cupon?: string | null;
  descuento?: number | null;
};

// Todo el histórico de pedidos de importaciones activas, sin líneas. Las
// columnas de la migración 041 se piden aparte: si la migración todavía no se
// aplicó, el select falla y se sigue con las columnas base (sin romper).
export async function cargarPedidosLivianos(admin: SupabaseClient, activas: Set<string>): Promise<PedidoLiviano[]> {
  const base = 'fecha, hora, cliente_id, importacion_id, envio_cobrado';
  const extendido = base + ', tipo_entrega, medio_pago, cupon, descuento';
  const leer = async (cols: string) => {
    let all: any[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await admin.from('pedidos').select(cols).order('id').range(from, from + 999);
      if (error) return { error };
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < 1000) break;
      from += 1000;
    }
    return { data: all };
  };
  let res = await leer(extendido);
  if ('error' in res) res = await leer(base);
  if ('error' in res) throw new Error('No se pudieron leer los pedidos: ' + res.error?.message);
  return (res.data || []).filter((p: any) => activas.has(p.importacion_id));
}

// Primera fecha de compra por cliente (misma definición que usa el motor:
// repetidor = cliente con una compra en un día anterior).
export function primerPedidoDe(pedidos: PedidoLiviano[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of pedidos) {
    if (!p.cliente_id) continue;
    const prev = m.get(p.cliente_id);
    if (prev === undefined || p.fecha < prev) m.set(p.cliente_id, p.fecha);
  }
  return m;
}

// Gasto de publicidad por semana operativa (Vie→Jue), de gastos_operativos.
export async function publicidadPorSemana(admin: SupabaseClient, desde: string, hasta: string): Promise<Map<string, number>> {
  const { data } = await admin
    .from('gastos_operativos')
    .select('fecha, monto')
    .eq('categoria', 'publicidad')
    .gte('fecha', desde)
    .lte('fecha', hasta);
  const m = new Map<string, number>();
  for (const g of data || []) {
    const s = semanaDe((g as any).fecha);
    m.set(s, (m.get(s) || 0) + (Number((g as any).monto) || 0));
  }
  return m;
}

// ─── Adquisición y recompra ─────────────────────────────────────────────────

export function construirRecompra(
  pedidos: PedidoLiviano[],
  desdeVentana: string,
  hastaRef: string,
  publi: Map<string, number>
): Recompra | undefined {
  const conCliente = pedidos.filter((p) => p.cliente_id);
  if (conCliente.length === 0) return undefined;

  // Fechas DISTINTAS de compra por cliente (dos pedidos el mismo día = una visita).
  const fechasPorCliente = new Map<string, string[]>();
  const pedidosPorCliente = new Map<string, number>();
  let datosDesde = '9999-12-31', datosHasta = '0000-01-01';
  for (const p of conCliente) {
    const id = p.cliente_id!;
    const arr = fechasPorCliente.get(id) || [];
    if (!arr.includes(p.fecha)) arr.push(p.fecha);
    fechasPorCliente.set(id, arr);
    pedidosPorCliente.set(id, (pedidosPorCliente.get(id) || 0) + 1);
    if (p.fecha < datosDesde) datosDesde = p.fecha;
    if (p.fecha > datosHasta) datosHasta = p.fecha;
  }
  for (const arr of fechasPorCliente.values()) arr.sort();

  const clientesUnicos = fechasPorCliente.size;
  const unaVez = [...pedidosPorCliente.values()].filter((n) => n === 1).length;
  const buckets: [string, (n: number) => boolean][] = [
    ['1', (n) => n === 1], ['2', (n) => n === 2], ['3', (n) => n === 3], ['4-5', (n) => n >= 4 && n <= 5], ['6+', (n) => n >= 6],
  ];
  const distribucionCompras = buckets.map(([compras, f]) => ({ compras, clientes: [...pedidosPorCliente.values()].filter(f).length }));

  // De la 1ra a la 2da visita.
  const gaps: number[] = [];
  for (const arr of fechasPorCliente.values()) if (arr.length >= 2) gaps.push(diasEntre(arr[0], arr[1]));
  gaps.sort((a, b) => a - b);
  const medianaDiasPrimeraASegunda = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  const pctSegundaCompraDentroDe30d = gaps.length ? pct(gaps.filter((g) => g <= 30).length, gaps.length) : null;

  // Recencia contra el último dato importado (no contra "hoy": si la
  // importación viene atrasada, "hoy" exageraría la inactividad).
  const recencia = { activos0a14: 0, enfriandose15a45: 0, enRiesgoMasDe45: 0 };
  for (const arr of fechasPorCliente.values()) {
    const d = diasEntre(arr[arr.length - 1], datosHasta);
    if (d <= 14) recencia.activos0a14++; else if (d <= 45) recencia.enfriandose15a45++; else recencia.enRiesgoMasDe45++;
  }

  // Serie semanal: nuevos vs. los que vuelven.
  const porSemana = new Map<string, { pedidos: number; clientes: Set<string>; nuevos: Set<string>; vuelven: Set<string> }>();
  for (const p of conCliente) {
    if (p.fecha < desdeVentana || p.fecha > hastaRef) continue;
    const s = semanaDe(p.fecha);
    const e = porSemana.get(s) || { pedidos: 0, clientes: new Set<string>(), nuevos: new Set<string>(), vuelven: new Set<string>() };
    e.pedidos++;
    e.clientes.add(p.cliente_id!);
    const primera = fechasPorCliente.get(p.cliente_id!)![0];
    if (semanaDe(primera) === s) e.nuevos.add(p.cliente_id!); else e.vuelven.add(p.cliente_id!);
    porSemana.set(s, e);
  }
  // Pedidos de clientes nuevos (para el %): pedido cuyo cliente tuvo su 1ra compra esa semana.
  const semanas: AdquisicionSemana[] = [...porSemana.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([semana, e]) => {
    const pedidosNuevos = conCliente.filter((p) => semanaDe(p.fecha) === semana && e.nuevos.has(p.cliente_id!)).length;
    const gasto = r0(publi.get(semana) || 0);
    return {
      semana,
      pedidos: e.pedidos,
      clientesUnicos: e.clientes.size,
      clientesNuevos: e.nuevos.size,
      clientesQueVolvieron: e.vuelven.size,
      pctPedidosDeNuevos: pct(pedidosNuevos, e.pedidos),
      gastoPublicidad: gasto,
      costoPublicidadPorClienteNuevo: gasto > 0 && e.nuevos.size > 0 ? r0(gasto / e.nuevos.size) : null,
    };
  });

  // Cohortes por semana de primera compra.
  const inicioDatos = fmtD(periodoDeJS(aFecha(datosDesde)));
  const finInflado = sumarDias(inicioDatos, 28);
  const cohMap = new Map<string, string[][]>();
  for (const arr of fechasPorCliente.values()) {
    const s = semanaDe(arr[0]);
    if (s < semanaDe(desdeVentana) || arr[0] > hastaRef) continue;
    const l = cohMap.get(s) || [];
    l.push(arr);
    cohMap.set(s, l);
  }
  const cohortes: CohorteSemana[] = [...cohMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([semana, clientes]) => {
    const domingo = sumarDias(semana, 2);
    const madura = (dias: number) => sumarDias(domingo, dias) <= datosHasta;
    const volvieronEn = (dias: number) => clientes.filter((f) => f.length > 1 && diasEntre(f[0], f[1]) <= dias).length;
    const v30 = madura(30) ? volvieronEn(30) : null;
    const v60 = madura(60) ? volvieronEn(60) : null;
    return {
      semana,
      nuevos: clientes.length,
      volvieron30d: v30,
      pct30d: v30 === null ? null : pct(v30, clientes.length),
      volvieron60d: v60,
      pct60d: v60 === null ? null : pct(v60, clientes.length),
      volvieronHastaHoy: clientes.filter((f) => f.length > 1).length,
      inflada: semana < finInflado,
    };
  });

  return {
    datosDesde,
    datosHasta,
    advertencia:
      `Los pedidos registrados arrancan el ${datosDesde}: en las primeras 4 semanas (cohortes con inflada=true) ` +
      'aparecen como "nuevos" clientes que ya compraban antes del sistema, así que esas semanas sobreestiman la adquisición. ' +
      'pct30d/pct60d son null cuando la cohorte todavía no cumplió ese plazo (no es cero). ' +
      'volvieronHastaHoy crece con el tiempo: no compares cohortes viejas contra nuevas con ese número.',
    clientesUnicos,
    compraronUnaSolaVez: unaVez,
    pctUnaSolaVez: pct(unaVez, clientesUnicos),
    distribucionCompras,
    medianaDiasPrimeraASegunda,
    pctSegundaCompraDentroDe30d,
    recencia,
    semanas,
    cohortes,
  };
}

// ─── Horario ────────────────────────────────────────────────────────────────

export function construirHorario(pedidos: PedidoLiviano[], desdeVentana: string, hastaRef: string): HorarioResumen | undefined {
  // Primer pedido de cada cliente con precisión de hora (fecha + hora).
  const primero = new Map<string, string>();
  for (const p of pedidos) {
    if (!p.cliente_id) continue;
    const k = `${p.fecha} ${p.hora || ''}`;
    const prev = primero.get(p.cliente_id);
    if (prev === undefined || k < prev) primero.set(p.cliente_id, k);
  }
  const m = new Map<string, { pedidos: number; nuevos: number }>();
  let conHora = 0, enVentanaAds = 0;
  for (const p of pedidos) {
    if (!p.hora || p.fecha < desdeVentana || p.fecha > hastaRef) continue;
    const dia = NOMBRE_DIA[aFecha(p.fecha).getDay()];
    if (!dia) continue;
    conHora++;
    const hh = p.hora.slice(0, 2);
    const mins = Number(hh) * 60 + Number(p.hora.slice(3, 5));
    if (mins >= 19 * 60 && mins <= 22 * 60 + 30) enVentanaAds++;
    const k = `${dia}|${hh}`;
    const e = m.get(k) || { pedidos: 0, nuevos: 0 };
    e.pedidos++;
    if (p.cliente_id && primero.get(p.cliente_id) === `${p.fecha} ${p.hora}`) e.nuevos++;
    m.set(k, e);
  }
  if (conHora === 0) return undefined;
  const orden = { Viernes: 0, 'Sábado': 1, Domingo: 2 } as const;
  const franjas: HorarioFranja[] = [...m.entries()]
    .map(([k, e]) => {
      const [dia, hora] = k.split('|') as [HorarioFranja['dia'], string];
      return { dia, hora, pedidos: e.pedidos, pctDeNuevos: pct(e.nuevos, e.pedidos) };
    })
    .filter((f) => f.pedidos >= 3) // franjas con 1-2 pedidos son ruido
    .sort((a, b) => orden[a.dia] - orden[b.dia] || (a.hora < b.hora ? -1 : 1));
  return { pedidosConHora: conHora, pctPedidosEntre19y2230: pct(enVentanaAds, conHora), franjas };
}

// ─── Delivery / cadetería ───────────────────────────────────────────────────

export async function construirDelivery(
  admin: SupabaseClient,
  pedidos: PedidoLiviano[],
  desdeVentana: string,
  hastaRef: string
): Promise<DeliveryResumen | undefined> {
  const [{ data: jornadas }, { data: conf }] = await Promise.all([
    admin
      .from('cadetes_jornadas')
      .select('fecha, viajes_realizados, pago_cadete, cadete_base_minima_usada, cadete_valor_viaje_usado, costo_empresa_cadete_usado')
      .gte('fecha', desdeVentana)
      .lte('fecha', hastaRef),
    admin.from('configuracion').select('clave, valor').in('clave', ['cadete_base_minima', 'cadete_valor_viaje', 'costo_empresa_cadete']),
  ]);
  const cfg = new Map((conf || []).map((c: any) => [c.clave, Number(c.valor)]));
  const baseMinima = cfg.get('cadete_base_minima') ?? null;
  const valorViaje = cfg.get('cadete_valor_viaje') ?? null;

  // Modelo de Lucas: un "viaje" es una UNIDAD de distancia (simple = 1, doble =
  // 2…). El cadete cobra el mayor entre la base mínima y viajes × valor por
  // viaje; el cliente paga en Pedix unidades × valor + un margen (hoy 2.500 /
  // 4.500 / 6.500…, antes 2.000 / 4.000 / 6.000). Si el cadete supera la base,
  // el envío lo pagan los clientes; lo que se pierde es el COMPLEMENTO para
  // llegar a la base en noches flojas, más el costo fijo de la empresa.
  // Descomposición exacta: resultado = margenEnvios − complementoBaseMinima − costoEmpresa.
  const valorRef = valorViaje || 2000;
  const unidadesDeEnvio = (env: number): number | null => {
    if (env >= valorRef && env % valorRef === 0) return env / valorRef;                 // tarifa vieja, sin margen
    const conMargen = env - (env % valorRef);
    if (env > valorRef && conMargen > 0) return conMargen / valorRef;                     // tarifa con margen (ej. 4.500 → 2)
    return null;
  };
  type Acum = { pedidosEnvio: number; envios: number; unidadesCobradas: number; pedidosSinUnidad: number; cadetes: number; viajes: number; valorViajes: number; pagos: number; complemento: number; empresa: number; alMinimo: number };
  const noche = new Map<string, Acum>();
  const nuevaNoche = (): Acum => ({ pedidosEnvio: 0, envios: 0, unidadesCobradas: 0, pedidosSinUnidad: 0, cadetes: 0, viajes: 0, valorViajes: 0, pagos: 0, complemento: 0, empresa: 0, alMinimo: 0 });
  const tramos = new Map<number, number>();
  for (const p of pedidos) {
    if (p.fecha < desdeVentana || p.fecha > hastaRef) continue;
    const env = Number(p.envio_cobrado) || 0;
    if (env <= 0) continue;
    const e = noche.get(p.fecha) || nuevaNoche();
    e.pedidosEnvio++; e.envios += env;
    const u = unidadesDeEnvio(env);
    if (u === null) e.pedidosSinUnidad++; else e.unidadesCobradas += u;
    noche.set(p.fecha, e);
    tramos.set(env, (tramos.get(env) || 0) + 1);
  }
  for (const j of jornadas || []) {
    const e = noche.get((j as any).fecha) || nuevaNoche();
    const viajes = Number((j as any).viajes_realizados) || 0;
    const valorViajes = viajes * (Number((j as any).cadete_valor_viaje_usado) || 0);
    const pago = Number((j as any).pago_cadete) || 0;
    e.cadetes++;
    e.viajes += viajes;
    e.valorViajes += valorViajes;
    e.pagos += pago;
    e.complemento += Math.max(0, pago - valorViajes);
    e.empresa += Number((j as any).costo_empresa_cadete_usado) || 0;
    if (valorViajes < (Number((j as any).cadete_base_minima_usada) || 0)) e.alMinimo++;
    noche.set((j as any).fecha, e);
  }
  if (noche.size === 0) return undefined;

  // Semanas. Solo noches con jornadas de cadetes cargadas: una noche con envíos
  // cobrados pero sin cadetes cargados parecería ganancia pura (no lo es).
  const nochesSinCadetes = [...noche.entries()].filter(([, e]) => e.cadetes === 0 && e.pedidosEnvio > 0).map(([f]) => f).sort();
  const sem = new Map<string, ReturnType<typeof nuevaNoche>>();
  for (const [fecha, e] of noche) {
    if (e.cadetes === 0) continue;
    const s = semanaDe(fecha);
    const a = sem.get(s) || nuevaNoche();
    for (const k of Object.keys(a) as (keyof Acum)[]) a[k] += e[k];
    sem.set(s, a);
  }
  const semanas: DeliverySemana[] = [...sem.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([semana, a]) => ({
    semana,
    pedidosConEnvio: a.pedidosEnvio,
    enviosCobrados: r0(a.envios),
    cadetesNoche: a.cadetes,
    viajes: a.viajes,
    pagosCadetes: r0(a.pagos),
    costoEmpresaCadeteria: r0(a.empresa),
    resultado: r0(a.envios - a.pagos - a.empresa),
    margenEnvios: r0(a.envios - a.valorViajes),
    complementoBaseMinima: r0(a.complemento),
    unidadesCobradasEnPedix: a.pedidosSinUnidad === 0 ? a.unidadesCobradas : null,
    costoPorViaje: a.viajes > 0 ? r0((a.pagos + a.empresa) / a.viajes) : null,
    envioPromedioCobrado: a.pedidosEnvio > 0 ? r0(a.envios / a.pedidosEnvio) : null,
    viajesPorCadeteNoche: a.cadetes > 0 ? r1(a.viajes / a.cadetes) : null,
    jornadasPagadasAlMinimo: a.alMinimo,
  }));

  // Promedios por día de la semana (solo noches con cadetes cargados).
  const porDia: DeliveryDia[] = (['Viernes', 'Sábado', 'Domingo'] as const).map((dia) => {
    const noches = [...noche.entries()].filter(([f, e]) => NOMBRE_DIA[aFecha(f).getDay()] === dia && e.cadetes > 0).map(([, e]) => e);
    const n = noches.length;
    const sum = (k: keyof ReturnType<typeof nuevaNoche>) => noches.reduce((acc, e) => acc + e[k], 0);
    return {
      dia,
      noches: n,
      pedidosConEnvioPromedio: n ? r1(sum('pedidosEnvio') / n) : 0,
      cadetesPromedio: n ? r1(sum('cadetes') / n) : 0,
      viajesPorCadetePromedio: sum('cadetes') > 0 ? r1(sum('viajes') / sum('cadetes')) : null,
      pctJornadasAlMinimo: sum('cadetes') > 0 ? pct(sum('alMinimo'), sum('cadetes')) : null,
      resultadoPromedio: n ? r0((sum('envios') - sum('pagos') - sum('empresa')) / n) : 0,
      margenEnviosPromedio: n ? r0((sum('envios') - sum('valorViajes')) / n) : 0,
      complementoBaseMinimaPromedio: n ? r0(sum('complemento') / n) : 0,
      costoEmpresaPromedio: n ? r0(sum('empresa') / n) : 0,
    };
  });

  const totViajes = semanas.reduce((a, x) => a + x.viajes, 0);
  const totPedEnvio = semanas.reduce((a, x) => a + x.pedidosConEnvio, 0);
  const viajesPorPedidoConEnvio = totPedEnvio > 0 && totViajes > 0 ? r1(totViajes / totPedEnvio) : null;
  return {
    nochesConEnviosSinCadetesCargados: nochesSinCadetes.length
      ? { cantidad: nochesSinCadetes.length, desde: nochesSinCadetes[0], hasta: nochesSinCadetes[nochesSinCadetes.length - 1] }
      : null,
    viajesPorPedidoConEnvio,
    nota:
      'Un "viaje" es una UNIDAD de distancia, no un pedido: un envío simple = 1 viaje, doble = 2, etc. (por eso hay más viajes que pedidos). ' +
      'El cadete cobra max(base mínima, viajes × valor por viaje); el cliente paga en Pedix unidades × valor + un margen chico (ej. 2.500 un simple, 4.500 un doble, con viaje a 2.000). ' +
      'Que el cadete SUPERE la base es bueno: su pago sale de lo que pagan los clientes. La pérdida de delivery se descompone EXACTO en: ' +
      'resultado = margenEnvios (envíos cobrados − viajes × valor) − complementoBaseMinima (lo que se paga de más para llegar a la base en jornadas flojas) − costoEmpresaCadeteria. ' +
      'La palanca principal es complementoBaseMinima: cuántos cadetes se ponen por noche frente a la demanda de ese día. ' +
      'unidadesCobradasEnPedix (deducidas del cargo de envío) vs. viajes cargados sirve para detectar viajes que no se cobraron.',
    configuracionActual: {
      baseMinima,
      valorViaje,
      costoEmpresaPorCadete: cfg.get('costo_empresa_cadete') ?? null,
      viajesParaSuperarMinimo: baseMinima && valorViaje ? r1(baseMinima / valorViaje) : null,
    },
    semanas,
    porDia,
    tramosEnvioCobrado: [...tramos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([monto, n]) => ({ monto: r0(monto), pedidos: n })),
  };
}

// ─── Entrega / pago / cupones ───────────────────────────────────────────────

export function construirEntregaPago(pedidos: PedidoLiviano[], desdeVentana: string, hastaRef: string): EntregaPago {
  const conDato = pedidos.filter((p) => p.tipo_entrega != null || p.medio_pago != null);
  if (conDato.length === 0) return 'sin_datos_todavia';
  const enVentana = pedidos.filter((p) => p.fecha >= desdeVentana && p.fecha <= hastaRef);

  const sem = new Map<string, { n: number; deliv: number; ret: number; transf: number; efec: number; desc: number; hayDesc: boolean; cupon: number }>();
  for (const p of enVentana) {
    if (p.tipo_entrega == null && p.medio_pago == null) continue;
    const s = semanaDe(p.fecha);
    const e = sem.get(s) || { n: 0, deliv: 0, ret: 0, transf: 0, efec: 0, desc: 0, hayDesc: false, cupon: 0 };
    e.n++;
    const ent = (p.tipo_entrega || '').toLowerCase();
    if (ent.includes('retiro')) e.ret++; else if (ent.includes('domicilio') || ent.includes('delivery') || ent.includes('envío') || ent.includes('envio')) e.deliv++;
    const pago = (p.medio_pago || '').toLowerCase();
    if (pago.includes('transfer')) e.transf++; else if (pago.includes('efectivo')) e.efec++;
    if (p.descuento != null) { e.desc += Number(p.descuento) || 0; e.hayDesc = true; }
    if (p.cupon) e.cupon++;
    sem.set(s, e);
  }
  const semanas: EntregaPagoSemana[] = [...sem.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([semana, e]) => ({
    semana,
    pedidosConDato: e.n,
    pctDelivery: pct(e.deliv, e.n),
    pctRetiro: pct(e.ret, e.n),
    pctTransferencia: pct(e.transf, e.n),
    pctEfectivo: pct(e.efec, e.n),
    descuentoTotal: e.hayDesc ? r0(e.desc) : null,
    pedidosConCupon: e.cupon,
  }));

  // Cupones de todo el histórico (sirven para medir campañas/comunidad).
  const cup = new Map<string, { pedidos: number; clientes: Set<string>; primera: string; ultima: string }>();
  for (const p of pedidos) {
    if (!p.cupon) continue;
    const k = p.cupon.trim().toUpperCase();
    const e = cup.get(k) || { pedidos: 0, clientes: new Set<string>(), primera: p.fecha, ultima: p.fecha };
    e.pedidos++;
    if (p.cliente_id) e.clientes.add(p.cliente_id);
    if (p.fecha < e.primera) e.primera = p.fecha;
    if (p.fecha > e.ultima) e.ultima = p.fecha;
    cup.set(k, e);
  }
  const cupones: CuponResumen[] = [...cup.entries()].sort((a, b) => b[1].pedidos - a[1].pedidos).slice(0, 20)
    .map(([cupon, e]) => ({ cupon, pedidos: e.pedidos, clientes: e.clientes.size, primeraVez: e.primera, ultimaVez: e.ultima }));

  return { semanas, cupones, pedidosSinDato: enVentana.length - [...sem.values()].reduce((a, e) => a + e.n, 0) };
}
