'use server';

import { createClient } from '@/lib/supabase/server';
import { construirContextoSemana } from '@/lib/reportes/contexto-semana';
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

  const hoy = new Date();
  const hoyLocalStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

  // Semanas que ya arrancaron (desde <= hoy) — una semana que todavía no
  // empezó no tiene datos que mostrar, solo ensuciaría el informe con ceros.
  const semanasRango = decomponerMesEnSemanas(desde, hasta).filter((s) => s.desde <= hoyLocalStr);
  if (semanasRango.length === 0) {
    return { error: 'El rango seleccionado todavía no tiene ninguna semana operativa (Vie-Sáb-Dom) que haya arrancado.' };
  }

  const semanas: SemanaInforme[] = await Promise.all(
    semanasRango.map(async (s) => ({
      ...s,
      enCurso: s.hasta >= hoyLocalStr,
      contexto: await construirContextoSemana(supabase, s.desde, s.hasta),
    }))
  );

  const texto = formatearInformeMensual(mesLabel, semanas);
  return { texto };
}
