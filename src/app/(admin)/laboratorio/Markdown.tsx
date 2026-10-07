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

const esFilaTabla = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const esSeparadorTabla = (l: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(l) && l.includes('-');
const celdas = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

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

  for (let i = 0; i < lineas.length; i++) {
    const raw = lineas[i];
    const l = raw.trimEnd();
    if (l.trim() === '') { flushLista(); continue; }

    // Tabla: fila header + separador (|---|---|) + filas de datos
    if (esFilaTabla(l) && i + 1 < lineas.length && esSeparadorTabla(lineas[i + 1])) {
      flushLista();
      const header = celdas(l);
      const filas: string[][] = [];
      let j = i + 2;
      while (j < lineas.length && esFilaTabla(lineas[j]) && !esSeparadorTabla(lineas[j])) {
        filas.push(celdas(lineas[j]));
        j++;
      }
      bloques.push(
        <div key={`tbl-${k++}`} className="overflow-x-auto">
          <table className="my-1 w-full border-collapse text-xs">
            <thead>
              <tr>{header.map((c, ci) => <th key={ci} className="border border-border bg-surface-alt px-2 py-1 text-left font-medium text-text-secondary">{inline(c, `th-${k}-${ci}`)}</th>)}</tr>
            </thead>
            <tbody>
              {filas.map((f, fi) => (
                <tr key={fi}>{f.map((c, ci) => <td key={ci} className="border border-border px-2 py-1 text-text-secondary">{inline(c, `td-${k}-${fi}-${ci}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      i = j - 1;
      continue;
    }

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
