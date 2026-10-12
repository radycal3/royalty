// Tipos del motor de análisis de negocio (Laboratorio → "Tu Analista").
// Todo lo que acá se define lo calcula CÓDIGO determinístico (no la IA): la IA
// solo interpreta y recomienda citando estos números. Es el "contexto" que se
// congela por conversación y se le pasa al analista.

export type RangoAnalisis = { desde: string; hasta: string; label: string };

export type Financiero = {
  pedidos: number;
  hamburguesasVendidas: number;
  ticketPromedio: number;
  ventas: number;
  costoIngredientes: number;
  beneficioBruto: number;
  margenBruto: number;
  gastosVariables: number;
  gastosFijos: number;
  gastosTotal: number;
  gastoPublicidad: number;
  publicidadPct: number;
  costoConsumoInterno: number;
  resultadoDelivery: number;
  beneficioNeto: number;
  margenNeto: number;
  // repetidores (definición: cliente con compra previa a este pedido)
  pedidosRepetidores: number;
  ventasRepetidores: number;
  pctVentasRepetidores: number;
};

export type ProductoLinea = {
  nombre: string;
  categoria: string;
  esPromo: boolean;
  unidades: number;
  venta: number;
  costo: number;
  beneficio: number;
  margen: number;          // % sobre venta
  participacion: number;   // % sobre ventas totales
};

export type DiaResumen = {
  dia: 'Viernes' | 'Sábado' | 'Domingo';
  pedidos: number;
  ventas: number;
  ticketPromedio: number;
  hamburguesas: number;
  topProductos: { nombre: string; unidades: number }[];
};

export type PromosAnalisis = {
  promos: ProductoLinea[]; // cada promo con su performance
  resumenPromo: { ventas: number; beneficio: number; margen: number; participacionVentas: number; unidades: number };
  resumenNoPromo: { ventas: number; beneficio: number; margen: number; participacionVentas: number; unidades: number };
};

export type AfinidadGrupo = {
  pedidos: number;
  ventas: number;
  ticketPromedio: number;
  topProductos: { nombre: string; unidades: number; pctVentasGrupo: number }[];
};

export type Afinidad = {
  repetidores: AfinidadGrupo;
  nuevos: AfinidadGrupo;
};

export type ConjuntoMetaAds = {
  nombre: string;
  tipoAudiencia: string; // 'caliente' | 'fría'
  gastoArs: number;
  conversaciones: number | null;
  costoPorConversacion: number | null;
  ctrEnlace: number | null;
};

export type Inversion = {
  porCategoria: { categoria: string; tipo: string; total: number }[];
  total: number;
  publicidad:
    | {
        gastoUsd: number;
        gastoArs: number;
        pctVentas: number;
        roas: number;
        alcance: number | null;
        clics: number | null;
        resultados: number | null;
        porConjunto: ConjuntoMetaAds[];
      }
    | 'sin_datos_todavia';
};

export type ClientesResumen = {
  totalUnicos: number;
  activos: number;
  enRiesgo: number;
  nuevoPerdido: number;
  retencionCartera: number;
  tasaRetencion: number;
  pctFacturacionRepetidores: number;
  altoValorEnRiesgo: number;
  altoValorVentasHistoricas: number;
  nuevosEnRiesgoEstaSemana: number;
  medianaDiasEntreCompras: number;
};

export type EquipoResumen =
  | {
      mensajesRecibidos: number | null;
      mensajesConvertidos: number | null;
      tasaConversion: number | null;
      tiempoPromedioProduccionMin: number | null;
      quejasFaltantes: number | null;
      quejasCalidad: number | null;
      pctPedidosConError: number | null;
    }
  | 'sin_datos_todavia';

export type MermaResumen =
  | { ingrediente: string; mermaPct: number | null; semaforo: string | null }[]
  | 'sin_datos_todavia';

export type AnalisisPeriodo = {
  rango: RangoAnalisis;
  financiero: Financiero;
  productos: ProductoLinea[];           // ranking completo, orden por venta desc
  porDia: DiaResumen[];                 // Vie / Sáb / Dom
  promos: PromosAnalisis;
  afinidad: Afinidad;
  inversion: Inversion;
  clientes: ClientesResumen;
  equipo: EquipoResumen;
  merma: MermaResumen;
};

