'use client';

import { useEffect, useState } from 'react';
import { obtenerSegmentacionClientes, type ClienteSegmentado, type SegmentacionClientes } from './actions';
import { EmptyState, useToast, Button } from '@/components/ui';

type GrupoKey = 'activosRecientes' | 'enfriandose' | 'enRiesgo';

type GrupoConfig = {
  key: GrupoKey;
  titulo: string;
  descripcion: string;
  colorClass: string;
  mensaje: string;
};

const GRUPOS: GrupoConfig[] = [
  {
    key: 'activosRecientes',
    titulo: 'Grupo 1 — Activos recientes',
    descripcion: 'Última compra hace 0–14 días',
    colorClass: 'text-positive',
    mensaje:
      '⛈️ Noche de [contexto]. Ya sabés lo que viene 🔥 Abrimos hoy a las 7:30pm — pedí antes de las 9 y te lo llevamos caliente: [link]',
  },
  {
    key: 'enfriandose',
    titulo: 'Grupo 2 — Enfriándose',
    descripcion: 'Última compra hace 15–45 días',
    colorClass: 'text-warning',
    mensaje:
      'Hace un tiempo que no te vemos… Esta noche tenemos algo especial 👑 Abrimos a las 7:30pm. Pedí antes de las 9pm: [link]',
  },
  {
    key: 'enRiesgo',
    titulo: 'Grupo 3 — En riesgo',
    descripcion: 'Última compra hace más de 45 días',
    colorClass: 'text-negative',
    mensaje:
      '¿Te acordás de Royalty Burgers? Esta noche si pedís mencionás este mensaje te regalamos las papas fritas 🍟 Abrimos hoy a las 7:30pm, solo hasta las 11pm: [link]',
  },
];

export default function ExportarClientesPage() {
  const [datos, setDatos] = useState<SegmentacionClientes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { show: showToast, Toast } = useToast();

  useEffect(() => {
    let activo = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await obtenerSegmentacionClientes();
        if (activo) setDatos(r);
      } catch (err) {
        if (activo) setError(err instanceof Error ? err.message : 'Error al cargar clientes');
      } finally {
        if (activo) setLoading(false);
      }
    })();
    return () => {
      activo = false;
    };
  }, []);

  async function copiarTelefonos(clientes: ClienteSegmentado[]) {
    const texto = clientes.map((c) => c.celular).join('\n');
    try {
      await navigator.clipboard.writeText(texto);
      showToast('Teléfonos copiados al portapapeles');
    } catch {
      showToast('No se pudo copiar al portapapeles', 'error');
    }
  }

  function descargarTelefonos(grupo: GrupoConfig, clientes: ClienteSegmentado[]) {
    const texto = clientes.map((c) => c.celular).join('\n');
    const blob = new Blob([texto], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `royalty-${grupo.key}-${datos?.fechaCorte ?? ''}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <Toast />

      <div>
        <h1 className="text-lg font-semibold text-text-primary">Exportar clientes para WhatsApp</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Segmentado por recencia de última compra{datos ? ` al ${datos.fechaCorte}` : ''}. Listo para difusiones de
          WhatsApp Business.
        </p>
        {!!datos?.sinFormatoValido && (
          <p className="mt-1 text-xs text-text-muted">
            {datos.sinFormatoValido} cliente{datos.sinFormatoValido !== 1 ? 's' : ''} con teléfono en un formato no
            reconocible quedaron excluidos (no se pudo armar un +54 confiable).
          </p>
        )}
      </div>

      {loading && <p className="text-sm text-text-secondary">Cargando clientes…</p>}

      {!loading && error && <EmptyState title="No se pudo cargar" description={error} />}

      {!loading && !error && datos && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {GRUPOS.map((grupo) => {
            const clientes = datos[grupo.key];
            return (
              <div key={grupo.key} className="space-y-3 rounded-lg border border-border bg-surface p-4">
                <div>
                  <h2 className={`text-sm font-semibold ${grupo.colorClass}`}>{grupo.titulo}</h2>
                  <p className="text-xs text-text-muted">{grupo.descripcion}</p>
                  <p className="mt-1 text-2xl font-semibold text-text-primary">{clientes.length}</p>
                  <p className="text-xs text-text-secondary">cliente{clientes.length !== 1 ? 's' : ''}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => copiarTelefonos(clientes)}
                    disabled={clientes.length === 0}
                  >
                    Copiar teléfonos
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => descargarTelefonos(grupo, clientes)}
                    disabled={clientes.length === 0}
                  >
                    Descargar .txt
                  </Button>
                </div>

                <div className="rounded-md border border-border bg-surface-alt p-3">
                  <p className="text-xs font-medium text-text-secondary">Mensaje sugerido (referencia):</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-text-primary">{grupo.mensaje}</p>
                </div>

                <div className="max-h-56 overflow-y-auto rounded-md border border-border">
                  {clientes.length === 0 ? (
                    <p className="p-3 text-xs text-text-muted">Sin clientes en este grupo.</p>
                  ) : (
                    <ul className="divide-y divide-border text-xs">
                      {clientes.map((c) => (
                        <li key={c.celular} className="px-3 py-1.5 text-text-secondary">
                          {c.celular}
                          {c.nombre ? ` — ${c.nombre}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
