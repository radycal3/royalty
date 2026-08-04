# ROYALTY — Handoff Técnico Completo v10
## Fecha: 4 de agosto de 2026

Sos el nuevo Claude (o Claude Code) que continúa el desarrollo de ROYALTY, el sistema de gestión de Royalty Burgers (Rosario, Argentina). Este documento es la fuente de verdad del proyecto y **reemplaza a ROYALTY_Handoff_v9.md** (eliminado). No tenés acceso al chat anterior — toda la información que necesitás está acá.

---

## 1. CONTEXTO DEL PROYECTO

**Negocio:** Royalty Burgers. Hamburguesería que opera viernes, sábado y domingo. El "período operativo" es Vie-Sáb-Dom.

**Usuario principal:** Lucas (dueño). Técnicamente competente. No acepta código provisional. Espera que cada decisión de arquitectura financiera se consulte antes de implementar. Prefiere entender el "por qué" antes del "cómo". Tiene plan Pro de Claude.

**Stack:** Next.js 15 (App Router), React 19, TypeScript strict, Tailwind v4, Supabase (PostgreSQL + Auth + RLS), Vercel. Sin ORMs ni state managers. Server Actions en `actions.ts` con `'use server'`. `@anthropic-ai/sdk` + `zod` para el módulo de IA (Laboratorio).

**Objetivo del sistema:** Medir ventas, costos, beneficio y margen semana a semana, con datos financieramente auditables e inmutables hacia el pasado. Responde: ¿qué pasó?, ¿por qué pasó?, ¿qué tan saludable está el negocio?, ¿estoy construyendo una base de clientes fieles?, ¿el equipo está alineado con el objetivo de margen?, ¿hay merma de stock?, ¿qué debería hacer distinto la semana que viene, y funcionó lo que decidí la vez pasada?, ¿qué conjunto de anuncios de Meta Ads debería escalar o pausar esta semana según el tipo de audiencia?, y ahora también: ¿a qué clientes le hablo esta semana por WhatsApp según cuánto hace que no compran, y cómo le planteo a una IA externa la realidad completa de un mes para debatir cómo mejorar los resultados?

**Estado del deploy: ✅ COMPLETO.**
- Repo privado en GitHub: `https://github.com/radycal3/royalty`.
- Vercel conectado al repo, auto-deploy en cada push a `main`.
- Dominio `royaltyburgers.club` (comprado en Porkbun) conectado y con SSL activo. El apex redirige (308) a `www.royaltyburgers.club`, que es el dominio canónico.
- Variables de entorno en Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`.
- Supabase Auth → Site URL y Redirect URLs apuntan a `https://www.royaltyburgers.club` (manteniendo `http://localhost:3000/**` para desarrollo local).
- Identidad de Git de Lucas ya configurada globalmente (`user.name "Lucas Alaniz"`, `user.email "bsediciones@gmail.com"`).
- **Push a GitHub desde Claude Code (NUEVO esta sesión):** `gh` CLI instalado (`brew install gh`) y autenticado como `radycal3` (`gh auth login`, vía navegador, dispositivo — lo hizo Lucas, Claude nunca vio el token). Luego `gh auth setup-git` engancha `gh` como credential helper de git. Con esto, `git push origin main` funciona directo desde Claude Code sin pedirle nada a Lucas — esto persiste entre sesiones (no hace falta repetirlo). Si en el futuro `git push` falla con "could not read Username" o "Invalid username or token", correr `gh auth status` para diagnosticar antes de asumir que hay que rehacer el login.

---

## 2. FILOSOFÍA Y PRINCIPIOS ARQUITECTÓNICOS (INAMOVIBLES)

Estas decisiones fueron aprobadas explícitamente y no se revierten sin consulta.

### 2.1 Congelación histórica
Todo valor monetario se calcula **una sola vez** al momento de registrar y se guarda como número fijo. Los cambios posteriores en recetas, costos, configuración o fórmulas **NO alteran registros pasados**. Aplica a:
- `pedidos_lineas.costo_unitario_calculado` — congelado al importar
- `pedidos_lineas.precio_unitario_vendido` — congelado al importar
- `cadetes_jornadas.*_usado` — los 3 valores de configuración congelados al cargar el cierre
- `periodos.*` — snapshot completo congelado al cerrar la semana manualmente
- `periodos_productos.*` / `periodos_gastos.*` — detalle congelado con el cierre
- `metricas_faltantes_detalle.producto_nombre` y `.precio_unitario_venta` — congelados al guardar la métrica

**Excepción explícita y deliberada:** `eliminarCierre()` (sección 15.3) borra intencionalmente un snapshot de `periodos` para permitir corregirlo y volver a cerrarlo. No es una recalculación automática: es una acción admin explícita de dos pasos con confirmación. **Botón "Reabrir semana" (NUEVO esta sesión):** es la misma función `eliminarCierre()`, ahora expuesta también directamente en el header del dashboard (antes solo vivía como link chiquito dentro de la tabla de Evolución) — mismo texto/confirmación en ambos lugares, mismo componente `AccionEliminarCierre` reutilizado con una prop `compact`.

**Excepción explícita y deliberada #2 (NUEVO esta sesión):** `eliminarProducto()` (sección 8) permite borrar un producto **por completo** (incluyendo su precio, que normalmente es append-only) pero **solo si nunca tuvo actividad real** — cero líneas en `pedidos_lineas`, `consumo_interno_lineas` y `metricas_faltantes_detalle`. Si tiene aunque sea una, el borrado se bloquea con un mensaje explícito y sugiere archivar. La razón de fondo: `productos_precios` append-only existe para auditar precios que se cobraron de verdad — un producto que nunca se vendió no tiene nada que auditar, así que borrarlo del todo no viola el principio. Las FK de la base (`productos_precios.producto_id` y `pedidos_lineas.producto_id` son `ON DELETE RESTRICT`) ya actúan como segunda barrera aunque el chequeo de la función fallara.

### 2.2 Costos y precios append-only
`ingredientes_costos` y `productos_precios` **nunca se editan ni borran**. Solo se agregan filas con nueva `fecha_vigencia`. La resolución del valor vigente usa siempre `.order('fecha_vigencia', DESC).order('created_at', DESC)` — dos criterios, siempre.

### 2.3 Períodos operativos = Vie + Sáb + Dom
La función SQL `periodo_de(fecha)` devuelve el viernes de la semana operativa. El selector de rango del dashboard soporta Semana / Mes / Trimestre / Año / Personalizado, pero la unidad de snapshots es siempre la **Semana operativa**. La misma noción de "una semana pertenece al mes de su viernes" se usa en el Informe mensual (sección 8) para descomponer un mes en sus semanas operativas.

### 2.4 Importaciones anulables
`importaciones.estado` es `'activa'` o `'anulada'`. **Todas las queries filtran por `estado = 'activa'`**. El dedup de `pedido_pedix_id` solo compara contra importaciones activas. La segmentación de clientes para WhatsApp (sección 8) también filtra estrictamente por importaciones activas.

### 2.5 Envíos separados
`pedidos.envio_cobrado` **NO suma a ventas**. Se maneja en el módulo de Delivery como parte del `resultadoDelivery`.

### 2.6 Consumo interno = gasto puro
Suma a costos pero nunca a ventas/ingresos.

### 2.7 Snapshots históricos son sagrados
Los datos de `periodos` (y tablas hijo) **nunca se recalculan** desde tablas operativas. Son inmutables desde el cierre. La única forma de cambiarlos es borrar el snapshot explícitamente (`eliminarCierre`) y volver a cerrar — nunca un UPDATE ni un recálculo silencioso.

### 2.8 Separación estricta histórico / en vivo
- Funciones `*Historico()` → solo `periodos`
- `obtenerSaludClientes()`, `calcularKpis()` → en vivo

### 2.9 No inventar causalidad
El sistema muestra descomposición aditiva matemáticamente exacta. No usa scores numéricos inventados. El semáforo usa reglas explícitas con umbrales configurables. Las métricas de tendencia siempre muestran el tamaño de muestra y advierten cuando es insuficiente.

**Extendido al módulo de stock:** cuando falta el conteo de inicio o fin de semana, la pantalla lo dice explícitamente (`ingredientesIncompletos`) en vez de inventar o estimar el dato faltante.

**Extendido al Laboratorio:** las recomendaciones las genera la IA, pero el `SYSTEM_PROMPT` exige citar el número concreto del contexto que motiva cada una y prohíbe generar recomendaciones sobre áreas marcadas `sin_datos_todavia`. La comparación automática "antes vs. después" de una decisión (`resumenSugerido`) **no la genera la IA** — la genera código determinístico.

**Extendido a Meta Ads:** el `SYSTEM_PROMPT` del Laboratorio prohíbe explícitamente comparar el costo por conversación entre conjuntos de audiencia caliente y fría — son tipos de audiencia fundamentalmente distintos. Solo se compara costo por conversación entre conjuntos del **mismo tipo de audiencia**.

**Extendido al Informe mensual (NUEVO):** la salud de clientes (`obtenerSaludClientes()`) no es un corte histórico por semana — es siempre "estado actual". El informe la muestra **una sola vez** al final, nunca repetida por cada semana del mes, para no disfrazar el mismo número de dato semanal distinto. Las semanas que todavía no arrancaron se excluyen en vez de mostrarse en cero.

**Extendido a Exportar clientes (NUEVO):** los teléfonos que no calzan en ningún formato reconocible (ver sección 8) se **excluyen y se cuentan explícitamente** (`sinFormatoValido`) en vez de forzar un `+54` adivinado que podría estar mal.

### 2.10 Separación admin / empleado
Los empleados solo ven lo que Lucas decide mostrarles. Nunca ven montos en pesos — solo porcentajes y cantidades físicas. El dashboard de empleados es una pantalla separada con su propia ruta (`/panel`).

**Defensa en profundidad:** el dato financiero completo se calcula server-side y se reduce a `{ pedidos, margenNeto }` antes de que la respuesta salga del server action. `decisiones_laboratorio`, `meta_ads_importaciones`, `meta_ads_detalle` y la segmentación de `/clientes/exportar` son admin-only (RLS y/o verificación de rol en el server action + gate de ruta en `middleware.ts`).

**Excepción deliberada — precio de venta en faltantes:** `metricas_faltantes_detalle.precio_unitario_venta` es el precio de venta al cliente (de `productos_precios`), no el costo interno. Tanto admin como empleado lo ven en la tabla de métricas (formato: "Royal Doble x2 ($84.000)"). No viola el principio porque es un precio público que no revela márgenes ni estructura de costos internos. Congelado al momento de registrar, igual que los demás valores del sistema.

**Panel de empleados:** grilla de 2 columnas: Pedidos y Margen neto (sin hamburguesas vendidas). El `margenNeto` es el valor real de `calcularKpis` sin modificación.

### 2.11 Laboratorio: disparo manual, sin generación automática
El botón "Generar recomendaciones" en `/laboratorio` es la única forma de llamar a la API de Anthropic. No hay cron, no hay generación al cerrar la semana. Costo predecible, sin ruido. Cualquier extensión futura requiere **consultar con Lucas** — no asumir que "más automático es mejor". El Informe mensual (sección 8) tampoco llama a la API de Anthropic — solo arma el texto con código determinístico para que Lucas lo pegue manualmente en un chat.

