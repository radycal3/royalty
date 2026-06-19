'use client';

import { useState, useEffect, useCallback, useTransition, useRef } from 'react';
import {
  Upload,
  History,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui';
import { formatDate } from '@/lib/utils/format';
import type { ParseResult } from '@/lib/utils/pedix-parser';
import type {
  ProductoConReceta,
  ResultadoImportacion,
  ImportacionHistorial,
} from './actions';
import {
  obtenerMapeos,
  obtenerProductosActivos,
  obtenerProductosConRecetas,
  importarPedidos,
  obtenerHistorial,
} from './actions';
import FileUploader from './FileUploader';
import MappingStep from './MappingStep';
import PreviewStep from './PreviewStep';
import ResultStep from './ResultStep';

type Step = 'upload' | 'mapping' | 'preview' | 'result';

const stepLabels: Record<Step, string> = {
  upload: 'Subir archivo',
  mapping: 'Mapear productos',
  preview: 'Previsualizar',
  result: 'Resultado',
};

const stepOrder: Step[] = ['upload', 'mapping', 'preview', 'result'];

export default function ImportarPage() {
  const [step, setStep] = useState<Step>('upload');
  const [isPending, startTransition] = useTransition();
  const requestIdRef = useRef(0);

  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [fileHash, setFileHash] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');

  const [mapeos, setMapeos] = useState<Record<string, string>>({});
  const [productosActivos, setProductosActivos] = useState<
    { id: string; nombre: string }[]
  >([]);
  const [productosConRecetas, setProductosConRecetas] = useState<
    Map<string, ProductoConReceta>
  >(new Map());

  const [productosSinMapeo, setProductosSinMapeo] = useState<string[]>([]);
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);
  const [historial, setHistorial] = useState<ImportacionHistorial[]>([]);
  const [loadingHistorial, setLoadingHistorial] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const id = ++requestIdRef.current;
    loadHistorial(id);
  }, []);

  async function loadHistorial(id: number) {
    try {
      const data = await obtenerHistorial();
      if (id !== requestIdRef.current) return;
      setHistorial(data);
    } catch {
    } finally {
      if (id === requestIdRef.current) setLoadingHistorial(false);
    }
  }

  const handleFileParsed = useCallback(
    async (result: ParseResult, hash: string, name: string) => {
      setParseResult(result);
      setFileHash(hash);
      setFileName(name);
      setError(null);

      try {
        const [mapeosData, productosData, productosRecetas] = await Promise.all(
          [obtenerMapeos(), obtenerProductosActivos(), obtenerProductosConRecetas()]
        );

        const mapeosMap: Record<string, string> = {};
        for (const m of mapeosData) {
          if (m.producto_id) {
            mapeosMap[m.nombre_pedix] = m.producto_id;
          }
        }

        const productosMap = new Map<string, ProductoConReceta>();
        for (const p of productosRecetas) {
          productosMap.set(p.id, p);
        }

        setMapeos(mapeosMap);
        setProductosActivos(productosData);
        setProductosConRecetas(productosMap);

        const nombresEnArchivo = new Set<string>();
        for (const p of result.pedidos) {
          for (const l of p.lineas) {
            nombresEnArchivo.add(l.productoNombre);
          }
        }

        const sinMapeo = Array.from(nombresEnArchivo).filter(
          (nombre) => !mapeosMap[nombre]
        );
        setProductosSinMapeo(sinMapeo);

        setStep(sinMapeo.length > 0 ? 'mapping' : 'preview');
      } catch (err: any) {
        setError(err.message || 'Error al cargar datos de referencia');
      }
    },
    []
  );

  const handleMapeoChange = useCallback(
    (nombre: string, productoId: string) => {
      setMapeos((prev) => ({ ...prev, [nombre]: productoId }));
    },
    []
  );

  const handleConfirmImport = useCallback(async () => {
    if (!parseResult) return;
    setImporting(true);
    setError(null);
    try {
      startTransition(async () => {
        const result = await importarPedidos({
          nombreArchivo: fileName,
          hashArchivo: fileHash,
          pedidos: parseResult.pedidos,
          mapeos,
          confirmoSinReceta: true,
        });
        setResultado(result);
        setStep('result');
        setImporting(false);
        const id = ++requestIdRef.current;
        loadHistorial(id);
      });
    } catch (err: any) {
      setError(err.message || 'Error durante la importación');
      setImporting(false);
    }
  }, [parseResult, fileName, fileHash, mapeos]);

  const handleNuevaImportacion = useCallback(() => {
    setStep('upload');
    setParseResult(null);
    setFileHash('');
    setFileName('');
    setMapeos({});
    setProductosSinMapeo([]);
    setResultado(null);
    setError(null);
  }, []);

  const currentStepIndex = stepOrder.indexOf(step);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Importar ventas</h1>
        <p className="text-text-muted text-sm mt-1">
          Subí el Excel exportado desde Pedix para registrar los pedidos.
        </p>
      </div>

      {step !== 'upload' && (
        <div className="flex items-center gap-2">
          {stepOrder.map((s, i) => {
            if (s === 'mapping' && productosSinMapeo.length === 0) return null;
            const isActive = s === step;
            const isDone = i < currentStepIndex;
            return (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && <div className="w-8 h-px bg-border" />}
                <span
                  className={`text-xs font-medium px-3 py-1 rounded-full ${
                    isActive
                      ? 'bg-brand-light text-text-primary'
                      : isDone
                        ? 'bg-positive-bg text-positive'
                        : 'bg-surface-alt text-text-muted'
                  }`}
                >
                  {stepLabels[s]}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-negative-bg border border-border">
          <p className="text-negative text-sm">{error}</p>
        </div>
      )}

      {step === 'upload' && <FileUploader onParsed={handleFileParsed} />}

      {step === 'mapping' && (
        <MappingStep
          productosSinMapeo={productosSinMapeo}
          productosDisponibles={productosActivos}
          mapeos={mapeos}
          onMapeoChange={handleMapeoChange}
          onComplete={() => setStep('preview')}
          onBack={handleNuevaImportacion}
        />
      )}

      {step === 'preview' && parseResult && (
        <PreviewStep
          parseResult={parseResult}
          mapeos={mapeos}
          productosMap={productosConRecetas}
          onConfirm={handleConfirmImport}
          onBack={() => {
            if (productosSinMapeo.length > 0) setStep('mapping');
            else handleNuevaImportacion();
          }}
          importing={importing}
        />
      )}

      {step === 'result' && resultado && (
        <ResultStep resultado={resultado} onNuevaImportacion={handleNuevaImportacion} />
      )}

      <div className="border-t border-border pt-8">
        <div className="flex items-center gap-2 mb-4">
          <History className="h-5 w-5 text-text-muted" />
          <h2 className="text-lg font-semibold text-text-primary">
            Historial de importaciones
          </h2>
        </div>

        {loadingHistorial ? (
          <div className="text-text-muted text-sm py-4">Cargando historial...</div>
        ) : historial.length === 0 ? (
          <div className="text-text-muted text-sm py-4">No hay importaciones registradas.</div>
        ) : (
          <div className="space-y-2">
            {historial.map((imp) => (
              <div
                key={imp.id}
                className="flex items-center justify-between p-3 rounded-lg bg-surface-alt border border-border"
              >
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="h-4 w-4 text-text-muted" />
                  <div>
                    <p className="text-sm text-text-primary">{imp.nombre_archivo}</p>
                    <p className="text-xs text-text-muted">
                     {formatDate(imp.created_at.split('T')[0])} — {imp.pedidos_count}{' '}
                      {imp.pedidos_count === 1 ? 'pedido' : 'pedidos'}
                    </p>
                  </div>
                </div>
                <Badge color={imp.estado === 'activa' ? 'green' : 'red'}>
                  {imp.estado === 'activa' ? 'Activa' : 'Anulada'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
