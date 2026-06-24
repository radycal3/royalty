'use server';

import { createClient } from '@/lib/supabase/server';

// ─── Types ───────────────────────────────────────────────────────────────

export type ConfigCadeteria = {
  cadeteBaseMinima: number;
  cadeteValorViaje: number;
  costoEmpresaCadete: number;
};

export type ConfigMeta = {
  metaNombre: string;
  metaDescripcion: string;
  metaHamburguesas: number;
};

export type ConfigAlertas = {
  alertaMargenMinimo: number;
  alertaPublicidadMaxima: number;
  margenObjetivoMinimo: number;   // límite inferior zona Objetivo del gráfico
  margenExcelenteMinimo: number;  // límite inferior zona Excelente del gráfico
};

export type ConfigProductosConsumo = {
  productoConsumoEmpleado: string | null; // id de producto
  productoConsumoCadete: string | null;
};

export type ProductoOpcion = {
  id: string;
  nombre: string;
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseNumero(valor: string | undefined): number {
  const n = valor !== undefined ? parseFloat(valor) : NaN;
  return Number.isFinite(n) ? n : 0;
}

async function leerClaves(
  supabase: any,
  claves: string[]
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('configuracion')
    .select('clave, valor')
    .in('clave', claves);

  if (error) throw new Error(error.message);

  return new Map<string, string>((data || []).map((c: any) => [c.clave, c.valor]));
}

async function actualizarClave(supabase: any, clave: string, valor: string): Promise<void> {
  const { error } = await supabase
    .from('configuracion')
    .update({ valor })
    .eq('clave', clave);

  if (error) throw new Error(`Error actualizando "${clave}": ${error.message}`);
}

// ─── Cadetería ───────────────────────────────────────────────────────────

export async function obtenerConfigCadeteria(): Promise<ConfigCadeteria> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const map = await leerClaves(supabase, [
    'cadete_base_minima',
    'cadete_valor_viaje',
    'costo_empresa_cadete',
  ]);

  return {
    cadeteBaseMinima: parseNumero(map.get('cadete_base_minima')),
    cadeteValorViaje: parseNumero(map.get('cadete_valor_viaje')),
    costoEmpresaCadete: parseNumero(map.get('costo_empresa_cadete')),
  };
}

// Guarda los 3 valores de cadetería en un solo paso. Esto SOLO actualiza
// la tabla configuracion — no toca cadetes_jornadas. Las jornadas ya
// registradas tienen sus propios valores _usada/_usado congelados en el
// momento del alta y no se ven afectadas por este cambio. Solo las
// jornadas que se carguen DESPUÉS de este guardado van a leer los nuevos
// valores (ver obtenerConfigCadetes() en cadetes/actions.ts).
export async function guardarConfigCadeteria(
  config: ConfigCadeteria
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  if (
    config.cadeteBaseMinima < 0 ||
    config.cadeteValorViaje < 0 ||
    config.costoEmpresaCadete < 0
  ) {
    return { ok: false, mensaje: 'Los valores no pueden ser negativos.' };
  }

  try {
    await actualizarClave(supabase, 'cadete_base_minima', String(config.cadeteBaseMinima));
    await actualizarClave(supabase, 'cadete_valor_viaje', String(config.cadeteValorViaje));
    await actualizarClave(supabase, 'costo_empresa_cadete', String(config.costoEmpresaCadete));
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : 'Error al guardar' };
  }
}

// ─── Meta semanal ────────────────────────────────────────────────────────

export async function obtenerConfigMeta(): Promise<ConfigMeta> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const map = await leerClaves(supabase, ['meta_nombre', 'meta_descripcion', 'meta_hamburguesas']);

  return {
    metaNombre: map.get('meta_nombre') || '',
    metaDescripcion: map.get('meta_descripcion') || '',
    metaHamburguesas: parseNumero(map.get('meta_hamburguesas')),
  };
}

export async function guardarConfigMeta(
  config: ConfigMeta
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  if (config.metaHamburguesas < 0) {
    return { ok: false, mensaje: 'La meta de hamburguesas no puede ser negativa.' };
  }
  if (!config.metaNombre.trim()) {
    return { ok: false, mensaje: 'El nombre de la meta no puede estar vacío.' };
  }

  try {
    await actualizarClave(supabase, 'meta_nombre', config.metaNombre);
    await actualizarClave(supabase, 'meta_descripcion', config.metaDescripcion);
    await actualizarClave(supabase, 'meta_hamburguesas', String(config.metaHamburguesas));
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : 'Error al guardar' };
  }
}

// ─── Alertas ─────────────────────────────────────────────────────────────

export async function obtenerConfigAlertas(): Promise<ConfigAlertas> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const map = await leerClaves(supabase, [
    'alerta_margen_minimo',
    'alerta_publicidad_maxima',
    'margen_objetivo_minimo',
    'margen_excelente_minimo',
  ]);

  return {
    alertaMargenMinimo: parseNumero(map.get('alerta_margen_minimo')),
    alertaPublicidadMaxima: parseNumero(map.get('alerta_publicidad_maxima')),
    margenObjetivoMinimo: parseNumero(map.get('margen_objetivo_minimo')) || 50,
    margenExcelenteMinimo: parseNumero(map.get('margen_excelente_minimo')) || 60,
  };
}

