# ROYALTY — Handoff Técnico Completo v7
## Fecha: 26 de junio de 2026

Sos el nuevo Claude (o Claude Code) que continúa el desarrollo de ROYALTY, el sistema de gestión de Royalty Burgers (Rosario, Argentina). Este documento es la fuente de verdad del proyecto y **reemplaza a ROYALTY_Handoff_v6.md** (eliminado). No tenés acceso al chat anterior — toda la información que necesitás está acá.

---

## 1. CONTEXTO DEL PROYECTO

**Negocio:** Royalty Burgers. Hamburguesería que opera viernes, sábado y domingo. El "período operativo" es Vie-Sáb-Dom.

**Usuario principal:** Lucas (dueño). Técnicamente competente. No acepta código provisional. Espera que cada decisión de arquitectura financiera se consulte antes de implementar. Prefiere entender el "por qué" antes del "cómo". Tiene plan Pro de Claude.

**Stack:** Next.js 15 (App Router), React 19, TypeScript strict, Tailwind v4, Supabase (PostgreSQL + Auth + RLS), Vercel. Sin ORMs ni state managers. Server Actions en `actions.ts` con `'use server'`. `@anthropic-ai/sdk` + `zod` para el módulo de IA (Laboratorio).

**Objetivo del sistema:** Medir ventas, costos, beneficio y margen semana a semana, con datos financieramente auditables e inmutables hacia el pasado. Responde: ¿qué pasó?, ¿por qué pasó?, ¿qué tan saludable está el negocio?, ¿estoy construyendo una base de clientes fieles?, ¿el equipo está alineado con el objetivo de margen?, ¿hay merma de stock?, ¿qué debería hacer distinto la semana que viene, y funcionó lo que decidí la vez pasada?, y ahora también: ¿qué conjunto de anuncios de Meta Ads debería escalar o pausar esta semana, según el tipo de audiencia?

**Estado del deploy: ✅ COMPLETO.**
- Repo privado en GitHub: `https://github.com/radycal3/royalty`.
- Vercel conectado al repo, auto-deploy en cada push a `main`.
- Dominio `royaltyburgers.club` (comprado en Porkbun) conectado y con SSL activo. El apex redirige (308) a `www.royaltyburgers.club`, que es el dominio canónico.
- Variables de entorno en Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`.
- Supabase Auth → Site URL y Redirect URLs apuntan a `https://www.royaltyburgers.club` (manteniendo `http://localhost:3000/**` para desarrollo local).
- Identidad de Git de Lucas ya configurada globalmente (`user.name "Lucas Alaniz"`, `user.email "bsediciones@gmail.com"`).

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

**Excepción explícita y deliberada:** `eliminarCierre()` (sección 15.3) borra intencionalmente un snapshot de `periodos` para permitir corregirlo y volver a cerrarlo. No es una recalculación automática: es una acción admin explícita de dos pasos con confirmación.

### 2.2 Costos y precios append-only
`ingredientes_costos` y `productos_precios` **nunca se editan ni borran**. Solo se agregan filas con nueva `fecha_vigencia`. La resolución del valor vigente usa siempre `.order('fecha_vigencia', DESC).order('created_at', DESC)` — dos criterios, siempre.

### 2.3 Períodos operativos = Vie + Sáb + Dom
La función SQL `periodo_de(fecha)` devuelve el viernes de la semana operativa. El selector de rango del dashboard soporta Semana / Mes / Trimestre / Año / Personalizado, pero la unidad de snapshots es siempre la **Semana operativa**.

### 2.4 Importaciones anulables
`importaciones.estado` es `'activa'` o `'anulada'`. **Todas las queries filtran por `estado = 'activa'`**. El dedup de `pedido_pedix_id` solo compara contra importaciones activas.

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

**Extendido al Laboratorio:** las recomendaciones las genera la IA, pero el `SYSTEM_PROMPT` exige citar el número concreto del contexto que motiva cada una y prohíbe generar recomendaciones sobre áreas marcadas `sin_datos_todavia`. La comparación automática "antes vs. después" de una decisión (`resumenSugerido`) **no la genera la IA** — la genera código determinístico. Confirmado explícitamente por Lucas: "más rápido, gratis y consistente con la filosofía del sistema."

**Extendido a Meta Ads (NUEVO esta sesión):** el `SYSTEM_PROMPT` del Laboratorio prohíbe explícitamente comparar el costo por conversación entre conjuntos de audiencia caliente y fría — son tipos de audiencia fundamentalmente distintos (caliente tiene menor volumen pero mayor conversión a pedido real; fría tiene más conversaciones pero menor conversión). La comparación entre tipos llevaría a conclusiones incorrectas. Solo se compara costo por conversación entre conjuntos del **mismo tipo de audiencia**.

