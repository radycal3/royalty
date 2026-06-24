# ROYALTY — Handoff Técnico Completo v4
## Fecha: 23 de junio de 2026

Sos el nuevo Claude (o Claude Code) que continúa el desarrollo de ROYALTY, el sistema de gestión de Royalty Burgers (Rosario, Argentina). Este documento es la fuente de verdad del proyecto. No tenés acceso al chat anterior — toda la información que necesitás está acá.

---

## 1. CONTEXTO DEL PROYECTO

**Negocio:** Royalty Burgers. Hamburguesería que opera viernes, sábado y domingo. El "período operativo" es Vie-Sáb-Dom.

**Usuario principal:** Lucas (dueño). Técnicamente competente. No acepta código provisional. Espera que cada decisión de arquitectura financiera se consulte antes de implementar. Prefiere entender el "por qué" antes del "cómo". Tiene plan Pro de Claude.

**Stack:** Next.js 15 (App Router), React 19, TypeScript strict, Tailwind v4, Supabase (PostgreSQL + Auth + RLS), Vercel (deploy pendiente). Sin ORMs ni state managers. Server Actions en `actions.ts` con `'use server'`.

**Objetivo del sistema:** Medir ventas, costos, beneficio y margen semana a semana, con datos financieramente auditables e inmutables hacia el pasado. Responde: ¿qué pasó?, ¿por qué pasó?, ¿qué tan saludable está el negocio?, ¿estoy construyendo una base de clientes fieles?

**Estado del deploy:** La app corre localmente con `npm run dev`. El dominio ya está comprado en Porkbun pero todavía no está conectado. El deploy en Vercel está pendiente — es el próximo paso antes de nuevas funcionalidades.

---

## 2. FILOSOFÍA Y PRINCIPIOS ARQUITECTÓNICOS (INAMOVIBLES)

Estas decisiones fueron aprobadas explícitamente y no se revierten sin consulta. Cualquier nueva funcionalidad debe respetar estos principios.

### 2.1 Congelación histórica
Todo valor monetario se calcula **una sola vez** al momento de registrar y se guarda como número fijo. Los cambios posteriores en recetas, costos, configuración o fórmulas **NO alteran registros pasados**. Aplica a:
- `pedidos_lineas.costo_unitario_calculado` — congelado al importar
- `pedidos_lineas.precio_unitario_vendido` — congelado al importar
- `cadetes_jornadas.*_usado` — los 3 valores de configuración congelados al cargar el cierre
- `periodos.*` — snapshot completo congelado al cerrar la semana manualmente
- `periodos_productos.*` / `periodos_gastos.*` — detalle congelado con el cierre

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
Los datos de `periodos` (y tablas hijo) **nunca se recalculan** desde tablas operativas. Son inmutables desde el cierre. Si una pantalla muestra datos históricos, deben venir exclusivamente de estas tablas.

### 2.8 Separación estricta histórico / en vivo
- Funciones `*Historico()` → solo `periodos`
- `obtenerSemaforoEnVivo(kpis)` → recibe KpisPeriodo ya calculado, no hace queries propias

### 2.9 No inventar causalidad
El sistema muestra descomposición aditiva matemáticamente exacta. No usa scores numéricos inventados. El semáforo usa reglas explícitas con umbrales configurables. Las métricas de tendencia siempre muestran el tamaño de muestra y advierten cuando es insuficiente.

### 2.10 Separación admin / empleado
Los empleados solo ven lo que Lucas decide mostrarles. Nunca ven montos en pesos — solo porcentajes y cantidades físicas. El dashboard de empleados es una pantalla separada con su propia ruta, no una vista reducida del dashboard admin.

---

## 3. PATRONES DE CÓDIGO OBLIGATORIOS

```typescript
// Imports de Supabase
import { createClient } from '@/lib/supabase/server';     // usuario autenticado
import { createAdminClient } from '@/lib/supabase/admin'; // bypasea RLS

// UI Components (src/components/ui)
// Exporta: SidePanel, Field, Input, Select, Button, Badge, EmptyState, useToast
// Badge usa prop "color" (green/yellow/red/gray), NO "variant"
// useToast: const { show, Toast } = useToast(); — Toast debe montarse en JSX

// Formato
import { formatARS, formatDate, formatPercent } from '@/lib/utils/format';

// Design tokens (NUNCA colores hardcodeados tipo text-zinc-* o text-emerald-*)
// Usar: text-text-primary, text-text-secondary, text-text-muted
//       bg-surface, bg-surface-alt, border-border
//       text-positive, text-warning, text-negative
//       bg-positive-bg, bg-warning-bg, bg-negative-bg, bg-brand-light

// Manejo de race conditions en cargas async
const requestIdRef = useRef(0);
// ++requestIdRef.current al iniciar; ignorar respuesta si ya no es la actual

// Fórmula costo de ingredientes (CRÍTICA, nunca cambiar):
// costo_parcial = (costo_por_unidad_compra / factor_conversion) × cantidad_receta
// Donde factor_conversion viene de ingredientes, NO de ingredientes_costos

// Dedup en importar/actions.ts:
// El Set de pedidos existentes se construye con join a importaciones WHERE estado='activa'
// NO simplemente: .from('pedidos').select('pedido_pedix_id')

// Tabs visuales: usar className hidden/block, no renderizado condicional
// Hidratación: NUNCA usar new Date() directamente en JSX — produce mismatch servidor/cliente.
// Usar: <div suppressHydrationWarning>{typeof window !== 'undefined' ? new Date().toLocaleDateString(...) : ''}</div>
// O mejor: calcular la fecha en un useEffect y guardar en estado.
// Imports dinámicos (await import('...')): NO usarlos en componentes React — Next.js App Router
// puede intentar resolverlos durante SSR y causar errores de hidratación.
```

