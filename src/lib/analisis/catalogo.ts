// Catálogo vigente para el Analista: productos con su precio actual, receta y
// costo teórico de hoy, e ingredientes con su costo vigente (y el anterior, para
// ver subas). Más el motor de SIMULACIÓN de precios/costos, que usa estos mismos
// datos. Todo determinístico; la IA solo interpreta.
//
// Reglas del sistema que se respetan acá:
// - Costo/precio vigente a una fecha: fecha_vigencia <= fecha, ordenado por
//   fecha_vigencia DESC, created_at DESC (principio 2.2, mismo criterio que
//   importar-core).
// - costo_parcial = (costo_por_unidad_compra / factor_conversion) × cantidad_receta
//   (fórmula 7.1, nunca cambiar).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Catalogo, IngredienteCatalogo, ProductoCatalogo } from './tipos';

const r0 = (n: number) => Math.round(n || 0);
const r1 = (n: number) => Math.round((n || 0) * 10) / 10;
const r2 = (n: number) => Math.round((n || 0) * 100) / 100;

type FilaVigencia = { id: string; valor: number; fecha_vigencia: string; created_at: string };

// Vigente a `fecha` y el "anterior" (el vigente justo antes de que empezara el
// actual, con OTRA fecha de vigencia — así varias filas el mismo día no se
// comparan entre sí).
function resolver(filas: FilaVigencia[], fecha: string): { actual: FilaVigencia | null; anterior: FilaVigencia | null } {
  const orden = filas
    .filter((f) => f.fecha_vigencia <= fecha)
    .sort((a, b) => (a.fecha_vigencia !== b.fecha_vigencia ? (a.fecha_vigencia < b.fecha_vigencia ? 1 : -1) : a.created_at < b.created_at ? 1 : -1));
  const actual = orden[0] || null;
  const anterior = actual ? orden.find((f) => f.fecha_vigencia < actual.fecha_vigencia) || null : null;
  return { actual, anterior };
}

// Datos crudos del catálogo, reutilizados por el contexto y por el simulador.
export type CatalogoBase = {
  productos: { id: string; nombre: string; categoria: string; activo: boolean }[];
  ingredientes: Map<string, { id: string; nombre: string; unidadCompra: string; unidadReceta: string; factor: number; activo: boolean; costo: number | null; costoDesde: string | null; costoAnterior: number | null; anteriorDesde: string | null }>;
  recetas: Map<string, { ingredienteId: string; cantidad: number }[]>;
  precios: Map<string, { precio: number | null; desde: string | null; anterior: number | null; anteriorDesde: string | null }>;
};

export async function cargarCatalogoBase(admin: SupabaseClient, fecha: string): Promise<CatalogoBase> {
  const [{ data: prods }, { data: ings }, { data: costos }, { data: precios }, { data: recs }] = await Promise.all([
    admin.from('productos').select('id, nombre, categoria, activo'),
    admin.from('ingredientes').select('id, nombre, unidad_compra, unidad_receta, factor_conversion, activo'),
    admin.from('ingredientes_costos').select('id, ingrediente_id, costo_por_unidad_compra, fecha_vigencia, created_at'),
    admin.from('productos_precios').select('id, producto_id, precio, fecha_vigencia, created_at'),
    admin.from('recetas').select('producto_id, ingrediente_id, cantidad'),
  ]);

  const agrupar = <T extends Record<string, any>>(rows: T[] | null, key: string, valor: string) => {
    const m = new Map<string, FilaVigencia[]>();
    for (const r of rows || []) {
      const l = m.get(r[key]) || [];
      l.push({ id: r.id, valor: Number(r[valor]), fecha_vigencia: r.fecha_vigencia, created_at: r.created_at });
      m.set(r[key], l);
    }
    return m;
  };
  const costosPorIng = agrupar(costos, 'ingrediente_id', 'costo_por_unidad_compra');
  const preciosPorProd = agrupar(precios, 'producto_id', 'precio');

  const ingredientes: CatalogoBase['ingredientes'] = new Map();
  for (const i of ings || []) {
    const { actual, anterior } = resolver(costosPorIng.get(i.id) || [], fecha);
    ingredientes.set(i.id, {
      id: i.id, nombre: i.nombre, unidadCompra: i.unidad_compra, unidadReceta: i.unidad_receta,
      factor: Number(i.factor_conversion) || 0, activo: i.activo,
      costo: actual ? actual.valor : null, costoDesde: actual ? actual.fecha_vigencia : null,
      costoAnterior: anterior ? anterior.valor : null, anteriorDesde: anterior ? anterior.fecha_vigencia : null,
    });
  }
  const recetas: CatalogoBase['recetas'] = new Map();
  for (const r of recs || []) {
    const l = recetas.get(r.producto_id) || [];
    l.push({ ingredienteId: r.ingrediente_id, cantidad: Number(r.cantidad) || 0 });
    recetas.set(r.producto_id, l);
  }
  const preciosMap: CatalogoBase['precios'] = new Map();
  for (const p of prods || []) {
    const { actual, anterior } = resolver(preciosPorProd.get(p.id) || [], fecha);
    preciosMap.set(p.id, {
      precio: actual ? actual.valor : null, desde: actual ? actual.fecha_vigencia : null,
      anterior: anterior ? anterior.valor : null, anteriorDesde: anterior ? anterior.fecha_vigencia : null,
    });
  }
  return { productos: (prods || []) as CatalogoBase['productos'], ingredientes, recetas, precios: preciosMap };
}

