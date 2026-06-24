import * as XLSX from 'xlsx';

// ─── Types ─────────────────────────────────────────────────────────────────

export type LineaParsed = {
  productoNombre: string;
  cantidad: number;
  precioUnitario: number;
  total: number;
};

export type PedidoParsed = {
  pedidoId: string;
  fecha: string;          // YYYY-MM-DD
  hora: string | null;
  cliente: string | null;
  celular: string | null;       // Normalizado: solo dígitos, sin guiones ni espacios
  celularRaw: string | null;    // Valor original de Pedix, sin tocar, para auditoría
  direccion: string | null;
  tipoEntrega: string | null;
  medioPago: string | null;
  envioCobrado: number;
  total: number;
  lineas: LineaParsed[];
};

export type ParseResult = {
  pedidos: PedidoParsed[];
  errores: string[];
};

// ─── Utilidades internas ───────────────────────────────────────────────────

/**
 * Busca una hoja por nombre, tolerante a mayúsculas/minúsculas y espacios extra.
 */
function findSheet(
  workbook: XLSX.WorkBook,
  nombreBuscado: string
): XLSX.WorkSheet | null {
  const normalizado = nombreBuscado.toLowerCase().trim();
  const sheetName = workbook.SheetNames.find(
    (name) => name.toLowerCase().trim() === normalizado
  );
  return sheetName ? workbook.Sheets[sheetName] : null;
}

/**
 * Convierte una hoja a array de arrays (raw) y busca la fila de headers
 * por contenido de sus celdas, no por posición fija.
 * Devuelve { headers, rows } donde rows son las filas de datos (sin el header).
 */
function parseSheetWithHeaders(sheet: XLSX.WorkSheet): {
  headers: string[];
  rows: any[][];
  headerRowIndex: number;
} | null {
  const raw: any[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: true,
  });

  if (raw.length === 0) return null;

  // Buscar la fila que contiene al menos 3 celdas con texto (probable header)
  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(raw.length, 15); i++) {
    const row = raw[i];
    const textCells = row.filter(
      (cell: any) => typeof cell === 'string' && cell.trim().length > 0
    );
    if (textCells.length >= 3) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) return null;

  const headers = raw[headerRowIndex].map((h: any) =>
    String(h).trim().toLowerCase()
  );
  const rows = raw.slice(headerRowIndex + 1).filter((row) =>
    // Filtrar filas completamente vacías
    row.some((cell: any) => cell !== '' && cell != null)
  );

  return { headers, rows, headerRowIndex };
}

/**
 * Busca el índice de una columna por posibles nombres de header.
 * Retorna -1 si no encuentra ninguno.
 */