---

## 4. MIGRACIONES SQL — ESTADO COMPLETO

| # | Archivo | Qué hace | Estado |
|---|---------|----------|--------|
| 001–014 | (Fase 0/1) | Auth, usuarios, ingredientes, productos, recetas, precios, mapeo_pedix, importaciones, pedidos, pedidos_lineas, configuracion, índices | ✅ Aplicado |
| 015 | `015_importacion_extras.sql` | Column `estado` en importaciones + tabla `pedidos_lineas_ingredientes` | ✅ Aplicado |
| 016 | `016_dashboard_gastos.sql` | Función `periodo_de(fecha)`, tabla `gastos_operativos` | ✅ Aplicado |
| 017 | `017_equipo.sql` | Tabla `equipo` (roles: cadete/cocina/caja/general) | ✅ Aplicado |
| 018 | `018_consumo_interno.sql` | Tablas `consumo_interno`, `consumo_interno_lineas`, `consumo_interno_ingredientes` | ✅ Aplicado |
| 019 | `019_pedidos_cadetes.sql` | **DESCARTADO** — NO aplicar nunca | ❌ NO aplicar |
| 020 | `020_cadetes_jornadas.sql` | Tabla `cadetes_jornadas` | ✅ Aplicado |
| 021 | `021_drop_pedidos_cadetes.sql` | DROP TABLE pedidos_cadetes | ✅ Aplicado |
| 022 | `022_periodos.sql` | Tabla `periodos` (snapshots semanales congelados) | ✅ Aplicado |
| 023 | `023_periodos_detalle.sql` | Tablas `periodos_productos` y `periodos_gastos` | ✅ Aplicado |
| 024 | `024_alertas_config.sql` | 4 claves de alerta en `configuracion` | ✅ Aplicado |
| 025 | `025_clientes.sql` | Tabla `clientes`, columnas en `pedidos` | ✅ Aplicado |
| 026 | `026_margen_bandas.sql` | 3 claves en `configuracion`: margen_objetivo_minimo, margen_excelente_minimo, cliente_ventana_activo_dias | ✅ Aplicado |
| 027 | `027_salud_clientes_fn.sql` | Función SQL `obtener_salud_clientes(p_ventana_dias)` — v3 final con alto_valor_detalle, celular, ultimo_pedido, top por ventas DESC | ✅ Aplicado |
| 028 | PENDIENTE | Sistema de roles/permisos para empleados | ⏳ Próxima etapa |
| 029 | PENDIENTE | Tablas de stock: `compras_ingredientes`, `conteos_stock` | ⏳ Próxima etapa |

---

## 5. ESQUEMA DE BASE DE DATOS ACTUAL

### 5.1 Tablas core
- **`usuarios`** — id, email, nombre, rol (admin/empleado). RLS con `public.get_my_rol()` SECURITY DEFINER.
- **`configuracion`** — clave, valor, descripcion. Key-value editable.

### 5.2 Catálogo
- **`ingredientes`** — nombre, unidad_compra, unidad_receta, factor_conversion, controlado_stock, activo.
- **`ingredientes_costos`** — append-only. ingrediente_id, costo_por_unidad_compra, fecha_vigencia.
- **`productos`** — nombre, categoria, activo.
- **`productos_precios`** — append-only.
- **`recetas`** — producto_id → ingrediente_id, cantidad.
- **`mapeo_pedix`** — nombre_pedix → producto_id.

### 5.3 Importación / Ventas
- **`importaciones`** — nombre_archivo, hash_archivo (SHA-256 dedup), estado ('activa'/'anulada'), importado_por, fecha_desde, fecha_hasta, total_pedidos, total_productos.
- **`pedidos`** — importacion_id, pedido_pedix_id (UNIQUE), fecha, hora, envio_cobrado, **cliente_id** (FK nullable → clientes), **cliente_celular**, **cliente_nombre**, **cliente_direccion**.
- **`pedidos_lineas`** — pedido_id, producto_id, cantidad, precio_unitario_vendido, costo_unitario_calculado.
- **`pedidos_lineas_ingredientes`** — congelación de ingredientes por línea.

