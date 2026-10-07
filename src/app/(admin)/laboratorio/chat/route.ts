import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import Anthropic from '@anthropic-ai/sdk';
import {
  ANALISTA_SYSTEM,
  CHAT_SYSTEM_EXTRA,
  INFORME_INSTRUCCION,
  MODELO_INFORME,
  MODELO_CHAT,
} from '@/lib/laboratorio/prompts';

export const maxDuration = 120; // la generación del informe (Opus) puede tardar

// Streaming de texto plano. Primer turno (sin mensajes aún y sin `mensaje`) =
// INFORME con Opus. Siguientes = chat con Sonnet. El contexto va como bloque
// cacheable (prompt caching) → cada repregunta reusa el contexto barato.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new Response('No autenticado', { status: 401 });
  const { data: yo } = await supabase.from('usuarios').select('rol').eq('id', auth.user.id).single();
  if (yo?.rol !== 'admin') return new Response('No autorizado', { status: 403 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response('Falta ANTHROPIC_API_KEY', { status: 500 });
  }

  let body: { conversacionId?: string; mensaje?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Body inválido', { status: 400 });
  }
  const conversacionId = body.conversacionId;
  const mensaje = (body.mensaje || '').trim();
  if (!conversacionId) return new Response('Falta conversacionId', { status: 400 });

  const admin = createAdminClient();
  const { data: conv } = await admin
    .from('laboratorio_conversaciones')
    .select('contexto')
    .eq('id', conversacionId)
    .single();
  if (!conv) return new Response('Conversación no encontrada', { status: 404 });

  const { data: stored } = await admin
    .from('laboratorio_mensajes')
    .select('orden, rol, contenido')
    .eq('conversacion_id', conversacionId)
    .order('orden', { ascending: true });
  const storedMsgs = (stored || []) as { orden: number; rol: 'user' | 'assistant'; contenido: string }[];

  const esInforme = storedMsgs.length === 0 && !mensaje;
  if (!esInforme && !mensaje) {
    return new Response('Falta mensaje', { status: 400 });
  }

  const nextOrden = storedMsgs.length;
  let userOrden = -1;
  if (mensaje) {
    userOrden = nextOrden;
    await admin.from('laboratorio_mensajes').insert({
      conversacion_id: conversacionId, orden: userOrden, rol: 'user', contenido: mensaje,
    });
  }
  const assistantOrden = mensaje ? userOrden + 1 : nextOrden;

  // Mensajes para la API: siempre arrancan con la instrucción del informe (turno
  // user), luego el historial guardado, luego la nueva pregunta. Garantiza
  // alternancia válida user/assistant empezando por user.
  const apiMessages: Anthropic.MessageParam[] = [{ role: 'user', content: INFORME_INSTRUCCION }];
  for (const m of storedMsgs) apiMessages.push({ role: m.rol, content: m.contenido });
  if (mensaje) apiMessages.push({ role: 'user', content: mensaje });

  const model = esInforme ? MODELO_INFORME : MODELO_CHAT;
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: ANALISTA_SYSTEM + (esInforme ? '' : '\n\n' + CHAT_SYSTEM_EXTRA) },
    {
      type: 'text',
      text: 'CONTEXTO (JSON — única fuente de números, no inventar nada fuera de esto):\n' + JSON.stringify(conv.contexto),
      cache_control: { type: 'ephemeral' },
    },
  ];

  const anthropic = new Anthropic();
  const encoder = new TextEncoder();
  let full = '';

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const s = anthropic.messages.stream({ model, max_tokens: 4096, system, messages: apiMessages });
        for await (const ev of s) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            full += ev.delta.text;
            controller.enqueue(encoder.encode(ev.delta.text));
          }
        }
        if (full.trim()) {
          await admin.from('laboratorio_mensajes').insert({
            conversacion_id: conversacionId, orden: assistantOrden, rol: 'assistant', contenido: full, meta: { modelo: model },
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error desconocido';
        controller.enqueue(encoder.encode('\n\n⚠️ Error al generar la respuesta: ' + msg));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