### 2.10 Separación admin / empleado
Los empleados solo ven lo que Lucas decide mostrarles. Nunca ven montos en pesos — solo porcentajes y cantidades físicas. El dashboard de empleados es una pantalla separada con su propia ruta (`/panel`).

**Defensa en profundidad:** el dato financiero completo se calcula server-side y se reduce a `{ pedidos, margenNeto }` antes de que la respuesta salga del server action. `decisiones_laboratorio`, `meta_ads_importaciones` y `meta_ads_detalle` son admin-only a nivel RLS.

**Panel de empleados (ACTUALIZADO esta sesión):** se eliminó el contador de hamburguesas vendidas. La grilla quedó en 2 columnas: Pedidos y Margen neto. El `margenNeto` es el valor real de `calcularKpis` sin modificación.

### 2.11 Laboratorio: disparo manual, sin generación automática
El botón "Generar recomendaciones" en `/laboratorio` es la única forma de llamar a la API de Anthropic. No hay cron, no hay generación al cerrar la semana. Costo predecible, sin ruido. Cualquier extensión futura requiere **consultar con Lucas** — no asumir que "más automático es mejor".

---

## 3. PATRONES DE CÓDIGO OBLIGATORIOS

```typescript
// Imports de Supabase
import { createClient } from '@/lib/supabase/server';     // usuario autenticado, respeta RLS
import { createAdminClient } from '@/lib/supabase/admin'; // bypasea RLS — verificar rol manualmente

// CRÍTICO: createAdminClient() bypasea RLS por completo. Siempre verificar rol del caller
// con el cliente normal ANTES de usar el admin client.

// UI Components (src/components/ui)
// Exporta: SidePanel, Field, Input, Select, Button, Badge, EmptyState, Tabs, useToast
// Badge usa prop "color" (green/yellow/red/gray), NO "variant"
// useToast: const { show, Toast } = useToast(); — Toast debe montarse en JSX

// Formato
import { formatARS, formatDate, formatPercent } from '@/lib/utils/format';

// Design tokens (NUNCA colores hardcodeados tipo text-zinc-* o text-emerald-*)
// Usar: text-text-primary, text-text-secondary, text-text-muted
//       bg-surface, bg-surface-alt, border-border
//       text-positive, text-warning, text-negative
//       bg-positive-bg, bg-warning-bg, bg-negative-bg, bg-brand-light

// Componentes del dashboard admin (NUEVO esta sesión):
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
```

## 4. MIGRACIONES SQL — ESTADO COMPLETO

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
| 036 | `036_meta_ads_detalle.sql` | **NUEVO esta sesión.** Tabla `meta_ads_detalle` (detalle por anuncio/conjunto, con `tipo_audiencia`). ON DELETE CASCADE desde `meta_ads_importaciones`. Admin-only | ✅ Aplicado |
| 037 | `037_meta_ads_detalle_fix_tipos.sql` | **NUEVO esta sesión.** ALTER TABLE `meta_ads_detalle`: cambia `costo_por_resultado_usd` y `ctr_enlace` de `NUMERIC(n,m)` a `NUMERIC` sin restricción — fix de "numeric field overflow" con valores de muchos decimales del CSV real | ✅ Aplicado |

---

## 5. ESQUEMA DE BASE DE DATOS ACTUAL

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
- **`pedidos`** — importacion_id, pedido_pedix_id (UNIQUE), fecha, hora, envio_cobrado, cliente_id (FK nullable), cliente_celular, cliente_nombre, cliente_direccion.
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
- **`metricas_equipo_semana`** — id, periodo_desde (UNIQUE), periodo_hasta, mensajes_recibidos, mensajes_convertidos, tiempo_promedio_produccion_min, quejas_faltantes, quejas_calidad. Sin ningún campo en pesos.

### 5.12 Stock
- **`compras_ingredientes`** — id, fecha, ingrediente_id, cantidad, unidad, costo_total, proveedor, nota, registrado_por. Siempre en `unidad_compra` real.
- **`conteos_stock`** — id, fecha, ingrediente_id, cantidad, unidad, tipo ('inicio_semana'/'fin_noche'), nota, registrado_por. UNIQUE(fecha, ingrediente_id, tipo).

### 5.13 Laboratorio
- **`decisiones_laboratorio`** — id, periodo_desde, periodo_hasta, area, recomendacion, justificacion, decision_tomada, fecha_decision, resultado, fecha_resultado, estado (sugerida/decidida/evaluada), registrado_por. Admin-only. Una fila = una recomendación individual.

