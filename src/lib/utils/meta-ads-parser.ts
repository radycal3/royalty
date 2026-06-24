// Parser de reportes CSV de Meta Ads Manager. CSV puro, sin dependencias
// (mismo criterio que la exportación de CSV ya usada en el dashboard) —
// evita los problemas de hidratación que tuvo SheetJS con imports dinámicos.
//
// El nombre exacto de las columnas varía según idioma de la cuenta y qué
// columnas eligió exportar el usuario, así que se busca por nombre con
// múltiples candidatos, igual que findColumn() en pedix-parser.ts.

export type MetaAdsParseResult = {
  gastoUsd: number;
  alcance: number | null;
  impresiones: number | null;
  clics: number | null;
  resultados: number | null;
  filasDetectadas: number;
};

const CANDIDATOS: Record<'gasto' | 'alcance' | 'impresiones' | 'clics' | 'resultados', string[]> = {
  gasto: ['amount spent (usd)', 'importe gastado (usd)', 'amount spent', 'importe gastado'],
  alcance: ['reach', 'alcance'],
  impresiones: ['impressions', 'impresiones'],
  clics: ['link clicks', 'clicks (all)', 'clics en el enlace', 'clics (todos)', 'clicks', 'clics'],
  resultados: ['results', 'resultados'],
};

function detectarDelimitador(headerLine: string): string {
  const comas = headerLine.split(',').length;
  const puntoYComa = headerLine.split(';').length;
  return puntoYComa > comas ? ';' : ',';
}

function parseLineaCsv(line: string, delimitador: string): string[] {
  const result: string[] = [];
  let actual = '';
  let entreComillas = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (entreComillas) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          actual += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        actual += char;
      }
    } else if (char === '"') {
      entreComillas = true;
    } else if (char === delimitador) {
      result.push(actual);
      actual = '';
    } else {
      actual += char;
    }
  }
  result.push(actual);
  return result;
}

function findColumn(headers: string[], posiblesNombres: string[]): number {
  for (const nombre of posiblesNombres) {
    const idx = headers.findIndex((h) => h === nombre || h.includes(nombre));
    if (idx !== -1) return idx;
  }
  return -1;
}

// Acepta "1.234,56", "1,234.56", "1234.56", "$ 1.234" etc.
function parseNumeroFlexible(raw: string): number {
  let s = (raw || '').trim().replace(/[^0-9.,-]/g, '');
  if (!s) return 0;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    const decimales = s.length - lastComma - 1;
    s = decimales <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot > -1) {
    const decimales = s.length - lastDot - 1;
    if (decimales > 2) s = s.replace(/\./g, '');
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function parseMetaAdsCsv(texto: string): MetaAdsParseResult {
  const lineas = texto.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lineas.length < 2) {
    throw new Error('El archivo está vacío o no tiene filas de datos.');
  }

  const delimitador = detectarDelimitador(lineas[0]);
  const headersRaw = parseLineaCsv(lineas[0], delimitador);
  const headers = headersRaw.map((h) => h.trim().toLowerCase());

  const idxGasto = findColumn(headers, CANDIDATOS.gasto);
  if (idxGasto === -1) {
    throw new Error(
      'No encontré la columna de gasto (esperaba algo como "Amount spent (USD)" o "Importe gastado (USD)"). Revisá que el CSV sea un export de Meta Ads Manager.'
    );
  }
  const idxAlcance = findColumn(headers, CANDIDATOS.alcance);
  const idxImpresiones = findColumn(headers, CANDIDATOS.impresiones);
  const idxClics = findColumn(headers, CANDIDATOS.clics);
  const idxResultados = findColumn(headers, CANDIDATOS.resultados);

  let gastoUsd = 0;
  let alcance = 0;
  let impresiones = 0;
  let clics = 0;
  let resultados = 0;
  let filasDetectadas = 0;

  for (let i = 1; i < lineas.length; i++) {
    const fila = parseLineaCsv(lineas[i], delimitador);
    if (fila.every((c) => !c.trim())) continue;

    gastoUsd += parseNumeroFlexible(fila[idxGasto]);
    if (idxAlcance !== -1) alcance += parseNumeroFlexible(fila[idxAlcance]);
    if (idxImpresiones !== -1) impresiones += parseNumeroFlexible(fila[idxImpresiones]);
    if (idxClics !== -1) clics += parseNumeroFlexible(fila[idxClics]);
    if (idxResultados !== -1) resultados += parseNumeroFlexible(fila[idxResultados]);
    filasDetectadas++;
  }

  if (filasDetectadas === 0) {
    throw new Error('No encontré filas de datos para sumar.');
  }

  return {
    gastoUsd: Math.round(gastoUsd * 100) / 100,
    alcance: idxAlcance !== -1 ? Math.round(alcance) : null,
    impresiones: idxImpresiones !== -1 ? Math.round(impresiones) : null,
    clics: idxClics !== -1 ? Math.round(clics) : null,
    resultados: idxResultados !== -1 ? Math.round(resultados) : null,
    filasDetectadas,
  };
}