export async function guardarConfigAlertas(
  config: ConfigAlertas
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  if (config.alertaMargenMinimo < 0 || config.alertaMargenMinimo > 100) {
    return { ok: false, mensaje: 'El margen mínimo de alerta debe estar entre 0 y 100%.' };
  }
  if (config.alertaPublicidadMaxima < 0 || config.alertaPublicidadMaxima > 100) {
    return { ok: false, mensaje: 'La publicidad máxima debe estar entre 0 y 100%.' };
  }
  if (config.margenObjetivoMinimo <= config.alertaMargenMinimo) {
    return { ok: false, mensaje: 'El margen Objetivo debe ser mayor que el margen de Alerta.' };
  }
  if (config.margenExcelenteMinimo <= config.margenObjetivoMinimo) {
    return { ok: false, mensaje: 'El margen Excelente debe ser mayor que el margen Objetivo.' };
  }

  try {
    await actualizarClave(supabase, 'alerta_margen_minimo', String(config.alertaMargenMinimo));
    await actualizarClave(supabase, 'alerta_publicidad_maxima', String(config.alertaPublicidadMaxima));
    await actualizarClave(supabase, 'margen_objetivo_minimo', String(config.margenObjetivoMinimo));
    await actualizarClave(supabase, 'margen_excelente_minimo', String(config.margenExcelenteMinimo));
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : 'Error al guardar' };
  }
}

// ─── Productos de consumo (empleado / cadete) ───────────────────────────

export async function obtenerProductosActivos(): Promise<ProductoOpcion[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('productos')
    .select('id, nombre')
    .eq('activo', true)
    .order('nombre', { ascending: true });

  if (error) throw new Error(error.message);

  return (data || []).map((p: any) => ({ id: p.id, nombre: p.nombre }));
}

export async function obtenerConfigProductosConsumo(): Promise<ConfigProductosConsumo> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const map = await leerClaves(supabase, ['producto_consumo_empleado', 'producto_consumo_cadete']);

  return {
    productoConsumoEmpleado: map.get('producto_consumo_empleado') || null,
    productoConsumoCadete: map.get('producto_consumo_cadete') || null,
  };
}

export async function guardarConfigProductosConsumo(
  config: ConfigProductosConsumo
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  if (!config.productoConsumoEmpleado || !config.productoConsumoCadete) {
    return { ok: false, mensaje: 'Seleccioná un producto para cada tipo de consumo.' };
  }

  try {
    await actualizarClave(supabase, 'producto_consumo_empleado', config.productoConsumoEmpleado);
    await actualizarClave(supabase, 'producto_consumo_cadete', config.productoConsumoCadete);
    return { ok: true };
  } catch (err) {
    return { ok: false, mensaje: err instanceof Error ? err.message : 'Error al guardar' };
  }
}

// ─── Metas del equipo (dashboard de empleados) ─────────────────────────────
// Tabla relacional, no key-value (ver migración 028). La descripcion no
// debe incluir montos en pesos — los empleados nunca ven montos en pesos.

export type ColorMeta = 'gray' | 'green' | 'yellow' | 'red';

export type MetaEquipoConfig = {
  id: string;
  nivel: number;
  margenMinimo: number;
  descripcion: string;
  color: ColorMeta;
  activo: boolean;
};

export async function obtenerMetasEquipoConfig(): Promise<MetaEquipoConfig[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase.from('metas_equipo').select('*').order('nivel');
  if (error) throw new Error(error.message);

  return (data || []).map((m: any) => ({
    id: m.id,
    nivel: m.nivel,
    margenMinimo: m.margen_minimo,
    descripcion: m.descripcion,
    color: m.color,
    activo: m.activo,
  }));
}

export async function actualizarMetaEquipo(
  id: string,
  input: { margenMinimo: number; descripcion: string; color: ColorMeta; activo: boolean }
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  if (!input.descripcion.trim()) return { ok: false, mensaje: 'La descripción es obligatoria' };

  const { error } = await supabase
    .from('metas_equipo')
    .update({
      margen_minimo: input.margenMinimo,
      descripcion: input.descripcion.trim(),
      color: input.color,
      activo: input.activo,
    })
    .eq('id', id);

  if (error) return { ok: false, mensaje: error.message };
  return { ok: true };
}

export async function crearMetaEquipo(
  input: { nivel: number; margenMinimo: number; descripcion: string; color: ColorMeta }
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { error } = await supabase.from('metas_equipo').insert({
    nivel: input.nivel,
    margen_minimo: input.margenMinimo,
    descripcion: input.descripcion.trim(),
    color: input.color,
    activo: true,
  });

  if (error) return { ok: false, mensaje: error.message };
  return { ok: true };
}
