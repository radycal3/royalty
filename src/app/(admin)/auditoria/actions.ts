'use server';

// ═══════════════════════════════════════════════════════════════════════
// CONVENCIÓN DE ESTE ARCHIVO — leer antes de modificar:
//
// Toda función cuyo nombre contiene "Historico" o "Cerrados" lee
// EXCLUSIVAMENTE de las tablas congeladas (periodos, periodos_productos,
// periodos_gastos). Nunca leen pedidos, gastos_operativos,
// cadetes_jornadas ni ninguna tabla operativa. Esto es deliberado: un
// dato histórico no puede cambiar según el momento en que se consulte.
//
// La única función con datos "en vivo" es obtenerSemaforoEnVivo(), que
// recibe KpisPeriodo ya calculado por el dashboard (no hace sus propias
// queries) — existe específicamente para mostrar el estado de la semana
// EN CURSO, que por definición todavía no tiene snapshot. Su resultado
// SIEMPRE debe mostrarse en la UI con una etiqueta explícita tipo
// "Semana en curso — valores sujetos a cambio hasta el cierre", nunca
// como si fuera un dato definitivo.
// ═══════════════════════════════════════════════════════════════════════

import { createClient } from '@/lib/supabase/server';
import type { KpisPeriodo } from '../dashboard/actions';

// ─── Types ───────────────────────────────────────────────────────────────

export type EstadoSalud = 'verde' | 'amarillo' | 'rojo' | 'sin_datos';

export type IndicadorSalud = {
  nombre: 'margen_neto' | 'publicidad' | 'delivery' | 'roas' | 'tendencia_ventas';
  estado: EstadoSalud;
  valorActual: number | null;
  umbral: number | null;
  explicacion: string;
};

export type Semaforo = {
  indicadores: IndicadorSalud[];
  // Marca explícita de la fuente — la UI debe usar este campo para decidir
  // qué etiqueta mostrar, no inferirlo.
  fuente: 'en_vivo' | 'historico';
};

export type ContribucionComponente = {
  componente:
    | 'ventas'
    | 'costoIngredientes'
    | 'costoConsumoInterno'
    | 'gastosVariables'
    | 'gastosFijos'
    | 'resultadoDelivery';
  label: string;
  valorA: number;
  valorB: number;
  impactoEnNeto: number;
};

export type ItemDestacado = {
  nombre: string;
  valorA: number;
  valorB: number;
  diferencia: number;
  pctDelCambioTotal: number;
};

export type ComparacionPeriodos = {
  periodoA: { id: string; label: string; desde: string; hasta: string };
  periodoB: { id: string; label: string; desde: string; hasta: string };
  beneficioNetoA: number;
  beneficioNetoB: number;
  deltaBeneficioNeto: number;
  contribuciones: ContribucionComponente[];
  tieneDetalle: boolean; // true solo si AMBOS períodos tienen filas de detalle
  productosDestacados: ItemDestacado[];
  gastosDestacados: ItemDestacado[];
};

export type TendenciaVentas = {
  disponible: boolean;
  promedioReciente: number | null; // últimas 3 semanas cerradas
  promedioAnterior: number | null; // las 3 anteriores a esas
  variacionPct: number | null;
  semanasUsadas: number; // cuántas semanas cerradas había disponibles
};

type ConfigAlertasAuditoria = {
  margenMinimo: number;
  publicidadMaxima: number;
  roasMinimo: number;
  caidaVentasPct: number;
  relevanciaMontoMinimo: number;
  relevanciaPctMinimo: number;
};

// ─── Helper: leer todos los umbrales de alerta de una sola vez ──────────

async function leerConfigAlertas(supabase: any): Promise<ConfigAlertasAuditoria> {
  const { data } = await supabase
    .from('configuracion')
    .select('clave, valor')
    .in('clave', [
      'alerta_margen_minimo',
      'alerta_publicidad_maxima',
      'alerta_roas_minimo',
      'alerta_caida_ventas_pct',
      'alerta_relevancia_monto_minimo',
      'alerta_relevancia_pct_minimo',
    ]);

  const map = new Map<string, string>((data || []).map((c: any) => [c.clave, c.valor]));
  const num = (clave: string, def: number) => {
    const v = map.get(clave);
    const n = v !== undefined ? parseFloat(v) : NaN;
    return Number.isFinite(n) ? n : def;
  };

  return {
    margenMinimo: num('alerta_margen_minimo', 40),
    publicidadMaxima: num('alerta_publicidad_maxima', 15),
    roasMinimo: num('alerta_roas_minimo', 3),
    caidaVentasPct: num('alerta_caida_ventas_pct', 15),
    relevanciaMontoMinimo: num('alerta_relevancia_monto_minimo', 15000),
    relevanciaPctMinimo: num('alerta_relevancia_pct_minimo', 5),
  };
}

