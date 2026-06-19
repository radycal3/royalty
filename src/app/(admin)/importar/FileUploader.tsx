'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, FileSpreadsheet, AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { parsePedixExcel, hashFile } from '@/lib/utils/pedix-parser';
import type { ParseResult } from '@/lib/utils/pedix-parser';
import { verificarHash } from './actions';

type Props = {
  onParsed: (result: ParseResult, hash: string, fileName: string) => void;
};

export default function FileUploader({ onParsed }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      setError(null);
      setFileName(file.name);

      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        setError('Solo se aceptan archivos .xlsx (Excel)');
        setFileName(null);
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        setError('El archivo excede el límite de 10 MB');
        setFileName(null);
        return;
      }

      setProcessing(true);

      try {
        const buffer = await file.arrayBuffer();
        const hash = await hashFile(buffer);

        const { duplicado, importacion } = await verificarHash(hash);
        if (duplicado && importacion) {
          const fecha = new Date(importacion.created_at).toLocaleDateString('es-AR');
          setError(
            `Este archivo ya fue importado el ${fecha} como "${importacion.nombre_archivo}". ` +
              'Si necesitás reimportarlo, primero anulá la importación anterior.'
          );
          setProcessing(false);
          return;
        }

        const result = parsePedixExcel(buffer);

        if (result.errores.length > 0 && result.pedidos.length === 0) {
          setError(
            'No se pudieron extraer pedidos del archivo. Errores:\n' +
              result.errores.join('\n')
          );
          setProcessing(false);
          return;
        }

        onParsed(result, hash, file.name);
      } catch (err: any) {
        setError(err.message || 'Error al procesar el archivo');
      } finally {
        setProcessing(false);
      }
    },
    [onParsed]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      e.target.value = '';
    },
    [processFile]
  );

  return (
    <div className="space-y-4">
      <div
        className={`
          relative border-2 border-dashed rounded-lg p-12
          flex flex-col items-center justify-center gap-4
          transition-colors cursor-pointer
          ${
            dragOver
              ? 'border-warning bg-warning-bg'
              : 'border-border hover:border-text-muted bg-surface'
          }
          ${processing ? 'pointer-events-none opacity-60' : ''}
        `}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={handleChange}
        />

        {processing ? (
          <>
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-warning border-t-transparent" />
            <p className="text-text-muted text-sm">
              {fileName ? `Procesando ${fileName}...` : 'Procesando archivo...'}
            </p>
          </>
        ) : (
          <>
            <div className="rounded-full bg-surface-alt p-4">
              <Upload className="h-8 w-8 text-text-muted" />
            </div>
            <div className="text-center">
              <p className="text-text-primary font-medium">
                Arrastrá el archivo de Pedix acá
              </p>
              <p className="text-text-muted text-sm mt-1">
                o hacé clic para seleccionarlo — solo .xlsx
              </p>
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-negative-bg border border-border">
          <AlertTriangle className="h-5 w-5 text-negative mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-negative text-sm whitespace-pre-line">{error}</p>
          </div>
          <button
            onClick={() => {
              setError(null);
              setFileName(null);
            }}
            className="text-negative hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex items-start gap-3 p-4 rounded-lg bg-surface-alt border border-border">
        <FileSpreadsheet className="h-5 w-5 text-text-muted mt-0.5 shrink-0" />
        <div className="text-text-muted text-sm space-y-1">
          <p>
            El archivo debe ser el Excel exportado desde Pedix con las hojas
            "Pedidos" y "Detalle de productos".
          </p>
          <p>
            El sistema detectará automáticamente las columnas y validará el formato.
          </p>
        </div>
      </div>
    </div>
  );
}