---

## 3. PATRONES DE CÓDIGO OBLIGATORIOS

```typescript
// Imports de Supabase
import { createClient } from '@/lib/supabase/server';     // usuario autenticado, respeta RLS
import { createAdminClient } from '@/lib/supabase/admin'; // bypasea RLS — verificar rol manualmente

// CRÍTICO: createAdminClient() bypasea RLS por completo. Siempre verificar rol del caller
// con el cliente normal ANTES de usar el admin client.

// Verificación de rol admin dentro de un server action (patrón duplicado
// deliberadamente en cada actions.ts que lo necesita — usuarios/actions.ts,
// evolucion/actions.ts, importar/actions.ts, clientes/exportar/actions.ts):
async function exigirAdmin() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('No autenticado');
  const { data: yo } = await supabase.from('usuarios').select('rol').eq('id', auth.user.id).single();
  if (yo?.rol !== 'admin') throw new Error('No autorizado');
}

// UI Components (src/components/ui)
// Exporta: SidePanel, Field, Input, Select, Button, Badge, EmptyState, Tabs, useToast
// Badge usa prop "color" (green/yellow/red/gray), NO "variant"
// Button usa prop "variant" (primary/secondary/danger/ghost) y "size" (sm/md)
// useToast: const { show, Toast } = useToast(); — Toast debe montarse en JSX

// Formato
import { formatARS, formatDate, formatPercent } from '@/lib/utils/format';

// Design tokens (NUNCA colores hardcodeados tipo text-zinc-* o text-emerald-*)
// Usar: text-text-primary, text-text-secondary, text-text-muted
//       bg-surface, bg-surface-alt, border-border
//       text-positive, text-warning, text-negative
//       bg-positive-bg, bg-warning-bg, bg-negative-bg, bg-brand-light

// Componentes del dashboard admin:
// KpiCardHero: card grande con valor text-3xl, prop colorValor opcional (ej. 'text-negative')
// ZonaDivisor: separador horizontal con label centrado, data-print="hidden"
// SeccionColapsable: useState toggle local, content hidden cuando cerrado
// Estos tres se definen como funciones locales en dashboard/page.tsx — no en components/ui

// Manejo de race conditions en cargas async
const requestIdRef = useRef(0);
// ++requestIdRef.current al iniciar; ignorar respuesta si ya no es la actual

// Fórmula costo de ingredientes (CRÍTICA, nunca cambiar):
// costo_parcial = (costo_por_unidad_compra / factor_conversion) × cantidad_receta

// Dedup en importar/actions.ts:
// El Set de pedidos existentes se construye con join a importaciones WHERE estado='activa'

// Desactivar acceso de un usuario: banear a nivel Supabase Auth + actualizar usuarios.activo
//   await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' }) // desactivar

// Tabs visuales: usar className hidden/block, no renderizado condicional

// Hidratación: NUNCA usar new Date() directamente en JSX

// Fechas con timezone — DOS variantes según dónde corre el código:
//
// 1) Client-side (componentes 'use client'): new Date() ya corre con la hora
//    del navegador de Lucas (Argentina). NUNCA usar
//    new Date().toISOString().split('T')[0] (da UTC — después de las 21:00
//    ARG muestra el día siguiente). Usar fecha LOCAL explícita:
//      const hoy = new Date();
//      const local = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;
//
// 2) Server-side (server actions con 'use server'): el patrón de arriba NO
//    sirve — el servidor de Vercel corre en UTC, no en hora argentina. Para
//    obtener "hoy" en Argentina desde el server, usar Intl.DateTimeFormat
//    con timezone explícito (ver clientes/exportar/actions.ts):
//      const hoy = new Intl.DateTimeFormat('en-CA', {
//        timeZone: 'America/Argentina/Buenos_Aires',
//        year: 'numeric', month: '2-digit', day: '2-digit',
//      }).format(new Date()); // → "YYYY-MM-DD"

// Migraciones SQL: nunca usar separadores Unicode (═══). Migraciones ya
// aplicadas NUNCA se editan; si hace falta corregir algo, se agrega una
// migración nueva.

// Anthropic SDK: usar client.messages.parse() con
// output_config: { format: zodOutputFormat(schema) } y leer
// response.parsed_output — no parsear JSON a mano. Modelo: 'claude-opus-4-8'.

// Parsers de CSV sin dependencias: buscar columnas por nombre con múltiples
// candidatos en minúsculas (idioma/exportación variable), nunca por posición fija.
// Ver meta-ads-parser.ts — mismo patrón que findColumn() de pedix-parser.ts.
// parseNumeroOpcional(raw): devuelve null si el campo está vacío (a diferencia
// de parseNumeroFlexible que devuelve 0) — usar para campos opcionales como CTR,
// costo por resultado, clics, donde vacío ≠ cero.

// Antes de testear contra producción algo que escribe/borra en tablas operativas,
// verificar primero si el período de prueba coincide con una semana real ya cerrada.
// Usar datos sintéticos con fecha obviamente falsa (ej. año 2020) si hay cualquier duda.

// Listas dinámicas en formularios controlados (ej. faltantes/quejas):
// - Tipo local: { _id: string; ...campos } donde _id es para React key, nunca como dato
// - IDs únicos: useRef counter (nextId.current++) — no Date.now() ni Math.random()
// - key={periodo.viernes} en el componente padre para forzar remount al cambiar período

// Admin client para datos no accesibles a empleados (importaciones, pedidos):
// fetchImpIds() usa createAdminClient() porque empleados no tienen RLS sobre importaciones.
// El auth se verifica PRIMERO con createClient() antes de llamar fetchImpIds().
// Este patrón garantiza que el empleado puede ver métricas derivadas de pedidos
// sin tener acceso directo a las tablas de importaciones/pedidos.

// Normalización de teléfono argentino (clientes/exportar/actions.ts):
// ANTES de escribir un normalizador de teléfono, relevar una muestra real de
// `pedidos.cliente_celular` — Pedix exporta el dato en formatos mezclados
// (local de 10 dígitos, con "0" de discado, con "54" sin "9", ya completo,
// con "15" de celular intercalado, con "9" pero sin "54"). No asumir un
// único formato. Lo que no calza en ningún patrón reconocido se excluye y
// se cuenta — nunca se fuerza un número adivinado (principio 2.9).

// Contexto semanal compartido para IA (src/lib/reportes/contexto-semana.ts):
// construirContextoSemana(supabase, desde, hasta) es la única fuente de
// verdad para "todo lo que sabe el sistema sobre una semana" (financiero +
// clientes + equipo + Meta Ads + merma). La usan tanto el Laboratorio como
// el Informe mensual — si hace falta agregar un campo nuevo al contexto que
// recibe la IA, agregarlo ACÁ, no duplicarlo en cada lugar que lo consume.

// NUNCA correr `npx next build` mientras `npm run dev` está corriendo en
// paralelo (NUEVO esta sesión, aprendido de un error real): ambos comparten
// la carpeta .next, y el build de producción la deja en un estado mixto
// que el dev server sigue sirviendo — el navegador tira "Application error:
// a client-side exception has occurred" y en consola aparece "Failed to
// read a RSC payload created by a development version of React on the
// server while using a production version on the client". Fix: `pkill -f
// "next dev"`, `rm -rf .next`, volver a levantar `npm run dev`. Si hace
// falta correr `next build` para chequear TypeScript mientras el dev server
// sigue activo, mejor pararlo primero y levantarlo de nuevo después.

// Botones de navegación de rango en el dashboard (← / → / "Hoy") usan
// startTransition() (dashboard/page.tsx, función navegar()). Si se
// automatizan clicks rápidos y seguidos (ej. con un browser tool para
// testing), varios clicks seguidos pueden colapsar en un solo movimiento
// neto porque cada uno lee `rango` de la última render committeada, no del
// último click — hay que esperar (2-4s aprox.) a que la transición
// resuelva entre click y click, o los clicks se "pierden" en apariencia
// (en realidad no se pierden del todo, se acumulan y a veces se resuelven
// de golpe más tarde — no confiar en el estado visual inmediatamente
// después de una tanda de clicks rápidos, esperar a que se asiente).

