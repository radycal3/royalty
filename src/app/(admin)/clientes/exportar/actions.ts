'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

async function exigirAdmin(): Promise<void> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('No autenticado');

  const { data: yo } = await supabase
    .from('usuarios')
    .select('rol')
    .eq('id', auth.user.id)
    .single();

  if (yo?.rol !== 'admin') throw new Error('No autorizado');
}

export type ClienteSegmentado = {
  celular: string;
  nombre: string | null;
  ultimaCompra: string; // YYYY-MM-DD
};

export type SegmentacionClientes = {
  activosRecientes: ClienteSegmentado[]; // 0-14 días
  enfriandose: ClienteSegmentado[]; // 15-45 días
  enRiesgo: ClienteSegmentado[]; // más de 45 días
  fechaCorte: string; // hoy, fecha local Argentina — para trazabilidad del corte
  sinFormatoValido: number; // pedidos con celular que no se pudo normalizar a +549…, excluidos de los 3 grupos
};

// Normaliza a formato internacional +549<área><número> (10 dígitos locales
// tras el "9" de celular), el que piden las herramientas de difusión de
// WhatsApp Business. Los datos reales de `pedidos.cliente_celular` (Pedix)
// vienen en formatos mezclados — se relevó una muestra real antes de
// escribir esto:
//   - 10 dígitos "3415013837"              → local sin prefijo (el caso más común, ~92%)
//   - 11 dígitos "03416353930"             → local con el "0" de discado
//   - 12 dígitos "543546539630"            → con "54" pero sin el "9" de celular
//   - 13 dígitos "5493416497064"           → ya viene completo y correcto
//   - 13 dígitos "0341153340621"           → discado local con "15" de celular intercalado
// Cualquier otro formato (muy corto, muy largo, o ambiguo — ej. un área de
// 4 dígitos con "15" intercalado, que no se puede distinguir sin una tabla
// de códigos de área) se descarta explícitamente en vez de adivinar mal.
function normalizarCelularArg(celular: string): string | null {
  let digitos = celular.replace(/\D/g, '');
  if (!digitos) return null;

  if (digitos.startsWith('0')) {
    digitos = digitos.slice(1);
    // Discado local "0<área 3 dígitos><15><número>": tras sacar el 0 quedan
    // 12 dígitos con "15" en la posición 3-4. Asume área de 3 dígitos
    // (Rosario y alrededores, el grueso de la cartera) — si el área es de
    // otra longitud esto no matchea y el número queda sin normalizar más abajo.
    if (digitos.length === 12 && digitos.slice(3, 5) === '15') {
      digitos = digitos.slice(0, 3) + digitos.slice(5);
    }
  }

  if (digitos.length === 13 && digitos.startsWith('549')) {
    return `+${digitos}`;
  }
  if (digitos.length === 12 && digitos.startsWith('54') && !digitos.startsWith('549')) {
    return `+549${digitos.slice(2)}`;
  }
  // Trae el "9" de celular pero le falta el "54" de país: "9341XXXXXXX"
  if (digitos.length === 11 && digitos.startsWith('9')) {
    return `+54${digitos}`;
  }
  if (digitos.length === 10) {
    return `+549${digitos}`;
  }

  return null;
}

// El server corre en UTC en Vercel — a diferencia del patrón cliente-side
// (new Date().getFullYear()... ya usa la hora del navegador, que es la de
// Lucas), acá hay que pedir explícitamente la fecha de Argentina o un
// pedido registrado a las 23:00 ARG quedaría "un día después" en UTC.
function hoyArgentinaLocal(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function diasEntre(fechaStr: string, hoyStr: string): number {
  const a = new Date(fechaStr + 'T12:00:00');
  const b = new Date(hoyStr + 'T12:00:00');
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export async function obtenerSegmentacionClientes(): Promise<SegmentacionClientes> {
  await exigirAdmin();

  const hoyStr = hoyArgentinaLocal();
  const admin = createAdminClient();

  const { data: impActivas, error: errorImp } = await admin
    .from('importaciones')
    .select('id')
    .eq('estado', 'activa');
  if (errorImp) throw new Error(`Error al obtener importaciones: ${errorImp.message}`);

  const impIds = (impActivas ?? []).map((i: any) => i.id as string);
  if (impIds.length === 0) {
    return { activosRecientes: [], enfriandose: [], enRiesgo: [], fechaCorte: hoyStr, sinFormatoValido: 0 };
  }

  const { data, error } = await admin
    .from('pedidos')
    .select('cliente_celular, cliente_nombre, fecha')
    .in('importacion_id', impIds)
    .not('cliente_celular', 'is', null);
  if (error) throw new Error(`Error al obtener pedidos: ${error.message}`);

  // Agrupar por celular normalizado, tomando la fecha máxima como última
  // compra (y el nombre asociado a esa compra más reciente).
  const porCelular = new Map<string, { nombre: string | null; ultimaCompra: string }>();
  const celularesSinFormato = new Set<string>();
  for (const row of data ?? []) {
    const celularRaw = row.cliente_celular as string | null;
    const fecha = row.fecha as string;
    if (!celularRaw || !fecha) continue;

    const celular = normalizarCelularArg(celularRaw);
    if (!celular) {
      celularesSinFormato.add(celularRaw);
      continue;
    }

    const existente = porCelular.get(celular);
    if (!existente || fecha > existente.ultimaCompra) {
      porCelular.set(celular, { nombre: (row.cliente_nombre as string | null) ?? null, ultimaCompra: fecha });
    }
  }

  const activosRecientes: ClienteSegmentado[] = [];
  const enfriandose: ClienteSegmentado[] = [];
  const enRiesgo: ClienteSegmentado[] = [];

  for (const [celular, info] of porCelular) {
    const dias = diasEntre(info.ultimaCompra, hoyStr);
    const cliente: ClienteSegmentado = { celular, nombre: info.nombre, ultimaCompra: info.ultimaCompra };
    if (dias <= 14) activosRecientes.push(cliente);
    else if (dias <= 45) enfriandose.push(cliente);
    else enRiesgo.push(cliente);
  }

  const masRecientePrimero = (a: ClienteSegmentado, b: ClienteSegmentado) =>
    a.ultimaCompra < b.ultimaCompra ? 1 : a.ultimaCompra > b.ultimaCompra ? -1 : 0;
  activosRecientes.sort(masRecientePrimero);
  enfriandose.sort(masRecientePrimero);
  enRiesgo.sort(masRecientePrimero);

  return { activosRecientes, enfriandose, enRiesgo, fechaCorte: hoyStr, sinFormatoValido: celularesSinFormato.size };
}
