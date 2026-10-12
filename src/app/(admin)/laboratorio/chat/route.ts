import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import Anthropic from '@anthropic-ai/sdk';
import {
  ANALISTA_SYSTEM,
  CHAT_SYSTEM_EXTRA,
  CHARLA_INSTRUCCION,
  INFORME_INSTRUCCION,
  DIAGNOSTICO_ESTRATEGICO,
  MODELO_INFORME,
  MODELO_CHAT,
  MODELO_FALLBACK,
} from '@/lib/laboratorio/prompts';
import { TOOLS, ejecutarTool } from '@/lib/laboratorio/tools';
import { bloqueConocimiento, hoyArgentina, leerFicha, leerMemoria } from '@/lib/laboratorio/conocimiento';

// Opus con herramientas puede encadenar varias rondas: margen amplio (máximo de
// Vercel Hobby con fluid compute).
export const maxDuration = 300;

const MAX_RONDAS_HERRAMIENTAS = 6;

// La API de Anthropic exige alternancia estricta user/assistant. Si un turno se
// cortó (timeout) sin guardar la respuesta, queda un mensaje 'user' huérfano en
// el historial; sin esto, el SIGUIENTE mensaje armaría [user, user] y la API
// tiraría error. Fusionamos turnos consecutivos del mismo rol (contenido texto).
// También fusiona la instrucción inicial con la primera pregunta en el modo charla.
function normalizarAlternancia(msgs: Anthropic.Beta.BetaMessageParam[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
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

const ETIQUETA_TOOL: Record<string, string> = {
  recordar: '📝 Anotando en mi memoria…',
};

// Streaming de texto plano. Primer turno sin mensaje = INFORME (o diagnóstico).
// En modo charla no hay informe: el primer turno es la pregunta de Lucas.
// Orden del prompt pensado para el caché: tools → system estable → CONTEXTO
// congelado (breakpoint de caché) → modo + ficha + memoria (cambian seguido,
// van después del breakpoint para no invalidar el contexto cacheado).
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
  const [{ data: conv }, { data: stored }, ficha, memoria] = await Promise.all([
    admin.from('laboratorio_conversaciones').select('contexto').eq('id', conversacionId).single(),
    admin
      .from('laboratorio_mensajes')
      .select('orden, rol, contenido')
      .eq('conversacion_id', conversacionId)
      .order('orden', { ascending: true }),
    leerFicha(admin),
    leerMemoria(admin),
  ]);
  if (!conv) return new Response('Conversación no encontrada', { status: 404 });
  const storedMsgs = (stored || []) as { orden: number; rol: 'user' | 'assistant'; contenido: string }[];

  const scopeTipo = (conv.contexto as { scopeTipo?: string } | null)?.scopeTipo;
  const esCharla = scopeTipo === 'charla';
  const esInforme = storedMsgs.length === 0 && !mensaje && !esCharla;
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

  // Mensajes para la API: siempre arrancan con la instrucción del modo (turno
  // user), luego el historial guardado (solo texto), luego la nueva pregunta.
  const instruccionInicial = esCharla
    ? CHARLA_INSTRUCCION
    : scopeTipo === 'negocio' ? DIAGNOSTICO_ESTRATEGICO : INFORME_INSTRUCCION;
  const apiMessagesRaw: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: instruccionInicial }];
  for (const m of storedMsgs) apiMessagesRaw.push({ role: m.rol, content: m.contenido });
  if (mensaje) apiMessagesRaw.push({ role: 'user', content: mensaje });
  const apiMessages = normalizarAlternancia(apiMessagesRaw);

  const model = esInforme ? MODELO_INFORME : MODELO_CHAT;
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: 'text', text: ANALISTA_SYSTEM },
    {
      type: 'text',
      text: 'CONTEXTO (JSON — única fuente de números, no inventar nada fuera de esto):\n' + JSON.stringify(conv.contexto),
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: [esInforme ? '' : CHAT_SYSTEM_EXTRA, bloqueConocimiento(ficha, memoria, hoyArgentina())].filter(Boolean).join('\n\n'),
    },
  ];

  const anthropic = new Anthropic();
  const encoder = new TextEncoder();
  let full = '';
  const toolsUsadas: string[] = [];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emitir = (t: string) => { full += t; controller.enqueue(encoder.encode(t)); };
      try {
        const convMessages: Anthropic.Beta.BetaMessageParam[] = [...apiMessages];
        let rondas = 0;
        while (true) {
          rondas++;
          const sinHerramientas = esInforme || rondas > MAX_RONDAS_HERRAMIENTAS;
          const s = anthropic.beta.messages.stream({
            model,
            max_tokens: esInforme ? 32000 : 16000,
            // Opus 5.5: razonamiento adaptativo siempre activo; la profundidad se
            // regula con effort (default del modelo: medium). Informe y charla
            // estratégica piensan más; las repreguntas sobre un informe, menos.
            output_config: { effort: esInforme || esCharla ? 'high' : 'medium' },
            system,
            messages: convMessages,
            // Las herramientas van SIEMPRE (mismo prefijo de caché en informe y
            // chat); en el informe (closed-book) y al agotar rondas, no se usan.
            tools: TOOLS,
            tool_choice: sinHerramientas ? { type: 'none' } : { type: 'auto' },
            betas: ['server-side-fallback-2026-06-01'],
            fallbacks: [{ model: MODELO_FALLBACK }],
          });
          for await (const ev of s) {
            if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') emitir(ev.delta.text);
          }
          const finalMsg = await s.finalMessage();

          if (finalMsg.stop_reason === 'refusal') {
            emitir('\n\n⚠️ El modelo no pudo responder esto. Probá reformular la pregunta.');
            break;
          }
          if (finalMsg.stop_reason === 'max_tokens') {
            emitir('\n\n⚠️ La respuesta se cortó por largo. Pedime que siga o que lo resuma.');
            break;
          }
          if (finalMsg.stop_reason !== 'tool_use' || sinHerramientas) break;

          // Turno con herramientas: se agrega el contenido COMPLETO de la
          // respuesta (incluye bloques de razonamiento) sin tocarlo, y todas las
          // respuestas de herramientas juntas en un solo mensaje user.
          convMessages.push({ role: 'assistant', content: finalMsg.content });
          const usos = finalMsg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
          for (const u of usos) {
            toolsUsadas.push(u.name);
            emitir(`\n\n${ETIQUETA_TOOL[u.name] || `🔎 Consultando datos (${u.name})…`}\n\n`);
          }
          const resultados = await Promise.all(
            usos.map(async (u): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
              try {
                const r = await ejecutarTool(admin, u.name, u.input);
                return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(r) };
              } catch (e) {
                return { type: 'tool_result', tool_use_id: u.id, content: e instanceof Error ? e.message : 'error', is_error: true };
              }
            })
          );
          convMessages.push({ role: 'user', content: resultados });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error desconocido';
        emitir('\n\n⚠️ Error al generar la respuesta: ' + msg);
      } finally {
        // Guardar SIEMPRE lo que se haya generado (aunque el turno se haya cortado
        // a medias): así no se pierde la respuesta parcial y el mensaje 'user' no
        // queda huérfano rompiendo el turno siguiente.
        if (full.trim()) {
          try {
            await admin.from('laboratorio_mensajes').insert({
              conversacion_id: conversacionId, orden: assistantOrden, rol: 'assistant', contenido: full,
              meta: { modelo: model, herramientas: toolsUsadas },
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
