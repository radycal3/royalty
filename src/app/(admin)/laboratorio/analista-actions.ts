'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { construirAnalisisCompleto } from '@/lib/analisis/analisis-negocio';
import type { ScopeAnalisis, AnalisisCompleto, RangoAnalisis, EventoNegocio } from '@/lib/analisis/tipos';
import { MODELO_INFORME, MODELO_CHAT } from '@/lib/laboratorio/prompts';

async function exigirAdmin() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('No autenticado');
  const { data: yo } = await supabase.from('usuarios').select('rol').eq('id', auth.user.id).single();
  if (yo?.rol !== 'admin') throw new Error('No autorizado');
  return auth.user.id;
}

export type ConversacionResumen = {
  id: string;
  titulo: string;
  scopeTipo: string;
  archivada: boolean;
  createdAt: string;
  mensajes: number;
};

export type MensajeChat = {
  id: string;
  orden: number;
  rol: 'user' | 'assistant';
  contenido: string;
  createdAt: string;
};

export type ConversacionCompleta = {
  id: string;
  titulo: string;
  scopeTipo: string;
  scope: ScopeAnalisis;
  contexto: AnalisisCompleto;
  mensajes: MensajeChat[];
};

function tituloDeScope(scope: ScopeAnalisis): string {
  if (scope.tipo === 'comparacion') return `Comparación: ${scope.a.label} vs ${scope.b.label}`;
  if (scope.tipo === 'mes') return `Mes: ${scope.a.label}`;
  if (scope.tipo === 'negocio') return `Diagnóstico del negocio — ${scope.a.label}`;
  return `Semana: ${scope.a.label}`;
}

// ─── Iniciar conversación: calcula el análisis y lo congela ────────────────
export async function iniciarConversacion(
  scope: ScopeAnalisis
): Promise<{ conversacionId: string } | { error: string }> {
  const userId = await exigirAdmin();
  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: 'Falta configurar ANTHROPIC_API_KEY.' };
  }
  const admin = createAdminClient();

  // Diagnóstico estratégico: no se elige semana, se analiza "el negocio" tomando
  // como ancla la última semana CERRADA (+ la historia de las últimas ~16).
  let scopeUsado: ScopeAnalisis = scope;
  if (scope.tipo === 'negocio') {
    const { data: ult } = await admin
      .from('periodos')
      .select('desde, hasta, label')
      .eq('tipo', 'semana')
      .order('desde', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ult) scopeUsado = { tipo: 'negocio', a: { desde: ult.desde, hasta: ult.hasta, label: ult.label } };
  }

  let contexto: AnalisisCompleto;
  try {
    contexto = await construirAnalisisCompleto(admin, scopeUsado, new Date().toISOString());
  } catch (e) {
    return { error: 'Error al construir el análisis: ' + (e instanceof Error ? e.message : String(e)) };
  }

  const { data, error } = await admin
    .from('laboratorio_conversaciones')
    .insert({
      titulo: tituloDeScope(scopeUsado),
      // La columna scope_tipo tiene CHECK IN (semana, mes, comparacion); el modo
      // real ('negocio') viaja en el jsonb `scope` y en contexto.scopeTipo.
      scope_tipo: scopeUsado.tipo === 'negocio' ? 'semana' : scopeUsado.tipo,
      scope: scopeUsado,
      contexto,
      modelo_informe: MODELO_INFORME,
      modelo_chat: MODELO_CHAT,
      created_by: userId,
    })
    .select('id')
    .single();

  if (error || !data) return { error: error?.message || 'No se pudo crear la conversación' };
  return { conversacionId: data.id };
}

// ─── Listar / obtener / archivar / eliminar ────────────────────────────────

export async function listarConversaciones(): Promise<ConversacionResumen[]> {
  await exigirAdmin();
  const admin = createAdminClient();
  const { data } = await admin
    .from('laboratorio_conversaciones')
    .select('id, titulo, scope_tipo, archivada, created_at, laboratorio_mensajes(id)')
    .order('created_at', { ascending: false });
  return (data || []).map((c: any) => ({
    id: c.id,
    titulo: c.titulo,
    scopeTipo: c.scope_tipo,
    archivada: c.archivada,
    createdAt: c.created_at,
    mensajes: Array.isArray(c.laboratorio_mensajes) ? c.laboratorio_mensajes.length : 0,
  }));
}