// Para testear en el navegador acciones que escriben/borran en tablas
// operativas (cerrar semana, eliminar producto, etc.) sin arriesgar datos
// reales: usar una semana o producto sintético que garantizadamente no
// tenga actividad real. El pedido más antiguo en toda la tabla `pedidos`
// es del 2026-04-26 — cualquier semana operativa anterior a esa fecha
// tiene 0 pedidos y 0 riesgo. Para productos, crear uno de prueba con
// nombre reconocible (ej. prefijo "ZZZ_TEST_"), probar, y borrarlo
// después con un script puntual usando `createAdminClient` (o directo con
// la service role key) — no dejar productos de prueba en la tabla real.
```

## 4. MIGRACIONES SQL — ESTADO COMPLETO

Ninguna migración nueva en esta sesión (31 jul → 4 ago 2026) — todo el trabajo fue de aplicación (dashboard, `/productos`), sin cambios de esquema. La última migración aplicada sigue siendo la 038.

| # | Archivo | Qué hace | Estado |
|---|---------|----------|--------|
| 001–006 | (Fase 0/1) | Auth, usuarios, configuracion, periodos, ingredientes, productos, ventas | ✅ Aplicado |
| 007 | `007_empleados.sql` | Tablas `empleados`/`asistencia` — abandonadas, reemplazadas por `equipo` (017) | ⚠️ Dropeadas en 028 |
| 008–009 | (Fase 1/2) | Cadetes, gastos | ✅ Aplicado |
| 010 | `010_stock.sql` | Tablas `stock_conteos`/`stock_compras` — abandonadas, reemplazadas por `conteos_stock`/`compras_ingredientes` (029) | ⚠️ Dropeadas en 028 |
| 011–014 | (Fase 0/1) | Laboratorio (placeholder), snapshots, seed, índices | ✅ Aplicado |
| 015 | `015_importacion_extras.sql` | Column `estado` en importaciones + tabla `pedidos_lineas_ingredientes` | ✅ Aplicado |
| 016 | `016_dashboard_gastos.sql` | Función `periodo_de(fecha)`, tabla `gastos_operativos` | ✅ Aplicado |
| 017 | `017_equipo.sql` | Tabla `equipo` (roles: cadete/cocina/caja/general). No confundir con `usuarios` | ✅ Aplicado |
| 018 | `018_consumo_interno.sql` | Tablas `consumo_interno`, `consumo_interno_lineas`, `consumo_interno_ingredientes` | ✅ Aplicado |
| 019 | `019_pedidos_cadetes.sql` | **DESCARTADO** — NO aplicar nunca | ❌ NO aplicar |
| 020 | `020_cadetes_jornadas.sql` | Tabla `cadetes_jornadas` | ✅ Aplicado |
| 021 | `021_drop_pedidos_cadetes.sql` | DROP TABLE pedidos_cadetes | ✅ Aplicado |
| 022 | `022_periodos.sql` | Tabla `periodos` (snapshots semanales congelados) | ✅ Aplicado |
| 023 | `023_periodos_detalle.sql` | Tablas `periodos_productos` y `periodos_gastos` | ✅ Aplicado |
| 024 | `024_alertas_config.sql` | 4 claves de alerta en `configuracion` | ✅ Aplicado |
| 025 | `025_clientes.sql` | Tabla `clientes`, columnas en `pedidos` | ✅ Aplicado |
| 026 | `026_margen_bandas.sql` | 3 claves en `configuracion` | ✅ Aplicado |
| 027 | `027_salud_clientes_fn_v3.sql` | Función SQL `obtener_salud_clientes(p_ventana_dias)` | ✅ Aplicado |
| 028 | `028_empleados.sql` | DROP tablas Fase 0 vacías. Tabla `metas_equipo` + RLS + seed de 4 niveles | ✅ Aplicado |
| 029 | `029_stock.sql` | Tablas `compras_ingredientes` y `conteos_stock` + RLS + `controlado_stock` | ✅ Aplicado |
| 030 | `030_periodos_rls_empleado.sql` | Fix de seguridad: `periodos` pasa a admin-only. Crea vista `periodos_margen_empleado` | ✅ Aplicado |
| 031 | `031_conteo_unidad_receta.sql` | Columna `ingredientes.conteo_en_unidad_receta` (default false). Activada para Carne | ✅ Aplicado |
| 032 | `032_clientes_riesgo_semanal.sql` | `CREATE OR REPLACE FUNCTION obtener_salud_clientes` + `nuevos_en_riesgo_detalle`. Tabla `clientes_contactos` | ✅ Aplicado |
| 033 | `033_metricas_equipo.sql` | Tabla `metricas_equipo_semana` (mensajes/conversión/producción/quejas). Sin campos en pesos | ✅ Aplicado |
| 034 | `034_laboratorio.sql` | Tabla `decisiones_laboratorio` (área, recomendación, decisión, resultado, estado). Admin-only | ✅ Aplicado |
| 035 | `035_meta_ads.sql` | Tabla `meta_ads_importaciones` (una fila por semana, totales de gasto/alcance/clics/resultados). Admin-only | ✅ Aplicado |
| 036 | `036_meta_ads_detalle.sql` | Tabla `meta_ads_detalle` (detalle por anuncio/conjunto, con `tipo_audiencia`). ON DELETE CASCADE desde `meta_ads_importaciones`. Admin-only | ✅ Aplicado |
| 037 | `037_meta_ads_detalle_fix_tipos.sql` | ALTER TABLE `meta_ads_detalle`: cambia `costo_por_resultado_usd` y `ctr_enlace` de `NUMERIC(n,m)` a `NUMERIC` sin restricción — fix de "numeric field overflow" con valores de muchos decimales del CSV real | ✅ Aplicado |
| 038 | `038_metricas_detalle.sql` | Tablas `metricas_faltantes_detalle` (producto + cantidad + precio de venta congelado, ON DELETE CASCADE desde `metricas_equipo_semana`) y `metricas_quejas_detalle` (texto libre). RLS admin-full + empleado-SELECT. | ✅ Aplicado |

---

## 5. ESQUEMA DE BASE DE DATOS ACTUAL

Sin cambios de esquema esta sesión — ver sección 4. Estructura completa (idéntica a v9):

### 5.1 Tablas core
- **`usuarios`** — id, email, nombre, rol (admin/empleado), activo. RLS con `public.get_my_rol()` SECURITY DEFINER.
- **`configuracion`** — clave, valor, descripcion. Key-value editable.

### 5.2 Catálogo
- **`ingredientes`** — nombre, unidad_compra, unidad_receta, factor_conversion, controlado_stock, activo, `conteo_en_unidad_receta`. RLS: admin full access + `empleado_read`.
- **`ingredientes_costos`** — append-only.
- **`productos`** — nombre, categoria, activo.
- **`productos_precios`** — append-only.
- **`recetas`** — producto_id → ingrediente_id, cantidad.
- **`mapeo_pedix`** — nombre_pedix → producto_id.

### 5.3 Importación / Ventas
- **`importaciones`** — nombre_archivo, hash_archivo (SHA-256), estado ('activa'/'anulada'), importado_por, fecha_desde, fecha_hasta.
- **`pedidos`** — importacion_id, pedido_pedix_id (UNIQUE), fecha, hora, envio_cobrado, cliente_id (FK nullable), cliente_celular, cliente_nombre, cliente_direccion. `cliente_celular` viene de Pedix en formatos mezclados — ver normalización en sección 8 (Exportar clientes).
- **`pedidos_lineas`** — pedido_id, producto_id, cantidad, precio_unitario_vendido, costo_unitario_calculado.
- **`pedidos_lineas_ingredientes`** — congelación de ingredientes por línea.

### 5.4 Gastos
- **`gastos_operativos`** — fecha, categoria (publicidad/packaging/sueldos/servicios/impuestos/otros), tipo (variable/fijo), monto, nota, registrado_por. Sin guard de período cerrado. Filas de Meta Ads tienen nota `"Importado de Meta Ads (USD X × $Y)"` y FK desde `meta_ads_importaciones.gasto_operativo_id`.

### 5.5 Equipo
- **`equipo`** — nombre, rol (cadete/cocina/caja/general), telefono, activo. **No son cuentas de login.**

### 5.6 Consumo interno
- **`consumo_interno`** — id, fecha, nota + columnas legacy nullable.
- **`consumo_interno_lineas`** — consumo_id, producto_id, cantidad, costo_unitario_calculado.
- **`consumo_interno_ingredientes`** — congelación idéntica a pedidos_lineas_ingredientes.

### 5.7 Cadetes
- **`cadetes_jornadas`** — equipo_id, fecha, viajes_realizados, 3 valores de config congelados, pago_cadete. UNIQUE(equipo_id, fecha).

### 5.8 Snapshots históricos
- **`periodos`** — tipo='semana', desde, hasta, label, pedidos, hamburguesas_vendidas, ticket_promedio, ventas, beneficio_bruto, beneficio_neto, margen_bruto, margen_neto, roas, publicidad_pct, resultado_delivery, cerrado_por, cerrado_en. UNIQUE(tipo, desde, hasta). SELECT admin-only (migración 030). DELETE admin-only. CASCADE a `periodos_productos`/`periodos_gastos`.
- **`periodos_productos`** — periodo_id (FK CASCADE), producto_nombre, unidades, venta, costo, beneficio, margen, participacion.
- **`periodos_gastos`** — periodo_id (FK CASCADE), tipo, categoria, total, legacy.
- **`periodos_margen_empleado`** (VISTA) — solo `desde/hasta/label/margen_neto`. **Nunca agregarle columnas con montos en pesos.**

### 5.9 Clientes
- **`clientes`** — celular TEXT UNIQUE (solo dígitos, mínimo 6), nombre_referencia.
- **`clientes_contactos`** — id, cliente_id (FK CASCADE), fecha, metodo (llamada/whatsapp/otro), nota, registrado_por. Admin-only. `volvioAComprar` se calcula en vivo, no se guarda.

### 5.10 Función SQL
- **`obtener_salud_clientes(p_ventana_dias int)`** — devuelve JSON con categorías, métricas de retención, alto valor en riesgo, `nuevos_en_riesgo_detalle` (clientes que cruzaron el umbral en los últimos 7 días), tendencias, top clientes.

### 5.11 Sistema de empleados
- **`metas_equipo`** — id, nivel (1-5, UNIQUE), margen_minimo, descripcion, color, activo. RLS: admin full access, empleado SELECT.
- **`metricas_equipo_semana`** — id, periodo_desde (UNIQUE), periodo_hasta, mensajes_recibidos, mensajes_convertidos, tiempo_promedio_produccion_min, quejas_faltantes (derivado del COUNT del detalle), quejas_calidad (ídem). Sin ningún campo en pesos.
- **`metricas_faltantes_detalle`** — id, metrica_id (FK CASCADE), periodo_desde (denorm), producto_id (FK), producto_nombre (congelado), cantidad, precio_unitario_venta (congelado — precio de venta público, excepción deliberada 2.10). RLS admin-full + empleado-SELECT.
- **`metricas_quejas_detalle`** — id, metrica_id (FK CASCADE), descripcion TEXT. RLS admin-full + empleado-SELECT.

### 5.12 Stock
- **`compras_ingredientes`** — id, fecha, ingrediente_id, cantidad, unidad, costo_total, proveedor, nota, registrado_por. Siempre en `unidad_compra` real.
- **`conteos_stock`** — id, fecha, ingrediente_id, cantidad, unidad, tipo ('inicio_semana'/'fin_noche'), nota, registrado_por. UNIQUE(fecha, ingrediente_id, tipo).

### 5.13 Laboratorio
- **`decisiones_laboratorio`** — id, periodo_desde, periodo_hasta, area, recomendacion, justificacion, decision_tomada, fecha_decision, resultado, fecha_resultado, estado (sugerida/decidida/evaluada), registrado_por. Admin-only. Una fila = una recomendación individual.

### 5.14 Meta Ads
- **`meta_ads_importaciones`** — id, periodo_desde (UNIQUE), periodo_hasta, gasto_operativo_id (FK nullable a `gastos_operativos`, ON DELETE SET NULL), gasto_usd, tipo_cambio, gasto_ars, alcance, impresiones, clics, resultados, nombre_archivo, registrado_por. Admin-only. Upsert por `periodo_desde`.
- **`meta_ads_detalle`** — id, importacion_id (FK → `meta_ads_importaciones` ON DELETE CASCADE), periodo_desde, nombre_campana, nombre_conjunto, nombre_anuncio, tipo_audiencia (CHECK: 'caliente'/'fría'), gasto_usd, gasto_ars, alcance, impresiones, conversaciones, costo_por_resultado_usd (NUMERIC sin restricción), ctr_enlace (NUMERIC sin restricción), clics_enlace. Admin-only. Índices en importacion_id y periodo_desde. Una fila = un anuncio individual filtrado (solo filas con gasto_usd > 0 OR conversaciones > 0).

### 5.15 Tablas Fase 0 eliminadas (migración 028)
`empleados`, `asistencia`, `stock_conteos`, `stock_compras` — dropeadas.

**Nota (sesión 31 jul):** las dos features de esa sesión (Informe mensual, Exportar clientes) **no agregaron tablas** — leen de `pedidos`/`periodos`/etc. existentes y no persisten nada nuevo en base.

**Nota (sesión 4 ago, esta):** las tres features nuevas (Reabrir semana, Duplicar producto, Eliminar producto) tampoco agregaron tablas ni columnas — son solo UI + server actions nuevas sobre `periodos`, `productos`, `productos_precios` y `recetas` ya existentes.

---

## 6. CONFIGURACIÓN — TODAS LAS CLAVES VIGENTES

| Clave | Valor default | Descripción |
|-------|---------------|-------------|
| `cadete_base_minima` | 21000 | Pago mínimo garantizado por jornada (ARS) |
| `cadete_valor_viaje` | 2000 | Pago por viaje adicional (ARS) |
| `costo_empresa_cadete` | 1500 | Costo de la empresa de cadetería por cadete activo (ARS) |
| `alerta_margen_minimo` | 40 | Margen neto mínimo — límite inferior zona Alerta (%) |
| `alerta_publicidad_maxima` | 15 | Publicidad máxima sobre ventas (%) |
| `alerta_roas_minimo` | 3 | ROAS mínimo aceptable |
| `alerta_caida_ventas_pct` | 15 | % de caída de ventas vs anterior que activa alerta |
| `alerta_relevancia_monto_minimo` | 15000 | Monto mínimo ARS para que aparezca en comparación |
| `alerta_relevancia_pct_minimo` | 5 | % mínimo del cambio total para aparecer |
| `margen_objetivo_minimo` | 50 | Límite inferior zona Objetivo en gráfico de margen (%) |
| `margen_excelente_minimo` | 60 | Límite inferior zona Excelente (%) |
| `cliente_ventana_activo_dias` | 21 | Días desde última compra para considerar cliente activo |

Notas: las metas de equipo viven en `metas_equipo`, no acá. El tipo de cambio de Meta Ads se ingresa a mano por importación — no es config global porque cambia cada semana. Los umbrales de segmentación de `/clientes/exportar` (14 y 45 días) están **hardcodeados en el código**, no en esta tabla — quedó pendiente evaluar si conviene moverlos acá (ver sección 16).

---

## 7. FÓRMULAS FINANCIERAS VALIDADAS

### 7.1 Costo de ingredientes (CRÍTICA)
```
costo_parcial = (costo_por_unidad_compra / factor_conversion) × cantidad_receta
```

### 7.2 Pago cadete
```
pago_cadete = GREATEST(cadete_base_minima_usada, viajes_realizados × cadete_valor_viaje_usado)
```

### 7.3 Resultado Delivery
```
resultadoDelivery = enviosCobrados - pagosCadetes - costoBaseCadeteria
```

### 7.4 Beneficio neto
```
beneficioNeto = beneficioBruto - costoConsumoInterno - gastosTotal + resultadoDelivery
```

### 7.5 Cascada P&L completa
```
Ventas
− Costo ingredientes
= Beneficio bruto              (margen bruto %)
− Consumo interno
− Gastos variables
− Gastos fijos
+ Resultado delivery
= Beneficio neto               (margen neto %)
```

### 7.6 Retención de cartera
```
retencionCartera = activos / (activos + enRiesgo) × 100
```
Nota: "nuevo_perdido" NO entra en esta fórmula.

### 7.7 Merma de stock
```
Consumo real (unidad_receta) = stockInicio_receta + compras_receta − stockFin_receta
Merma = Consumo real − Consumo teórico (ventas) − Consumo interno registrado
Merma % = (Merma / Consumo real) × 100
```
Semáforo: verde si `|Merma %| < 3`, amarillo si `3 ≤ |Merma %| ≤ 6`, rojo si `|Merma %| > 6`.

### 7.8 Conversión de gasto de Meta Ads
```
gasto_ars = gasto_usd × tipo_cambio
```

### 7.9 Comparación automática post-cierre del Laboratorio (generada por código, no por IA)
```
delta_pp(metrica) = metrica_después − metrica_antes   // en puntos porcentuales
```
El texto `resumenSugerido` compara la semana de la decisión contra la semana más recientemente cerrada. Siempre incluye Margen neto y Ventas; agrega líneas según palabras clave en `area`.

### 7.10 Meta Ads por conjunto
```
costoPorConversacion = gastoArs_conjunto / conversaciones_conjunto  (null si conversaciones = 0)
ctrEnlace_conjunto   = (totalClics / totalImpresiones) × 100        (null si impresiones = 0)
```
Calculado en `obtenerDetalleMetaAds()` agrupando filas de `meta_ads_detalle` por `nombre_conjunto`. **REGLA CRÍTICA:** solo comparar `costoPorConversacion` entre conjuntos del mismo `tipo_audiencia` ('caliente' o 'fría').

### 7.11 Porcentaje de pedidos con error
```
totalErrores = COUNT(faltantesDetalle) + COUNT(quejasDetalle)
pctError = (totalErrores / pedidosEnPeriodo) × 100
```
Se calcula en vivo (no se guarda). `pedidosEnPeriodo` viene de la tabla `pedidos` filtrado por el período, usando admin client (empleados no tienen RLS directo sobre `pedidos`). Formato de display: `"12.5% de pedidos con error (3 de 24)"`. Si no hay datos de pedidos: muestra solo `"N errores"` o `"—"`.

### 7.12 Margen neto de un mes en el Informe mensual (NUEVO)
```
margenNetoMes = (Σ beneficioNeto_semana / Σ ventas_semana) × 100
```
Promedio ponderado por ventas de las semanas operativas del mes (no un promedio simple de los `margenNeto` semanales) — para que una semana grande no pese igual que una chica.

### 7.13 Segmentación de clientes por recencia (NUEVO — para difusiones WhatsApp)
```
diasDesdeUltimaCompra = hoyArgentina − MAX(pedidos.fecha) agrupado por celular normalizado
```
- **Grupo 1 — Activos recientes:** 0–14 días
- **Grupo 2 — Enfriándose:** 15–45 días
- **Grupo 3 — En riesgo:** más de 45 días

`hoyArgentina` se calcula server-side con `Intl.DateTimeFormat(..., { timeZone: 'America/Argentina/Buenos_Aires' })` (ver sección 3). Umbrales (14 y 45) hardcodeados en `clientes/exportar/actions.ts`, no en `configuracion`.

---

## 8. MÓDULOS — ESTADO ACTUAL

### ✅ Reabrir semana cerrada (NUEVO esta sesión — 4 ago)
Objetivo: Lucas se confundía a veces al cerrar una semana y no encontraba forma de corregirla — en realidad ya existía `eliminarCierre()` (sección 15.3) pero vivía escondido como un link chiquito dentro de la tabla de Evolución.

- **`src/app/(admin)/dashboard/page.tsx`**: el componente `AccionEliminarCierre` (ya existente) ahora acepta una prop `compact?: boolean`. En la tabla de Evolución se sigue usando `compact` (link chiquito subrayado). En el **header principal del dashboard**, cuando `periodoCerradoActual` no es null, aparece un botón normal (no-compact) **"Reabrir semana"** al lado del pill "✓ Cerrada el...".
- Textos actualizados de "Eliminar cierre" → **"Reabrir semana"** (mismo componente, misma función `eliminarCierre()` sin cambios) porque describe mejor lo que hace desde el punto de vista de Lucas. Confirmación en dos pasos: "¿Reabrir esta semana para corregirla?" → "Sí, reabrir" / "Cancelar".
- El callback `onEliminado` en el header hace `setPeriodoCerradoActual(null)` + `loadEvolucion()` (mismo patrón que ya usaba `confirmarCierre()` al cerrar).
- **Probado end-to-end** con sesión real de Lucas vía navegador (Claude in Chrome), sobre una semana sintética sin datos (Vie 10 — Dom 12 abr 2026, anterior al primer pedido real del 26 abr 2026): cerrar → aparece pill + botón → reabrir → confirma → vuelve a "Cerrar semana" → verificado en base que no quedó fila residual en `periodos`. No se tocó ningún cierre real.

### ✅ Duplicar producto (NUEVO esta sesión — 4 ago)
Objetivo: dar de alta variantes de productos existentes más rápido, sin tener que cargar la receta ingrediente por ingrediente de nuevo.

- **`duplicarProducto(id, nuevoNombre)`** en `src/app/(admin)/productos/actions-productos.ts`: crea un producto nuevo con la misma `categoria`, copia todas las filas de `recetas` (ingrediente + cantidad) y el precio vigente (si tenía) a una fila nueva en `productos_precios` con fecha de hoy. **No copia** los alias de `mapeo_pedix` (son específicos del nombre que usa Pedix para el producto original, y `nombre_pedix` es único — copiarlos chocaría contra esa restricción).
- **UI** (`ProductosTab.tsx`): ícono de copiar (`Copy` de lucide-react) en cada fila de la tabla, abre un `SidePanel` con el nombre pre-completado (`"<nombre> (copia)"`, editable) y un botón "Duplicar producto". Al confirmar, se abre automáticamente el panel de detalle del producto nuevo para ajustar lo que haga falta.
- **Probado end-to-end** con sesión real de Lucas: producto de prueba con receta (Carne, 1 Medallon, $1.136) y precio ($1.000) → duplicado → la copia salió con la misma receta, mismo precio, sin alias Pedix. Productos de prueba borrados de la base al terminar.

### ✅ Eliminar producto sin historial real (NUEVO esta sesión — 4 ago)
Objetivo: antes solo se podía archivar un producto (`activo=false`), pero seguía apareciendo en la lista como "Inactivo" — Lucas quería poder sacarlo de encima del todo cuando lo cargó por error (ej. una prueba) y nunca se vendió.

- **`eliminarProducto(id)`** en `actions-productos.ts`: cuenta filas en `pedidos_lineas`, `consumo_interno_lineas` y `metricas_faltantes_detalle` para ese `producto_id`. Si el total es > 0, **bloquea el borrado** y devuelve un mensaje explicando cuántas líneas de cada tipo tiene, sugiriendo archivar. Si es 0, borra primero `productos_precios` (que normalmente es append-only, pero acá no hay nada real que auditar) y después la fila de `productos` (```recetas``` y `mapeo_pedix` caen en cascada por FK `ON DELETE CASCADE` ya existente). Ver excepción explícita en sección 2.1.
- Las FK de la base (`productos_precios.producto_id` y `pedidos_lineas.producto_id` son `ON DELETE RESTRICT`) actúan como segunda barrera aunque el chequeo de conteo fallara — defensa en profundidad, sin necesitar un `exigirAdmin()` extra porque la tabla `productos` ya tiene RLS `admin_full_access` (migración 005).
- **UI**: ícono de basurero (`Trash2`) en cada fila, confirmación inline en dos pasos ("¿Eliminar del todo?" → "Sí, eliminar" / "Cancelar"), mismo patrón visual que "Reabrir semana".
- **Probado end-to-end** con sesión real de Lucas: intento de borrar "Bacon Royal" (producto real, 42 líneas de pedidos) → bloqueado con el mensaje correcto, nada se tocó. Producto de prueba sin historial → borrado exitoso, confirmado en base que no quedó residuo.

### ✅ Informe mensual por semana operativa, exportable para IA (sesión 31 jul)
Objetivo: que Lucas pueda bajar, con un solo botón, un informe de un mes completo dividido por semana operativa, autocontenido y objetivo, para pegarlo en un chat externo con Claude y debatir cómo mejorar los resultados.

- **Botón "🤖 Informe para IA"** en `src/app/(admin)/dashboard/page.tsx`, visible **solo cuando el rango seleccionado es "Mes"** (junto al botón "↓ Exportar PDF" existente).
- Al clickear: descarga un archivo `.md` (`informe-royalty-<desde>.md`) y copia el mismo texto al portapapeles.
- **`src/lib/reportes/informe-mensual.ts`** (módulo puro, sin `'use server'`):
  - `decomponerMesEnSemanas(desde, hasta)`: encuentra las semanas Vie-Sáb-Dom cuyo viernes cae dentro del rango — una semana "pertenece" al mes de su viernes (mismo criterio que `periodo_de()`).
  - `formatearInformeMensual(mesLabel, semanas)`: arma el Markdown. Incluye resumen del mes, tabla comparativa semana a semana, detalle completo por semana, y la salud de clientes **una sola vez** al final (no por semana — ver principio 2.9).
- **`src/lib/reportes/contexto-semana.ts`**: `construirContextoSemana(supabase, desde, hasta)` — junta financiero + clientes + equipo + Meta Ads + merma de una semana. **Extraído del Laboratorio** (antes vivía duplicado ahí como función privada) para que ambos módulos usen la misma fuente de verdad.
  - **Fix incluido:** antes buscaba métricas de equipo con `obtenerMetricasHistorico(8).find(...)`, que fallaba silenciosamente para semanas fuera de las últimas 8. Ahora usa `obtenerMetricasPeriodo(desde)` directo — beneficia también al Laboratorio, que comparte el mismo código.
- **`src/app/(admin)/dashboard/actions-informe.ts`**: `generarInformeMensual(desde, hasta, mesLabel)` — orquesta todo. Excluye semanas que todavía no arrancaron (`s.desde <= hoyLocal`) para no mostrar ceros engañosos; marca la semana en curso como "EN CURSO — datos parciales".
- `src/lib/dashboard/rangos.ts`: `periodoDeJS()` pasó a exportado (antes privado) para reutilizarlo en `informe-mensual.ts`.
- **Probado:** `npx next build` limpio. No se probó en navegador en el momento de escribirlo (sin credenciales); Lucas lo validó manualmente bajando el informe contra datos reales de julio 2026 y confirmó que el contenido y nivel de detalle son correctos. Se evaluó (y Lucas decidió que **no hace falta por ahora**) agregar los umbrales configurados de `configuracion` (bandas de margen, publicidad máxima) al texto del informe — quedó anotado en sección 16 por si se retoma.

### ✅ Exportar clientes para WhatsApp (sesión 31 jul)
Objetivo: exportar teléfonos de clientes segmentados por recencia de última compra, listos para difusiones de WhatsApp Business.

- Ruta **`/clientes/exportar`**, admin-only (agregada a `adminRoutes` en `src/middleware.ts`). Link "Exportar clientes" (ícono `Phone`) al final del nav en `Sidebar.tsx` — no existía una "sección de clientes" separada en el Sidebar (la Salud de Clientes vive como tab dentro de `/dashboard`), así que se agregó como ítem propio.
- **`src/app/(admin)/clientes/exportar/actions.ts`** — `obtenerSegmentacionClientes()`:
  - `exigirAdmin()` (ver sección 3) antes de usar `createAdminClient()`.
  - Lee `pedidos` (celular/nombre/fecha) de importaciones con `estado='activa'`, agrupa por celular normalizado tomando la fecha máxima como última compra.
  - Segmenta en 3 grupos por días desde la última compra (fórmula 7.13).
  - **`normalizarCelularArg()`**: normaliza a formato internacional `+549XXXXXXXXXX`. Se relevó una muestra real de `pedidos.cliente_celular` (~1000 filas) antes de escribir la lógica — Pedix trae 6 formatos mezclados (local 10 dígitos sin prefijo — el más común, ~92% —, con "0" de discado, con "54" sin el "9", ya completo con "549", discado local con "15" de celular intercalado, y con "9" pero sin "54"). Cobertura verificada contra datos reales: **991/1000 (99.1%)**. Lo que no calza en ningún patrón reconocido (número muy corto, muy largo, o con área ambigua) se **excluye y se cuenta** en `sinFormatoValido` — nunca se fuerza un `+54` adivinado.
  - "Hoy" se calcula server-side con `Intl.DateTimeFormat(..., { timeZone: 'America/Argentina/Buenos_Aires' })` (ver sección 3) — no con el patrón client-side de `new Date()`, que en el servidor de Vercel (UTC) daría resultados incorrectos.
- **`src/app/(admin)/clientes/exportar/page.tsx`**: 3 tarjetas (una por grupo), cada una con contador, botón "Copiar teléfonos" (clipboard), botón "Descargar .txt", y el mensaje de difusión sugerido (texto fijo, de referencia, no editable). Solo design tokens.
- **Probado end-to-end** con login real (Playwright instalado con `npm install --no-save`, sin dejar rastro ni como dependencia — se usó porque `chromium-cli` no estaba disponible en este entorno) contra el dev server y datos reales de producción: 70 / 241 / 531 clientes en cada grupo al 18 jul 2026, botones de copiar y descargar funcionando, sin errores de consola, screenshot verificado visualmente.

### ✅ Dashboard financiero
`src/app/(admin)/dashboard/page.tsx` en **3 zonas con jerarquía visual clara**:

**Zona 1 — Resultado rápido:** 6 cards grandes (`KpiCardHero`) en grilla `grid-cols-2 sm:grid-cols-3`:
1. Ventas (con delta vs semana anterior)
2. Beneficio neto (rojo si negativo)
3. Margen neto % (rojo si negativo)
4. ROAS (con lógica especial si no hubo publicidad o si es publicidad nueva)
5. Clientes que volvieron (`pedidosRepetidores`)
6. % facturación repetidores (`pctVentasRepetidores`)

**Zona 2 — Por qué ese resultado:** `ZonaDivisor` + Cascada P&L + Semáforo + ¿Qué cambió?

**Zona 3 — Evolución e inteligencia:** `ZonaDivisor` + `SeccionColapsable("Ranking de productos")` + `SeccionColapsable("Consumo de ingredientes")` + tabs de Evolución.

Botón "Cerrar semana" aparece cuando el período ya terminó (`rango.hasta < hoyLocalStr`) aunque siga siendo `esActual` (fix de sesión anterior, ver sección 12).

### ✅ MÓDULOS ESTABLES (no tocar sin consulta)

**Auditoría Financiera Inteligente** (`/auditoria`), **Exportación PDF** (`window.print()`), **Importación Pedix**, **Gastos operativos**, **Cadetes**, **Consumo interno**, **Productos / Ingredientes**, **Configuración**, **Panel de empleados** (`/panel`), **Métricas de equipo** (`/equipo`), **Sistema de Empleados + Stock** (sección 13), **Salud de Clientes + Recuperación** (sección 14.1), **Laboratorio**, **Importación de Meta Ads** (sección 15) — sin cambios esta sesión.

---

## 9. ARQUITECTURA DE ARCHIVOS

```
src/
  middleware.ts                 ← (sesión 31 jul) '/clientes' agregado a adminRoutes
  app/
    page.tsx, layout.tsx
    login/page.tsx
    globals.css
    (admin)/
      layout.tsx
      dashboard/
        actions.ts
        actions-informe.ts      ← (sesión 31 jul) generarInformeMensual()
        page.tsx                ← ACTUALIZADO esta sesión (4 ago): botón "Reabrir semana" en el header
                                    (además del botón "🤖 Informe para IA" de la sesión 31 jul)
      clientes/
        exportar/
          actions.ts             ← (sesión 31 jul) obtenerSegmentacionClientes(), normalizarCelularArg()
          page.tsx                ← (sesión 31 jul)
      importar/
      productos/
        actions-ingredientes.ts
        actions-productos.ts    ← ACTUALIZADO esta sesión: duplicarProducto(), eliminarProducto()
        IngredientesTab.tsx
        ProductosTab.tsx        ← ACTUALIZADO esta sesión: íconos duplicar/eliminar por fila
        page.tsx
      gastos/
        actions.ts               ← PeriodoInfo, obtenerPeriodoActual/PorOffset/DeFecha
        actions-meta-ads.ts      ← importarMetaAds acepta tipoAudienciaMap + filas
        page.tsx
      stock/
        actions.ts, page.tsx
      usuarios/
        actions.ts, page.tsx
      equipo/
        actions.ts, page.tsx
      consumo-interno/
        actions.ts, page.tsx
      cadetes/
        actions.ts, page.tsx
      configuracion/
        actions.ts, page.tsx
      evolucion/
        actions.ts               ← cerrarPeriodo, validarCierre, obtenerEvolucion, eliminarCierre
      auditoria/
        actions.ts
      laboratorio/
        actions.ts               ← (sesión 31 jul) construirContextoKpis() (privada, duplicada)
                                    reemplazada por import de construirContextoSemana() compartida
        page.tsx
    (empleado)/
      layout.tsx
      panel/
        actions.ts
        page.tsx
        stock/
          page.tsx
  lib/
    reportes/                    ← (sesión 31 jul)
      contexto-semana.ts          ← construirContextoSemana() — compartido por Laboratorio e Informe mensual
      informe-mensual.ts          ← decomponerMesEnSemanas(), formatearInformeMensual()
    dashboard/
      rangos.ts                  ← (sesión 31 jul) periodoDeJS() ahora exportado
    supabase/
      server.ts, admin.ts, client.ts
    utils/
      pedix-parser.ts
      meta-ads-parser.ts         ← MetaAdsFilaDetalle, conjuntosDetectados, parseNumeroOpcional
      format.ts, export.ts
  components/
    layout/
      Sidebar.tsx                ← (sesión 31 jul) link "Exportar clientes" (ícono Phone)
      AdminHeader.tsx, EmpleadoNav.tsx, LogoutButton.tsx
    stock/
      ConteoForm.tsx
    ui/index.tsx