### 5.4 Gastos
- **`gastos_operativos`** — fecha, categoria (publicidad/packaging/sueldos/servicios/impuestos/otros), tipo (variable/fijo), monto, nota, registrado_por. Registros históricos con categoria='cadeteria' existen pero el formulario ya no lo ofrece.

### 5.5 Equipo
- **`equipo`** — nombre, rol (cadete/cocina/caja/general), telefono, activo.

### 5.6 Consumo interno
- **`consumo_interno`** — id, fecha, nota + columnas legacy nullable (no usadas).
- **`consumo_interno_lineas`** — consumo_id, producto_id, cantidad, costo_unitario_calculado.
- **`consumo_interno_ingredientes`** — congelación idéntica a pedidos_lineas_ingredientes.

### 5.7 Cadetes
- **`cadetes_jornadas`** — equipo_id, fecha, viajes_realizados, cadete_base_minima_usada (congelado), cadete_valor_viaje_usado (congelado), costo_empresa_cadete_usado (congelado), pago_cadete. UNIQUE(equipo_id, fecha).

### 5.8 Snapshots históricos
- **`periodos`** — tipo='semana' (único CHECK), desde, hasta, label, pedidos, hamburguesas_vendidas, hamburguesas_por_pedido, ticket_promedio, costo_por_pedido, ventas, beneficio_bruto, beneficio_neto, beneficio_por_pedido, margen_bruto, margen_neto, roas, publicidad_pct, resultado_delivery, cerrado_por, cerrado_en. UNIQUE(tipo, desde, hasta). **Sin política UPDATE**.
- **`periodos_productos`** — periodo_id (FK CASCADE), producto_nombre, unidades, venta, costo, beneficio, margen, participacion.
- **`periodos_gastos`** — periodo_id (FK CASCADE), tipo, categoria, total, legacy.

### 5.9 Clientes
- **`clientes`** — celular TEXT UNIQUE (normalizado: solo dígitos, mínimo 6), nombre_referencia (last write wins).

### 5.10 Función SQL
- **`obtener_salud_clientes(p_ventana_dias int)`** — agrega toda la lógica de clientes en PostgreSQL. Devuelve JSON con: categorías (activo/en_riesgo/nuevo_perdido/reciente_sin_veredicto), métricas de retención, alto valor en riesgo con detalle accionable (nombre, celular, días sin comprar), tendencias de 28 días con tamaños de muestra, top clientes por ventas DESC con celular y último pedido.

---

## 6. CONFIGURACIÓN — TODAS LAS CLAVES VIGENTES

| Clave | Valor default | Descripción |
|-------|---------------|-------------|
| `cadete_base_minima` | 21000 | Pago mínimo garantizado por jornada (ARS) |
| `cadete_valor_viaje` | 2000 | Pago por viaje adicional sobre la base (ARS) |
| `costo_empresa_cadete` | 1500 | Costo que cobra la empresa de cadetería por cadete activo en la jornada (ARS) |
| `alerta_margen_minimo` | 40 | Margen neto mínimo — límite inferior zona Alerta (%) |
| `alerta_publicidad_maxima` | 15 | Publicidad máxima sobre ventas (%) |
| `alerta_roas_minimo` | 3 | ROAS mínimo aceptable |
| `alerta_caida_ventas_pct` | 15 | % de caída de ventas vs anterior que activa alerta |
| `alerta_relevancia_monto_minimo` | 15000 | Monto mínimo ARS para que un producto/gasto aparezca en comparación |
| `alerta_relevancia_pct_minimo` | 5 | % mínimo del cambio total para que un producto/gasto aparezca |
| `margen_objetivo_minimo` | 50 | Límite inferior zona Objetivo en gráfico de margen (%) |
| `margen_excelente_minimo` | 60 | Límite inferior zona Excelente en gráfico de margen (%) |
| `cliente_ventana_activo_dias` | 21 | Días desde última compra para considerar cliente activo |

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
Nota: "nuevo_perdido" NO entra en esta fórmula — es una métrica de conversión de primera compra, no de retención de cartera.

---

## 8. MÓDULOS — ESTADO ACTUAL

### ✅ CERRADOS Y ESTABLES (no tocar sin consulta)