export async function obtenerConversacion(id: string): Promise<ConversacionCompleta | { error: string }> {
  await exigirAdmin();
  const admin = createAdminClient();
  const { data: conv, error } = await admin
    .from('laboratorio_conversaciones')
    .select('id, titulo, scope_tipo, scope, contexto')
    .eq('id', id)
    .single();
  if (error || !conv) return { error: 'Conversación no encontrada' };

  const { data: msgs } = await admin
    .from('laboratorio_mensajes')
    .select('id, orden, rol, contenido, created_at')
    .eq('conversacion_id', id)
    .order('orden', { ascending: true });

  return {
    id: conv.id,
    titulo: conv.titulo,
    scopeTipo: conv.scope_tipo,
    scope: conv.scope as ScopeAnalisis,
    contexto: conv.contexto as AnalisisCompleto,
    mensajes: (msgs || []).map((m: any) => ({
      id: m.id, orden: m.orden, rol: m.rol, contenido: m.contenido, createdAt: m.created_at,
    })),
  };
}

export async function archivarConversacion(id: string, archivada: boolean) {
  await exigirAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from('laboratorio_conversaciones').update({ archivada }).eq('id', id);
  if (error) return { error: error.message };
  return { success: true };
}

export async function eliminarConversacion(id: string) {
  await exigirAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from('laboratorio_conversaciones').delete().eq('id', id);
  if (error) return { error: error.message };
  return { success: true };
}

// ─── Guardar una conclusión del chat como decisión (loop de evaluación) ─────
// Reusa la tabla decisiones_laboratorio existente para que la evaluación
// automática post-cierre siga funcionando igual.
export async function guardarComoDecision(input: {
  periodoDesde: string;
  periodoHasta: string;
  area: string;
  recomendacion: string;
  justificacion: string;
}): Promise<{ success: true } | { error: string }> {
  const userId = await exigirAdmin();
  const admin = createAdminClient();
  const { error } = await admin.from('decisiones_laboratorio').insert({
    periodo_desde: input.periodoDesde,
    periodo_hasta: input.periodoHasta,
    area: input.area,
    recomendacion: input.recomendacion,
    justificacion: input.justificacion,
    registrado_por: userId,
  });
  if (error) return { error: error.message };
  return { success: true };
}

// ─── Eventos del negocio (contexto cualitativo del mundo real) ──────────────
// Se guardan en configuracion.clave='negocio_eventos' como JSON (sin tabla
// nueva). El Analista los recibe SIEMPRE en el contexto para no atribuir mal
// las causas (ej. "WhatsApp caído desde 15-sep").

function parseEventos(valor: string | null | undefined): EventoNegocio[] {
  if (!valor) return [];
  try {
    const a = JSON.parse(valor);
    if (!Array.isArray(a)) return [];
    return a
      .filter((e: any) => e && e.fecha && e.descripcion)
      .map((e: any) => ({ fecha: String(e.fecha), descripcion: String(e.descripcion) }))
      .sort((x: EventoNegocio, y: EventoNegocio) => (x.fecha < y.fecha ? 1 : -1));
  } catch {
    return [];
  }
}

async function leerEventos(admin: ReturnType<typeof createAdminClient>): Promise<EventoNegocio[]> {
  const { data } = await admin.from('configuracion').select('valor').eq('clave', 'negocio_eventos').maybeSingle();
  return parseEventos(data?.valor);
}

async function guardarEventos(admin: ReturnType<typeof createAdminClient>, eventos: EventoNegocio[]) {
  return admin.from('configuracion').upsert(
    { clave: 'negocio_eventos', valor: JSON.stringify(eventos), descripcion: 'Eventos del mundo real para el Analista' },
    { onConflict: 'clave' }
  );
}

export async function listarEventos(): Promise<EventoNegocio[]> {
  await exigirAdmin();
  return leerEventos(createAdminClient());
}

export async function agregarEvento(fecha: string, descripcion: string): Promise<{ eventos: EventoNegocio[] } | { error: string }> {
  await exigirAdmin();
  const f = (fecha || '').trim();
  const d = (descripcion || '').trim();
  if (!f || !d) return { error: 'Faltan fecha o descripción' };
  const admin = createAdminClient();
  const arr = await leerEventos(admin);
  arr.push({ fecha: f, descripcion: d });
  const ordenado = arr.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const { error } = await guardarEventos(admin, ordenado);
  if (error) return { error: error.message };
  return { eventos: ordenado };
}

export async function eliminarEvento(fecha: string, descripcion: string): Promise<{ eventos: EventoNegocio[] } | { error: string }> {
  await exigirAdmin();
  const admin = createAdminClient();
  const arr = (await leerEventos(admin)).filter((e) => !(e.fecha === fecha && e.descripcion === descripcion));
  const { error } = await guardarEventos(admin, arr);
  if (error) return { error: error.message };
  return { eventos: arr };
}

export type { ScopeAnalisis, RangoAnalisis, EventoNegocio };