### 5.14 Meta Ads
- **`meta_ads_importaciones`** — id, periodo_desde (UNIQUE), periodo_hasta, gasto_operativo_id (FK nullable a `gastos_operativos`, ON DELETE SET NULL), gasto_usd, tipo_cambio, gasto_ars, alcance, impresiones, clics, resultados, nombre_archivo, registrado_por. Admin-only. Upsert por `periodo_desde`.
- **`meta_ads_detalle`** (NUEVO esta sesión, migración 036+037) — id, importacion_id (FK → `meta_ads_importaciones` ON DELETE CASCADE), periodo_desde, nombre_campana, nombre_conjunto, nombre_anuncio, tipo_audiencia (CHECK: 'caliente'/'fría'), gasto_usd, gasto_ars, alcance, impresiones, conversaciones, costo_por_resultado_usd (NUMERIC sin restricción), ctr_enlace (NUMERIC sin restricción), clics_enlace. Admin-only. Índices en importacion_id y periodo_desde. Una fila = un anuncio individual filtrado (solo filas con gasto_usd > 0 OR conversaciones > 0).

### 5.15 Tablas Fase 0 eliminadas (migración 028)
`empleados`, `asistencia`, `stock_conteos`, `stock_compras` — dropeadas.

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

Notas: las metas de equipo viven en `metas_equipo`, no acá. El tipo de cambio de Meta Ads se ingresa a mano por importación — no es config global porque cambia cada semana.

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

### 7.10 Meta Ads por conjunto (NUEVO esta sesión)
```
costoPorConversacion = gastoArs_conjunto / conversaciones_conjunto  (null si conversaciones = 0)
ctrEnlace_conjunto   = (totalClics / totalImpresiones) × 100        (null si impresiones = 0)
```
Calculado en `obtenerDetalleMetaAds()` agrupando filas de `meta_ads_detalle` por `nombre_conjunto`. **REGLA CRÍTICA:** solo comparar `costoPorConversacion` entre conjuntos del mismo `tipo_audiencia` ('caliente' o 'fría') — los tipos tienen tasas de conversión a pedido radicalmente distintas y compararlos da conclusiones incorrectas.

---

## 8. MÓDULOS — ESTADO ACTUAL

### ✅ Dashboard financiero (ACTUALIZADO esta sesión)

`src/app/(admin)/dashboard/page.tsx` fue reestructurado en **3 zonas con jerarquía visual clara**:

**Zona 1 — Resultado rápido:** 6 cards grandes (`KpiCardHero`) en grilla `grid-cols-2 sm:grid-cols-3`:
1. Ventas (con delta vs semana anterior)
2. Beneficio neto (rojo si negativo)
3. Margen neto % (rojo si negativo)
4. ROAS (con lógica especial si no hubo publicidad o si es publicidad nueva)
5. Clientes que volvieron (`pedidosRepetidores`)
6. % facturación repetidores (`pctVentasRepetidores`)

**Zona 2 — Por qué ese resultado:** `ZonaDivisor` + Cascada P&L + Semáforo + ¿Qué cambió? (apilados verticalmente, no en columnas).

**Zona 3 — Evolución e inteligencia:** `ZonaDivisor` + `SeccionColapsable("Ranking de productos")` + `SeccionColapsable("Consumo de ingredientes")` + tabs de Evolución.

Componentes nuevos definidos localmente en `dashboard/page.tsx`:
- `KpiCardHero`: card con valor `text-3xl`, prop `colorValor` opcional para estados negativos
- `ZonaDivisor`: línea horizontal con label centrado, `data-print="hidden"`
- `SeccionColapsable`: toggle `useState` local, colapsado por defecto, contenido hidden cuando cerrado

Las 11 KPI cards del área principal anterior fueron eliminadas (la información sigue accesible en la cascada P&L y los tabs de Evolución).

`actions.ts`: sin cambios de fondo — `KpisPeriodo` ya tenía todos los campos necesarios (`pedidosRepetidores`, `pctVentasRepetidores`, etc.).

### ✅ Panel de empleados (ACTUALIZADO esta sesión)

`src/app/(empleado)/panel/page.tsx`: eliminado el contador de hamburguesas vendidas (`hamburguesasVendidas`). La grilla de stats pasó de 3 columnas a 2: Pedidos y Margen neto. `margenNeto` sigue siendo el valor real de `calcularKpis` — sin modificaciones.

### ✅ MÓDULOS ESTABLES (no tocar sin consulta)

**Auditoría Financiera Inteligente** (`/auditoria`), **Exportación PDF**, **Importación Pedix**, **Cadetes**, **Consumo interno**, **Productos / Ingredientes**, **Configuración** — sin cambios.

### ✅ Sistema de Empleados + Stock (construido en sesiones anteriores, sección 13)

**Gestión de usuarios** (`/usuarios`), **Módulo de stock** (`/stock`), **Conteo nocturno** (`/panel/stock`), **Metas del equipo**, **Métricas de equipo** — sin cambios.

### ✅ Salud de Clientes + Recuperación (construido en sesión anterior, sección 14.1)

Sin cambios.