**Dashboard financiero** (`src/app/(admin)/dashboard/`)
- `actions.ts`: `KpisPeriodo` incluye todos los campos financieros + **campos nuevos de esta sesión**: `pedidosRepetidores`, `ventasRepetidores`, `pctVentasRepetidores`. La query de clientes repetidores determina cuáles `cliente_id` tenían pedidos ANTES del rango seleccionado (importaciones activas) y los cuenta en el loop principal.
- `page.tsx` final: incluye KPI cards (15 — se agregaron 3 de repetidores), cascada P&L, Semáforo de salud, sección Evolución con 4 tabs:
  - **"Resumen general"** — 9 sparklines con métricas clave
  - **"Rentabilidad"** — gráfico de área SVG con bandas configurables, tooltip hover, tabla semana a semana
  - **"Clientes"** — tab completo de Salud de Clientes (ver abajo)
  - **"Tabla semanal"** — tabla comparativa de todas las semanas cerradas con exportación CSV
- Exportación PDF con `window.print()` y CSS `@media print` — sidebar y header se ocultan, todos los tabs de Evolución se muestran simultáneamente en el PDF. Botón "↓ Exportar PDF" junto al título.
- Fix cierre de semana: `semanaTerminada = tipo === 'semana' && (!esActual || rango.hasta < hoyStr)` — resuelve bug de timezone donde el sistema marcaba como "en curso" semanas ya terminadas.

**Salud de Clientes** (tab "Clientes" dentro de Evolución en dashboard)
- Función SQL `obtener_salud_clientes(p_ventana_dias)` — toda la agregación en PostgreSQL, el servidor Node recibe un solo JSON.
- Semáforo de cartera: Excelente/Aceptable/Atención/Crítico basado en `retencionCartera` + tendencia.
- 4 categorías de clientes con conteos y colores.
- Card de alto valor en riesgo (3+ pedidos, en riesgo) con modal accionable: nombre, celular, pedidos, facturación acumulada, días sin comprar, botón WhatsApp (`https://wa.me/54XXXXXXXXXX`).
- Historial de clientes en riesgo: facturación acumulada, ticket promedio, pedidos totales.
- Métricas de retención: retención de cartera, % facturación repetidores, % clientes repetidores, tasa de retención.
- Tendencia por ventanas rodantes de 28 días: muestra tamaños de muestra explícitos con advertencia cuando < 30 clientes.
- Top clientes más valiosos: tabla con nombre, pedidos, facturación acumulada, último pedido, botón WhatsApp. Ordenado por ventas_totales DESC.
- Tipos: `SaludClientes`, `TendenciaVentana`, `ClienteValioso` en `dashboard/actions.ts`.

**Auditoría Financiera Inteligente** (`src/app/(admin)/auditoria/`)
- `ComparacionPeriodos` incluye **nuevos campos**: `beneficioNetoA`, `beneficioNetoB` (antes solo estaba `deltaBeneficioNeto`).
- Sección "¿Qué cambió?": resumen ejecutivo automático con lenguaje orientado a causa (no "Gastos variables aportó..." sino "Los gastos variables bajaron $X, liberando $Y de margen"). Micro-labels de dirección (↑/↓) en cada fila de contribución. Contribuciones ordenadas por impacto absoluto. Productos y gastos separados en "↑ Impulsaron" / "↓ Frenaron".

**Tabla semanal** (tab "Tabla semanal" en Evolución)
- Muestra todas las semanas cerradas: pedidos, ventas, beneficio bruto, margen bruto %, publicidad %, ROAS, resultado delivery, beneficio neto, margen neto % (con color condicional por bandas), ticket promedio.
- Fila de promedios en el footer.
- Botón "↓ Exportar CSV" — genera CSV puro sin dependencias externas (sin SheetJS, sin imports dinámicos). BOM UTF-8 para compatibilidad con Excel.

**Exportación PDF** (`src/app/globals.css` + layout)
- `globals.css`: bloque `@media print` con `@page` fuera del media query (suprime URL del browser).
- `Sidebar.tsx`: `print:hidden` en el `<aside>`.
- `AdminHeader.tsx`: `print:hidden` en el `<header>`.
- `(admin)/layout.tsx`: `print:ml-0` en el wrapper y `print:p-0` en `<main>`.
- En pantalla: solo el botón "↓ Exportar PDF" es visible.
- En impresión: cabecera limpia con "Royalty Burgers · Resumen ejecutivo de gestión · período · fecha", todos los tabs de Evolución visibles simultáneamente.

**Importación Pedix, Cadetes, Gastos, Equipo, Consumo interno, Configuración** — sin cambios desde v3.

---

## 9. ARQUITECTURA DE ARCHIVOS

