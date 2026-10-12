'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, Plus, Archive, Trash2, BarChart3, Compass, Globe, MessageCircle, BookOpen, Brain } from 'lucide-react';
import { Button, Badge, SidePanel, Field, Input, useToast } from '@/components/ui';
import { formatARS } from '@/lib/utils/format';
import { buildRangoSemana, buildRangoMes, navegarRango, type Rango } from '@/lib/dashboard/rangos';
import Markdown from './Markdown';
import {
  iniciarConversacion,
  listarConversaciones,
  obtenerConversacion,
  archivarConversacion,
  eliminarConversacion,
  guardarComoDecision,
  obtenerConocimiento,
  guardarFicha,
  agregarNotaMemoria,
  eliminarNotaMemoria,
  agregarEvento,
  eliminarEvento,
  type ConversacionResumen,
  type ConversacionCompleta,
  type MensajeChat,
  type NotaMemoria,
  type EventoConId,
} from './analista-actions';
import type { ScopeAnalisis, RangoAnalisis, AnalisisPeriodo } from '@/lib/analisis/tipos';

type TipoScope = 'semana' | 'mes' | 'comparacion';
const aRango = (r: Rango): RangoAnalisis => ({ desde: r.desde, hasta: r.hasta, label: r.label });
const ETIQUETA_MODO: Record<string, string> = {
  semana: 'semana', mes: 'mes', comparacion: 'comparación', negocio: 'diagnóstico', charla: 'charla',
};