### ✅ Laboratorio (ACTUALIZADO esta sesión)

`laboratorio/actions.ts`:
- `construirContextoKpis()` ahora llama a `obtenerDetalleMetaAds(desde)` y añade `metaAds.porConjunto` al contexto (array de `MetaAdsConjuntoResumen` con nombre, tipoAudiencia, gastoArs, conversaciones, costoPorConversacion, ctrEnlace). Si no hay detalle para esa semana (semana importada antes de esta feature), queda `[]`.
- `SYSTEM_PROMPT` tiene una **REGLA CRÍTICA** nueva: prohibición explícita de comparar `costoPorConversacion` entre conjuntos de distinto tipo de audiencia. Define caliente (seguidores/compradores previos) vs fría (audiencia nueva), y exige comparar solo entre conjuntos del mismo tipo.
- **Bug fix:** `generarRecomendaciones()` ahora borra todas las filas en estado `'sugerida'` del período antes de insertar las nuevas. Las `'decidida'` y `'evaluada'` no se tocan nunca. Antes de este fix, regenerar acumulaba recomendaciones encima de las anteriores.

### ✅ Importación de Meta Ads (ACTUALIZADO esta sesión — detalle por conjunto)

Ver sección 15 completa.

---

## 9. ARQUITECTURA DE ARCHIVOS

```
src/
  middleware.ts
  app/
    page.tsx, layout.tsx
    login/page.tsx
    globals.css
    (admin)/
      layout.tsx
      dashboard/
        actions.ts           ← KpisPeriodo + calcularKpis() + obtenerSaludClientes()
                                + obtenerContactosCliente/registrarContacto
        page.tsx             ← ACTUALIZADO esta sesión: 3 zonas (KpiCardHero/ZonaDivisor/
                                SeccionColapsable), banner post-cierre, AccionEliminarCierre
      importar/
      productos/
        actions-ingredientes.ts, actions-productos.ts
        IngredientesTab.tsx, ProductosTab.tsx, page.tsx
      gastos/
        actions.ts           ← PeriodoInfo, obtenerPeriodoActual/PorOffset/DeFecha
        actions-meta-ads.ts  ← ACTUALIZADO esta sesión: importarMetaAds acepta
                                tipoAudienciaMap + filas; obtenerDetalleMetaAds() nuevo;
                                MetaAdsConjuntoResumen type nuevo
        page.tsx             ← ACTUALIZADO esta sesión: FormImportarMetaAds en 2 pasos
                                (paso 1: archivo + tipo cambio; paso 2: clasificar conjuntos
                                caliente/fría por conjunto detectado)
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
        actions.ts           ← cerrarPeriodo, validarCierre, obtenerEvolucion, eliminarCierre
      auditoria/
        actions.ts
      laboratorio/
        actions.ts           ← ACTUALIZADO esta sesión: construirContextoKpis agrega
                                porConjunto; SYSTEM_PROMPT con regla caliente/fría;
                                generarRecomendaciones borra 'sugeridas' antes de insertar
        page.tsx
    (empleado)/
      layout.tsx
      panel/
        actions.ts
        page.tsx             ← ACTUALIZADO esta sesión: sin hamburguesas, grilla 2 cols
        stock/
          page.tsx
  lib/
    dashboard/
      rangos.ts
    supabase/
      server.ts, admin.ts, client.ts
    utils/
      pedix-parser.ts
      meta-ads-parser.ts     ← ACTUALIZADO esta sesión: MetaAdsFilaDetalle type nuevo;
                                MetaAdsParseResult agrega filas[] y conjuntosDetectados[];
                                detecta columnas: conjunto, campaña, anuncio, costoResultado,
                                CTR, clicsEnlace; filtra filas inactivas (gasto=0 Y conv=0);
                                parseNumeroOpcional() nueva helper
      format.ts, export.ts
  components/
    layout/
      Sidebar.tsx, AdminHeader.tsx, EmpleadoNav.tsx, LogoutButton.tsx
    stock/
      ConteoForm.tsx
    ui/index.tsx
supabase/
  migrations/
    ... (001–035 aplicadas, ver sección 4)
    036_meta_ads_detalle.sql      ← NUEVO esta sesión
    037_meta_ads_detalle_fix_tipos.sql ← NUEVO esta sesión
```

---

## 10. DATOS REALES DE ROYALTY (contexto de negocio)

**Historial:** finales de abril a 26 junio 2026. ~900 pedidos totales.

**Clientes:**
- 761 clientes únicos. 88.7% compraron 1 sola vez.
- Tasa de retención: 11.3% (historial de 2 meses — interpretar con cautela).
- Ciclo de compra: mediana 12 días, promedio 14.2 días → `cliente_ventana_activo_dias=21` correcto.