// ─── Comparación entre 2 períodos CERRADOS cualesquiera ──────────────────
// Lee EXCLUSIVAMENTE periodos / periodos_productos / periodos_gastos.
// No recibe ni toca KpisPeriodo en vivo en ningún momento.

export async function compararPeriodosCerrados(
  periodoIdA: string,
  periodoIdB: string
): Promise<ComparacionPeriodos> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const [{ data: pA, error: errA }, { data: pB, error: errB }] = await Promise.all([
    supabase.from('periodos').select('*').eq('id', periodoIdA).single(),
    supabase.from('periodos').select('*').eq('id', periodoIdB).single(),
  ]);

  if (errA || !pA) throw new Error('No se encontró el período A (¿está cerrado?)');
  if (errB || !pB) throw new Error('No se encontró el período B (¿está cerrado?)');

  // Descomposición aditiva — matemáticamente exacta, no inferida. Se
  // reconstruyen los componentes de gastos (variables/fijos) a partir de
  // los campos agregados disponibles en 'periodos'. NOTA: 'periodos' no
  // guarda gastosVariables/gastosFijos por separado (no estaba en el
  // contrato original) — para esta descomposición se usa el desglose de
  // periodos_gastos cuando está disponible, y si no, el delta de
  // resultado_delivery + beneficio_bruto- beneficio_neto agregado.
  const config = await leerConfigAlertas(supabase);

  const [{ data: gastosA }, { data: gastosB }] = await Promise.all([
    supabase.from('periodos_gastos').select('*').eq('periodo_id', periodoIdA),
    supabase.from('periodos_gastos').select('*').eq('periodo_id', periodoIdB),
  ]);

  const [{ data: prodA }, { data: prodB }] = await Promise.all([
    supabase.from('periodos_productos').select('*').eq('periodo_id', periodoIdA),
    supabase.from('periodos_productos').select('*').eq('periodo_id', periodoIdB),
  ]);

  const tieneDetalle =
    (gastosA?.length || 0) > 0 &&
    (gastosB?.length || 0) > 0 &&
    (prodA?.length || 0) > 0 &&
    (prodB?.length || 0) > 0;

  const sumaGastos = (rows: any[] | null, tipo: string) =>
    (rows || []).filter((g) => g.tipo === tipo).reduce((s, g) => s + g.total, 0);

  const gastosVariablesA = sumaGastos(gastosA, 'variable');
  const gastosVariablesB = sumaGastos(gastosB, 'variable');
  const gastosFijosA = sumaGastos(gastosA, 'fijo');
  const gastosFijosB = sumaGastos(gastosB, 'fijo');

  const costoConsumoInternoA =
    pA.beneficio_bruto - gastosVariablesA - gastosFijosA - pA.beneficio_neto + pA.resultado_delivery;
  const costoConsumoInternoB =
    pB.beneficio_bruto - gastosVariablesB - gastosFijosB - pB.beneficio_neto + pB.resultado_delivery;

  const deltaBeneficioNeto = pB.beneficio_neto - pA.beneficio_neto;

  const contribuciones: ContribucionComponente[] = [
    {
      componente: 'ventas',
      label: 'Ventas',
      valorA: pA.ventas,
      valorB: pB.ventas,
      // Ventas y costoIngredientes juntas explican beneficio_bruto; para
      // mantener la descomposición simple y verificable, se calcula el
      // impacto de "ventas" como el delta de beneficio_bruto atribuible
      // proporcionalmente al cambio de ventas vs. costo. Se simplifica
      // usando el delta directo de beneficio_bruto menos el de costo,
      // ya que beneficio_bruto = ventas - costoIngredientes.
      impactoEnNeto: pB.ventas - pA.ventas,
    },
    {
      componente: 'costoIngredientes',
      label: 'Costo de ingredientes',
      valorA: pA.ventas - pA.beneficio_bruto,
      valorB: pB.ventas - pB.beneficio_bruto,
      impactoEnNeto: -((pB.ventas - pB.beneficio_bruto) - (pA.ventas - pA.beneficio_bruto)),
    },
    {
      componente: 'costoConsumoInterno',
      label: 'Consumo interno',
      valorA: costoConsumoInternoA,
      valorB: costoConsumoInternoB,
      impactoEnNeto: -(costoConsumoInternoB - costoConsumoInternoA),
    },
    {
      componente: 'gastosVariables',
      label: 'Gastos variables',
      valorA: gastosVariablesA,
      valorB: gastosVariablesB,
      impactoEnNeto: -(gastosVariablesB - gastosVariablesA),
    },
    {
      componente: 'gastosFijos',
      label: 'Gastos fijos',
      valorA: gastosFijosA,
      valorB: gastosFijosB,
      impactoEnNeto: -(gastosFijosB - gastosFijosA),
    },
    {
      componente: 'resultadoDelivery',
      label: 'Resultado Delivery',
      valorA: pA.resultado_delivery,
      valorB: pB.resultado_delivery,
      impactoEnNeto: pB.resultado_delivery - pA.resultado_delivery,
    },
  ];

  // ── Productos/gastos destacados — umbral de relevancia, no Top N fijo ──
  function calcularDestacados(
    rowsA: any[] | null,
    rowsB: any[] | null,
    keyNombre: string,
    keyValor: string,
    cambioTotalRef: number
  ): ItemDestacado[] {
    const mapaA = new Map<string, number>((rowsA || []).map((r) => [r[keyNombre], r[keyValor]]));
    const mapaB = new Map<string, number>((rowsB || []).map((r) => [r[keyNombre], r[keyValor]]));
    const nombres = new Set([...mapaA.keys(), ...mapaB.keys()]);

    const items: ItemDestacado[] = [];
    for (const nombre of nombres) {
      const valorA = mapaA.get(nombre) || 0;
      const valorB = mapaB.get(nombre) || 0;
      const diferencia = valorB - valorA;
      const pctDelCambioTotal =
        cambioTotalRef !== 0 ? (Math.abs(diferencia) / Math.abs(cambioTotalRef)) * 100 : 0;

      const relevante =
        Math.abs(diferencia) >= config.relevanciaMontoMinimo ||
        pctDelCambioTotal >= config.relevanciaPctMinimo;

      if (relevante) {
        items.push({ nombre, valorA, valorB, diferencia, pctDelCambioTotal });
      }
    }

    return items.sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));
  }

  const cambioTotalVentas = pB.ventas - pA.ventas;
  const cambioTotalGastos = gastosVariablesB + gastosFijosB - (gastosVariablesA + gastosFijosA);

  const productosDestacados = tieneDetalle
    ? calcularDestacados(prodA, prodB, 'producto_nombre', 'venta', cambioTotalVentas)
    : [];
  const gastosDestacados = tieneDetalle
    ? calcularDestacados(gastosA, gastosB, 'categoria', 'total', cambioTotalGastos)
    : [];

  return {
    periodoA: { id: pA.id, label: pA.label, desde: pA.desde, hasta: pA.hasta },
    periodoB: { id: pB.id, label: pB.label, desde: pB.desde, hasta: pB.hasta },
    beneficioNetoA: pA.beneficio_neto,
    beneficioNetoB: pB.beneficio_neto,
    deltaBeneficioNeto,
    contribuciones,
    tieneDetalle,
    productosDestacados,
    gastosDestacados,
  };
}