export default function AnalistaTab() {
  const { show, Toast } = useToast();
  const [convs, setConvs] = useState<ConversacionResumen[]>([]);
  const [activa, setActiva] = useState<ConversacionCompleta | null>(null);
  const [cargandoConv, setCargandoConv] = useState(false);

  // Selector de alcance (para nueva conversación)
  const [modo, setModo] = useState<'nuevo' | 'conversacion'>('nuevo');
  const [tipo, setTipo] = useState<TipoScope>('semana');
  const [rangoA, setRangoA] = useState<Rango>(() => buildRangoSemana());
  const [rangoB, setRangoB] = useState<Rango>(() => navegarRango(buildRangoSemana(), -1));
  const [generando, setGenerando] = useState(false);

  // Chat
  const [input, setInput] = useState('');
  const [streamText, setStreamText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Guardar decisión
  const [panelDecision, setPanelDecision] = useState<{ texto: string } | null>(null);
  const [decArea, setDecArea] = useState('');
  const [decRecom, setDecRecom] = useState('');
  const [decJust, setDecJust] = useState('');

  useEffect(() => { loadConvs(); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [activa?.mensajes.length, streamText]);

  async function loadConvs() {
    setConvs(await listarConversaciones());
  }

  function rebuildRango(t: TipoScope, cual: 'a' | 'b', offset: number | null) {
    const setter = cual === 'a' ? setRangoA : setRangoB;
    setter((prev) => {
      if (offset === null) {
        // cambio de tipo: reiniciar a base
        return t === 'mes' ? buildRangoMes(new Date().getFullYear(), new Date().getMonth()) : buildRangoSemana();
      }
      return navegarRango(prev, offset);
    });
  }

  function cambiarTipo(t: TipoScope) {
    setTipo(t);
    if (t === 'mes') setRangoA(buildRangoMes(new Date().getFullYear(), new Date().getMonth()));
    else setRangoA(buildRangoSemana());
    setRangoB(navegarRango(buildRangoSemana(), -1));
  }

  function scopeActual(): ScopeAnalisis {
    if (tipo === 'comparacion') return { tipo: 'comparacion', a: aRango(rangoA), b: aRango(rangoB) };
    return { tipo, a: aRango(rangoA) };
  }

  async function handleAnalizar(scopeOverride?: ScopeAnalisis) {
    setGenerando(true);
    const r = await iniciarConversacion(scopeOverride ?? scopeActual());
    if ('error' in r) { setGenerando(false); show(r.error, 'error'); return; }
    const conv = await obtenerConversacion(r.conversacionId);
    setGenerando(false);
    if ('error' in conv) { show(conv.error, 'error'); return; }
    setActiva(conv);
    setModo('conversacion');
    await loadConvs();
    // Generar el informe (primer turno, sin mensaje → Opus)
    await streamChat(conv.id, undefined, conv);
  }

  // Charla: arranca directo con la pregunta de Lucas (sin informe previo).
  async function handleCharla(pregunta: string) {
    const msg = pregunta.trim();
    if (!msg) return;
    setGenerando(true);
    const r = await iniciarConversacion({ tipo: 'charla', a: aRango(buildRangoSemana()) }, msg);
    if ('error' in r) { setGenerando(false); show(r.error, 'error'); return; }
    const conv = await obtenerConversacion(r.conversacionId);
    setGenerando(false);
    if ('error' in conv) { show(conv.error, 'error'); return; }
    setActiva(conv);
    setModo('conversacion');
    await loadConvs();
    await streamChat(conv.id, msg, conv);
  }

  async function abrirConversacion(id: string) {
    setCargandoConv(true);
    const conv = await obtenerConversacion(id);
    setCargandoConv(false);
    if ('error' in conv) { show(conv.error, 'error'); return; }
    setActiva(conv);
    setModo('conversacion');
    // Si no tiene ningún mensaje (informe no generado), generarlo. Una charla
    // sin mensajes espera la pregunta de Lucas.
    if (conv.mensajes.length === 0 && conv.contexto.scopeTipo !== 'charla') await streamChat(conv.id, undefined, conv);
  }

  async function streamChat(conversacionId: string, mensaje: string | undefined, convRef: ConversacionCompleta) {
    setStreaming(true);
    setStreamText('');
    // Optimista: agregar el mensaje del usuario a la UI
    if (mensaje) {
      setActiva((prev) => prev ? { ...prev, mensajes: [...prev.mensajes, { id: 'tmp-u', orden: prev.mensajes.length, rol: 'user', contenido: mensaje, createdAt: '' }] } : prev);
    }
    let acc = '';
    try {
      const res = await fetch('/laboratorio/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversacionId, mensaje }),
      });
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => '');
        throw new Error(t || `Error ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setStreamText(acc);
      }
    } catch (e) {
      show(e instanceof Error ? e.message : 'Error en el chat', 'error');
    } finally {
      setStreaming(false);
      setStreamText('');
      // Refrescar desde la base (fuente de verdad de los mensajes persistidos)
      const refreshed = await obtenerConversacion(conversacionId);
      if (!('error' in refreshed)) setActiva(refreshed);
      await loadConvs();
    }
  }

  async function enviar() {
    const msg = input.trim();
    if (!msg || !activa || streaming) return;
    setInput('');
    await streamChat(activa.id, msg, activa);
  }

  async function handleArchivar(id: string, archivada: boolean) {
    await archivarConversacion(id, !archivada);
    await loadConvs();
  }
  async function handleEliminar(id: string) {
    await eliminarConversacion(id);
    if (activa?.id === id) { setActiva(null); setModo('nuevo'); }
    await loadConvs();
  }

  function abrirGuardarDecision(texto: string) {
    setDecArea(''); setDecRecom(texto.slice(0, 280)); setDecJust('');
    setPanelDecision({ texto });
  }
  async function confirmarDecision() {
    if (!activa) return;
    const periodo = activa.scope.a;
    const r = await guardarComoDecision({
      periodoDesde: periodo.desde,
      periodoHasta: periodo.hasta,
      area: decArea.trim() || 'General',
      recomendacion: decRecom.trim(),
      justificacion: decJust.trim(),
    });
    if ('error' in r) { show(r.error, 'error'); return; }
    show('Decisión guardada — la vas a poder evaluar tras el próximo cierre');
    setPanelDecision(null);
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
      {/* ── Sidebar: conversaciones ── */}
      <aside className="space-y-2">
        <Button variant="secondary" size="sm" onClick={() => { setModo('nuevo'); setActiva(null); }} className="w-full justify-center">
          <Plus className="h-4 w-4" /> Nueva charla o análisis
        </Button>
        <div className="space-y-1">
          {convs.length === 0 && <p className="px-1 text-xs text-text-muted">Todavía no hay análisis. Creá el primero.</p>}
          {convs.map((c) => (
            <div key={c.id} className={`group flex items-center gap-1 rounded-md border px-2 py-1.5 text-left text-xs ${activa?.id === c.id ? 'border-brand-light bg-surface-alt' : 'border-border hover:bg-surface-alt'}`}>
              <button className="flex-1 truncate text-left text-text-secondary" onClick={() => abrirConversacion(c.id)} title={c.titulo}>
                <span className="block truncate font-medium text-text-primary">{c.titulo}</span>
                <span className="text-text-muted">{c.mensajes} mensaje{c.mensajes === 1 ? '' : 's'}{c.archivada ? ' · archivada' : ''}</span>
              </button>
              <button className="opacity-0 group-hover:opacity-100" title="Archivar" onClick={() => handleArchivar(c.id, c.archivada)}><Archive className="h-3.5 w-3.5 text-text-muted hover:text-text-secondary" /></button>
              <button className="opacity-0 group-hover:opacity-100" title="Eliminar" onClick={() => handleEliminar(c.id)}><Trash2 className="h-3.5 w-3.5 text-text-muted hover:text-negative" /></button>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="min-w-0">
        {modo === 'nuevo' || !activa ? (
          <SelectorAlcance
            tipo={tipo} rangoA={rangoA} rangoB={rangoB} generando={generando}
            onTipo={cambiarTipo} onNav={(cual, off) => rebuildRango(tipo, cual, off)}
            onAnalizar={() => handleAnalizar()}
            onDiagnostico={() => handleAnalizar({ tipo: 'negocio', a: aRango(buildRangoSemana()) })}
            onCharla={handleCharla}
          />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-text-primary">{activa.titulo}</h2>
              <Badge color="gray">{ETIQUETA_MODO[activa.contexto.scopeTipo] || activa.scopeTipo}</Badge>
            </div>
            <DatosDuros contexto={activa.contexto} />
            {/* Chat */}
            <div className="space-y-3">
              {activa.mensajes.map((m) => (
                <Mensaje key={m.id} m={m} onGuardar={abrirGuardarDecision} />
              ))}
              {streaming && (
                <div className="rounded-lg border border-border bg-surface p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-brand"><Sparkles className="h-3.5 w-3.5" /> Analista</div>
                  {streamText ? <Markdown texto={streamText} /> : <span className="text-sm text-text-muted">Pensando…</span>}
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            {/* Input */}
            <div className="sticky bottom-0 flex items-end gap-2 bg-surface pt-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                placeholder="Hablá con tu socio… (ej: ¿la gente vuelve a comprar? ¿muevo la publicidad a miércoles-viernes?)"
                rows={2}
                disabled={streaming}
                className="min-h-[44px] flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand-light disabled:opacity-60"
              />
              <Button onClick={enviar} disabled={streaming || !input.trim()} size="md"><Send className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </main>

      {panelDecision && (
        <SidePanel open title="Guardar como decisión" onClose={() => setPanelDecision(null)}>
          <div className="space-y-3">
            <p className="text-xs text-text-muted">Se guarda en tu loop de decisiones para evaluarla automáticamente tras el próximo cierre de semana.</p>
            <Field label="Área"><Input value={decArea} onChange={(e) => setDecArea(e.target.value)} placeholder="Ventas, Publicidad, Promos, Clientes…" /></Field>
            <Field label="Qué vas a hacer (recomendación)">
              <textarea value={decRecom} onChange={(e) => setDecRecom(e.target.value)} rows={3} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary" />
            </Field>
            <Field label="Por qué (justificación)">
              <textarea value={decJust} onChange={(e) => setDecJust(e.target.value)} rows={2} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary" placeholder="El número que lo motiva" />
            </Field>
            <Button onClick={confirmarDecision} disabled={!decRecom.trim()} className="w-full justify-center">Guardar decisión</Button>
          </div>
        </SidePanel>
      )}
      <Toast />
    </div>
  );
}

function Mensaje({ m, onGuardar }: { m: MensajeChat; onGuardar: (texto: string) => void }) {
  if (m.rol === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-brand-light px-3 py-2 text-sm text-text-primary">{m.contenido}</div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-brand"><Sparkles className="h-3.5 w-3.5" /> Analista</span>
        <button className="text-xs text-text-muted hover:text-text-secondary" onClick={() => onGuardar(m.contenido)}>+ Guardar como decisión</button>
      </div>
      <Markdown texto={m.contenido} />
    </div>
  );
}

function SelectorAlcance({ tipo, rangoA, rangoB, generando, onTipo, onNav, onAnalizar, onDiagnostico, onCharla }: {
  tipo: TipoScope; rangoA: Rango; rangoB: Rango; generando: boolean;
  onTipo: (t: TipoScope) => void; onNav: (cual: 'a' | 'b', off: number) => void; onAnalizar: () => void; onDiagnostico: () => void;
  onCharla: (pregunta: string) => void;
}) {
  const [pregunta, setPregunta] = useState('');
  const navRow = (r: Rango, cual: 'a' | 'b', etiqueta?: string) => (
    <div className="flex items-center gap-2">
      {etiqueta && <span className="w-16 text-xs text-text-muted">{etiqueta}</span>}
      <button className="rounded-md border border-border px-2 py-1 text-text-secondary hover:bg-surface-alt" onClick={() => onNav(cual, -1)}>←</button>
      <span className="flex-1 text-center text-sm font-medium text-text-primary">{r.label}</span>
      <button className="rounded-md border border-border px-2 py-1 text-text-secondary hover:bg-surface-alt" onClick={() => onNav(cual, 1)}>→</button>
    </div>
  );
  return (
    <div className="mx-auto max-w-xl space-y-4">
      {/* ── Charla con el socio: la acción principal ── */}
      <div className="space-y-3 rounded-lg border border-brand-light bg-surface p-5">
        <div className="flex items-center gap-2 text-text-primary"><MessageCircle className="h-5 w-5 text-brand" /><h2 className="text-base font-semibold">Charlá con tu socio</h2></div>
        <p className="text-sm text-text-secondary">Traé una idea, una duda o una decisión. Tu socio ya tiene todos los números del negocio (ventas, promos, clientes que vuelven y los que no, publicidad, cadetería) y lo que hablaron antes. Te dice qué apoyan los datos, qué no se puede saber y cómo probarlo.</p>
        <textarea
          value={pregunta}
          onChange={(e) => setPregunta(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && pregunta.trim() && !generando) { e.preventDefault(); onCharla(pregunta); } }}
          rows={3}
          placeholder="Ej: estoy pensando en mover el presupuesto de Meta de viernes-domingo a miércoles-viernes para llenar la comunidad de WhatsApp. ¿Qué dicen los números?"
          className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-brand-light"
        />
        <Button onClick={() => onCharla(pregunta)} disabled={generando || !pregunta.trim()} className="w-full justify-center">
          {generando ? 'Preparando los datos…' : <><Send className="h-4 w-4" /> Empezar la charla</>}
        </Button>
      </div>

      {/* ── Lo que el socio sabe del negocio ── */}
      <ConocimientoManager />

      {/* ── Diagnóstico estratégico ── */}
      <div className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center gap-2 text-text-primary"><Compass className="h-5 w-5 text-brand" /><h2 className="text-base font-semibold">Diagnóstico estratégico del negocio</h2></div>
        <p className="text-sm text-text-secondary">Un informe completo: dónde está parado el negocio, si estás construyendo clientes que vuelven, los puntos flojos estructurales (costos, promos, publicidad, cadetería) y un plan priorizado con cómo medirlo.</p>
        <Button variant="secondary" onClick={onDiagnostico} disabled={generando} className="w-full justify-center">
          {generando ? 'Analizando…' : <><Compass className="h-4 w-4" /> Diagnosticar mi negocio</>}
        </Button>
      </div>

      {/* ── Análisis de un período puntual ── */}
      <div className="space-y-4 rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center gap-2 text-text-primary"><Sparkles className="h-5 w-5 text-brand" /><h2 className="text-base font-semibold">…o analizá un período puntual</h2></div>
        <p className="text-sm text-text-secondary">Una semana, un mes, o comparar dos períodos (ventas, productos, días, promos, inversión, clientes).</p>
        <div className="flex gap-2">
          {(['semana', 'mes', 'comparacion'] as TipoScope[]).map((t) => (
            <button key={t} onClick={() => onTipo(t)} className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium capitalize ${tipo === t ? 'border-brand-light bg-brand-light text-text-primary' : 'border-border text-text-secondary hover:bg-surface-alt'}`}>
              {t === 'comparacion' ? 'Comparar' : t}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {tipo !== 'comparacion' ? navRow(rangoA, 'a') : (<>{navRow(rangoA, 'a', 'Período A')}{navRow(rangoB, 'b', 'Período B')}</>)}
        </div>
        <Button variant="secondary" onClick={onAnalizar} disabled={generando} className="w-full justify-center">
          {generando ? 'Analizando…' : <><BarChart3 className="h-4 w-4" /> Analizar período</>}
        </Button>
      </div>
    </div>
  );
}

// Lo que el socio sabe de Royalty y los números no cuentan: la FICHA del
// negocio, su MEMORIA entre charlas (notas de Lucas o del propio asesor) y los
// EVENTOS del mundo real. Tabla admin-only analista_conocimiento.
function ConocimientoManager() {
  const { show, Toast } = useToast();
  const [cargado, setCargado] = useState(false);
  const [ficha, setFicha] = useState('');
  const [fichaGuardada, setFichaGuardada] = useState('');
  const [memoria, setMemoria] = useState<NotaMemoria[]>([]);
  const [eventos, setEventos] = useState<EventoConId[]>([]);
  const [nota, setNota] = useState('');
  const [fecha, setFecha] = useState('');
  const [desc, setDesc] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    obtenerConocimiento()
      .then((c) => { setFicha(c.ficha); setFichaGuardada(c.ficha); setMemoria(c.memoria); setEventos(c.eventos); setCargado(true); })
      .catch(() => setCargado(true));
  }, []);

  async function saveFicha() {
    setGuardando(true);
    const r = await guardarFicha(ficha);
    setGuardando(false);
    if ('error' in r) { show(r.error, 'error'); return; }
    setFichaGuardada(ficha.trim());
    show('Ficha guardada — tu socio la usa desde el próximo mensaje');
  }
  async function addNota() {
    if (!nota.trim() || guardando) return;
    setGuardando(true);
    const r = await agregarNotaMemoria(nota);
    setGuardando(false);
    if ('error' in r) { show(r.error, 'error'); return; }
    setMemoria(r.memoria); setNota('');
  }
  async function delNota(id: string) {
    const r = await eliminarNotaMemoria(id);
    if ('error' in r) { show(r.error, 'error'); return; }
    setMemoria(r.memoria);
  }
  async function addEvento() {
    if (!fecha || !desc.trim() || guardando) return;
    setGuardando(true);
    const r = await agregarEvento(fecha, desc.trim());
    setGuardando(false);
    if ('error' in r) { show(r.error, 'error'); return; }
    setEventos(r.eventos); setFecha(''); setDesc('');
  }
  async function delEvento(id: string) {
    const r = await eliminarEvento(id);
    if ('error' in r) { show(r.error, 'error'); return; }
    setEventos(r.eventos);
  }

  const inputCls = 'rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted';
  return (
    <details className="rounded-lg border border-border bg-surface">
      <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-text-primary">
        <BookOpen className="mr-1.5 inline h-4 w-4 -mt-0.5 text-brand" />
        Lo que tu socio sabe de Royalty
        {cargado && <span className="ml-1 text-xs font-normal text-text-muted">· {memoria.length} nota{memoria.length === 1 ? '' : 's'} · {eventos.length} evento{eventos.length === 1 ? '' : 's'}</span>}
      </summary>
      <div className="space-y-5 border-t border-border p-5">
        {/* Ficha */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-text-primary">Ficha del negocio</h3>
          <p className="text-[11px] text-text-muted">Cómo funciona Royalty: canales, horarios y presupuesto de publicidad, cadetería, proyectos en curso, hipótesis que querés evaluar. Tu socio la lee en cada mensaje.</p>
          <textarea value={ficha} onChange={(e) => setFicha(e.target.value)} rows={10} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-text-primary" />
          <div className="flex justify-end">
            <Button size="sm" onClick={saveFicha} disabled={guardando || ficha.trim() === fichaGuardada.trim()}>Guardar ficha</Button>
          </div>
        </section>

        {/* Memoria */}
        <section className="space-y-2">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-text-primary"><Brain className="h-3.5 w-3.5 text-brand" /> Memoria</h3>
          <p className="text-[11px] text-text-muted">Decisiones, experimentos y aprendizajes que tu socio recuerda entre charlas. Él mismo anota cuando decidís algo; podés agregar o borrar.</p>
          {memoria.length > 0 && (
            <ul className="space-y-1">
              {memoria.map((n) => (
                <li key={n.id} className="flex items-start gap-2 text-xs">
                  <span className="shrink-0 font-mono text-text-muted">{n.fecha}</span>
                  <span className="flex-1 text-text-secondary">{n.texto}{n.origen === 'asesor' && <span className="ml-1 text-text-muted">(anotó tu socio)</span>}</span>
                  <button onClick={() => delNota(n.id)} title="Borrar" className="shrink-0 text-text-muted hover:text-negative"><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-2">
            <input type="text" value={nota} onChange={(ev) => setNota(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addNota(); } }} placeholder="Ej: desde el 20-oct la publicidad corre Mié-Vie hacia la comunidad" className={`flex-1 ${inputCls}`} />
            <Button size="sm" variant="secondary" onClick={addNota} disabled={!nota.trim() || guardando}><Plus className="h-3.5 w-3.5" /></Button>
          </div>
        </section>

        {/* Eventos */}
        <section className="space-y-2">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-text-primary"><Globe className="h-3.5 w-3.5 text-brand" /> Eventos del mundo real</h3>
          <p className="text-[11px] text-text-muted">Hechos fechados que los números no cuentan (ej. “WhatsApp broadcast caído”, “subí precios 8%”, “feriado largo”), para no atribuir mal las causas.</p>
          {eventos.length > 0 && (
            <ul className="space-y-1">
              {eventos.map((e) => (
                <li key={e.id} className="flex items-start gap-2 text-xs">
                  <span className="shrink-0 font-mono text-text-muted">{e.fecha}</span>
                  <span className="flex-1 text-text-secondary">{e.descripcion}</span>
                  <button onClick={() => delEvento(e.id)} title="Eliminar" className="shrink-0 text-text-muted hover:text-negative"><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-2">
            <input type="date" value={fecha} onChange={(ev) => setFecha(ev.target.value)} className={inputCls} />
            <input type="text" value={desc} onChange={(ev) => setDesc(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addEvento(); } }} placeholder="Qué pasó…" className={`flex-1 ${inputCls}`} />
            <Button size="sm" variant="secondary" onClick={addEvento} disabled={!fecha || !desc.trim() || guardando}><Plus className="h-3.5 w-3.5" /></Button>
          </div>
        </section>
      </div>
      <Toast />
    </details>
  );
}

function Stat({ label, valor, color }: { label: string; valor: string; color?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-alt p-2.5">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className={`text-sm font-semibold ${color || 'text-text-primary'}`}>{valor}</div>
    </div>
  );
}

function DatosDuros({ contexto }: { contexto: ConversacionCompleta['contexto'] }) {
  const p: AnalisisPeriodo = contexto.periodoA;
  const f = p.financiero;
  const pct = (n: number) => `${n.toFixed(1)}%`;
  // Recompra: promedio de las cohortes que ya cumplieron 30 días (sin las
  // primeras semanas "infladas" por clientes previos al sistema).
  const rc = contexto.historia?.recompra;
  const maduras = (rc?.cohortes || []).filter((c) => c.pct30d !== null && !c.inflada);
  const totNuevos = maduras.reduce((a, c) => a + c.nuevos, 0);
  const ret30 = totNuevos > 0 ? (maduras.reduce((a, c) => a + (c.volvieron30d || 0), 0) / totNuevos) * 100 : null;
  const ultSem = rc?.semanas[rc.semanas.length - 1];
  return (
    <details className="rounded-lg border border-border bg-surface" open>
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-text-secondary">
        Datos duros{contexto.scopeTipo === 'charla' || contexto.scopeTipo === 'negocio' ? ` — última semana cerrada (${p.rango.label})` : ' del período'} (calculados por el sistema)
      </summary>
      <div className="space-y-3 border-t border-border p-3">
        {rc && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Clientes únicos" valor={String(rc.clientesUnicos)} />
            <Stat label="Compraron 1 sola vez" valor={pct(rc.pctUnaSolaVez)} color={rc.pctUnaSolaVez > 70 ? 'text-negative' : undefined} />
            <Stat label="Vuelven a los 30 días" valor={ret30 === null ? '—' : pct(ret30)} />
            <Stat label="Nuevos última semana" valor={ultSem ? `${ultSem.clientesNuevos} de ${ultSem.clientesUnicos}` : '—'} />
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Stat label="Ventas" valor={formatARS(f.ventas)} />
          <Stat label="Beneficio neto" valor={formatARS(f.beneficioNeto)} color={f.beneficioNeto < 0 ? 'text-negative' : 'text-positive'} />
          <Stat label="Margen neto" valor={pct(f.margenNeto)} color={f.margenNeto < 0 ? 'text-negative' : 'text-positive'} />
          <Stat label="Pedidos" valor={String(f.pedidos)} />
          <Stat label="% repetidores" valor={pct(f.pctVentasRepetidores)} />
          <Stat label="Publicidad" valor={pct(f.publicidadPct)} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <div className="mb-1 text-[11px] font-medium text-text-muted">Top productos (venta)</div>
            <ul className="space-y-0.5 text-xs text-text-secondary">
              {p.productos.slice(0, 5).map((pr) => (<li key={pr.nombre} className="flex justify-between gap-2"><span className="truncate">{pr.nombre}</span><span className="shrink-0 text-text-muted">{formatARS(pr.venta)} · {pr.margen.toFixed(0)}%</span></li>))}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-medium text-text-muted">Por día</div>
            <ul className="space-y-0.5 text-xs text-text-secondary">
              {p.porDia.map((d) => (<li key={d.dia} className="flex justify-between gap-2"><span>{d.dia}</span><span className="text-text-muted">{formatARS(d.ventas)} · {d.pedidos} ped</span></li>))}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-medium text-text-muted">Promos vs resto</div>
            <ul className="space-y-0.5 text-xs text-text-secondary">
              <li className="flex justify-between gap-2"><span>Promos</span><span className="text-text-muted">{pct(p.promos.resumenPromo.participacionVentas)} ventas · {p.promos.resumenPromo.margen.toFixed(0)}% margen</span></li>
              <li className="flex justify-between gap-2"><span>No-promo</span><span className="text-text-muted">{pct(p.promos.resumenNoPromo.participacionVentas)} ventas · {p.promos.resumenNoPromo.margen.toFixed(0)}% margen</span></li>
              <li className="flex justify-between gap-2"><span>Repetidores</span><span className="text-text-muted">{p.afinidad.repetidores.pedidos} ped · {formatARS(p.afinidad.repetidores.ventas)}</span></li>
            </ul>
          </div>
        </div>
      </div>
    </details>
  );
}