export type TendenciaItem = {
  label: string;
  desde: string;
  ventas: number;
  margenNeto: number;
  beneficioNeto: number;
  pedidos: number;
  cerrada: boolean;
};

// ─── HISTORIA (la "película": últimas N semanas, para el asesor estratégico) ──

export type PromoSemana = {
  participacion: number; // % de ventas de la semana que fueron productos promo
  margen: number;        // margen % de los productos promo esa semana
  unidades: number;
  venta: number;
};

export type HistoriaSemana = {
  semana: string;        // fecha del viernes (YYYY-MM-DD)
  label: string;
  esPromo: boolean;      // participación de promo > umbral → fue "semana de promo"
  ventas: number;
  margenNeto: number;
  beneficioNeto: number;
  pedidos: number;
  ticketPromedio: number;
  publicidadPct: number;
  roas: number;
  resultadoDelivery: number;
  pctVentasRepetidores: number | null;
  promo: PromoSemana | null;
};

export type PubliSemanaHist = {
  semana: string;        // fecha del viernes (YYYY-MM-DD)
  gastoArs: number;
  frio: { gastoArs: number; conversaciones: number; costoPorConversacion: number | null } | null;
  calido: { gastoArs: number; conversaciones: number; costoPorConversacion: number | null } | null;
};

export type DecisionHist = {
  periodoDesde: string;
  area: string;
  recomendacion: string;
  estado: string;               // sugerida | decidida | evaluada
  decisionTomada: string | null;
  resultado: string | null;     // resultado medido tras el cierre (si existe)
};

// ─── ADQUISICIÓN Y RECOMPRA ("¿la gente vuelve?") ───────────────────────────
// Nuevo = primera compra registrada del cliente (por celular). Ver `advertencia`:
// los datos arrancan en `datosDesde`, así que en las primeras semanas aparecen
// como "nuevos" clientes que ya compraban antes del sistema.

export type AdquisicionSemana = {
  semana: string;                 // viernes de la semana operativa
  pedidos: number;                // pedidos con cliente identificado
  clientesUnicos: number;
  clientesNuevos: number;         // primera compra de su vida esa semana
  clientesQueVolvieron: number;   // ya habían comprado en una semana anterior
  pctPedidosDeNuevos: number;
  gastoPublicidad: number;        // gastos_operativos categoría publicidad de esa semana (Vie→Jue)
  costoPublicidadPorClienteNuevo: number | null;
};

export type CohorteSemana = {
  semana: string;                 // semana de la PRIMERA compra
  nuevos: number;
  volvieron30d: number | null;    // null = la cohorte todavía no cumplió 30 días
  pct30d: number | null;
  volvieron60d: number | null;
  pct60d: number | null;
  volvieronHastaHoy: number;      // recompra alguna vez (crece con el tiempo: no comparar cohortes viejas con nuevas)
  inflada: boolean;               // primeras 4 semanas de datos: incluye clientes previos al sistema
};

export type Recompra = {
  datosDesde: string;             // primer pedido registrado en el sistema
  datosHasta: string;             // último pedido importado (los cálculos de recencia/madurez usan esta fecha)
  advertencia: string;
  clientesUnicos: number;
  compraronUnaSolaVez: number;
  pctUnaSolaVez: number;
  distribucionCompras: { compras: string; clientes: number }[];  // 1, 2, 3, 4-5, 6+
  medianaDiasPrimeraASegunda: number | null;
  pctSegundaCompraDentroDe30d: number | null;  // de los que volvieron, cuántos lo hicieron en ≤30 días
  recencia: { activos0a14: number; enfriandose15a45: number; enRiesgoMasDe45: number };
  semanas: AdquisicionSemana[];   // cronológico
  cohortes: CohorteSemana[];      // cronológico
};

// ─── HORARIO ────────────────────────────────────────────────────────────────
export type HorarioFranja = {
  dia: 'Viernes' | 'Sábado' | 'Domingo';
  hora: string;                   // "19", "20", … (hora de inicio)
  pedidos: number;
  pctDeNuevos: number;            // % de esos pedidos que fueron primera compra del cliente
};
export type HorarioResumen = {
  pedidosConHora: number;
  pctPedidosEntre19y2230: number;
  franjas: HorarioFranja[];
};