// ─── Comparación rápida: última semana cerrada vs. anterior ─────────────
// Wrapper de conveniencia sobre compararPeriodosCerrados — sigue siendo
// 100% histórico.

export async function compararUltimasDosSemanas(): Promise<ComparacionPeriodos | null> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data: ultimas } = await supabase
    .from('periodos')
    .select('id')
    .eq('tipo', 'semana')
    .order('desde', { ascending: false })
    .limit(2);

  if (!ultimas || ultimas.length < 2) return null;

  // ultimas[0] = más reciente (B), ultimas[1] = anterior (A)
  return compararPeriodosCerrados(ultimas[1].id, ultimas[0].id);
}

// ─── Tendencia histórica de ventas (3 semanas vs 3 anteriores) ──────────
// 100% histórico. Si hay menos de 6 semanas cerradas, devuelve
// disponible: false en vez de forzar un cálculo poco confiable.

export async function obtenerTendenciaHistorica(): Promise<TendenciaVentas> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data } = await supabase
    .from('periodos')
    .select('ventas, desde')
    .eq('tipo', 'semana')
    .order('desde', { ascending: false })
    .limit(6);

  const semanas = data || [];

  if (semanas.length < 6) {
    return {
      disponible: false,
      promedioReciente: null,
      promedioAnterior: null,
      variacionPct: null,
      semanasUsadas: semanas.length,
    };
  }

  // semanas[0..2] = las 3 más recientes, semanas[3..5] = las 3 anteriores
  const recientes = semanas.slice(0, 3);
  const anteriores = semanas.slice(3, 6);

  const promedioReciente = recientes.reduce((s: number, p: any) => s + p.ventas, 0) / 3;
  const promedioAnterior = anteriores.reduce((s: number, p: any) => s + p.ventas, 0) / 3;
  const variacionPct =
    promedioAnterior !== 0 ? ((promedioReciente - promedioAnterior) / promedioAnterior) * 100 : 0;

  return {
    disponible: true,
    promedioReciente,
    promedioAnterior,
    variacionPct,
    semanasUsadas: 6,
  };
}