**Rentabilidad (semanas cerradas):**
- Semana 5-7 jun: Margen neto **-15.7%** → Pérdida.
- Semana 12-14 jun: Margen neto **-12.3%** → Pérdida (mejora).
- Semana 19-21 jun: Ventas $1.856.500, Beneficio neto -$140.859, Margen neto **-7.6%**, Publicidad 30.04% de ventas (~$557.710) → Mejora sostenida. Esta semana fue la primera donde Meta Ads se importó con detalle por conjunto, clasificando los conjuntos como caliente/fría.

**Delivery actual:** resultado ~-$181.000/semana.

**Merma:** el módulo está construido y deployado pero no hay conteos reales cargados todavía. En curso: medir manualmente 3 semanas (ver roadmap).

**Ingredientes controlados de stock:** Carne (48.9% del costo, cuenta en medallones), Cheddar (11.0%), Papas fritas Buttler (10.6%), Panes de papa (8.3%) — ~79% del costo total.

**Meta Ads:** módulo de importación con detalle por conjunto activo y deployado. La campaña actual ("Mensajes wsp Royalty / Junio 2026") tiene 4 conjuntos de anuncios: "Seguidores IG" y "Compradores Royalty" (caliente), "Abierto frio Royalty" y "Abierto frio Royalty - Copia" (fría).

**Laboratorio:** ya generó recomendaciones reales sobre datos reales (validadas como específicas y bien fundamentadas). Tiene decisiones registradas en producción. Es una herramienta en uso activo. La evaluación automática post-cierre está activa — al cerrar una semana, el dashboard muestra cuántas decisiones previas se pueden evaluar con los nuevos datos.

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
| `tipo_audiencia` en tabla separada (lookup conjunto→tipo) | Denormalizado por fila — más simple, sobrevive reimports, no necesita join extra |
| NUMERIC(n,m) para ctr_enlace y costo_por_resultado_usd | Causa overflow con decimales reales del CSV. Reemplazado por NUMERIC sin restricción |

---

## 12. BUGS RESUELTOS (para no reincidir)

| Bug | Causa | Fix |
|-----|-------|-----|
| `envio_cobrado` = $0 | Columna en Excel se llama "Cargos Envío" (plural) | Agregar primero en lista de candidatos de `findColumn` |
| Reimportación omitía pedidos | Dedup sin filtrar por importación activa | `importaciones!inner(estado)='activa'` en query de dedup |
| Gráfico de margen sin valores negativos | Eje Y hardcodeado [0, 100] | Eje Y dinámico con `min(0, ...valores) - 5` |
| `ROAS = undefined` | `actions.ts` y `page.tsx` desincronizados | Reemplazar ambos juntos siempre |
| Botón "Cerrar semana" no aparecía | Bug de timezone | `semanaTerminada = tipo==='semana' && (!esActual \|\| rango.hasta < hoyStr)` |
| Error de hidratación con SheetJS | `await import('xlsx')` durante SSR | CSV puro sin dependencias |
| Error de hidratación con `new Date()` en JSX | Servidor en UTC, cliente en UTC-3 | `suppressHydrationWarning` + `typeof window !== 'undefined'` |
| `npx next build` rompía por `src-fase0-backup` | Carpeta de respaldo vieja entraba al type-check | Excluida en `tsconfig.json` |
| `'salud' is possibly 'null'` en `dashboard/page.tsx` | Closure perdía el null-narrowing de TS | `fraseSemaforo` pasó a recibir `salud` como parámetro |
| Fuga de RLS en `periodos` (crítico) | `periodos_select` usaba `USING (true)` | Migración 030: policy admin-only + vista `periodos_margen_empleado` |
| Cálculo de merma con unidades mixtas | Sumar primero y convertir el total es incorrecto | Cada término se convierte individualmente antes de combinarse |
| Identidad de Git incorrecta bloqueaba deploy en Vercel | Nunca se configuró `git config --global user.email/user.name` | Resuelto: `git config --global user.email "bsediciones@gmail.com"` y `user.name "Lucas Alaniz"` |
| Force-push no disparó deploy nuevo en Vercel | Webhook de GitHub→Vercel no procesa push no-fast-forward igual que uno normal | Commit vacío (`git commit --allow-empty`) con push normal retriggerea el webhook |
| Test de Playwright sobrescribió datos reales | El período "actual" resultó ser la semana 19-21 jun ya cerrada | Usar fechas obviamente falsas para pruebas. El gasto se restauró inmediatamente; el snapshot `periodos` no se vio afectado |
| **Numeric field overflow al importar Meta Ads** | `ctr_enlace NUMERIC(8,6)` y `costo_por_resultado_usd NUMERIC(10,4)` no admitían los decimales reales del CSV de Meta Ads | Migración 037: ambos campos pasan a `NUMERIC` sin restricción |
| **Regenerar recomendaciones acumulaba encima de las anteriores** | `generarRecomendaciones()` insertaba filas nuevas sin borrar las `'sugeridas'` existentes del mismo período | Borrar todas las `'sugeridas'` del período antes de insertar las nuevas. Las `'decidida'` y `'evaluada'` nunca se tocan |