function findColumn(headers: string[], posiblesNombres: string[]): number {
  for (const nombre of posiblesNombres) {
    const idx = headers.findIndex((h) => h.includes(nombre.toLowerCase()));
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Convierte una fecha de Excel (serial number o string) a YYYY-MM-DD.
 * Excel serial: días desde 1900-01-01 (con el bug de 1900 siendo bisiesto).
 * String: DD/MM/YYYY o DD-MM-YYYY.
 */
function parseDate(value: any): string | null {
  if (value == null || value === '') return null;

  // Número serial de Excel
  if (typeof value === 'number') {
    try {
      // SheetJS puede convertir serial a fecha
      const date = XLSX.SSF.parse_date_code(value);
      if (date) {
        const y = String(date.y).padStart(4, '0');
        const m = String(date.m).padStart(2, '0');
        const d = String(date.d).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    } catch {
      // Fallthrough
    }
  }

  const str = String(value).trim();

  // DD/MM/YYYY o DD-MM-YYYY
  const match = str.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (match) {
    const d = match[1].padStart(2, '0');
    const m = match[2].padStart(2, '0');
    const y = match[3];
    return `${y}-${m}-${d}`;
  }

  // YYYY-MM-DD (ya formateado)
  const matchISO = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (matchISO) {
    return `${matchISO[1]}-${matchISO[2]}-${matchISO[3]}`;
  }

  // Date object (puede venir de SheetJS con cellDates)
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

/**
 * Normaliza un valor numérico: maneja strings con coma decimal, $, espacios.
 */
function parseNumber(value: any): number {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return value;

  const str = String(value)
    .replace(/\$/g, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')  // puntos de miles
    .replace(',', '.');  // coma decimal → punto

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/**
 * Normaliza un string de hora.
 */
function parseHora(value: any): string | null {
  if (value == null || value === '') return null;

  // Si es un número (fracción del día en Excel)
  if (typeof value === 'number') {
    const totalMinutes = Math.round(value * 24 * 60);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  const str = String(value).trim();
  // HH:MM o H:MM
  const match = str.match(/(\d{1,2}):(\d{2})/);
  if (match) {
    return `${match[1].padStart(2, '0')}:${match[2]}`;
  }

  return str || null;
}

/**
 * Normaliza un número de celular: elimina todo lo que no sea dígito.
 * Ejemplos:
 *   "341-621-4667"  → "3416214667"
 *   "3 413089774"   → "3413089774"
 *   "3466-633942"   → "3466633942"
 *   ""              → null
 *   null            → null
 *
 * Devuelve null si el resultado tiene menos de 6 dígitos (probablemente
 * no es un número real), para no guardar basura como identificador.
 */
function normalizarCelular(value: any): string | null {
  if (value == null || value === '') return null;
  const str = String(value).replace(/\D/g, ''); // quita todo lo que no es dígito
  return str.length >= 6 ? str : null;
}

// ─── Parser principal ──────────────────────────────────────────────────────

export function parsePedixExcel(buffer: ArrayBuffer): ParseResult {
  const errores: string[] = [];

  // Leer workbook
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  } catch (err: any) {
    return {
      pedidos: [],
      errores: [`No se pudo leer el archivo Excel: ${err.message}`],
    };
  }

  // ── Buscar hoja "Pedidos" ──
  const hojaPedidos = findSheet(workbook, 'Pedidos');
  if (!hojaPedidos) {
    return {
      pedidos: [],
      errores: [
        `No se encontró la hoja "Pedidos". Hojas disponibles: ${workbook.SheetNames.join(', ')}`,
      ],
    };
  }

  // ── Buscar hoja "Detalle de productos" ──
  const hojaDetalle = findSheet(workbook, 'Detalle de productos');
  if (!hojaDetalle) {
    return {
      pedidos: [],
      errores: [
        `No se encontró la hoja "Detalle de productos". Hojas disponibles: ${workbook.SheetNames.join(', ')}`,
      ],
    };
  }

  // ── Parsear hoja de Pedidos ──
  const pedidosSheet = parseSheetWithHeaders(hojaPedidos);
  if (!pedidosSheet) {
    return {
      pedidos: [],
      errores: ['No se pudieron detectar headers en la hoja "Pedidos"'],
    };
  }

  const colPedidoId = findColumn(pedidosSheet.headers, [
    'nro', 'número', 'numero', 'n°', 'pedido', 'id', '#',
  ]);
  const colFecha = findColumn(pedidosSheet.headers, ['fecha']);
  const colHora = findColumn(pedidosSheet.headers, ['hora']);
  const colCliente = findColumn(pedidosSheet.headers, [
    'cliente', 'nombre', 'comprador',
  ]);
  // "Celular" es el nombre exacto confirmado en el Excel real de Pedix.
  // Se agregan variantes por si cambia en futuras exportaciones.
  const colCelular = findColumn(pedidosSheet.headers, [
    'celular', 'teléfono', 'telefono', 'tel', 'phone', 'móvil', 'movil',
  ]);
  const colDireccion = findColumn(pedidosSheet.headers, [
    'dirección', 'direccion', 'address', 'domicilio',
  ]);
  const colTipoEntrega = findColumn(pedidosSheet.headers, [
    'entrega', 'tipo', 'envío', 'envio', 'delivery', 'retiro',
  ]);
  const colMedioPago = findColumn(pedidosSheet.headers, [
    'pago', 'medio', 'forma de pago',
  ]);
  // FIX: el Excel real de Pedix usa "Cargos Envío" (plural) — el header
  // normalizado a lowercase queda "cargos envío". Las variantes en
  // singular ('cargo envío', 'costo envío', etc.) no hacían match porque
  // .includes() busca el substring exacto: "cargos envío".includes("cargo
  // envío") es false (la "s" de más rompe el match). Se agrega la forma
  // plural real, sin sacar las anteriores por si el formato varía entre
  // exportaciones de Pedix.
  const colEnvio = findColumn(pedidosSheet.headers, [
    'cargos envío', 'cargos envio',
    'costo envío', 'costo envio',
    'envío cobrado', 'envio cobrado',
    'cargo envío', 'cargo envio',
  ]);
  const colTotal = findColumn(pedidosSheet.headers, ['total']);
  const colEstado = findColumn(pedidosSheet.headers, [
    'estado', 'status',
  ]);

  // Validar columnas mínimas
  const columnasEncontradas: string[] = [];
  const columnasFaltantes: string[] = [];

  if (colPedidoId !== -1) columnasEncontradas.push('ID pedido');
  else columnasFaltantes.push('ID pedido (nro/número/pedido/id)');

  if (colFecha !== -1) columnasEncontradas.push('Fecha');
  else columnasFaltantes.push('Fecha');

  if (colTotal !== -1) columnasEncontradas.push('Total');
  else columnasFaltantes.push('Total');

  if (columnasFaltantes.length > 0) {
    return {
      pedidos: [],
      errores: [
        `Columnas faltantes en "Pedidos": ${columnasFaltantes.join(', ')}. ` +
          `Columnas encontradas: ${pedidosSheet.headers.filter((h) => h).join(', ')}`,
      ],
    };
  }

  // ── Parsear hoja de Detalle ──
  const detalleSheet = parseSheetWithHeaders(hojaDetalle);
  if (!detalleSheet) {
    return {
      pedidos: [],
      errores: [
        'No se pudieron detectar headers en la hoja "Detalle de productos"',
      ],
    };
  }

  const colDetPedidoId = findColumn(detalleSheet.headers, [
    'nro', 'número', 'numero', 'n°', 'pedido', 'id', '#',
  ]);
  const colDetProducto = findColumn(detalleSheet.headers, [
    'producto', 'ítem', 'item', 'descripción', 'descripcion', 'nombre',
  ]);
  const colDetCantidad = findColumn(detalleSheet.headers, [
    'cantidad', 'cant', 'qty', 'unidades',
  ]);
  const colDetTotal = findColumn(detalleSheet.headers, ['total']);
  // Precio unitario puede no existir; se calcula desde total/cantidad
  const colDetPrecio = findColumn(detalleSheet.headers, [
    'precio', 'precio unitario', 'p. unitario', 'unit',
  ]);

  const colsDetFaltantes: string[] = [];
  if (colDetPedidoId === -1) colsDetFaltantes.push('ID pedido');
  if (colDetProducto === -1) colsDetFaltantes.push('Producto');
  if (colDetCantidad === -1) colsDetFaltantes.push('Cantidad');
  if (colDetTotal === -1) colsDetFaltantes.push('Total');

  if (colsDetFaltantes.length > 0) {
    return {
      pedidos: [],
      errores: [
        `Columnas faltantes en "Detalle de productos": ${colsDetFaltantes.join(', ')}. ` +
          `Columnas encontradas: ${detalleSheet.headers.filter((h) => h).join(', ')}`,
      ],
    };
  }

  // ── Construir mapa de líneas por pedido ID ──
  const lineasPorPedido = new Map<string, LineaParsed[]>();

  for (const row of detalleSheet.rows) {
    const pedidoId = String(row[colDetPedidoId] ?? '').trim();
    if (!pedidoId) continue;

    // Descartar filas de resumen/totales
    const detIdLower = pedidoId.toLowerCase();
    if (
      detIdLower === 'totales' ||
      detIdLower === 'total' ||
      detIdLower === 'subtotal' ||
      detIdLower === 'resumen' ||
      detIdLower.startsWith('total ')
    ) {
      continue;
    }

    const productoNombre = String(row[colDetProducto] ?? '').trim();
    if (!productoNombre) continue;

    const cantidad = parseNumber(row[colDetCantidad]);
    const total = parseNumber(row[colDetTotal]);

    let precioUnitario: number;
    if (colDetPrecio !== -1 && row[colDetPrecio] != null && row[colDetPrecio] !== '') {
      precioUnitario = parseNumber(row[colDetPrecio]);
    } else {
      precioUnitario = cantidad > 0 ? total / cantidad : 0;
    }

    const linea: LineaParsed = {
      productoNombre,
      cantidad,
      precioUnitario,
      total,
    };

    const existing = lineasPorPedido.get(pedidoId) || [];
    existing.push(linea);
    lineasPorPedido.set(pedidoId, existing);
  }

  // ── Construir pedidos ──
  const pedidos: PedidoParsed[] = [];
  const pedidoIdsSeen = new Set<string>();

  for (const row of pedidosSheet.rows) {
    const rawId = row[colPedidoId];
    const pedidoId = String(rawId ?? '').trim();
    if (!pedidoId) continue;

    // Descartar filas de resumen/totales (no son pedidos reales)
    const idLower = pedidoId.toLowerCase();
    if (
      idLower === 'totales' ||
      idLower === 'total' ||
      idLower === 'subtotal' ||
      idLower === 'resumen' ||
      idLower.startsWith('total ')
    ) {
      continue;
    }

    // Dedup dentro del mismo archivo
    if (pedidoIdsSeen.has(pedidoId)) continue;
    pedidoIdsSeen.add(pedidoId);

    // Filtrar cancelados
    if (colEstado !== -1) {
      const estado = String(row[colEstado] ?? '').toLowerCase().trim();
      if (
        estado.includes('cancel') ||
        estado.includes('rechaz') ||
        estado.includes('anulad')
      ) {
        continue;
      }
    }

    const fecha = parseDate(row[colFecha]);
    if (!fecha) {
      errores.push(
        `Pedido ${pedidoId}: fecha no reconocida (${String(row[colFecha])})`
      );
      continue;
    }

    const lineas = lineasPorPedido.get(pedidoId) || [];
    if (lineas.length === 0) {
      errores.push(`Pedido ${pedidoId}: sin líneas de productos en "Detalle"`);
      // Igual lo incluimos con líneas vacías — el preview mostrará la advertencia
    }

    const celularRaw =
      colCelular !== -1 ? String(row[colCelular] ?? '').trim() || null : null;

    const pedido: PedidoParsed = {
      pedidoId,
      fecha,
      hora: colHora !== -1 ? parseHora(row[colHora]) : null,
      cliente: colCliente !== -1 ? String(row[colCliente] ?? '').trim() || null : null,
      celular: normalizarCelular(celularRaw),
      celularRaw,
      direccion: colDireccion !== -1 ? String(row[colDireccion] ?? '').trim() || null : null,
      tipoEntrega:
        colTipoEntrega !== -1
          ? String(row[colTipoEntrega] ?? '').trim() || null
          : null,
      medioPago:
        colMedioPago !== -1
          ? String(row[colMedioPago] ?? '').trim() || null
          : null,
      envioCobrado: colEnvio !== -1 ? parseNumber(row[colEnvio]) : 0,
      total: parseNumber(row[colTotal]),
      lineas,
    };

    pedidos.push(pedido);
  }

  // Advertencias informativas
  const lineasSinPedido = new Set<string>();
  for (const pedidoId of lineasPorPedido.keys()) {
    if (!pedidoIdsSeen.has(pedidoId)) {
      lineasSinPedido.add(pedidoId);
    }
  }
  if (lineasSinPedido.size > 0) {
    errores.push(
      `${lineasSinPedido.size} ID(s) de pedido en "Detalle" no encontrados en "Pedidos" ` +
        `(podrían ser cancelados): ${Array.from(lineasSinPedido).slice(0, 5).join(', ')}${lineasSinPedido.size > 5 ? '...' : ''}`
    );
  }

  return { pedidos, errores };
}

// ─── Hash SHA-256 del archivo ──────────────────────────────────────────────

export async function hashFile(buffer: ArrayBuffer): Promise<string> {
  // Usar Web Crypto API (disponible en browser y Node 18+)
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