```
src/
  app/
    globals.css            ← design tokens + @media print completo
    (admin)/
      layout.tsx           ← Sidebar + AdminHeader + print:ml-0/print:p-0
      dashboard/
        actions.ts         ← KpisPeriodo (con pedidosRepetidores/ventasRepetidores/pctVentasRepetidores)
                              + obtenerSaludClientes() + tipos SaludClientes/TendenciaVentana/ClienteValioso
        page.tsx           ← Dashboard completo con 4 tabs de Evolución, PDF, tabla semanal, salud clientes
      importar/
        actions.ts         ← fix dedup + upsert clientes
        page.tsx, FileUploader.tsx, MappingStep.tsx, PreviewStep.tsx, ResultStep.tsx
      cadetes/
        actions.ts, page.tsx
      gastos/
        actions.ts, page.tsx
      equipo/
        actions.ts, page.tsx
      consumo-interno/
        actions.ts, page.tsx
      configuracion/
        actions.ts         ← ConfigAlertas con 4 campos + bandas de margen
        page.tsx
      evolucion/
        actions.ts         ← cerrarPeriodo, obtenerBandasMargen, obtenerEvolucion, obtenerRecords
      auditoria/
        actions.ts         ← ComparacionPeriodos con beneficioNetoA/B, compararPeriodosCerrados,
                              compararUltimasDosSemanas, obtenerTendenciaHistorica,
                              obtenerSemaforoHistorico, obtenerSemaforoEnVivo
  lib/
    dashboard/
      rangos.ts            ← buildRangoSemana(), buildRangoMes(), etc. Sin 'use server'
    supabase/
      server.ts, admin.ts, client.ts
    utils/
      pedix-parser.ts      ← parsePedixExcel, hashFile. Con Celular y Dirección.
      format.ts            ← formatARS, formatDate, formatPercent
  components/
    layout/
      Sidebar.tsx          ← con print:hidden
      AdminHeader.tsx      ← con print:hidden
    ui/index.tsx           ← SidePanel, Field, Input, Select, Button, Badge, EmptyState, useToast
```

---

## 10. DATOS REALES DE ROYALTY (contexto de negocio)

**Historial:** finales de abril a 23 junio 2026. ~900 pedidos totales.

**Clientes:**
- 761 clientes únicos. 88.7% compraron 1 sola vez.
- Tasa de retención: 11.3% (historial de 2 meses — interpretar con cautela).
- Ciclo de compra: mediana 12 días, promedio 14.2 días → `cliente_ventana_activo_dias=21` correcto.
- Teléfonos almacenados como `+54XXXXXXXXXX`. Links de WhatsApp: `https://wa.me/54XXXXXXXXXX` (sin el +).

**Rentabilidad (3 semanas cerradas):**
- Semana 5-7 jun: Ventas $2.873.000, Margen neto **-15.7%** → Pérdida.
- Semana 12-14 jun: Margen neto **-12.3%** → Pérdida (mejora).
- Semana 19-21 jun: Ventas $1.856.500, Beneficio neto -$140.859, Margen neto **-7.6%** → Mejora sostenida.

**Delivery actual:** resultado -$181.000/semana (principal área de mejora operativa identificada).

**Merma:** no medida todavía. Plan acordado: medir manualmente durante 3 semanas antes de construir módulo de stock.

---

## 11. DECISIONES DESCARTADAS Y POR QUÉ

| Decisión descartada | Por qué |
|---------------------|---------|
| `pedidos_cadetes` (pago por pedido) | Reemplazado por `cadetes_jornadas` |
| Score de salud 0-100 | Pesos arbitrarios. Reemplazado por semáforo con reglas explícitas |
| Top N fijo en comparación | Reemplazado por umbral de relevancia (monto + % del cambio) |
| SheetJS / import dinámico en React | Causa errores de hidratación en Next.js App Router. Reemplazado por CSV puro sin dependencias |
| `new Date()` en JSX directamente | Mismatch servidor/cliente → error de hidratación. Usar `suppressHydrationWarning` o estado con `useEffect` |
| `require('xlsx')` en función de render | Mismo problema. Todo acceso a APIs de browser debe ser exclusivamente en handlers de eventos |
| Cierres de Mes/Trimestre como entidades | Se calculan como agregaciones de semanas cerradas |
| CRM, CAC, LTV, cohortes avanzadas | Fuera de scope. Primero medir, analizar cuando haya suficiente historial |
| Dashboard de empleados como vista reducida del admin | Rechazado — son rutas separadas con datos distintos. Empleados NUNCA ven montos en pesos |

---

## 12. BUGS RESUELTOS (para no reincidir)