// Costo de receta con costos de ingredientes opcionalmente sobreescritos
// (para simular). null si falta el costo de algún ingrediente o el factor es inválido.
export function costoReceta(base: CatalogoBase, productoId: string, costoOverride?: Map<string, number>): number | null {
  const receta = base.recetas.get(productoId);
  if (!receta || receta.length === 0) return null;
  let total = 0;
  for (const r of receta) {
    const ing = base.ingredientes.get(r.ingredienteId);
    const costo = costoOverride?.get(r.ingredienteId) ?? ing?.costo ?? null;
    if (!ing || costo === null || !(ing.factor > 0)) return null;
    total += (costo / ing.factor) * r.cantidad;
  }
  return total;
}

// Ventas por producto en un rango (unidades y precio promedio cobrado), de
// importaciones activas.
export async function ventasPorProducto(
  admin: SupabaseClient,
  desde: string,
  hasta: string
): Promise<Map<string, { unidades: number; venta: number }>> {
  const { data: act } = await admin.from('importaciones').select('id').eq('estado', 'activa');
  const activas = new Set((act || []).map((i: any) => i.id));
  let rows: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await admin
      .from('pedidos_lineas')
      .select('id, producto_id, cantidad, precio_unitario_vendido, pedidos!inner(fecha, importacion_id)')
      .gte('pedidos.fecha', desde)
      .lte('pedidos.fecha', hasta)
      .order('id')
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    rows = rows.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const m = new Map<string, { unidades: number; venta: number }>();
  for (const r of rows) {
    if (!activas.has(r.pedidos?.importacion_id)) continue;
    const e = m.get(r.producto_id) || { unidades: 0, venta: 0 };
    e.unidades += Number(r.cantidad) || 0;
    e.venta += (Number(r.cantidad) || 0) * (Number(r.precio_unitario_vendido) || 0);
    m.set(r.producto_id, e);
  }
  return m;
}

// Rango de las últimas N semanas CERRADAS (desde el viernes más viejo hasta el
// jueves de la más nueva).
export async function rangoUltimasCerradas(admin: SupabaseClient, n: number): Promise<{ desde: string; hasta: string; semanas: number } | null> {
  const { data } = await admin.from('periodos').select('desde, hasta').eq('tipo', 'semana').order('desde', { ascending: false }).limit(n);
  if (!data || data.length === 0) return null;
  return { desde: data[data.length - 1].desde, hasta: data[0].hasta, semanas: data.length };
}

const SEMANAS_VENTAS = 4;

