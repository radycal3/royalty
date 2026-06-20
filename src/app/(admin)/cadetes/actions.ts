'use server';

import { createClient } from '@/lib/supabase/server';

// ─── Types ───────────────────────────────────────────────────────────────

export type CadeteActivo = {
  id: string;
  nombre: string;
};

export type ConfigCadetes = {
  cadeteBaseMinima: number;
  cadeteValorViaje: number;
  costoEmpresaCadete: number;
};

export type JornadaRegistrada = {
  id: string;
  equipoId: string;
  nombreCadete: string;
  fecha: string;
  viajesRealizados: number;
  pagoCadete: number;
  costoEmpresaCadeteUsado: number;
  cadeteBaseMinimaUsada: number;
  cadeteValorViajeUsado: number;
  observacion: string | null;
};

export type ResumenJornadas = {
  totalPagadoCadetes: number;
  totalCostoEmpresa: number;
  totalCostoDelivery: number; // totalPagadoCadetes + totalCostoEmpresa
  totalViajes: number;
  cantidadJornadas: number;
};

export type RegistroJornadaInput = {
  equipoId: string;
  viajesRealizados: number;
  observacion?: string;
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseConfigValor(valor: string | number): number {
  // La tabla configuracion guarda 'valor' como texto (confirmado por
  // inspección directa del esquema) — se castea acá, no se asume número.
  const n = typeof valor === 'number' ? valor : parseFloat(valor);
  return Number.isFinite(n) ? n : 0;
}

// ─── Configuración vigente ──────────────────────────────────────────────

export async function obtenerConfigCadetes(): Promise<ConfigCadetes> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('configuracion')
    .select('clave, valor')
    .in('clave', ['cadete_base_minima', 'cadete_valor_viaje', 'costo_empresa_cadete']);

  if (error) throw new Error(error.message);

  const map = new Map<string, string>((data || []).map((c: any) => [c.clave, c.valor]));

  const cadeteBaseMinima = map.get('cadete_base_minima');
  const cadeteValorViaje = map.get('cadete_valor_viaje');
  const costoEmpresaCadete = map.get('costo_empresa_cadete');

  if (!cadeteBaseMinima || !cadeteValorViaje || !costoEmpresaCadete) {
    throw new Error(
      'Falta configuración requerida (cadete_base_minima, cadete_valor_viaje o costo_empresa_cadete). Verificar tabla configuracion.'
    );
  }

  return {
    cadeteBaseMinima: parseConfigValor(cadeteBaseMinima),
    cadeteValorViaje: parseConfigValor(cadeteValorViaje),
    costoEmpresaCadete: parseConfigValor(costoEmpresaCadete),
  };
}

// ─── Cadetes activos ─────────────────────────────────────────────────────

export async function obtenerCadetesActivos(): Promise<CadeteActivo[]> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('equipo')
    .select('id, nombre')
    .eq('rol', 'cadete')
    .eq('activo', true)
    .order('nombre', { ascending: true });

  if (error) throw new Error(error.message);

  return (data || []).map((c: any) => ({ id: c.id, nombre: c.nombre }));
}

// ─── Registrar jornadas (carga masiva: varios cadetes, una fecha) ───────

export async function registrarJornadas(
  fecha: string,
  registros: RegistroJornadaInput[]
): Promise<{ exitosos: number; errores: { equipoId: string; mensaje: string }[] }> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const validos = registros.filter((r) => r.viajesRealizados > 0);
  if (validos.length === 0) {
    return { exitosos: 0, errores: [] };
  }

  // Config vigente leída UNA sola vez para todo el lote: todos los cadetes
  // de la misma carga (misma noche, mismo momento de registro) congelan los
  // mismos valores. Si la config cambiara a mitad de carga, cada fila
  // igual queda con un valor consistente y trazable a su propio momento.
  const config = await obtenerConfigCadetes();

  const filas = validos.map((r) => {
    const pagoCadete = Math.max(
      config.cadeteBaseMinima,
      r.viajesRealizados * config.cadeteValorViaje
    );
    return {
      equipo_id: r.equipoId,
      fecha,
      viajes_realizados: r.viajesRealizados,
      cadete_base_minima_usada: config.cadeteBaseMinima,
      cadete_valor_viaje_usado: config.cadeteValorViaje,
      costo_empresa_cadete_usado: config.costoEmpresaCadete,
      pago_cadete: pagoCadete,
      observacion: r.observacion || null,
      registrado_por: user.user.id,
    };
  });

  // Insert fila por fila (no en lote único) para poder reportar
  // individualmente qué cadete falló por UNIQUE(equipo_id, fecha) sin que
  // un solo conflicto tire abajo el resto de la carga de esa noche.
  const errores: { equipoId: string; mensaje: string }[] = [];
  let exitosos = 0;

  for (const fila of filas) {
    const { error } = await supabase.from('cadetes_jornadas').insert(fila);
    if (error) {
      const yaExiste = error.code === '23505'; // unique_violation
      errores.push({
        equipoId: fila.equipo_id,
        mensaje: yaExiste
          ? 'Ya existe una jornada cargada para este cadete en esta fecha.'
          : error.message,
      });
    } else {
      exitosos++;
    }
  }

  return { exitosos, errores };
}