| Bug | Causa | Fix |
|-----|-------|-----|
| `envio_cobrado` = $0 | Columna en Excel se llama "Cargos Envío" (plural) | Agregar primero en lista de búsqueda de `findColumn` |
| Reimportación omitía pedidos | Dedup sin filtrar por importación activa | `importaciones!inner(estado)='activa'` en query de dedup |
| Gráfico de margen sin valores negativos | Eje Y hardcodeado [0, 100] | Eje Y dinámico con `min(0, ...valores) - 5` |
| `ROAS = undefined` | `actions.ts` y `page.tsx` desincronizados | Siempre reemplazar ambos juntos |
| Botón "Cerrar semana" no aparecía | Bug de timezone: semanas terminadas marcadas como "en curso" | `semanaTerminada = tipo==='semana' && (!esActual \|\| rango.hasta < hoyStr)` |
| Error de hidratación con SheetJS | `await import('xlsx')` durante SSR | Reemplazado por CSV puro (Blob + URL.createObjectURL) |
| `evolucion is not defined` | Variable se llama `evolucionDatos` en el state, no `evolucion` | Verificar nombres de estado antes de referenciarlos |
| Error de hidratación con `new Date()` en JSX | Servidor renderiza en UTC, cliente en UTC-3 → strings distintos | `suppressHydrationWarning` + `typeof window !== 'undefined'` |

---

## 13. PRÓXIMAS ETAPAS — ROADMAP APROBADO

### Etapa inmediata: Deploy en Vercel
**Antes de cualquier nueva funcionalidad**, el objetivo es tener la app en producción.
1. Subir código a repositorio privado en GitHub
2. Conectar Vercel → import project → variables de entorno: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
3. Conectar dominio de Porkbun: cargar registros A y CNAME en Porkbun según instrucciones de Vercel
4. Verificar que Supabase acepta conexiones desde el dominio de producción (Site URL en Auth settings)

---

### ETAPA SIGUIENTE: SISTEMA DE EMPLEADOS + STOCK

Esta es la próxima gran funcionalidad a construir. Se describe en detalle a continuación.

---

## 14. ESPECIFICACIÓN DETALLADA — SISTEMA DE EMPLEADOS + STOCK

### 14.1 Visión general

Dos módulos nuevos interconectados:

**A) Dashboard de empleados** — una pantalla separada, accesible por empleados con login propio, que muestra el desempeño del negocio en forma motivacional sin exponer información financiera sensible.

**B) Módulo de stock** — permite registrar compras de ingredientes (solo Lucas/admin), registrar conteos de stock al final de cada noche (empleados), y calcula automáticamente si el consumo cuadra con las ventas o hay desvíos.

---

### 14.2 Sistema de autenticación / roles

**Situación actual:**
- `usuarios` ya tiene columna `rol` con valores `admin` / `empleado`.
- RLS ya usa `public.get_my_rol()` SECURITY DEFINER.
- Supabase Auth ya está configurado.

**Lo que falta:**
- Poder crear usuarios empleado desde la UI de admin (hoy hay que hacerlo manualmente en Supabase).
- Rutas separadas para empleados: `src/app/(empleado)/...`
- Middleware de Next.js que redirige según rol al hacer login.

**Esquema de rutas:**
```
/login              → detecta rol → redirige a /dashboard (admin) o /equipo/dashboard (empleado)
/(admin)/...        → solo rol=admin
/(empleado)/
  dashboard/        → dashboard motivacional del equipo
  stock/            → carga de conteo nocturno de stock
```

**Migración 028 necesaria:**
```sql
-- La tabla usuarios ya existe. Solo necesitamos asegurarnos de que
-- los empleados pueden ser creados via Supabase Auth + insert en usuarios.
-- Agregar política RLS para que empleados lean solo sus propios datos.
-- Verificar que get_my_rol() funciona correctamente para ambos roles.
```

**Pantalla de gestión de empleados (solo admin):**
- Formulario para crear usuario empleado: nombre, email, contraseña temporal, rol.
- Usa `createAdminClient()` (service role) para crear el usuario en Supabase Auth y luego insertar en `usuarios`.
- Lista de empleados activos con opción de desactivar acceso.
- Ruta: `src/app/(admin)/equipo/` (ya existe la tabla, ampliar la UI).

---

### 14.3 Dashboard de empleados

**Filosofía:** motivacional, no financiero. Los empleados ven el desempeño como porcentajes y cantidades físicas. NUNCA ven montos en pesos.

**Contenido del dashboard:**

**Bloque 1 — Resultado de la semana en curso (en vivo)**
- Hamburguesas vendidas esta semana: número grande, prominente.
- Pedidos totales esta semana: número grande.
- Margen neto actual en %: solo el porcentaje, sin el monto en pesos.
- Estos datos vienen de `calcularKpis()` del dashboard — reutilizar la función, no duplicar la lógica.

**Bloque 2 — Gráfico de evolución del margen neto**
- SVG simple de línea o barras. Eje Y: porcentaje (no pesos). Eje X: semanas.
- Datos: últimas N semanas cerradas de `periodos.margen_neto`.
- Muestra la tendencia de forma visual y clara.
- NO muestra ventas ni beneficio en pesos — solo el porcentaje.