// ─── Semáforo — versión HISTÓRICA (una semana ya cerrada) ───────────────
// 100% histórico, lee 'periodos'.

export async function obtenerSemaforoHistorico(periodoId: string): Promise<Semaforo> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data: p, error } = await supabase
    .from('periodos')
    .select('*')
    .eq('id', periodoId)
    .single();

  if (error || !p) throw new Error('Período no encontrado');

  const config = await leerConfigAlertas(supabase);
  const tendencia = await obtenerTendenciaHistorica();

  return construirSemaforo(
    {
      margenNeto: p.margen_neto,
      publicidadPct: p.publicidad_pct,
      resultadoDelivery: p.resultado_delivery,
      roas: p.roas,
    },
    config,
    tendencia,
    'historico'
  );
}

// ─── Semáforo — versión EN VIVO (semana en curso, sin cerrar) ───────────
// Recibe KpisPeriodo ya calculado por el dashboard — esta función NO hace
// sus propias queries a tablas operativas, solo evalúa las mismas reglas
// sobre el objeto que ya le pasaron. La UI que llama a esta función es
// responsable de etiquetar el resultado como "en vivo / sujeto a cambios".

export async function obtenerSemaforoEnVivo(kpis: KpisPeriodo): Promise<Semaforo> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const config = await leerConfigAlertas(supabase);
  const tendencia = await obtenerTendenciaHistorica(); // la tendencia SIEMPRE es histórica, incluso en la vista en vivo

  return construirSemaforo(
    {
      margenNeto: kpis.margenNeto,
      publicidadPct: kpis.publicidadPct,
      resultadoDelivery: kpis.resultadoDelivery,
      roas: kpis.roas,
    },
    config,
    tendencia,
    'en_vivo'
  );
}

// ─── Lógica compartida de evaluación de reglas (pura, sin I/O) ──────────