export async function construirCatalogo(admin: SupabaseClient, hoy: string): Promise<Catalogo> {
  const [base, rango] = await Promise.all([cargarCatalogoBase(admin, hoy), rangoUltimasCerradas(admin, SEMANAS_VENTAS)]);
  const ventas = rango ? await ventasPorProducto(admin, rango.desde, rango.hasta) : new Map();

  const usos = new Map<string, number>();
  for (const [pid, rec] of base.recetas) {
    const prod = base.productos.find((p) => p.id === pid);
    if (!prod?.activo) continue;
    for (const r of rec) usos.set(r.ingredienteId, (usos.get(r.ingredienteId) || 0) + 1);
  }

  const productos: ProductoCatalogo[] = base.productos
    .filter((p) => p.activo || ventas.has(p.id))
    .map((p) => {
      const pr = base.precios.get(p.id)!;
      const costo = costoReceta(base, p.id);
      const v = ventas.get(p.id);
      return {
        nombre: p.nombre,
        categoria: p.categoria,
        activo: p.activo,
        precio: pr.precio,
        precioDesde: pr.desde,
        precioAnterior: pr.anterior,
        costoReceta: costo === null ? null : r0(costo),
        margenTeorico: costo !== null && pr.precio ? r1(((pr.precio - costo) / pr.precio) * 100) : null,
        receta: (base.recetas.get(p.id) || []).map((r) => {
          const ing = base.ingredientes.get(r.ingredienteId);
          return {
            ingrediente: ing?.nombre || '?',
            cantidad: r2(r.cantidad),
            unidad: ing?.unidadReceta || '',
            costo: ing && ing.costo !== null && ing.factor > 0 ? r0((ing.costo / ing.factor) * r.cantidad) : null,
          };
        }),
        ventasUltimasSemanas: {
          unidadesPorSemana: v && rango ? r1(v.unidades / rango.semanas) : 0,
          precioPromedioCobrado: v && v.unidades > 0 ? r0(v.venta / v.unidades) : null,
        },
      };
    })
    .sort((a, b) => b.ventasUltimasSemanas.unidadesPorSemana - a.ventasUltimasSemanas.unidadesPorSemana);

  const ingredientes: IngredienteCatalogo[] = [...base.ingredientes.values()]
    .filter((i) => i.activo || usos.has(i.id))
    .map((i) => ({
      nombre: i.nombre,
      unidadCompra: i.unidadCompra,
      unidadReceta: i.unidadReceta,
      factorConversion: i.factor,
      costoUnidadCompra: i.costo,
      vigenteDesde: i.costoDesde,
      costoAnterior: i.costoAnterior,
      anteriorDesde: i.anteriorDesde,
      variacionPct: i.costo !== null && i.costoAnterior ? r1(((i.costo - i.costoAnterior) / i.costoAnterior) * 100) : null,
      costoUnidadReceta: i.costo !== null && i.factor > 0 ? r2(i.costo / i.factor) : null,
      productosQueLoUsan: usos.get(i.id) || 0,
    }))
    .sort((a, b) => b.productosQueLoUsan - a.productosQueLoUsan);

  return {
    fechaCostos: hoy,
    ventasDe: rango ? { desde: rango.desde, hasta: rango.hasta, semanas: rango.semanas } : null,
    nota:
      'Precio y costo VIGENTES HOY (teóricos, de la carta y las recetas). margenTeorico = (precio − costoReceta) / precio. ' +
      'El margen REAL de cada venta usa el costo congelado al importar y el precio efectivamente cobrado (puede diferir: descuentos, cambios de precio o de costos). ' +
      'precioPromedioCobrado y unidadesPorSemana son de las últimas semanas cerradas. costoAnterior: el costo vigente antes del actual (para ver subas). ' +
      'Para simular cambios de precio o de costo usá la herramienta simular_escenario.',
    productos,
    ingredientes,
  };
}

// ─── Simulador ──────────────────────────────────────────────────────────────

export type CambioEscenario =
  | { tipo: 'precio'; producto: string; nuevoPrecio?: number; variacionPct?: number }
  | { tipo: 'costo'; ingrediente: string; nuevoCosto?: number; variacionPct?: number };

function buscarPorNombre<T extends { nombre: string }>(lista: T[], q: string): { match: T | null; candidatos: string[] } {
  const n = (q || '').toLowerCase().trim();
  const exacto = lista.filter((x) => x.nombre.toLowerCase() === n);
  if (exacto.length === 1) return { match: exacto[0], candidatos: [] };
  const parcial = lista.filter((x) => x.nombre.toLowerCase().includes(n));
  if (parcial.length === 1) return { match: parcial[0], candidatos: [] };
  return { match: null, candidatos: (parcial.length ? parcial : lista).map((x) => x.nombre).slice(0, 40) };
}