supabase/
  migrations/
    ... (001–038 aplicadas, ver sección 4 — ninguna nueva desde entonces)
```

---

## 10. DATOS REALES DE ROYALTY (contexto de negocio)

**⚠️ Esta sección tiene datos financieros semanales verificados hasta fines de junio 2026 — desactualizados desde entonces. Para cifras de rentabilidad actuales, consultar el dashboard/Evolución directamente en vez de confiar en lo escrito acá.**

**Historial:** finales de abril a 30 junio 2026. ~900+ pedidos totales (dato de esa fecha).

**Clientes (al 18 jul 2026, verificado durante el testing de `/clientes/exportar`):** de los pedidos con celular registrado, 842 clientes únicos con teléfono normalizable a `+549...` (70 activos recientes 0-14 días, 241 enfriándose 15-45 días, 531 en riesgo +45 días) — 9 quedaron excluidos por formato de teléfono irreconocible.

**Rentabilidad (última cifra verificada, semanas cerradas a fines de junio):**
- Semana 5-7 jun: Margen neto **-15.7%** → Pérdida.
- Semana 12-14 jun: Margen neto **-12.3%** → Pérdida (mejora).
- Semana 19-21 jun: Ventas $1.856.500, Beneficio neto -$140.859, Margen neto **-7.6%**, Publicidad 30.04% de ventas (~$557.710) → Mejora sostenida. Primera semana con Meta Ads importado con detalle por conjunto (caliente/fría).
- Semana 3-5 jul (verificado por testeo del Informe mensual): Ventas $1.586.500, Margen neto 9.3%, Beneficio neto $148.235 → primera semana positiva registrada en el handoff.
- Semana 10-12 jul: Ventas $1.217.000, Margen neto -9.8%, Beneficio neto -$119.097.
- Semanas posteriores: no verificadas en esta sesión — ver dashboard.

**Delivery:** ronda los -$120.000 a -$180.000/semana en las semanas verificadas.

**Merma:** el módulo está construido y deployado; a la fecha del testing de esta sesión seguía sin conteos de stock cargados para las semanas revisadas.

**Ingredientes controlados de stock:** Carne (48.9% del costo), Cheddar (11.0%), Papas fritas Buttler (10.6%), Panes de papa (8.3%) — ~79% del costo total (dato de junio, no reverificado).

**Meta Ads:** campaña "Mensajes wsp Royalty" con conjuntos "Seguidores IG" y "Compradores Royalty" (caliente), "Abierto frio Royalty" y variantes/copias (fría). Reimportación semanal en curso.

**Laboratorio:** en uso activo con decisiones registradas en producción y evaluación automática post-cierre activa.

---

## 11. DECISIONES DESCARTADAS Y POR QUÉ

| Decisión descartada | Por qué |
|---------------------|---------|
| `pedidos_cadetes` (pago por pedido) | Reemplazado por `cadetes_jornadas` |
| Score de salud 0-100 | Pesos arbitrarios. Reemplazado por semáforo con reglas explícitas |
| Top N fijo en comparación | Reemplazado por umbral de relevancia |
| SheetJS / import dinámico en React | Causa errores de hidratación. CSV puro sin dependencias |
| `new Date()` en JSX directamente | Mismatch servidor/cliente |
| Cierres de Mes/Trimestre como entidades | Agregaciones de semanas cerradas |
| CRM, CAC, LTV, cohortes avanzadas | Fuera de scope |
| Dashboard de empleados como vista reducida del admin | Rutas separadas, datos distintos |
| Linkear `equipo` con `usuarios` | Conceptos deliberadamente separados |
| Montos en pesos en `metas_equipo.descripcion` | Viola principio 2.10 |
| Tablas `empleados`/`asistencia`/`stock_conteos`/`stock_compras` (Fase 0) | Vacías, superadas |
| Convertir TODOS los ingredientes controlados a unidad_receta | Solo tiene sentido por ingrediente |
| Generación automática/programada de recomendaciones del Laboratorio | Costo no predecible, ruido |
| Texto de comparación "antes/después" generado por IA | Código determinístico es más rápido, gratis y consistente. Confirmado por Lucas |
| Bloquear cierre hasta evaluar decisiones pendientes | Banner posterior, no bloqueante |
| Recalcular `periodos` automáticamente cuando cambia un gasto | Viola principio 2.7 |
| Borrado quirúrgico de gastos "solo los de Meta Ads" | Se borra todo gasto `categoria='publicidad'` del rango al reimportar |
| `tipo_audiencia` en tabla separada (lookup conjunto→tipo) | Denormalizado por fila — más simple, sobrevive reimports |
| NUMERIC(n,m) para ctr_enlace y costo_por_resultado_usd | Causa overflow con decimales reales del CSV. Reemplazado por NUMERIC sin restricción |
| Extender filtro de gastos a Mon-Thu en `obtenerGastosPeriodo` | Cambiaría qué gastos incluye el cierre. La solución correcta fue cambiar el default de fecha al domingo del período |
| **"Últimos 10 dígitos sin código de país" para exportar teléfonos** | Reemplazado por formato internacional completo `+549...` — necesario para que las herramientas de difusión de WhatsApp Business reconozcan el contacto |
| **Repetir el bloque de salud de clientes por cada semana en el Informe mensual** | `obtenerSaludClientes()` no es un corte histórico por semana — mostrarlo repetido sería el mismo número disfrazado de dato semanal distinto |
| **Agregar umbrales configurados (bandas de margen, publicidad máxima) al texto del Informe mensual** | Evaluado y ofrecido; Lucas decidió que no hace falta por ahora — el informe se queda puramente objetivo/sin interpretación (ver sección 16 si se retoma) |
| **Permitir borrar cualquier producto sin restricción** | Rompería la congelación histórica (principio 2.1/2.2) si el producto tiene ventas o consumo real. Se optó por chequear actividad real antes de borrar y bloquear con mensaje claro si tiene — ver `eliminarProducto()`, sección 8 y 2.1 |
| **Copiar los alias de `mapeo_pedix` al duplicar un producto** | Son específicos del nombre que usa Pedix para el producto ORIGINAL, y `nombre_pedix` tiene restricción de unicidad — copiarlos generaría conflicto o ambigüedad de importación |

---

## 12. BUGS RESUELTOS (para no reincidir)

| Bug | Causa | Fix |
|-----|-------|-----|
| `envio_cobrado` = $0 | Columna en Excel se llama "Cargos Envío" (plural) | Agregar primero en lista de candidatos de `findColumn` |
| Reimportación omitía pedidos | Dedup sin filtrar por importación activa | `importaciones!inner(estado)='activa'` en query de dedup |
| Gráfico de margen sin valores negativos | Eje Y hardcodeado [0, 100] | Eje Y dinámico con `min(0, ...valores) - 5` |
| `ROAS = undefined` | `actions.ts` y `page.tsx` desincronizados | Reemplazar ambos juntos siempre |
| Error de hidratación con SheetJS | `await import('xlsx')` durante SSR | CSV puro sin dependencias |
| Error de hidratación con `new Date()` en JSX | Servidor en UTC, cliente en UTC-3 | `suppressHydrationWarning` + `typeof window !== 'undefined'` |
| `npx next build` rompía por `src-fase0-backup` | Carpeta de respaldo vieja entraba al type-check | Excluida en `tsconfig.json` |
| `'salud' is possibly 'null'` en `dashboard/page.tsx` | Closure perdía el null-narrowing de TS | `fraseSemaforo` pasó a recibir `salud` como parámetro |
| Fuga de RLS en `periodos` (crítico) | `periodos_select` usaba `USING (true)` | Migración 030: policy admin-only + vista `periodos_margen_empleado` |
| Cálculo de merma con unidades mixtas | Sumar primero y convertir el total es incorrecto | Cada término se convierte individualmente antes de combinarse |
| Identidad de Git incorrecta bloqueaba deploy en Vercel | Nunca se configuró `git config --global user.email/user.name` | Resuelto |
| Force-push no disparó deploy nuevo en Vercel | Webhook de GitHub→Vercel no procesa push no-fast-forward igual que uno normal | Commit vacío (`git commit --allow-empty`) con push normal retriggerea el webhook |
| Test de Playwright sobrescribió datos reales | El período "actual" resultó ser una semana ya cerrada | Usar fechas obviamente falsas para pruebas (o, como esta sesión, testear una ruta de solo-lectura contra producción con cuidado) |
| Numeric field overflow al importar Meta Ads | `ctr_enlace NUMERIC(8,6)` y `costo_por_resultado_usd NUMERIC(10,4)` no admitían los decimales reales | Migración 037: ambos campos pasan a `NUMERIC` sin restricción |
| Regenerar recomendaciones acumulaba encima de las anteriores | `generarRecomendaciones()` insertaba sin borrar las `'sugeridas'` existentes | Borrar todas las `'sugeridas'` del período antes de insertar nuevas |
| `pedidosEnPeriodo` siempre null para empleados | `fetchImpIds()` usaba `createClient()` (con RLS) — empleados no tienen acceso a `importaciones` | `fetchImpIds()` usa `createAdminClient()`. Auth verificado con cliente normal antes de llamarlo |
| Columnas Semana y Mensajes visualmente pegadas en tabla del empleado | Sin padding horizontal en la tabla de métricas del equipo | `pr-4` en columna Semana, `px-3` en Mensajes/Conversión/T. producción |
| Gastos no aparecían tras registrarlos | `new Date().toISOString().split('T')[0]` (UTC) daba fecha futura después de las 21:00 ARG | Fecha default cambiada a `periodoActual.fechaHasta` |
| Botón "Cerrar semana" no aparecía el lunes | `semanaTerminada = !rango.esActual`; el lunes el período sigue siendo "actual" | Agregado `\|\| rango.hasta < hoyLocalStr` a la condición |
| **Métricas de equipo del Laboratorio fallaban silenciosamente para semanas fuera de las últimas 8** | `construirContextoKpis()` (privada, ahora extraída) usaba `obtenerMetricasHistorico(8).find(...)` en vez de pedir el período exacto | Reemplazado por `obtenerMetricasPeriodo(desde)` directo, en el módulo compartido `src/lib/reportes/contexto-semana.ts` — beneficia al Laboratorio y al Informe mensual por igual |
| **Semanas del mes que todavía no arrancaron aparecían en el Informe mensual con todo en cero** | `decomponerMesEnSemanas()` incluía semanas futuras del rango del mes seleccionado | `generarInformeMensual()` filtra `s.desde <= hoyLocal` antes de armar el informe |
| **Teléfonos de clientes exportados sin código de país** | Primera versión de `normalizarCelularArg` solo tomaba los últimos 10 dígitos, descartando `+54` | Reescrito para reconstruir el formato internacional completo `+549...`, validado contra ~1000 números reales de producción (99.1% de cobertura) |
| **"Application error" en el navegador tras correr `npx next build`** | `next build` corrió mientras `npm run dev` seguía activo — ambos comparten la carpeta `.next` y quedó en un estado mixto (chunks de dev y de producción mezclados) | `pkill -f "next dev"`, `rm -rf .next`, relevantar `npm run dev` limpio. No correr build y dev en paralelo sobre el mismo `.next` |
| **`git push` fallaba con "could not read Username" / "Invalid username or token"** | No había ningún token de GitHub accesible desde el entorno de Claude Code (ni en el keychain, ni en `~/.git-credentials`, ni `~/.netrc`) | Se instaló `gh` CLI (`brew install gh`) y Lucas hizo `gh auth login` (browser/device flow, Claude nunca vio el token) + `gh auth setup-git`. Desde entonces `git push` funciona directo — ver sección 1 |

---

## 13. SISTEMA DE EMPLEADOS + STOCK — ESPECIFICACIÓN IMPLEMENTADA (referencia)

### 13.1 Autenticación / roles
`usuarios.rol` (admin/empleado) + `usuarios.activo`. UI de gestión en `/usuarios`. Baneo real a nivel Auth al desactivar. Middleware extiende chequeo de `activo` y bloqueo de rutas admin (lista `adminRoutes` en `src/middleware.ts`, incluye `/clientes` desde la sesión del 31 jul).

### 13.2 Dashboard de empleados
- `/panel` en vez de `/dashboard` (colisión de URL).
- `metas_equipo.descripcion` es texto libre sin monto sugerido (principio 2.10).
- `/usuarios` separado de `/equipo` (respeta separación de migración 017).
- Grilla de stats 2 columnas: Pedidos + Margen neto. Sin hamburguesas vendidas.

### 13.3 Módulo de stock
- `conteo_en_unidad_receta` como toggle por ingrediente.
- Las compras siempre en `unidad_compra`; conteo físico puede estar en cualquiera de las dos unidades.
- Respaldo si falta conteo de inicio: cierre de semana anterior, con fuente marcada explícitamente en la UI.

---

## 14. SALUD DE CLIENTES + MÉTRICAS DE EQUIPO + LABORATORIO — ESPECIFICACIÓN IMPLEMENTADA

### 14.1 Salud de Clientes — "entraron en riesgo esta semana" + registro de contacto

- `clientes_contactos` (migración 032): id, cliente_id (FK CASCADE), fecha, metodo (llamada/whatsapp/otro), nota.
- `volvioAComprar` se calcula en vivo: existe algún pedido con `fecha > fecha_contacto`. Sin ventana fija.
- `nuevos_en_riesgo_detalle`: clientes que cruzaron el umbral de riesgo en los últimos 7 días específicamente.
- `PanelContactoCliente` (SidePanel): reutilizado en SeccionNuevosEnRiesgo y ModalAltoValor.
- Nota: esta segmentación (activo/en riesgo/nuevo-perdido con ventana `cliente_ventana_activo_dias=21`) es **distinta** de la segmentación por recencia de `/clientes/exportar` (0-14/15-45/+45 días, sección 8) — sirven propósitos distintos (salud de cartera vs. targeting de difusión) y no comparten código ni umbrales.

### 14.2 Métricas de equipo

5 métricas base por semana (`metricas_equipo_semana`): mensajes recibidos, mensajes convertidos, tiempo de producción, quejas faltantes (conteo legacy), quejas calidad (conteo legacy).

Detalle por período (`metricas_faltantes_detalle` + `metricas_quejas_detalle`): sustituyen los enteros legacy con listas completas de ítems. Texto generado dinámicamente en UI, no guardado.

Métrica derivada: `pedidosEnPeriodo` (calculado en el server action con admin client; no guardado en DB). Permite mostrar `% de pedidos con error` tanto en el formulario admin (tiempo real, reactivo al estado del formulario) como en la tabla del empleado.

### 14.3 Laboratorio — recomendaciones de IA + decisión + resultado + evaluación automática

**Generación (manual):**
1. Lucas elige un período y aprieta "Generar recomendaciones".
2. `construirContextoSemana()` (`src/lib/reportes/contexto-semana.ts` — extraída en la sesión del 31 jul, antes vivía como función privada acá) junta: financiero, clientes, equipo, merma, Meta Ads totales + porConjunto. Cualquier bloque sin datos queda como `"sin_datos_todavia"`.
3. Llamada a Anthropic (`claude-opus-4-8`) con `zodOutputFormat()` + `response.parsed_output`.
4. Borra todas las `'sugeridas'` del período (fix del bug de acumulación).
5. Inserta cada recomendación como fila individual en `decisiones_laboratorio`, estado `'sugerida'`.

**Seguimiento:**
- `registrarDecision()` → estado `'decidida'`, queda `fecha_decision`.
- `registrarResultado()` → estado `'evaluada'`.

**Evaluación automática post-cierre:**
Al cerrar una semana, el dashboard cuenta cuántas decisiones `'decidida'` tienen ya una semana cerrada posterior para comparar, y muestra un banner descartable con link a `/laboratorio`.

`aplicarResumenSugerido()` genera `resumenSugerido` — texto por código determinístico, no por IA.

---

## 15. IMPORTACIÓN DE META ADS + DETALLE POR CONJUNTO — ESPECIFICACIÓN COMPLETA

### 15.1 Flujo de importación original (totales)

1. **Parseo** (`parseMetaAdsCsv`): CSV puro, sin dependencias. Busca columnas por nombre. Suma todas las filas.
2. **Conversión**: `gastoArs = gastoUsd × tipoCambio`. El tipo de cambio lo ingresa Lucas a mano.
3. **Reemplazo**: borra TODO gasto `categoria='publicidad'` en el rango de fechas y si `gastoArs > 0` crea uno nuevo.
4. **Upsert** en `meta_ads_importaciones` por `periodo_desde`.
5. **Deshacer** (`eliminarMetaAdsPeriodo`): borra gasto vinculado + fila de importación + detalle en cascada.

### 15.2 Detalle por conjunto

**Parser** (`src/lib/utils/meta-ads-parser.ts`):
- Nuevo tipo `MetaAdsFilaDetalle`: `{ nombreCampana, nombreConjunto, nombreAnuncio, gastoUsd, alcance, impresiones, conversaciones, costoResultadoUsd, ctrEnlace, clicsEnlace }`.
- `MetaAdsParseResult` incluye `filas: MetaAdsFilaDetalle[]` y `conjuntosDetectados: string[]`.
- Filtro: solo se incluyen en `filas` las rows con `gastoUsd > 0 OR conversaciones > 0`.
- Helper `parseNumeroOpcional(raw)`: devuelve `null` si el campo está vacío.

**Formulario 2 pasos** (`FormImportarMetaAds`):
- **Paso 1:** archivo CSV + tipo de cambio.
- **Paso 2:** radio buttons caliente/fría por conjunto. Botón "Confirmar importación" habilitado cuando todos clasificados.

**Server action** (`importarMetaAds`): acepta `tipoAudienciaMap` y `filas`. Upsert + reemplazo de detalle.

**Consulta para el Laboratorio y el Informe mensual** (`obtenerDetalleMetaAds(periodoDesde)`): agrupa por `nombre_conjunto`. Devuelve `MetaAdsConjuntoResumen[]` — campo del nombre es `nombre`, no `nombreConjunto` (ojo si se reusa este tipo).

### 15.3 Eliminar cierre

Botón "Eliminar cierre" en Tabla Semanal de Evolución, con confirmación de dos pasos. Llama a `eliminarCierre(periodoId)`. Solo borra el snapshot — no toca tablas operativas.

### 15.4 Integración con el Laboratorio y el Informe mensual

Ambos usan `construirContextoSemana()` (sección 8), que agrega `metaAds.porConjunto` al contexto.

### 15.5 Procedimiento para corregir una semana ya cerrada con datos de Meta Ads

1. En `/gastos`, borrar el/los gasto(s) de publicidad manual de esa semana.
2. "Importar Meta Ads" → CSV de esa semana histórica → **tipo de cambio de esa semana** → clasificar conjuntos → confirmar.
3. Dashboard → Evolución → "Eliminar cierre" de esa semana → confirmar.
4. Volver a cerrar la semana.

Hacer los 4 pasos seguidos — mientras tanto la semana aparece como "no cerrada".

---

## 16. PRÓXIMA ETAPA

No hay una etapa grande sin especificar pendiente. Lo que sigue es operar lo ya construido (ver roadmap, sección 17). Ideas que surgieron pero **no se acordaron en detalle** — no avanzar sin conversar con Lucas:
- ¿Simplificar el procedimiento de "Eliminar cierre + reimportar" en un solo botón ("Corregir y recerrar")?
- ¿Agregar comparación de conjuntos de Meta Ads semana a semana en el Laboratorio?
- ¿Extender el filtro de `obtenerGastosPeriodo` para cubrir lunes-jueves además de Vie-Dom?
- ¿Agregar los umbrales configurados (`alerta_margen_minimo`, `alerta_publicidad_maxima`, bandas de margen, récords históricos) al texto del Informe mensual, para que la IA tenga la propia vara de medir de Lucas en vez de tener que inferirla? Ofrecido esta sesión, Lucas dijo que por ahora no hace falta.
- ¿Mover los umbrales de segmentación de `/clientes/exportar` (14 y 45 días, hoy hardcodeados) a `configuracion`, como el resto de los umbrales del sistema?
- ¿Vale la pena registrar en base cada difusión de WhatsApp enviada (grupo, fecha, cantidad), para poder cruzarlo después con si esos clientes volvieron a comprar? Hoy `/clientes/exportar` es de solo lectura/exportación, no deja rastro.

---

## 17. ROADMAP — ESTADO COMPLETO

| Etapa | Estado |
|-------|--------|
| Deploy en Vercel + dominio + Supabase Auth en producción | ✅ Completo |
| Sistema de roles/permisos para empleados | ✅ Completo |
| Gestión de usuarios (crear/desactivar accesos) | ✅ Completo |
| Dashboard de empleados (`/panel`) | ✅ Completo |
| Sistema de metas/recompensas configurable | ✅ Completo |
| Módulo de stock: compras + conteos + análisis de merma | ✅ Completo (código y RLS) |
| Salud de clientes: "entraron en riesgo esta semana" + registro de contacto | ✅ Completo |
| Métricas de equipo (carga manual + evolución para empleados) | ✅ Completo |
| Laboratorio: recomendaciones de IA + decisión + resultado | ✅ Completo |
| Laboratorio: evaluación automática post-cierre (banner + resumen por código) | ✅ Completo |
| Importación de Meta Ads (CSV → gasto en ARS + métricas totales) | ✅ Completo |
| Detalle de Meta Ads por conjunto con tipo de audiencia caliente/fría | ✅ Completo |
| Dashboard admin: 3 zonas + 6 cards Zona 1 | ✅ Completo |
| Panel empleados: grilla 2 columnas (Pedidos + Margen neto) | ✅ Completo |
| Métricas de equipo: faltantes con producto + precio congelado + quejas con texto libre | ✅ Completo |
| Métricas de equipo: % de pedidos con error (admin + empleado) | ✅ Completo |
| Informe mensual por semana operativa, exportable para IA (dashboard) | ✅ Completo (sesión 31 jul) |
| Exportar clientes segmentados por recencia para WhatsApp Business (`/clientes/exportar`) | ✅ Completo (sesión 31 jul) |
| Extracción de `construirContextoSemana()` compartida (Laboratorio + Informe mensual) | ✅ Completo (sesión 31 jul) |
| **Reabrir semana cerrada desde el header del dashboard** | ✅ **Completo esta sesión** |
| **Duplicar producto con receta e ingredientes** | ✅ **Completo esta sesión** |
| **Eliminar producto sin historial real (con bloqueo si tiene ventas/consumo)** | ✅ **Completo esta sesión** |
| **Push a GitHub configurado (`gh` CLI autenticado) — Claude Code puede pushear solo** | ✅ **Completo esta sesión** |
| Reimportar Meta Ads semanalmente con el CSV semanal | ⏳ En curso (operación regular) |
| Continuar midiendo merma — cargar conteos reales de los 4 ingredientes controlados | ⏳ En curso (operación regular) |
| Evaluar módulo de stock con datos reales (¿ajustar umbrales del semáforo?) | ⏳ Pendiente, depende de más semanas de medición |
| Reimportar semanas históricas cerradas desde Meta Ads (procedimiento 15.5) | ⏳ Pendiente — acción de Lucas, necesita CSV históricos y tipo de cambio de cada semana |
| Operación semanal (cierres de período, evaluación de decisiones del Laboratorio) | ⏳ En curso — ver `/dashboard` → Evolución para el estado actualizado, no verificado en esta sesión |
| Próxima etapa grande de funcionalidad nueva | ⏳ Sin especificar (sección 16) — conversar con Lucas primero |

---

## 18. INSTRUCCIONES PARA ARRANCAR

### Al iniciar en Claude Code:
1. Leer este handoff completo antes de tocar cualquier archivo.
2. Verificar el estado actual del código con `npx next build` — resolver errores de TypeScript antes de agregar funcionalidades.
3. Revisar `ls -la src/app/` para confirmar que la estructura coincide con la sección 9.
4. Antes de tocar cualquier módulo marcado ✅, consultar con Lucas.
5. Antes de escribir código para la próxima etapa grande (sección 16), conversar con Lucas para definir el alcance.

### Archivos clave a revisar antes de empezar:
- `src/app/(admin)/dashboard/actions.ts` — `KpisPeriodo`, `calcularKpis()`, `obtenerSaludClientes()`
- `src/app/(admin)/dashboard/actions-informe.ts` — `generarInformeMensual()`
- `src/app/(admin)/dashboard/page.tsx` — 3 zonas, `KpiCardHero`, `ZonaDivisor`, `SeccionColapsable`, botón Informe para IA, `AccionEliminarCierre` (botón "Reabrir semana")
- `src/app/(admin)/productos/actions-productos.ts` — `duplicarProducto()`, `eliminarProducto()` (bloquea si tiene historial real)
- `src/app/(admin)/productos/ProductosTab.tsx` — íconos duplicar/archivar/eliminar por fila, confirmación inline
- `src/lib/reportes/contexto-semana.ts` — `construirContextoSemana()`, compartida por Laboratorio e Informe mensual
- `src/lib/reportes/informe-mensual.ts` — `decomponerMesEnSemanas()`, `formatearInformeMensual()`
- `src/app/(admin)/clientes/exportar/actions.ts` — `obtenerSegmentacionClientes()`, `normalizarCelularArg()`
- `src/app/(admin)/equipo/actions.ts` — `FaltanteItem`, `QuejaItem`, `fetchImpIds()`, `guardarMetricasPeriodo`
- `src/app/(admin)/laboratorio/actions.ts` — flujo de IA + evaluación automática + regla caliente/fría
- `src/app/(admin)/gastos/actions-meta-ads.ts` — importación de Meta Ads + detalle por conjunto
- `src/lib/utils/meta-ads-parser.ts` — parser con `MetaAdsFilaDetalle` y `conjuntosDetectados`
- `src/app/(admin)/evolucion/actions.ts` — `cerrarPeriodo`, `validarCierre`, `eliminarCierre`
- `src/app/(admin)/stock/actions.ts` — `obtenerAnalisisMerma()`, fórmula con unidades mixtas
- `src/app/(empleado)/panel/actions.ts` — patrón de "calcular completo, exponer solo lo seguro"
- `src/middleware.ts` — autenticación, roles, chequeo de `activo`, `adminRoutes`

### Variables de entorno necesarias:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY          ← confirmar que está en Vercel, no solo en .env.local
```