function construirSemaforo(
  valores: { margenNeto: number; publicidadPct: number; resultadoDelivery: number; roas: number },
  config: ConfigAlertasAuditoria,
  tendencia: TendenciaVentas,
  fuente: 'en_vivo' | 'historico'
): Semaforo {
  const indicadores: IndicadorSalud[] = [];

  // Margen neto
  {
    const { margenNeto } = valores;
    const estado: EstadoSalud =
      margenNeto >= config.margenMinimo + 5
        ? 'verde'
        : margenNeto >= config.margenMinimo
        ? 'amarillo'
        : 'rojo';
    indicadores.push({
      nombre: 'margen_neto',
      estado,
      valorActual: margenNeto,
      umbral: config.margenMinimo,
      explicacion:
        estado === 'rojo'
          ? `Margen neto de ${margenNeto.toFixed(1)}% está por debajo del mínimo configurado (${config.margenMinimo}%).`
          : estado === 'amarillo'
          ? `Margen neto de ${margenNeto.toFixed(1)}% está cerca del mínimo configurado (${config.margenMinimo}%).`
          : `Margen neto de ${margenNeto.toFixed(1)}%, por encima del mínimo configurado (${config.margenMinimo}%).`,
    });
  }

  // Publicidad % sobre ventas
  {
    const { publicidadPct } = valores;
    const estado: EstadoSalud =
      publicidadPct <= config.publicidadMaxima - 3
        ? 'verde'
        : publicidadPct <= config.publicidadMaxima
        ? 'amarillo'
        : 'rojo';
    indicadores.push({
      nombre: 'publicidad',
      estado,
      valorActual: publicidadPct,
      umbral: config.publicidadMaxima,
      explicacion:
        estado === 'rojo'
          ? `Publicidad consume ${publicidadPct.toFixed(1)}% de las ventas, por encima del máximo configurado (${config.publicidadMaxima}%).`
          : estado === 'amarillo'
          ? `Publicidad consume ${publicidadPct.toFixed(1)}% de las ventas, cerca del máximo configurado (${config.publicidadMaxima}%).`
          : `Publicidad consume ${publicidadPct.toFixed(1)}% de las ventas, dentro del máximo configurado (${config.publicidadMaxima}%).`,
    });
  }

  // Resultado Delivery
  {
    const { resultadoDelivery } = valores;
    const estado: EstadoSalud =
      resultadoDelivery > 0 ? 'verde' : resultadoDelivery === 0 ? 'amarillo' : 'rojo';
    indicadores.push({
      nombre: 'delivery',
      estado,
      valorActual: resultadoDelivery,
      umbral: 0,
      explicacion:
        estado === 'rojo'
          ? `El delivery está dando pérdida: se pagó más a cadetes y empresa de cadetería de lo que se cobró en envíos.`
          : estado === 'amarillo'
          ? `El delivery está en equilibrio: lo cobrado en envíos cubre exactamente lo pagado a cadetes.`
          : `El delivery es rentable: lo cobrado en envíos supera lo pagado a cadetes y empresa de cadetería.`,
    });
  }

  // ROAS
  {
    const { roas } = valores;
    const estado: EstadoSalud =
      roas === 0
        ? 'sin_datos'
        : roas >= config.roasMinimo + 1
        ? 'verde'
        : roas >= config.roasMinimo
        ? 'amarillo'
        : 'rojo';
    indicadores.push({
      nombre: 'roas',
      estado,
      valorActual: roas === 0 ? null : roas,
      umbral: config.roasMinimo,
      explicacion:
        estado === 'sin_datos'
          ? 'Sin gasto en publicidad en este período — ROAS no aplica.'
          : estado === 'rojo'
          ? `ROAS de ${roas.toFixed(2)}x está por debajo del mínimo configurado (${config.roasMinimo}x).`
          : estado === 'amarillo'
          ? `ROAS de ${roas.toFixed(2)}x está cerca del mínimo configurado (${config.roasMinimo}x).`
          : `ROAS de ${roas.toFixed(2)}x, por encima del mínimo configurado (${config.roasMinimo}x).`,
    });
  }

  // Tendencia de ventas — siempre histórica (3 vs 3 semanas cerradas),
  // independientemente de si este semáforo es en vivo o histórico.
  {
    if (!tendencia.disponible) {
      indicadores.push({
        nombre: 'tendencia_ventas',
        estado: 'sin_datos',
        valorActual: null,
        umbral: null,
        explicacion: `Datos insuficientes: se necesitan al menos 6 semanas cerradas para calcular tendencia (hay ${tendencia.semanasUsadas}).`,
      });
    } else {
      const variacion = tendencia.variacionPct!;
      const estado: EstadoSalud =
        variacion >= 0 ? 'verde' : Math.abs(variacion) <= config.caidaVentasPct ? 'amarillo' : 'rojo';
      indicadores.push({
        nombre: 'tendencia_ventas',
        estado,
        valorActual: variacion,
        umbral: -config.caidaVentasPct,
        explicacion:
          estado === 'rojo'
            ? `Las ventas promedio de las últimas 3 semanas cerradas cayeron ${Math.abs(variacion).toFixed(1)}% respecto a las 3 anteriores, superando el umbral de alerta (${config.caidaVentasPct}%).`
            : estado === 'amarillo'
            ? `Las ventas promedio cayeron ${Math.abs(variacion).toFixed(1)}% respecto a las 3 semanas anteriores, dentro del umbral de alerta (${config.caidaVentasPct}%).`
            : `Las ventas promedio subieron ${variacion.toFixed(1)}% respecto a las 3 semanas anteriores.`,
      });
    }
  }

  return { indicadores, fuente };
}
