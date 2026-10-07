'use client';

import React from 'react';

// Renderer de Markdown minimalista (sin dependencias) para la salida del
// analista: encabezados (#, ##, ###), viñetas (-, *), listas numeradas,
// **negrita** y párrafos. Suficiente para el formato que produce la IA.

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<strong key={`${keyBase}-b${i++}`} className="font-semibold text-text-primary">{m[1]}</strong>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ texto }: { texto: string }) {
  const lineas = (texto || '').split('\n');
  const bloques: React.ReactNode[] = [];
  let lista: { tipo: 'ul' | 'ol'; items: string[] } | null = null;
  let k = 0;

  const flushLista = () => {
    if (!lista) return;
    const items = lista.items.map((it, idx) => (
      <li key={`li-${k}-${idx}`} className="ml-1">{inline(it, `li-${k}-${idx}`)}</li>
    ));
    bloques.push(
      lista.tipo === 'ul'
        ? <ul key={`ul-${k++}`} className="list-disc space-y-1 pl-5 text-sm text-text-secondary">{items}</ul>
        : <ol key={`ol-${k++}`} className="list-decimal space-y-1 pl-5 text-sm text-text-secondary">{items}</ol>
    );
    lista = null;
  };

  for (const raw of lineas) {
    const l = raw.trimEnd();
    if (l.trim() === '') { flushLista(); continue; }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushLista();
      const nivel = h[1].length;
      const cls = nivel <= 1 ? 'text-base font-semibold text-text-primary mt-2'
        : nivel === 2 ? 'text-sm font-semibold text-text-primary mt-3'
        : 'text-sm font-medium text-text-secondary mt-2';
      bloques.push(<div key={`h-${k++}`} className={cls}>{inline(h[2], `h-${k}`)}</div>);
      continue;
    }
    const ul = l.match(/^\s*[-*]\s+(.*)$/);
    if (ul) { if (!lista || lista.tipo !== 'ul') { flushLista(); lista = { tipo: 'ul', items: [] }; } lista.items.push(ul[1]); continue; }
    const ol = l.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) { if (!lista || lista.tipo !== 'ol') { flushLista(); lista = { tipo: 'ol', items: [] }; } lista.items.push(ol[1]); continue; }
    flushLista();
    bloques.push(<p key={`p-${k++}`} className="text-sm text-text-secondary leading-relaxed">{inline(l, `p-${k}`)}</p>);
  }
  flushLista();

  return <div className="space-y-1.5">{bloques}</div>;
}