---

## 13. SISTEMA DE EMPLEADOS + STOCK — ESPECIFICACIÓN IMPLEMENTADA (referencia)

### 13.1 Autenticación / roles
`usuarios.rol` (admin/empleado) + `usuarios.activo`. UI de gestión en `/usuarios`. Baneo real a nivel Auth al desactivar. Middleware extiende chequeo de `activo` y bloqueo de rutas admin.

### 13.2 Dashboard de empleados
- `/panel` en vez de `/dashboard` (colisión de URL).
- `metas_equipo.descripcion` es texto libre sin monto sugerido (principio 2.10).
- `/usuarios` separado de `/equipo` (respeta separación de migración 017).
- **Actualización esta sesión:** grilla de stats 2 columnas (Pedidos + Margen neto). Sin hamburguesas.

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

### 14.2 Métricas de equipo

5 métricas operativas por semana (`metricas_equipo_semana`): mensajes recibidos, mensajes convertidos, tiempo de producción, quejas faltantes, quejas calidad. Sin ningún campo en pesos. Empleados ven evolución completa (policy SELECT directa).

`/equipo` tiene tab "Métricas semanales" con navegador de período. El formulario usa `key={periodo.viernes}` para forzar remount al cambiar de semana.

### 14.3 Laboratorio — recomendaciones de IA + decisión + resultado + evaluación automática

**Generación (manual):**
1. Lucas elige un período y aprieta "Generar recomendaciones".
2. `construirContextoKpis()` junta: financiero, clientes, equipo, merma (solo ingredientes con datos completos), Meta Ads totales + **porConjunto** (NUEVO esta sesión). Cualquier bloque sin datos queda como `"sin_datos_todavia"`.
3. Llamada a Anthropic (`claude-opus-4-8`) con `zodOutputFormat()` + `response.parsed_output`.
4. Borra todas las `'sugeridas'` del período (NUEVO esta sesión — fix del bug de acumulación).
5. Inserta cada recomendación como fila individual en `decisiones_laboratorio`, estado `'sugerida'`.

**Seguimiento:**
- `registrarDecision()` → estado `'decidida'`, queda `fecha_decision`.
- `registrarResultado()` → estado `'evaluada'`.

**Evaluación automática post-cierre:**
Al cerrar una semana, el dashboard cuenta cuántas decisiones `'decidida'` tienen ya una semana cerrada posterior para comparar, y muestra un banner descartable con link a `/laboratorio`.

`aplicarResumenSugerido()` genera `resumenSugerido` — texto por código determinístico, no por IA. Compara la semana de la decisión contra la semana más recientemente cerrada. Siempre incluye Margen neto y Ventas; agrega líneas según palabras clave en `area` (Delivery → resultadoDelivery; Publicidad/Costos → publicidadPct + Meta Ads si hay datos de ambas semanas; Equipo/Quejas/Mensajes → conversión + quejas; Merma/Stock → merma total).

---

## 15. IMPORTACIÓN DE META ADS + DETALLE POR CONJUNTO — ESPECIFICACIÓN COMPLETA

### 15.1 Flujo de importación original (totales)

1. **Parseo** (`parseMetaAdsCsv`): CSV puro, sin dependencias. Busca columnas por nombre con candidatos español/inglés. Suma todas las filas.
2. **Conversión**: `gastoArs = gastoUsd × tipoCambio`. El tipo de cambio lo ingresa Lucas a mano (no es config global).
3. **Reemplazo**: borra TODO gasto `categoria='publicidad'` en el rango de fechas y si `gastoArs > 0` crea uno nuevo con nota `"Importado de Meta Ads (USD X × $Y)"`.
4. **Upsert** en `meta_ads_importaciones` por `periodo_desde`.
5. **Deshacer** (`eliminarMetaAdsPeriodo`): borra gasto vinculado + fila de importación + detalle en cascada.

### 15.2 Detalle por conjunto (NUEVO esta sesión)

**Parser** (`src/lib/utils/meta-ads-parser.ts`):
- Nuevo tipo `MetaAdsFilaDetalle`: `{ nombreCampana, nombreConjunto, nombreAnuncio, gastoUsd, alcance, impresiones, conversaciones, costoResultadoUsd, ctrEnlace, clicsEnlace }`.
- `MetaAdsParseResult` ahora incluye `filas: MetaAdsFilaDetalle[]` y `conjuntosDetectados: string[]`.
- Columnas detectadas (por nombre, no por posición): Nombre del conjunto de anuncios, Nombre de la campaña, Nombre del anuncio, Coste por resultados, CTR (tasa de clics en el enlace), Clics en el enlace.
- Filtro: solo se incluyen en `filas` las rows con `gastoUsd > 0 OR conversaciones > 0`. Las inactivas (todo cero) se descartan.
- `conjuntosDetectados`: únicos de `filas` (solo conjuntos con actividad real).
- Nueva helper `parseNumeroOpcional(raw)`: devuelve `null` si el campo está vacío (vs `parseNumeroFlexible` que devuelve 0).

