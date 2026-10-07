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

export type ScopeAnalisis =
  | { tipo: 'semana'; a: RangoAnalisis }
  | { tipo: 'mes'; a: RangoAnalisis }
  | { tipo: 'comparacion'; a: RangoAnalisis; b: RangoAnalisis };

export type AnalisisCompleto = {
  generadoEn: string;        // ISO — se setea afuera (no usar new Date() en el módulo puro del server action)
  scopeTipo: 'semana' | 'mes' | 'comparacion';
  periodoA: AnalisisPeriodo;
  periodoB?: AnalisisPeriodo;        // solo en comparacion
  deltas?: Record<string, { a: number; b: number; delta: number }>;  // solo en comparacion
  tendencia: TendenciaItem[];        // últimas N semanas (semana/mes)
  findes: number;                    // cantidad de fines de semana operativos en el período A
};