**Bloque 3 — Sistema de metas y recompensas (configurable por Lucas)**
- El gráfico del margen tiene bandas de color que corresponden a niveles de recompensa.
- Ejemplo: 0% = sin bono, 10% = bono básico, 20% = bono medio, 30% = bono premium.
- Los niveles y las descripciones de recompensa los configura Lucas desde el panel admin.
- El empleado ve visualmente en qué banda estamos y qué recompensa corresponde.
- Si estamos en 15% esta semana, el gráfico muestra claramente "Zona: Bono básico — seguimos subiendo".

**Configuración de metas (solo admin):**
- Nueva sección en `configuracion` o tabla nueva `metas_equipo`.
- Campos por nivel: porcentaje_minimo, descripcion_recompensa (ej: "Bono $X por persona"), color.
- Hasta 4-5 niveles configurables.
- Lucas puede cambiarlos cuando quiera — los cambios afectan la visualización futura, no el historial.

**Recomendación de arquitectura para metas:**
- Tabla nueva `metas_equipo` con: id, nivel (1-5), margen_minimo (%), descripcion, color, activo.
- No usar `configuracion` key-value porque las metas tienen estructura (5 filas relacionadas).
- Migración 028 o 029.

---

### 14.4 Módulo de stock

**Objetivo:** detectar si el consumo real de ingredientes cuadra con el consumo teórico calculado por el sistema según las ventas. Si no cuadra, hay merma, error de receta, desperdicio o robo.

**La ecuación central:**
```
Consumo real = Stock inicial + Compras durante la semana − Stock final
Merma = Consumo real − Consumo teórico del sistema
Merma % = (Merma / Consumo real) × 100
```

El consumo teórico ya lo calcula el sistema en `obtenerConsumoIngredientes()`. Lo que falta es medir el consumo real.

**Actores:**
- **Lucas (admin):** registra compras de ingredientes, ve el análisis de merma.
- **Empleados:** registran el conteo de stock al final de cada noche de trabajo.

**Tablas nuevas (migración 029):**

```sql
-- Compras de ingredientes (solo admin las crea)
CREATE TABLE compras_ingredientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha date NOT NULL,
  ingrediente_id uuid NOT NULL REFERENCES ingredientes(id),
  cantidad numeric NOT NULL CHECK (cantidad > 0),
  unidad text NOT NULL,          -- la unidad en que se compró (puede diferir de unidad_compra)
  costo_total numeric NOT NULL,  -- lo que se pagó realmente
  proveedor text,
  nota text,
  registrado_por uuid REFERENCES usuarios(id),
  created_at timestamptz DEFAULT now()
);

-- Conteos de stock al final de cada noche (empleados y admin)
CREATE TABLE conteos_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha date NOT NULL,
  ingrediente_id uuid NOT NULL REFERENCES ingredientes(id),
  cantidad numeric NOT NULL CHECK (cantidad >= 0),
  unidad text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('inicio_semana', 'fin_noche')),
  nota text,
  registrado_por uuid REFERENCES usuarios(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(fecha, ingrediente_id, tipo)  -- un conteo por ingrediente por fecha por tipo
);
```

**Flujo operativo:**
1. Lucas registra las compras de ingredientes durante la semana (cuando llega el proveedor).
2. Los empleados, al terminar cada noche (vie/sáb/dom), cargan cuánto quedó de cada ingrediente clave.
3. El sistema calcula automáticamente el consumo real = stock_inicio + compras − stock_fin.
4. Compara con el consumo teórico de `pedidos_lineas_ingredientes`.
5. Muestra el desvío por ingrediente y en total.

**Ingredientes a controlar (los 4 que representan el 79% del costo):**
- Carne (medallones) — 48.9% del costo
- Cheddar (fetas) — 11.0%
- Papas fritas (porciones 200g) — 10.6%
- Panes de papa — 8.3%

El campo `ingredientes.controlado_stock` ya existe en la tabla — usarlo para marcar cuáles participan del módulo de stock.

**UI para empleados (pantalla de conteo nocturno):**
- Lista simple de los ingredientes `controlado_stock = true`.
- Campo numérico por ingrediente: "¿Cuánto quedó?"
- Botón "Guardar conteo de esta noche".
- Feedback inmediato: "✓ Guardado correctamente".
- No muestran costos, no muestran precios, no muestran análisis — solo la carga.

**UI para admin (análisis de merma):**
- Por semana: tabla con ingrediente, consumo teórico (del sistema), consumo real (calculado), diferencia en unidades, diferencia en %, diferencia en pesos.
- Semáforo de merma: verde < 3%, amarillo 3-6%, rojo > 6%.
- Incluir también el consumo interno registrado manualmente y el consumo de cadetes (ya implementado en `consumo_interno`) para no confundir merma real con consumo legítimo.

**Relación con consumo interno:**
El consumo interno ya está implementado (`consumo_interno_lineas`). Al calcular la merma, hay que restar el consumo interno registrado para ese período, porque ese consumo es legítimo y no es merma.

