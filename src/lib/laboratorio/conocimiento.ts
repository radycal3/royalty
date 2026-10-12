// Conocimiento cualitativo del negocio para el Analista (tabla admin-only
// `analista_conocimiento`, migración 041): la FICHA del negocio, los EVENTOS
// del mundo real y la MEMORIA entre conversaciones (notas de Lucas o del
// propio asesor). Módulo sin 'use server': lo usan el route handler del chat
// (que ya verificó rol admin) y las server actions del Laboratorio. Siempre con
// el client service_role → el caller tiene que haber verificado admin antes.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventoNegocio } from '@/lib/analisis/tipos';

export type NotaMemoria = {
  id: string;
  fecha: string;            // YYYY-MM-DD
  texto: string;
  origen: 'lucas' | 'asesor';
};

export type EventoConId = EventoNegocio & { id: string };

const MAX_NOTA = 600;
const MAX_NOTAS_CONTEXTO = 60;

// "Hoy" en Argentina (el server de Vercel corre en UTC — ver handoff sección 3).
export function hoyArgentina(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export async function leerFicha(admin: SupabaseClient): Promise<string> {
  const { data } = await admin.from('analista_conocimiento').select('texto').eq('tipo', 'ficha').maybeSingle();
  return data?.texto || '';
}

export async function guardarFichaTexto(admin: SupabaseClient, texto: string) {
  const { data: existente } = await admin.from('analista_conocimiento').select('id').eq('tipo', 'ficha').maybeSingle();
  if (existente) {
    return admin.from('analista_conocimiento').update({ texto }).eq('id', existente.id);
  }
  return admin.from('analista_conocimiento').insert({ tipo: 'ficha', texto, origen: 'lucas' });
}

export async function leerMemoria(admin: SupabaseClient): Promise<NotaMemoria[]> {
  const { data } = await admin
    .from('analista_conocimiento')
    .select('id, fecha, texto, origen, created_at')
    .eq('tipo', 'nota')
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(MAX_NOTAS_CONTEXTO);
  return (data || []).map((n: any) => ({ id: n.id, fecha: n.fecha, texto: n.texto, origen: n.origen }));
}

export async function agregarNota(
  admin: SupabaseClient,
  texto: string,
  origen: 'lucas' | 'asesor',
  fecha?: string
): Promise<{ nota: NotaMemoria } | { error: string }> {
  const t = (texto || '').trim().slice(0, MAX_NOTA);
  if (!t) return { error: 'La nota está vacía' };
  const { data, error } = await admin
    .from('analista_conocimiento')
    .insert({ tipo: 'nota', fecha: fecha || hoyArgentina(), texto: t, origen })
    .select('id, fecha, texto, origen')
    .single();
  if (error || !data) return { error: error?.message || 'No se pudo guardar la nota' };
  return { nota: data as NotaMemoria };
}

export async function leerEventos(admin: SupabaseClient): Promise<EventoConId[]> {
  const { data } = await admin
    .from('analista_conocimiento')
    .select('id, fecha, texto')
    .eq('tipo', 'evento')
    .order('fecha', { ascending: false })
    .limit(30);
  return (data || []).map((e: any) => ({ id: e.id, fecha: e.fecha, descripcion: e.texto }));
}

export async function borrarConocimiento(admin: SupabaseClient, id: string, tipo: 'evento' | 'nota') {
  return admin.from('analista_conocimiento').delete().eq('id', id).eq('tipo', tipo);
}

// Bloque de texto que recibe el modelo en cada turno (va DESPUÉS del contexto
// cacheado: cambia cuando se edita la ficha o se anota algo en la memoria).
export function bloqueConocimiento(ficha: string, memoria: NotaMemoria[], hoy: string): string {
  const notas = memoria.length
    ? memoria.map((n) => `- [${n.fecha}${n.origen === 'asesor' ? ', anotado por vos' : ''}] ${n.texto}`).join('\n')
    : '(todavía no hay notas)';
  return [
    `HOY: ${hoy}`,
    '',
    'FICHA DEL NEGOCIO (la escribió Lucas — cómo funciona Royalty; tomala como verdad sobre el negocio):',
    ficha.trim() || '(Lucas todavía no completó la ficha)',
    '',
    'MEMORIA DE CONVERSACIONES ANTERIORES (decisiones, experimentos y aprendizajes; lo más nuevo primero):',
    notas,
  ].join('\n');
}