export async function simularEscenario(admin: SupabaseClient, hoy: string, cambios: CambioEscenario[], semanasBase: number) {
  if (!Array.isArray(cambios) || cambios.length === 0) return { error: 'No se indicó ningún cambio.' };
  const n = Math.max(1, Math.min(12, Math.round(semanasBase || SEMANAS_VENTAS)));
  const [base, rango] = await Promise.all([cargarCatalogoBase(admin, hoy), rangoUltimasCerradas(admin, n)]);
  if (!rango) return { error: 'No hay semanas cerradas para tomar como base de volumen.' };
  const ventas = await ventasPorProducto(admin, rango.desde, rango.hasta);

  const ingLista = [...base.ingredientes.values()];
  const precioNuevo = new Map<string, number>();
  const costoNuevo = new Map<string, number>();
  const aplicados: string[] = [];
  for (const c of cambios) {
    if (c.tipo === 'precio') {
      const { match, candidatos } = buscarPorNombre(base.productos, c.producto);
      if (!match) return { error: `No identifiqué un único producto para "${c.producto}".`, candidatos };
      const actual = base.precios.get(match.id)?.precio;
      if (actual == null) return { error: `"${match.nombre}" no tiene precio cargado.` };
      const nuevo = c.nuevoPrecio ?? actual * (1 + (c.variacionPct ?? 0) / 100);
      precioNuevo.set(match.id, nuevo);
      aplicados.push(`Precio de ${match.nombre}: $${r0(actual)} → $${r0(nuevo)}`);
    } else if (c.tipo === 'costo') {
      const { match, candidatos } = buscarPorNombre(ingLista, c.ingrediente);
      if (!match) return { error: `No identifiqué un único ingrediente para "${c.ingrediente}".`, candidatos };
      if (match.costo === null) return { error: `"${match.nombre}" no tiene costo cargado.` };
      const nuevo = c.nuevoCosto ?? match.costo * (1 + (c.variacionPct ?? 0) / 100);
      costoNuevo.set(match.id, nuevo);
      aplicados.push(`Costo de ${match.nombre}: $${r0(match.costo)} → $${r0(nuevo)} por ${match.unidadCompra}`);
    } else {
      return { error: 'Tipo de cambio desconocido (usar "precio" o "costo").' };
    }
  }

  // Productos afectados: los que cambian de precio o usan un ingrediente que cambia.
  const afectados = base.productos.filter((p) =>
    precioNuevo.has(p.id) || (base.recetas.get(p.id) || []).some((r) => costoNuevo.has(r.ingredienteId))
  );
  let deltaSemanal = 0, beneficioAntesTotal = 0, ventasAntesTotal = 0, ventasDespuesTotal = 0;
  const sinVentas: string[] = [];
  const detalle = afectados.map((p) => {
    const precioAntes = base.precios.get(p.id)?.precio ?? null;
    const precioDespues = precioNuevo.get(p.id) ?? precioAntes;
    const costoAntes = costoReceta(base, p.id);
    const costoDespues = costoReceta(base, p.id, costoNuevo);
    const v = ventas.get(p.id);
    const uSem = v ? v.unidades / rango.semanas : 0;
    if (!v) sinVentas.push(p.nombre);
    if (precioAntes === null || precioDespues === null || costoAntes === null || costoDespues === null) {
      return { producto: p.nombre, error: 'Falta precio o costo de receta: no se puede simular este producto.' };
    }
    const mAntes = precioAntes - costoAntes;
    const mDespues = precioDespues - costoDespues;
    deltaSemanal += (mDespues - mAntes) * uSem;
    beneficioAntesTotal += mAntes * uSem;
    ventasAntesTotal += precioAntes * uSem;
    ventasDespuesTotal += precioDespues * uSem;
    const margenPctAntes = precioAntes > 0 ? (mAntes / precioAntes) * 100 : 0;
    return {
      producto: p.nombre,
      unidadesPorSemana: r1(uSem),
      precio: { antes: r0(precioAntes), despues: r0(precioDespues) },
      costoReceta: { antes: r0(costoAntes), despues: r0(costoDespues) },
      margenUnitario: { antes: r0(mAntes), despues: r0(mDespues) },
      margenPct: { antes: r1(margenPctAntes), despues: precioDespues > 0 ? r1((mDespues / precioDespues) * 100) : null },
      beneficioBrutoSemanal: { antes: r0(mAntes * uSem), despues: r0(mDespues * uSem), delta: r0((mDespues - mAntes) * uSem) },
      // Suba de precio: cuánto puede caer el volumen antes de ganar MENOS que hoy.
      caidaDeVolumenQueAnulaElCambio: mDespues > mAntes && mDespues > 0 ? `${r1((1 - mAntes / mDespues) * 100)}%` : null,
      // Suba de costo: qué precio mantiene el margen % actual.
      precioParaMantenerMargenPct: costoDespues !== costoAntes && margenPctAntes < 100 ? r0(costoDespues / (1 - margenPctAntes / 100)) : null,
    };
  });

  return {
    cambiosAplicados: aplicados,
    baseDeVolumen: `promedio de las últimas ${rango.semanas} semanas cerradas (${rango.desde} a ${rango.hasta})`,
    supuestos: [
      'Mismo volumen de ventas que el promedio de esas semanas (no modela cuánto cae o sube la demanda con el precio: eso es una hipótesis aparte).',
      'Precios y costos de la carta/recetas vigentes hoy (teóricos); no incluye descuentos ni delivery.',
      'El impacto es sobre el beneficio BRUTO (ventas − ingredientes); gastos fijos, publicidad y delivery no cambian.',
    ],
    productos: detalle,
    productosAfectadosSinVentasRecientes: sinVentas,
    totalSemanal: {
      deltaBeneficioBruto: r0(deltaSemanal),
      deltaBeneficioBrutoMensual_aprox: r0(deltaSemanal * 4.33),
      beneficioBrutoAntesDeEstosProductos: r0(beneficioAntesTotal),
      ventasAntes: r0(ventasAntesTotal),
      ventasDespues: r0(ventasDespuesTotal),
    },
  };
}