**Formulario 2 pasos** (`src/app/(admin)/gastos/page.tsx`, `FormImportarMetaAds`):
- **Paso 1:** archivo CSV + tipo de cambio. Al parsear, muestra cuántos conjuntos detectó. Botón "Continuar — clasificar audiencias" habilitado cuando hay archivo parseado y tipo de cambio > 0.
- **Paso 2:** por cada `conjuntoDetectado`, radio buttons caliente/fría. Botón "Confirmar importación" habilitado cuando todos los conjuntos están clasificados. Botón "← Volver" para corregir.

**Server action** (`importarMetaAds`):
- Acepta `tipoAudienciaMap: Record<string, 'caliente' | 'fría'>` y `filas: MetaAdsFilaDetalle[]`.
- El upsert a `meta_ads_importaciones` ahora hace `.select('id').single()` para obtener el `importacion_id`.
- Borra el detalle anterior (`meta_ads_detalle` WHERE `importacion_id`) y lo reemplaza con las filas nuevas.
- Para cada fila: `gasto_ars = gastoUsd × tipoCambio`, `tipo_audiencia = tipoAudienciaMap[fila.nombreConjunto]`.

**Consulta para el Laboratorio** (`obtenerDetalleMetaAds(periodoDesde)`):
- Agrupa filas de `meta_ads_detalle` por `nombre_conjunto` en código TypeScript (no SQL).
- Devuelve `MetaAdsConjuntoResumen[]`: `{ nombre, tipoAudiencia, gastoArs, conversaciones, costoPorConversacion, ctrEnlace }`.
- `costoPorConversacion`: null si conversaciones = 0.
- `ctrEnlace`: weighted average (totalClics / totalImpresiones × 100), null si impresiones = 0.

### 15.3 Eliminar cierre

Botón "Eliminar cierre" en Tabla Semanal de Evolución, con confirmación de dos pasos. Llama a `eliminarCierre(periodoId)` en `evolucion/actions.ts` (verifica rol admin). Solo borra el snapshot — no toca tablas operativas. `periodos_productos`/`periodos_gastos` caen en cascada.

### 15.4 Integración con el Laboratorio

`construirContextoKpis()` llama a `obtenerDetalleMetaAds(desde)` y agrega `metaAds.porConjunto` al contexto JSON. Si no hay detalle para esa semana (semana vieja sin detalle), `porConjunto` queda `[]`. `construirResumen()` (comparación automática post-cierre) agrega una línea de Meta Ads cuando el área de la decisión es publicidad/costos y hay datos de ambas semanas comparadas.

### 15.5 Procedimiento para corregir una semana ya cerrada con datos de Meta Ads

1. En `/gastos`, borrar el/los gasto(s) de publicidad manual de esa semana.
2. "Importar Meta Ads" → CSV de esa semana histórica → **tipo de cambio de esa semana** (no el del día actual) → clasificar conjuntos → confirmar.
3. Dashboard → Evolución → "Eliminar cierre" de esa semana → confirmar.
4. Volver a cerrar la semana (recalcula con el gasto correcto y lo congela de nuevo).
Hacer los 4 pasos seguidos — mientras tanto la semana aparece como "no cerrada".

---

## 16. PRÓXIMA ETAPA