### Comandos útiles:
```bash
npm run dev          # desarrollo local
npx next build       # verificar errores de TypeScript antes de entregar
git push origin main # dispara auto-deploy en Vercel (gh configurado, no debería pedir credenciales — ver sección 1)
```

### Cómo entregar código:
- Siempre verificar que compila (`npx next build`) antes de entregar.
- Cuando se toca `dashboard/actions.ts`, siempre revisar `dashboard/page.tsx` al mismo tiempo.
- Si se toca `gastos/actions-meta-ads.ts` o `meta-ads-parser.ts`, revisar si `laboratorio/actions.ts` o `src/lib/reportes/contexto-semana.ts` necesitan actualizarse.
- Si se toca `stock/actions.ts`, revisar si `ConteoForm.tsx` necesita el mismo cambio.
- Si se toca `src/lib/reportes/contexto-semana.ts`, revisar que tanto Laboratorio como el Informe mensual sigan andando — es código compartido.
- Nunca usar `new Date()` directamente en JSX.
- Nunca usar `new Date().toISOString().split('T')[0]` para la fecha local — usar fecha local explícita (client-side: `getFullYear()`/etc.; server-side: `Intl.DateTimeFormat` con timezone explícito — ver sección 3).
- Nunca usar `await import(...)` dentro de componentes React.
- Nunca usar separadores Unicode (═══) en archivos SQL.
- Nunca editar una migración ya aplicada — agregar una nueva.
- Design tokens siempre, nunca colores hardcodeados.
- Cualquier server action que use `createAdminClient()` debe verificar el rol del caller al principio.
- Antes de testear contra producción algo que escribe/borra en tablas operativas, verificar si el período coincide con una semana real ya cerrada.
- Antes de escribir un normalizador/parser de un dato que viene de una fuente externa (Pedix, Meta Ads), relevar una muestra real de los datos en vez de asumir un único formato.
- Para testear en navegador contra producción con login real: Playwright vía `npm install --no-save playwright && npx playwright install chromium` (no dejar el paquete instalado ni scripts de prueba en el repo al terminar). **Alternativa usada esta sesión:** si el skill `claude-in-chrome` está disponible, es más simple — usa la sesión de Chrome ya logueada de Lucas (él hace login una vez en la pestaña), sin instalar nada ni dejar rastro.
- Nunca correr `npx next build` con `npm run dev` corriendo en paralelo — corrompen la misma carpeta `.next` (ver sección 3 y 12).

