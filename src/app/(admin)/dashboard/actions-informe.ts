'use server';

import { createClient } from '@/lib/supabase/server';
import { construirContextoSemana } from '@/lib/reportes/contexto-semana';
import { obtenerSaludClientes } from '@/app/(admin)/dashboard/actions';
import { decomponerMesEnSemanas, formatearInformeMensual, type SemanaInforme } from '@/lib/reportes/informe-mensual';

// Genera el informe de un mes dividido por semana operativa (Vie-Sáb-Dom),
// listo para copiar/descargar y pegar en un chat con la IA. Un solo botón,
// sin nada nuevo que guardar en base — reusa exactamente el mismo contexto
// que ya recibe el Laboratorio por semana (ver src/lib/reportes).
export async function generarInformeMensual(
  desde: string,
  hasta: string,
  mesLabel: string
): Promise<{ texto: string } | { error: string }> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');
  // El informe arma un reporte financiero completo (pesos). Verificar rol admin.
  const { data: yo } = await supabase
    .from('usuarios')
    .select('rol')
    .eq('id', user.user.id)
    .single();
  if (yo?.rol !== 'admin') return { error: 'No autorizado' };

  // "hoy" en hora de Argentina (server-side corre en UTC en Vercel; con
  // getters locales un informe generado de noche tomaría mal el borde de mes).
  const hoyLocalStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  // Semanas que ya arrancaron (desde <= hoy) — una semana que todavía no
  // empezó no tiene datos que mostrar, solo ensuciaría el informe con ceros.
  const semanasRango = decomponerMesEnSemanas(desde, hasta).filter((s) => s.desde <= hoyLocalStr);
  if (semanasRango.length === 0) {
    return { error: 'El rango seleccionado todavía no tiene ninguna semana operativa (Vie-Sáb-Dom) que haya arrancado.' };
  }

  // La salud de clientes es "estado actual", igual para todas las semanas del
  // mes → se calcula UNA vez y se reusa, en vez de repetir la RPC por semana.
  const salud = await obtenerSaludClientes();

  const semanas: SemanaInforme[] = await Promise.all(
    semanasRango.map(async (s) => ({
      ...s,
      enCurso: s.hasta >= hoyLocalStr,
      contexto: await construirContextoSemana(supabase, s.desde, s.hasta, salud),
    }))
  );

  const texto = formatearInformeMensual(mesLabel, semanas);
  return { texto };
}