No hay una etapa grande sin especificar pendiente. Lo que sigue es operar lo ya construido (ver roadmap, sección 17). Algunas ideas que surgieron pero **no se acordaron en detalle** — no avanzar sin conversar con Lucas:
- ¿Simplificar el procedimiento de "Eliminar cierre + reimportar" en un solo botón ("Corregir y recerrar")?
- ¿Agregar comparación de conjuntos de Meta Ads semana a semana en el Laboratorio, más allá de cuando coincide con una decisión?

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
| **Detalle de Meta Ads por conjunto con tipo de audiencia caliente/fría** | ✅ **Completo esta sesión** |
| **Laboratorio: contexto porConjunto + regla caliente/fría en SYSTEM_PROMPT** | ✅ **Completo esta sesión** |
| **Dashboard admin: 3 zonas con jerarquía visual (KpiCardHero/ZonaDivisor/SeccionColapsable)** | ✅ **Completo esta sesión** |
| **Dashboard admin: 6 cards en Zona 1 (+ Clientes que volvieron + % facturación repetidores)** | ✅ **Completo esta sesión** |
| **Panel empleados: sin hamburguesas, solo Pedidos y Margen neto** | ✅ **Completo esta sesión** |
| **Fix: regenerar recomendaciones reemplaza en vez de acumular** | ✅ **Completo esta sesión** |
| Botón "Eliminar cierre" en Evolución | ✅ Completo |
| Identidad de Git configurada globalmente en la máquina de Lucas | ✅ Completo |
| **Cerrar semana 27-29 jun el domingo 29 de junio** | ⏳ **Próximo — acción de Lucas el domingo** |
| **Evaluar la primera decisión registrada del Laboratorio** (ya está pendiente de resultado) | ⏳ **Próximo — tras el cierre del 29 jun, el banner mostrará las decisiones evaluables** |
| **Reimportar Meta Ads semanalmente** con el CSV semanal de Meta Ads Manager | ⏳ **En curso — importar cada semana nueva al finalizar el período** |
| **Continuar midiendo merma** — cargar conteos reales los 4 ingredientes controlados | ⏳ **En curso — Lucas y el equipo deben cargar inicio de semana + cierre de cada noche** |
| Evaluar módulo de stock con datos reales (¿ajustar umbrales del semáforo?) | ⏳ Pendiente, depende de 3 semanas de medición |
| Reimportar las 3 semanas históricas cerradas desde Meta Ads (procedimiento 15.5) | ⏳ Pendiente — acción de Lucas, necesita CSV históricos y tipo de cambio de cada semana |
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
- `src/app/(admin)/dashboard/page.tsx` — 3 zonas, `KpiCardHero`, `ZonaDivisor`, `SeccionColapsable`
- `src/app/(admin)/laboratorio/actions.ts` — flujo de IA + evaluación automática + regla caliente/fría
- `src/app/(admin)/gastos/actions-meta-ads.ts` — importación de Meta Ads + detalle por conjunto
- `src/lib/utils/meta-ads-parser.ts` — parser con `MetaAdsFilaDetalle` y `conjuntosDetectados`
- `src/app/(admin)/evolucion/actions.ts` — `cerrarPeriodo`, `validarCierre`, `eliminarCierre`
- `src/app/(admin)/stock/actions.ts` — `obtenerAnalisisMerma()`, fórmula con unidades mixtas
- `src/app/(empleado)/panel/actions.ts` — patrón de "calcular completo, exponer solo lo seguro"
- `src/middleware.ts` — autenticación, roles, chequeo de `activo`

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
git push origin main # dispara auto-deploy en Vercel
```

### Cómo entregar código:
- Siempre verificar que compila (`npx next build`) antes de entregar.
- Cuando se toca `dashboard/actions.ts`, siempre revisar `dashboard/page.tsx` al mismo tiempo.
- Si se toca `gastos/actions-meta-ads.ts` o `meta-ads-parser.ts`, revisar si `laboratorio/actions.ts` (que lee de ambos) necesita actualizarse.
- Si se toca `stock/actions.ts`, revisar si `ConteoForm.tsx` necesita el mismo cambio.
- Nunca usar `new Date()` directamente en JSX.
- Nunca usar `await import(...)` dentro de componentes React.
- Nunca usar separadores Unicode (═══) en archivos SQL.
- Nunca editar una migración ya aplicada — agregar una nueva.
- Design tokens siempre, nunca colores hardcodeados.
- Cualquier server action que use `createAdminClient()` debe verificar el rol del caller al principio.
- Antes de testear contra producción algo que escribe/borra en tablas operativas, verificar si el período coincide con una semana real ya cerrada.

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
11. **No instalar herramientas de testing como dependencia permanente.** Playwright se instala con `--no-save` cada vez.
12. **`gastos_operativos` no tiene guard de período cerrado.** Un borrado accidental de un gasto real no avisa que esa semana ya está congelada en `periodos`. Si se necesita evitar ediciones accidentales en el futuro, consultarlo con Lucas.
13. **`meta_ads_detalle` tipo_audiencia CHECK ('caliente', 'fría'):** si se agregan nuevos tipos de audiencia en el futuro, hay que agregar una migración que extienda el CHECK — no alcanza con pasar el nuevo valor desde código.
14. **`conjuntosDetectados` en el parser** solo incluye conjuntos de filas con actividad real (gasto > 0 OR conversaciones > 0). Si un conjunto importado antes de esta feature aparece en el CSV con todo en cero, no aparecerá en el paso 2 del formulario — comportamiento correcto.
15. **Regenerar recomendaciones del Laboratorio** borra todas las `'sugeridas'` del período antes de insertar las nuevas. Si Lucas registró una `'decidida'` en esa sesión y luego regurgita, las decididas/evaluadas no se tocan. No hay riesgo.
16. **El force-push a una rama con auto-deploy puede no disparar un build en Vercel.** Ver sección 18.