### Si un push no dispara un deploy nuevo en Vercel:
Confirmar con `git ls-remote origin main` que GitHub tiene el commit. Si lo tiene pero Vercel no muestra deployment nuevo, un commit vacío (`git commit --allow-empty -m "Retrigger deploy"`) con push normal suele resolverlo.

---

## 19. RIESGOS Y CONSIDERACIONES TÉCNICAS

1. **Tablas placeholder:** Si una migración falla con "column not found", verificar con `SELECT column_name FROM information_schema.columns WHERE table_name = 'tabla'`.
2. **`formatDate` con timestamps:** `created_at` viene como ISO. Usar `.split('T')[0]` antes de pasar a `formatDate()`.
3. **Envíos duplicados en JOINs:** `SUM(envio_cobrado)` se multiplica por cantidad de líneas si se hace JOIN con `pedidos_lineas`. Consultar envíos por separado.
4. **`consumo_interno` tiene columnas legacy** nullable, no usadas. No borrar.
5. **El Excel de Pedix** tiene una fila "Totales" al final que el parser descarta automáticamente.
6. **`periodos` sin detalle:** semanas cerradas antes de la migración 023 no tienen filas en `periodos_productos`/`periodos_gastos`. Por diseño.
7. **RLS y empleados:** cualquier tabla nueva que un empleado necesite leer requiere una policy explícita. Ninguna tabla con datos en pesos debe tener policy para `rol = 'empleado'` ni `USING (true)`.
8. **`createAdminClient()` bypasea RLS.** Verificar el rol del caller con el cliente normal ANTES.
9. **Desactivar un usuario** requiere banear a nivel Auth además de actualizar `usuarios.activo`.
10. **Unidades mixtas en stock:** si se agrega cualquier cálculo que combine `conteos_stock` con `compras_ingredientes`, convertir cada término individualmente — nunca sumar primero y convertir al final.
11. **No instalar herramientas de testing como dependencia permanente.** Playwright (o `chromium-cli` si está disponible) se instala/usa de forma efímera cada vez.
12. **`gastos_operativos` no tiene guard de período cerrado.** Un borrado accidental de un gasto real no avisa que esa semana ya está congelada en `periodos`.
13. **`meta_ads_detalle` tipo_audiencia CHECK ('caliente', 'fría'):** si se agregan nuevos tipos de audiencia, hay que agregar una migración que extienda el CHECK.
14. **`conjuntosDetectados` en el parser** solo incluye conjuntos de filas con actividad real (gasto > 0 OR conversaciones > 0).
15. **Regenerar recomendaciones del Laboratorio** borra todas las `'sugeridas'` del período antes de insertar nuevas. Las decididas/evaluadas no se tocan. No hay riesgo.
16. **El force-push a una rama con auto-deploy puede no disparar un build en Vercel.** Ver sección 18.
17. **`obtenerGastosPeriodo` filtra estrictamente Vie-Dom.** Un gasto cargado con fecha de lunes o martes se guarda pero no aparece en la vista del período actual.
18. **`semanaTerminada` usa fecha local del browser.** Caso extremo, poco probable, si el reloj del navegador está mal configurado.
19. **`pedidosEnPeriodo` en métricas** se calcula con admin client en cada carga; histórico usa 1 query cubriendo todo el rango — costo fijo, no debería ser problema en los volúmenes actuales.
20. **`normalizarCelularArg()` asume área de 3 dígitos** para desambiguar el patrón "0-área-15-número" del discado local. Si en el futuro entran muchos clientes de zonas con área de 2 o 4 dígitos, esos números específicos (con "15" intercalado) quedarán excluidos — contados en `sinFormatoValido`, nunca mal armados — en vez de resueltos. No hay tabla de códigos de área en el sistema; agregarla sería la forma de subir la cobertura del 99.1% actual.
21. **`construirContextoSemana()` (Informe mensual) se llama una vez POR SEMANA del mes** — hasta 5 llamadas, cada una disparando ~6 queries (financiero, clientes, equipo, merma, Meta Ads×2). Costo aceptable a la escala actual (~900 pedidos/mes), pero si el volumen de pedidos o la cantidad de meses a exportar crece mucho, conviene revisar.
22. **Los umbrales de segmentación de `/clientes/exportar` (14 y 45 días) están hardcodeados**, a diferencia del resto de los umbrales del sistema que viven en `configuracion`. Ver sección 16.
23. **Reabrir una semana (`eliminarCierre()`) no recalcula nada solo** — borra el snapshot y listo. Si Lucas reabre para corregir algo, tiene que efectivamente corregir el dato (gasto, importación, etc.) y volver a apretar "Cerrar semana" — si no, la semana queda sin snapshot hasta que la vuelva a cerrar.
24. **La navegación por semanas del dashboard (← / →) usa `startTransition`** y puede "lagear" visiblemente si se hacen varios clicks rápidos seguidos (ver sección 3) — es un comportamiento preexistente de React, no algo introducido esta sesión, pero conviene saberlo antes de automatizar clicks o de asumir que la UI está sincronizada de inmediato tras navegar.
25. **`eliminarProducto()` no tiene un `exigirAdmin()` explícito** (como tampoco lo tienen `crearProducto`/`actualizarProducto`/`duplicarProducto` en el mismo archivo) — se apoya en que `productos` y `productos_precios` tienen RLS `admin_full_access` (migración 005) más el gate de ruta `(admin)`. Coherente con el resto del archivo, pero si en algún momento se refactoriza para agregar `exigirAdmin()` en otros módulos, valdría hacerlo acá también por consistencia.