```
Merma real = Consumo real − Consumo teórico ventas − Consumo interno registrado
```

---

## 15. INSTRUCCIONES PARA ARRANCAR

### Al iniciar en Claude Code:
1. Leer este handoff completo antes de tocar cualquier archivo.
2. Verificar el estado actual del código con `npx next build` — si hay errores de TypeScript, resolverlos antes de agregar funcionalidades.
3. Revisar la estructura de archivos real del proyecto con `ls -la src/app/(admin)/` para confirmar que coincide con la sección 9 de este handoff.
4. Antes de tocar cualquier módulo marcado ✅, consultar con Lucas.

### Archivos clave a revisar antes de empezar:
- `src/app/(admin)/dashboard/actions.ts` — estado de `KpisPeriodo` y `SaludClientes`
- `src/app/(admin)/dashboard/page.tsx` — UI completa actual
- `src/app/(admin)/evolucion/actions.ts` — `PeriodoCerrado`, `cerrarPeriodo`, `obtenerEvolucion`
- `src/app/(admin)/auditoria/actions.ts` — `ComparacionPeriodos` con `beneficioNetoA/B`
- `src/middleware.ts` — si existe, ver cómo maneja la autenticación actual
- `src/app/globals.css` — tokens de diseño y `@media print`
- `src/components/layout/Sidebar.tsx` — para saber qué nav links existen

### Variables de entorno necesarias:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

### Comandos útiles:
```bash
npm run dev          # desarrollo local
npx next build       # verificar errores de TypeScript antes de entregar
```

### Cómo entregar código:
- Siempre verificar que compila antes de entregar.
- Cuando se toca `dashboard/actions.ts`, siempre reemplazar `dashboard/page.tsx` al mismo tiempo.
- Los archivos de Evolución/Auditoría son interdependientes: `evolucion/actions.ts`, `auditoria/actions.ts`, `dashboard/page.tsx`, `configuracion/actions.ts` deben mantenerse en sync.
- Nunca usar `new Date()` directamente en JSX.
- Nunca usar `await import(...)` o `require(...)` dentro de componentes React.
- Nunca usar separadores Unicode (═══) en archivos SQL.
- Design tokens siempre, nunca colores hardcodeados (no `text-zinc-*`, no `text-emerald-*`).

---

## 16. RIESGOS Y CONSIDERACIONES TÉCNICAS

1. **Tablas placeholder:** Si una migración falla con "column not found", verificar con `SELECT column_name FROM information_schema.columns WHERE table_name = 'tabla'`.

2. **`formatDate` con timestamps:** `created_at` viene como ISO. Usar `.split('T')[0]` antes de pasar a `formatDate()`.

3. **Envíos duplicados en JOINs:** Si hacés JOIN `pedidos` ↔ `pedidos_lineas`, `SUM(envio_cobrado)` se multiplica por cantidad de líneas. Siempre consultar envíos por separado.

4. **Costos con fecha posterior a pedidos:** Si se cargan costos con `fecha_vigencia` posterior a las fechas de los pedidos importados, `costo_unitario_calculado` queda en $0. Verificar que `fecha_vigencia` ≤ fecha del pedido más antiguo.

5. **`consumo_interno` tiene columnas legacy:** tipo, persona_id, producto_id, cantidad, costo_unitario, periodo_id — nullable, no usadas. No borrar.

6. **`gastos_operativos.categoria = 'cadeteria'`:** Registros históricos existen. El dashboard los muestra con flag `legacy: true`. No restan del neto (el cálculo de cadetería viene de `cadetes_jornadas`).

7. **El Excel de Pedix** tiene una fila "Totales" al final que el parser descarta automáticamente. Celulares con formatos inconsistentes ya normalizados.

8. **Reimportación después de anular:** (1) anular vía UPDATE, (2) DELETE en cascada, (3) reimportar el Excel re-exportado de Pedix (para que el hash SHA-256 sea distinto).

9. **Celulares con menos de 6 dígitos:** El parser retorna `null`. Hay 6 pedidos sin cliente en el historial actual.

10. **`periodos` sin detalle:** Semanas cerradas antes de migración 023 no tienen filas en `periodos_productos`/`periodos_gastos`. `tieneDetalle: false` es por diseño — no rellenar en vivo.

11. **RLS y empleados:** Al crear el sistema de empleados, verificar que las políticas RLS existentes no bloqueen acceso legítimo de empleados a las tablas que necesitan leer (ingredientes, conteos_stock). Usar `get_my_rol()` como base para las políticas.

12. **Supabase Auth para empleados:** Usar `createAdminClient()` (service role) para crear usuarios desde el panel admin. El cliente normal (`createClient()`) no puede crear usuarios Auth — necesita el service role key.