// ─── DELIVERY / CADETERÍA ───────────────────────────────────────────────────
export type DeliverySemana = {
  semana: string;
  pedidosConEnvio: number;
  enviosCobrados: number;
  cadetesNoche: number;           // jornadas de cadete cargadas (1 cadete × 1 noche)
  viajes: number;
  pagosCadetes: number;
  costoEmpresaCadeteria: number;
  resultado: number;              // envíos cobrados − pagos − costo empresa
  costoPorViaje: number | null;   // (pagos + costo empresa) / viajes
  envioPromedioCobrado: number | null;
  viajesPorCadeteNoche: number | null;
  jornadasPagadasAlMinimo: number; // jornadas donde el cadete cobró la base mínima (pocos viajes)
};
export type DeliveryDia = {
  dia: 'Viernes' | 'Sábado' | 'Domingo';
  noches: number;
  pedidosConEnvioPromedio: number;
  cadetesPromedio: number;
  viajesPorCadetePromedio: number | null;
  pctJornadasAlMinimo: number | null;
  resultadoPromedio: number;
};
export type DeliveryResumen = {
  configuracionActual: { baseMinima: number | null; valorViaje: number | null; costoEmpresaPorCadete: number | null; viajesParaSuperarMinimo: number | null };
  viajesPorPedidoConEnvio: number | null; // viajes cargados / pedidos con envío en la ventana
  nota: string;
  semanas: DeliverySemana[];
  porDia: DeliveryDia[];
  tramosEnvioCobrado: { monto: number; pedidos: number }[]; // distribución del cargo de envío (≈ zonas)
};

// ─── ENTREGA / PAGO / CUPONES (columnas de Pedix capturadas desde la migración 041) ──
export type EntregaPagoSemana = {
  semana: string;
  pedidosConDato: number;
  pctDelivery: number | null;
  pctRetiro: number | null;
  pctTransferencia: number | null;
  pctEfectivo: number | null;
  descuentoTotal: number | null;  // plata "regalada" en descuentos esa semana
  pedidosConCupon: number;
};
export type CuponResumen = { cupon: string; pedidos: number; clientes: number; primeraVez: string; ultimaVez: string };
export type EntregaPago =
  | { semanas: EntregaPagoSemana[]; cupones: CuponResumen[]; pedidosSinDato: number }
  | 'sin_datos_todavia';

export type Historia = {
  semanas: HistoriaSemana[];      // orden cronológico: más vieja → más nueva
  publiPorSemana: PubliSemanaHist[];
  decisiones: DecisionHist[];     // decisiones pasadas con su resultado (memoria)
  // Los bloques de clientes y operación usan TODOS los datos importados (no solo
  // semanas cerradas): pueden llegar más adelante que historia.semanas.
  ventanaClientesYOperacion?: { desde: string; hasta: string };
  recompra?: Recompra;            // adquisición, cohortes, recencia
  horario?: HorarioResumen;
  delivery?: DeliveryResumen;
  entregaPago?: EntregaPago;
};

// Hechos del mundo real que los números no cuentan (cargados por el admin):
// "WhatsApp broadcast caído desde 15-sep", "subí precios 8%", "feriado", etc.
export type EventoNegocio = {
  fecha: string;         // YYYY-MM-DD
  descripcion: string;
};

export type ScopeAnalisis =
  | { tipo: 'semana'; a: RangoAnalisis }
  | { tipo: 'mes'; a: RangoAnalisis }
  | { tipo: 'comparacion'; a: RangoAnalisis; b: RangoAnalisis }
  | { tipo: 'negocio'; a: RangoAnalisis }  // diagnóstico estratégico: a = última semana cerrada
  | { tipo: 'charla'; a: RangoAnalisis };  // charla libre con el socio: mismo contexto que 'negocio', sin informe inicial

export type AnalisisCompleto = {
  generadoEn: string;        // ISO — se setea afuera (no usar new Date() en el módulo puro del server action)
  scopeTipo: 'semana' | 'mes' | 'comparacion' | 'negocio' | 'charla';
  periodoA: AnalisisPeriodo;
  periodoB?: AnalisisPeriodo;        // solo en comparacion
  deltas?: Record<string, { a: number; b: number; delta: number }>;  // solo en comparacion
  tendencia: TendenciaItem[];        // últimas N semanas (semana/mes)
  findes: number;                    // cantidad de fines de semana operativos en el período A
  historia?: Historia;               // "la película": serie semanal + promos + publi + decisiones
  eventos?: EventoNegocio[];         // hechos del mundo real cargados por el admin
};
