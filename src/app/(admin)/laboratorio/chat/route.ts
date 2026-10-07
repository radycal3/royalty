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
import { TOOLS, ejecutarTool } from '@/lib/laboratorio/tools';

export const maxDuration = 120; // la generación del informe (Opus) puede tardar

// La API de Anthropic exige alternancia estricta user/assistant. Si un turno se
// cortó (timeout) sin guardar la respuesta, queda un mensaje 'user' huérfano en
// el historial; sin esto, el SIGUIENTE mensaje armaría [user, user] y la API
// tiraría error. Fusionamos turnos consecutivos del mismo rol (contenido texto).
function normalizarAlternancia(msgs: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of msgs) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role && typeof prev.content === 'string' && typeof m.content === 'string') {
      prev.content = `${prev.content}\n\n${m.content}`;
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

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
  const apiMessagesRaw: Anthropic.MessageParam[] = [{ role: 'user', content: INFORME_INSTRUCCION }];
  for (const m of storedMsgs) apiMessagesRaw.push({ role: m.rol, content: m.contenido });
  if (mensaje) apiMessagesRaw.push({ role: 'user', content: mensaje });
  const apiMessages = normalizarAlternancia(apiMessagesRaw);

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
        const convMessages: Anthropic.MessageParam[] = [...apiMessages];
        let rondas = 0;
        while (true) {
          rondas++;
          const s = anthropic.messages.stream({
            model,
            max_tokens: esInforme ? 8192 : 4096,
            system,
            messages: convMessages,
            // Herramientas de drill-down solo en el chat (el informe es closed-book
            // sobre el contexto completo). Tope de rondas para no ciclar.
            ...(esInforme ? {} : { tools: TOOLS }),
          });
          for await (const ev of s) {
            if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
              full += ev.delta.text;
              controller.enqueue(encoder.encode(ev.delta.text));
            }
          }
          const finalMsg = await s.finalMessage();
          if (finalMsg.stop_reason === 'tool_use' && rondas <= 5) {
            convMessages.push({ role: 'assistant', content: finalMsg.content });
            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const block of finalMsg.content) {
              if (block.type !== 'tool_use') continue;
              controller.enqueue(encoder.encode(`\n\n🔎 Consultando datos (${block.name})…\n\n`));
              let resultado: unknown;
              try {
                resultado = await ejecutarTool(admin, block.name, block.input);
              } catch (e) {
                resultado = { error: e instanceof Error ? e.message : 'error' };
              }
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultado) });
            }
            convMessages.push({ role: 'user', content: toolResults });
            continue;
          }
          break;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error desconocido';
        controller.enqueue(encoder.encode('\n\n⚠️ Error al generar la respuesta: ' + msg));
      } finally {
        // Guardar SIEMPRE lo que se haya generado (aunque el turno se haya cortado
        // a medias): así no se pierde la respuesta parcial y el mensaje 'user' no
        // queda huérfano rompiendo el turno siguiente.
        if (full.trim()) {
          try {
            await admin.from('laboratorio_mensajes').insert({
              conversacion_id: conversacionId, orden: assistantOrden, rol: 'assistant', contenido: full, meta: { modelo: model },
            });
          } catch { /* best-effort: si falla el guardado, igual cerramos el stream */ }
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