// ─── Histórico de jornadas + resumen del rango ──────────────────────────

export async function obtenerJornadas(
  desde: string,
  hasta: string
): Promise<{ jornadas: JornadaRegistrada[]; resumen: ResumenJornadas }> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('cadetes_jornadas')
    .select(
      `
      id,
      equipo_id,
      fecha,
      viajes_realizados,
      pago_cadete,
      costo_empresa_cadete_usado,
      cadete_base_minima_usada,
      cadete_valor_viaje_usado,
      observacion,
      equipo ( nombre )
    `
    )
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: false });

  if (error) throw new Error(error.message);

  const jornadas: JornadaRegistrada[] = (data || []).map((j: any) => ({
    id: j.id,
    equipoId: j.equipo_id,
    nombreCadete: j.equipo?.nombre || 'Desconocido',
    fecha: j.fecha,
    viajesRealizados: j.viajes_realizados,
    pagoCadete: j.pago_cadete,
    costoEmpresaCadeteUsado: j.costo_empresa_cadete_usado,
    cadeteBaseMinimaUsada: j.cadete_base_minima_usada,
    cadeteValorViajeUsado: j.cadete_valor_viaje_usado,
    observacion: j.observacion,
  }));

  const resumen: ResumenJornadas = jornadas.reduce(
    (acc, j) => ({
      totalPagadoCadetes: acc.totalPagadoCadetes + j.pagoCadete,
      totalCostoEmpresa: acc.totalCostoEmpresa + j.costoEmpresaCadeteUsado,
      totalCostoDelivery: acc.totalCostoDelivery + j.pagoCadete + j.costoEmpresaCadeteUsado,
      totalViajes: acc.totalViajes + j.viajesRealizados,
      cantidadJornadas: acc.cantidadJornadas + 1,
    }),
    {
      totalPagadoCadetes: 0,
      totalCostoEmpresa: 0,
      totalCostoDelivery: 0,
      totalViajes: 0,
      cantidadJornadas: 0,
    }
  );

  return { jornadas, resumen };
}

// ─── Jornadas ya cargadas para una fecha específica ─────────────────────
// Usado por el formulario para no mostrar como "pendientes de cargar" a
// cadetes que ya tienen jornada registrada ese día.

export async function obtenerJornadasDeFecha(fecha: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('cadetes_jornadas')
    .select('equipo_id')
    .eq('fecha', fecha);

  if (error) throw new Error(error.message);

  return new Set((data || []).map((j: any) => j.equipo_id));
}

// ─── Editar jornada ──────────────────────────────────────────────────────
// Corrige errores de carga (fecha, viajes, observación) SIN releer
// Configuración. Recalcula únicamente pago_cadete, usando los valores que
// esa fila ya tenía congelados (cadete_base_minima_usada,
// cadete_valor_viaje_usado) — nunca los valores vigentes hoy en
// configuracion. costo_empresa_cadete_usado no se toca: no depende de
// fecha ni de viajes_realizados.

export type EditarJornadaInput = {
  id: string;
  fecha: string;
  viajesRealizados: number;
  observacion?: string;
};

export async function editarJornada(
  input: EditarJornadaInput
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  if (input.viajesRealizados <= 0) {
    return { ok: false, mensaje: 'Los viajes realizados deben ser mayor a 0.' };
  }

  // Traer los valores YA congelados de esta fila — son la base del
  // recálculo, no los de configuracion.
  const { data: actual, error: errorLectura } = await supabase
    .from('cadetes_jornadas')
    .select('cadete_base_minima_usada, cadete_valor_viaje_usado')
    .eq('id', input.id)
    .single();

  if (errorLectura || !actual) {
    return { ok: false, mensaje: 'No se encontró la jornada a editar.' };
  }

  const nuevoPago = Math.max(
    actual.cadete_base_minima_usada,
    input.viajesRealizados * actual.cadete_valor_viaje_usado
  );

  const { error } = await supabase
    .from('cadetes_jornadas')
    .update({
      fecha: input.fecha,
      viajes_realizados: input.viajesRealizados,
      pago_cadete: nuevoPago,
      observacion: input.observacion || null,
    })
    .eq('id', input.id);

  if (error) {
    const yaExiste = error.code === '23505'; // unique_violation
    return {
      ok: false,
      mensaje: yaExiste
        ? 'Ya existe una jornada para este cadete en esa fecha.'
        : error.message,
    };
  }

  return { ok: true };
}

// ─── Eliminar jornada ────────────────────────────────────────────────────

export async function eliminarJornada(
  id: string
): Promise<{ ok: true } | { ok: false; mensaje: string }> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { error } = await supabase.from('cadetes_jornadas').delete().eq('id', id);

  if (error) {
    return { ok: false, mensaje: error.message };
  }

  return { ok: true };
}
