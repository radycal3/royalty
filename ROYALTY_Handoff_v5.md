# ROYALTY — Handoff Técnico Completo v5
## Fecha: 24 de junio de 2026

Sos el nuevo Claude (o Claude Code) que continúa el desarrollo de ROYALTY, el sistema de gestión de Royalty Burgers (Rosario, Argentina). Este documento es la fuente de verdad del proyecto y **reemplaza a ROYALTY_Handoff_v4.md**. No tenés acceso al chat anterior — toda la información que necesitás está acá.

---

## 1. CONTEXTO DEL PROYECTO

**Negocio:** Royalty Burgers. Hamburguesería que opera viernes, sábado y domingo. El "período operativo" es Vie-Sáb-Dom.

**Usuario principal:** Lucas (dueño). Técnicamente competente. No acepta código provisional. Espera que cada decisión de arquitectura financiera se consulte antes de implementar. Prefiere entender el "por qué" antes del "cómo". Tiene plan Pro de Claude.

**Stack:** Next.js 15 (App Router), React 19, TypeScript strict, Tailwind v4, Supabase (PostgreSQL + Auth + RLS), Vercel. Sin ORMs ni state managers. Server Actions en `actions.ts` con `'use server'`.

**Objetivo del sistema:** Medir ventas, costos, beneficio y margen semana a semana, con datos financieramente auditables e inmutables hacia el pasado. Responde: ¿qué pasó?, ¿por qué pasó?, ¿qué tan saludable está el negocio?, ¿estoy construyendo una base de clientes fieles?, y ahora también: ¿el equipo está alineado con el objetivo de margen?, ¿hay merma de stock?

**Estado del deploy: ✅ COMPLETO.**
- Repo privado en GitHub: `https://github.com/radycal3/royalty`.
- Vercel conectado al repo, auto-deploy en cada push a `main`.
- Dominio `royaltyburgers.club` (comprado en Porkbun) conectado y con SSL activo. El apex redirige (308) a `www.royaltyburgers.club`, que es el dominio canónico.
- Variables de entorno (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) cargadas en Vercel.
- Supabase Auth → Site URL y Redirect URLs actualizados a `https://www.royaltyburgers.club` (manteniendo `http://localhost:3000/**` para desarrollo local).
- La app real está en producción y se usó para crear y probar cuentas de empleado.

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
El sistema muestra descomposición aditiva matemáticamente exacta. No usa scores numéricos inventados. El semáforo usa reglas explícitas con umbrales configurables. Las métricas de tendencia siempre muestran el tamaño de muestra y advierten cuando es insuficiente. **Extendido en esta sesión al módulo de stock:** cuando falta el conteo de inicio o fin de semana para calcular la merma de un ingrediente, la pantalla lo dice explícitamente (`ingredientesIncompletos`) en vez de inventar o estimar el dato faltante. Cuando el stock inicial se toma del cierre de la semana anterior (no hubo conteo fresco del viernes), se marca la fuente (`fallback_semana_anterior`) en la UI.

### 2.10 Separación admin / empleado
Los empleados solo ven lo que Lucas decide mostrarles. Nunca ven montos en pesos — solo porcentajes y cantidades físicas. El dashboard de empleados es una pantalla separada con su propia ruta (`/panel`), no una vista reducida del dashboard admin.

**Implementado en esta sesión con defensa en profundidad (no solo en la UI):**
- El dato financiero completo (`calcularKpis()`) se calcula server-side con `createAdminClient()` y se reduce a `{ pedidos, hamburguesasVendidas, margenNeto }` **antes** de que la respuesta salga del server action — nunca hay un campo en pesos en el payload de red hacia un empleado, aunque alguien inspeccione la pestaña Network del navegador.
- La tabla `periodos` (que tiene `ventas`, `beneficio_neto`, etc.) es de **lectura admin-only** a nivel RLS. El dashboard de empleados lee de una vista dedicada, `periodos_margen_empleado`, que solo expone `desde/hasta/label/margen_neto` — ver bug crítico en sección 12.
- `metas_equipo.descripcion` es texto libre editable por Lucas. La tabla tiene un comentario SQL advirtiendo no poner montos en pesos ahí, pero no hay una restricción técnica — es una convención que Lucas debe respetar al editar las metas desde Configuración.

---

## 3. PATRONES DE CÓDIGO OBLIGATORIOS

```typescript
// Imports de Supabase
import { createClient } from '@/lib/supabase/server';     // usuario autenticado, respeta RLS
import { createAdminClient } from '@/lib/supabase/admin'; // bypasea RLS — usar con cuidado

// CRÍTICO: createAdminClient() bypasea RLS por completo. Cualquier server
// action que lo use DEBE verificar el rol del caller manualmente al inicio
// (no hay red de seguridad de la base de datos). Patrón usado en
// usuarios/actions.ts (exigirAdmin()) y panel/actions.ts:
//   const supabase = await createClient();           // cliente normal
//   const { data: auth } = await supabase.auth.getUser();
//   if (!auth.user) throw new Error('No autenticado');
//   // ... verificar rol con una query RLS-protegida si hace falta ...
//   const admin = createAdminClient();                // ahora sí, admin client

// UI Components (src/components/ui)
// Exporta: SidePanel, Field, Input, Select, Button, Badge, EmptyState, Tabs, useToast
// Badge usa prop "color" (green/yellow/red/gray), NO "variant"
// EmptyState soporta 2 modos: { message, action } simple, o { icon, title,
// description, action } más rico — usar el que corresponda al resto de la pantalla.
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
// Equivalente: 1 unidad_compra = factor_conversion unidades_receta.

// Unidades mixtas en cálculos (NUEVO): si una cantidad puede venir en
// unidad_compra O en unidad_receta según un flag por ingrediente
// (ingredientes.conteo_en_unidad_receta), CONVERTIR CADA TÉRMINO
// INDIVIDUALMENTE a una unidad común antes de sumar/restar. Sumar primero
// y convertir el total al final solo es válido si todos los términos están
// en la misma unidad — si no, da un resultado matemáticamente incorrecto.
// Ver obtenerAnalisisMerma() en stock/actions.ts.

// Dedup en importar/actions.ts:
// El Set de pedidos existentes se construye con join a importaciones WHERE estado='activa'
// NO simplemente: .from('pedidos').select('pedido_pedix_id')

// Desactivar acceso de un usuario (NUEVO): no alcanza con un flag. Hay que
// banear a nivel Supabase Auth para que el login falle de verdad:
//   await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' }) // desactivar
//   await admin.auth.admin.updateUserById(id, { ban_duration: 'none' })    // reactivar
// Y además actualizar usuarios.activo (se usa para mostrar el estado en la UI
// y para que el middleware fuerce signOut si la sesión ya estaba abierta).

// Rutas (empleado) vs (admin): un route group de Next.js NO forma parte de
// la URL. (admin)/dashboard y (empleado)/dashboard colisionarían en la
// misma URL /dashboard. Por eso el lado empleado usa /panel, nunca /dashboard.

// equipo vs usuarios: son conceptos DELIBERADAMENTE separados (ver comentario
// en migración 017). `equipo` = personal operativo para jornadas de
// cadetería / consumo interno, sin login. `usuarios` = cuentas de acceso
// con rol admin/empleado. No se linkean entre sí.

// Componentes compartidos entre route groups: un componente o server action
// en src/app/(admin)/algo/actions.ts puede importarse perfectamente desde
// src/app/(empleado)/otro/page.tsx — los route groups son solo organización
// de carpetas, no un límite de módulos. Ver ConteoForm.tsx (usado por admin
// y empleado) y panel/actions.ts (importa calcularKpis de dashboard/actions.ts).

// Tabs visuales: usar className hidden/block, no renderizado condicional
// Hidratación: NUNCA usar new Date() directamente en JSX — produce mismatch servidor/cliente.
// Usar: <div suppressHydrationWarning>{typeof window !== 'undefined' ? new Date().toLocaleDateString(...) : ''}</div>
// O mejor: calcular la fecha en un useEffect y guardar en estado, o calcularla
// en un server action (new Date() del lado servidor es seguro, el problema
// es solo new Date() durante el render en el cliente).
// Imports dinámicos (await import('...')): NO usarlos en componentes React — Next.js App Router
// puede intentar resolverlos durante SSR y causar errores de hidratación.

// Migraciones SQL: nunca usar separadores Unicode (═══) — evitarlos siempre,
// usar comentarios simples con "--". Migraciones ya aplicadas NUNCA se editan;
// si hace falta corregir algo, se agrega una migración nueva (ver 021 sobre
// 020, o 028/029 limpiando tablas creadas por 007/010).
```

---

## 4. MIGRACIONES SQL — ESTADO COMPLETO

| # | Archivo | Qué hace | Estado |
|---|---------|----------|--------|
| 001–006 | (Fase 0/1) | Auth, usuarios, configuracion, periodos, ingredientes, productos, ventas | ✅ Aplicado |
| 007 | `007_empleados.sql` | Tablas `empleados`/`asistencia` — **abandonadas**, reemplazadas por `equipo` (017) | ⚠️ Tablas dropeadas en 028 |
| 008–009 | (Fase 1/2) | Cadetes, gastos | ✅ Aplicado |
| 010 | `010_stock.sql` | Tablas `stock_conteos`/`stock_compras` — **abandonadas**, reemplazadas por `conteos_stock`/`compras_ingredientes` (029) | ⚠️ Tablas dropeadas en 028 |
| 011–014 | (Fase 0/1) | Laboratorio (placeholder), snapshots, seed, índices | ✅ Aplicado |
| 015 | `015_importacion_extras.sql` | Column `estado` en importaciones + tabla `pedidos_lineas_ingredientes` | ✅ Aplicado |
| 016 | `016_dashboard_gastos.sql` | Función `periodo_de(fecha)`, tabla `gastos_operativos` | ✅ Aplicado |
| 017 | `017_equipo.sql` | Tabla `equipo` (roles: cadete/cocina/caja/general). Comentario explícito: no confundir con `usuarios` | ✅ Aplicado |
| 018 | `018_consumo_interno.sql` | Tablas `consumo_interno`, `consumo_interno_lineas`, `consumo_interno_ingredientes` | ✅ Aplicado |
| 019 | `019_pedidos_cadetes.sql` | **DESCARTADO** — NO aplicar nunca | ❌ NO aplicar |
| 020 | `020_cadetes_jornadas.sql` | Tabla `cadetes_jornadas` | ✅ Aplicado |
| 021 | `021_drop_pedidos_cadetes.sql` | DROP TABLE pedidos_cadetes | ✅ Aplicado |
| 022 | `022_periodos.sql` | Tabla `periodos` (snapshots semanales congelados) | ✅ Aplicado |
| 023 | `023_periodos_detalle.sql` | Tablas `periodos_productos` y `periodos_gastos` | ✅ Aplicado |
| 024 | `024_alertas_config.sql` | 4 claves de alerta en `configuracion` | ✅ Aplicado |
| 025 | `025_clientes.sql` | Tabla `clientes`, columnas en `pedidos` | ✅ Aplicado |
| 026 | `026_margen_bandas.sql` | 3 claves en `configuracion`: margen_objetivo_minimo, margen_excelente_minimo, cliente_ventana_activo_dias | ✅ Aplicado |
| 027 | `027_salud_clientes_fn_v3.sql` | Función SQL `obtener_salud_clientes(p_ventana_dias)` | ✅ Aplicado |
| 028 | `028_empleados.sql` | DROP de `empleados`/`asistencia`/`stock_conteos`/`stock_compras` (Fase 0, vacías, sin uso). Tabla `metas_equipo` + RLS + seed de 4 niveles | ✅ Aplicado |
| 029 | `029_stock.sql` | Tablas `compras_ingredientes` y `conteos_stock` + RLS vía `get_my_rol()`. Fija `controlado_stock` en `ingredientes` (true solo para Carne/Cheddar/Panes de papa/Papas fritas Buttler) | ✅ Aplicado |
| 030 | `030_periodos_rls_empleado.sql` | **Fix de seguridad**: `periodos_select` pasa de `USING (true)` a admin-only. Crea vista `periodos_margen_empleado` (solo `desde/hasta/label/margen_neto`) con grant a `authenticated` | ✅ Aplicado |
| 031 | `031_conteo_unidad_receta.sql` | Columna `ingredientes.conteo_en_unidad_receta` (default false). La activa para `Carne` (se cuenta en medallones, no en kg) | ✅ Aplicado |

---

## 5. ESQUEMA DE BASE DE DATOS ACTUAL

### 5.1 Tablas core
- **`usuarios`** — id, email, nombre, rol (admin/empleado), activo. RLS con `public.get_my_rol()` SECURITY DEFINER. Policy `admin_full_access` (admin, FOR ALL) + `empleado_read_self` (empleado solo lee su propia fila).
- **`configuracion`** — clave, valor, descripcion. Key-value editable.

### 5.2 Catálogo
- **`ingredientes`** — nombre, unidad_compra, unidad_receta, factor_conversion, controlado_stock, activo, **`conteo_en_unidad_receta`** (nuevo, migración 031). RLS: admin full access + `empleado_read` (SELECT).
- **`ingredientes_costos`** — append-only. ingrediente_id, costo_por_unidad_compra, fecha_vigencia. Admin-only (sin acceso de empleado — ahí vive el costo en pesos).
- **`productos`** — nombre, categoria, activo.
- **`productos_precios`** — append-only.
- **`recetas`** — producto_id → ingrediente_id, cantidad.
- **`mapeo_pedix`** — nombre_pedix → producto_id.

### 5.3 Importación / Ventas
- **`importaciones`** — nombre_archivo, hash_archivo (SHA-256 dedup), estado ('activa'/'anulada'), importado_por, fecha_desde, fecha_hasta, total_pedidos, total_productos.
- **`pedidos`** — importacion_id, pedido_pedix_id (UNIQUE), fecha, hora, envio_cobrado, cliente_id (FK nullable → clientes), cliente_celular, cliente_nombre, cliente_direccion.
- **`pedidos_lineas`** — pedido_id, producto_id, cantidad, precio_unitario_vendido, costo_unitario_calculado.
- **`pedidos_lineas_ingredientes`** — congelación de ingredientes por línea.

### 5.4 Gastos
- **`gastos_operativos`** — fecha, categoria (publicidad/packaging/sueldos/servicios/impuestos/otros), tipo (variable/fijo), monto, nota, registrado_por. Registros históricos con categoria='cadeteria' existen pero el formulario ya no lo ofrece.

### 5.5 Equipo
- **`equipo`** — nombre, rol (cadete/cocina/caja/general), telefono, activo. **No son cuentas de login** (eso es `usuarios`) — son personas para asignar a jornadas de cadetería / consumo interno.

### 5.6 Consumo interno
- **`consumo_interno`** — id, fecha, nota + columnas legacy nullable (no usadas).
- **`consumo_interno_lineas`** — consumo_id, producto_id, cantidad, costo_unitario_calculado.
- **`consumo_interno_ingredientes`** — congelación idéntica a pedidos_lineas_ingredientes.

### 5.7 Cadetes
- **`cadetes_jornadas`** — equipo_id, fecha, viajes_realizados, cadete_base_minima_usada (congelado), cadete_valor_viaje_usado (congelado), costo_empresa_cadete_usado (congelado), pago_cadete. UNIQUE(equipo_id, fecha).

### 5.8 Snapshots históricos
- **`periodos`** — tipo='semana' (único CHECK), desde, hasta, label, pedidos, hamburguesas_vendidas, hamburguesas_por_pedido, ticket_promedio, costo_por_pedido, ventas, beneficio_bruto, beneficio_neto, beneficio_por_pedido, margen_bruto, margen_neto, roas, publicidad_pct, resultado_delivery, cerrado_por, cerrado_en. UNIQUE(tipo, desde, hasta). Sin política UPDATE. **RLS: SELECT admin-only desde la migración 030** (antes era cualquier autenticado — ver bug crítico en sección 12).
- **`periodos_productos`** — periodo_id (FK CASCADE), producto_nombre, unidades, venta, costo, beneficio, margen, participacion.
- **`periodos_gastos`** — periodo_id (FK CASCADE), tipo, categoria, total, legacy.
- **`periodos_margen_empleado`** (VISTA, nueva en 030) — `SELECT desde, hasta, label, margen_neto FROM periodos WHERE tipo='semana'`. Único punto de acceso de los empleados a datos históricos de margen. Grant SELECT a `authenticated`. **Nunca agregarle columnas con montos en pesos.**

### 5.9 Clientes
- **`clientes`** — celular TEXT UNIQUE (normalizado: solo dígitos, mínimo 6), nombre_referencia (last write wins).

### 5.10 Función SQL
- **`obtener_salud_clientes(p_ventana_dias int)`** — agrega toda la lógica de clientes en PostgreSQL. Devuelve JSON con: categorías (activo/en_riesgo/nuevo_perdido/reciente_sin_veredicto), métricas de retención, alto valor en riesgo con detalle accionable (nombre, celular, días sin comprar), tendencias de 28 días con tamaños de muestra, top clientes por ventas DESC con celular y último pedido.

### 5.11 Sistema de empleados (NUEVO)
- **`metas_equipo`** — id, nivel (1-5, UNIQUE), margen_minimo, descripcion, color (gray/green/yellow/red), activo, created_at. RLS: admin full access, empleado SELECT. Niveles de recompensa configurables por margen neto, mostrados en `/panel`.

### 5.12 Stock (NUEVO)
- **`compras_ingredientes`** — id, fecha, ingrediente_id, cantidad, unidad, costo_total, proveedor, nota, registrado_por. **Admin-only** (tiene costo_total en pesos). Siempre en `unidad_compra` real (cómo compra Lucas), nunca en `unidad_receta`.
- **`conteos_stock`** — id, fecha, ingrediente_id, cantidad, unidad, tipo ('inicio_semana'/'fin_noche'), nota, registrado_por. UNIQUE(fecha, ingrediente_id, tipo). RLS: admin full access; empleado INSERT y SELECT; empleado UPDATE solo de sus propias filas (`registrado_por = auth.uid()`, para poder corregir un error de tipeo la misma noche). La unidad de `cantidad` depende de `ingredientes.conteo_en_unidad_receta`: si es true, está en `unidad_receta` (ej. Carne en medallones); si es false (default), está en `unidad_compra`.

### 5.13 Tablas Fase 0 eliminadas (migración 028)
`empleados`, `asistencia`, `stock_conteos`, `stock_compras` existían desde el scaffold inicial del proyecto (17 de junio), estaban vacías y ningún archivo de `src/` las referenciaba. Se dropearon al construir el sistema de empleados real para evitar confusión de nombres con las tablas nuevas (`conteos_stock`, `compras_ingredientes`).

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

Nota: las metas de recompensa del equipo (`metas_equipo`) **no** viven acá — es una tabla relacional propia (sección 5.11), no claves key-value, porque son varias filas con relación entre sí (niveles ordenados).

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

### 7.7 Merma de stock (NUEVO)
```
Consumo real (unidad_receta) = stockInicio_receta + compras_receta − stockFin_receta
Merma = Consumo real − Consumo teórico (ventas) − Consumo interno registrado
Merma % = (Merma / Consumo real) × 100
```
Donde:
- `compras_receta = comprasCantidad(unidad_compra) × factor_conversion` — las compras siempre están en `unidad_compra`.
- `stockInicio_receta` / `stockFin_receta` = el valor tal cual si `ingredientes.conteo_en_unidad_receta = true`, o `valor × factor_conversion` si es `false`.
- **Cada término se convierte individualmente antes de combinarse** — no se suma todo y se convierte el total al final (ver patrón en sección 3).
- Ventana de compras: lunes a domingo de la semana del período (no solo vie-dom), porque la mercadería suele comprarse en los días previos a abrir.
- `stockInicio`: conteo `inicio_semana` del viernes. Si no existe, usa como respaldo el `fin_noche` del domingo anterior (misma realidad física), marcando la fuente como `fallback_semana_anterior`.
- Semáforo: verde si `|Merma %| < 3`, amarillo si `3 ≤ |Merma %| ≤ 6`, rojo si `|Merma %| > 6`.
- Si falta el conteo de inicio o de fin, el ingrediente queda en `ingredientesIncompletos` y no se calcula nada — nunca se estima a ciegas.

---

## 8. MÓDULOS — ESTADO ACTUAL

### ✅ CERRADOS Y ESTABLES (no tocar sin consulta)

**Dashboard financiero** (`src/app/(admin)/dashboard/`)
- `actions.ts`: `KpisPeriodo` con todos los campos financieros + métricas de repetidores. `calcularKpis()` ahora está **exportada** (antes era privada) para que el dashboard de empleados pueda reutilizarla sin duplicar lógica — sigue siendo la misma función, mismo cálculo, ningún cambio de comportamiento para el admin.
- `page.tsx`: KPI cards, cascada P&L, Semáforo de salud, sección Evolución con 4 tabs (Resumen general, Rentabilidad, Clientes, Tabla semanal). Exportación PDF con `window.print()`.

**Salud de Clientes** (tab "Clientes" dentro de Evolución en dashboard) — sin cambios desde v4. Esta es la base sobre la que se construirá la próxima etapa de "Recuperación de clientes" (sección 14).

**Auditoría Financiera Inteligente** (`src/app/(admin)/auditoria/`) — sin cambios desde v4.

**Tabla semanal**, **Exportación PDF** — sin cambios desde v4.

**Importación Pedix, Cadetes, Gastos, Equipo, Consumo interno** — sin cambios funcionales. `Equipo` sigue siendo exclusivamente personal sin login (ver sección 3).

**Productos / Ingredientes** (`src/app/(admin)/productos/`)
- Único cambio: nuevo checkbox "Contar stock en unidad de receta" en el formulario de ingrediente (visible solo si "Controlar stock" está tildado). Permite, ingrediente por ingrediente, decidir si el conteo físico de stock se hace en `unidad_compra` o en `unidad_receta`. Activado para Carne (medallones en vez de kg).

---

### ✅ NUEVO EN ESTA SESIÓN — Sistema de Empleados + Stock

**Gestión de usuarios** (`src/app/(admin)/usuarios/`)
- `actions.ts`: `Usuario` type. `obtenerUsuarios()` (RLS-scoped). `crearUsuario()` — usa `createAdminClient()` para crear el usuario en Supabase Auth (`auth.admin.createUser`, `email_confirm: true`) y después insertar en `usuarios`; si el insert falla, hace rollback borrando el usuario de Auth (evita cuentas fantasma que no pueden loguearse). `toggleActivoUsuario()` — banea/desbanea a nivel Auth (`ban_duration`) y actualiza `usuarios.activo`. `exigirAdmin()` — helper que verifica el rol del caller antes de cualquier operación con el admin client (obligatorio: ese client bypasea RLS).
- `page.tsx`: lista de usuarios con badges de rol/estado, SidePanel para crear (con botón "generar contraseña" aleatoria), botón archivar/restaurar por fila.
- Nav: ítem "Usuarios" agregado al Sidebar admin.

**Módulo de stock** (`src/app/(admin)/stock/`, reemplaza el placeholder de Fase 0)
- `actions.ts`: `IngredienteStock`, `CompraIngrediente`, `AnalisisMerma` types. `obtenerIngredientesControlados()`. CRUD de compras (`obtenerComprasPeriodo`, `registrarCompra`, `eliminarCompra` — siempre en `unidad_compra`). `obtenerConteo`/`registrarConteo` (upsert por `fecha+ingrediente_id+tipo`, compartido con el lado empleado). `obtenerAnalisisMerma()` — el cálculo central (fórmula en sección 7.7).
- `page.tsx`: navegador de período operativo (reutiliza `PeriodoInfo` de `gastos/actions.ts`), tabs "Análisis de merma" / "Compras", SidePanel para nueva compra y para conteo de inicio de semana.

**Dashboard de empleados** (`src/app/(empleado)/panel/`, reemplaza el placeholder de Fase 0)
- `actions.ts`: `obtenerResumenEmpleado()` — usa `createAdminClient()` internamente (un empleado no tiene RLS para leer `pedidos`/`gastos_operativos`/etc.) para llamar a `calcularKpis()`, pero **descarta todos los campos en pesos antes de retornar** — solo expone `{ pedidos, hamburguesasVendidas, margenNeto }`. `obtenerMargenHistorico()` — lee la vista `periodos_margen_empleado`. `obtenerMetasEquipo()` — lee `metas_equipo`. `obtenerFechaHoy()` — calcula la fecha del lado servidor (nunca `new Date()` en el cliente).
- `page.tsx`: 3 stat cards grandes (hamburguesas vendidas, pedidos, margen neto %), escalera de metas con la zona actual resaltada y mensaje de cuántos puntos faltan para el próximo nivel, gráfico de barras horizontales (sin librerías) de evolución del margen, coloreado según la banda de meta correspondiente a cada semana.

**Conteo nocturno de stock** (`src/app/(empleado)/panel/stock/`)
- Pantalla mínima: reutiliza `ConteoForm` (ver abajo) con `tipo='fin_noche'` y `fecha` = hoy (calculada server-side). Sin costos, sin precios, solo "¿cuánto quedó?" por ingrediente controlado.

**Componente compartido** (`src/components/stock/ConteoForm.tsx`)
- Usado tanto por `/stock` (admin, conteo `inicio_semana`) como por `/panel/stock` (empleado, conteo `fin_noche`). Muestra la unidad correcta (`unidad_compra` o `unidad_receta`) según `ingrediente.conteoEnUnidadReceta`. Demuestra que un componente puede compartirse libremente entre los route groups `(admin)` y `(empleado)`.

**Configuración → Metas del equipo** (`src/app/(admin)/configuracion/`)
- Nueva sección en la página de Configuración (no una pestaña nueva, una sección más en la misma página): lista editable de niveles de `metas_equipo` (descripción, margen mínimo, color, activo), guardado por fila, botón "+ Agregar nivel" hasta 5.

**Middleware** (`src/middleware.ts`)
- Agrega `/usuarios` a la lista de rutas admin-only.
- Ahora también verifica `usuarios.activo`: si es `false`, hace `signOut()` y redirige a `/login` — así una sesión ya abierta de un usuario desactivado se corta en la siguiente request, no solo se bloquea el login siguiente (que de todos modos ya está bloqueado por el ban a nivel Auth).

**Sidebar** (`src/components/layout/Sidebar.tsx`) — ítem "Usuarios" agregado.

**EmpleadoNav** (`src/components/layout/EmpleadoNav.tsx`, nuevo) — navegación simple de 2 ítems (Resumen / Conteo de stock) para el layout `(empleado)`.

---

## 9. ARQUITECTURA DE ARCHIVOS

```
src/
  middleware.ts             ← + chequeo de usuarios.activo, + /usuarios en adminRoutes
  app/
    page.tsx, layout.tsx
    login/page.tsx
    globals.css              ← design tokens + @media print completo
    (admin)/
      layout.tsx             ← Sidebar + AdminHeader + print:ml-0/print:p-0
      dashboard/
        actions.ts           ← KpisPeriodo + calcularKpis() EXPORTADA + obtenerSaludClientes()
        page.tsx
      importar/
      productos/
        actions-ingredientes.ts  ← + conteo_en_unidad_receta en create/update
        actions-productos.ts
        IngredientesTab.tsx      ← + checkbox "Contar stock en unidad de receta"
        ProductosTab.tsx, page.tsx
      gastos/
        actions.ts           ← PeriodoInfo, obtenerPeriodoActual/PorOffset/DeFecha (reutilizado por stock)
        page.tsx
      stock/                 ← NUEVO (reemplaza placeholder)
        actions.ts           ← compras + obtenerAnalisisMerma()
        page.tsx
      usuarios/               ← NUEVO
        actions.ts
        page.tsx
      equipo/
        actions.ts, page.tsx  ← sin cambios (personal sin login)
      consumo-interno/
        actions.ts, page.tsx
      cadetes/
        actions.ts, page.tsx
      configuracion/
        actions.ts            ← + obtenerMetasEquipoConfig/actualizarMetaEquipo/crearMetaEquipo
        page.tsx              ← + sección "Metas del equipo"
      evolucion/
        actions.ts            ← cerrarPeriodo, obtenerBandasMargen, obtenerEvolucion, obtenerRecords
      auditoria/
        actions.ts
      laboratorio/
        page.tsx               ← placeholder, sin cambios
    (empleado)/
      layout.tsx              ← + <EmpleadoNav />
      panel/
        actions.ts             ← NUEVO: obtenerResumenEmpleado/obtenerMargenHistorico/obtenerMetasEquipo/obtenerFechaHoy
        page.tsx                ← NUEVO: dashboard motivacional (reemplaza placeholder)
        stock/
          page.tsx               ← NUEVO: conteo nocturno
  lib/
    dashboard/
      rangos.ts              ← buildRangoSemana(), buildRangoMes(), etc. Sin 'use server'
    supabase/
      server.ts, admin.ts, client.ts
    utils/
      pedix-parser.ts
      format.ts
      export.ts
  components/
    layout/
      Sidebar.tsx             ← + ítem "Usuarios"
      AdminHeader.tsx
      EmpleadoNav.tsx         ← NUEVO
      LogoutButton.tsx
    stock/
      ConteoForm.tsx          ← NUEVO, compartido admin/empleado
    ui/index.tsx              ← EmptyState extendido (icon/title/description + message/action)
```

---

## 10. DATOS REALES DE ROYALTY (contexto de negocio)

**Historial:** finales de abril a 23 junio 2026. ~900 pedidos totales. No se recalculó ni se agregó historial nuevo en esta sesión — esta sección sigue siendo la del v4.

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

**Merma:** **el módulo ya está construido y deployado, pero todavía no hay ningún conteo real cargado.** Plan acordado: medir manualmente durante 3 semanas (cargando conteos de inicio de semana y cierre de cada noche) antes de sacar conclusiones o ajustar el módulo. Ver roadmap (sección 14).

**Ingredientes controlados de stock:** Carne (48.9% del costo, se cuenta en medallones), Cheddar (11.0%), Papas fritas Buttler (10.6%), Panes de papa (8.3%) — los 4 que explican ~79% del costo total. El resto de los ingredientes tiene `controlado_stock=false`.

---

## 11. DECISIONES DESCARTADAS Y POR QUÉ

| Decisión descartada | Por qué |
|---------------------|---------|
| `pedidos_cadetes` (pago por pedido) | Reemplazado por `cadetes_jornadas` |
| Score de salud 0-100 | Pesos arbitrarios. Reemplazado por semáforo con reglas explícitas |
| Top N fijo en comparación | Reemplazado por umbral de relevancia (monto + % del cambio) |
| SheetJS / import dinámico en React | Causa errores de hidratación en Next.js App Router. Reemplazado por CSV puro sin dependencias |
| `new Date()` en JSX directamente | Mismatch servidor/cliente → error de hidratación. Usar `suppressHydrationWarning` o estado con `useEffect`, o calcularlo en un server action |
| `require('xlsx')` en función de render | Mismo problema. Todo acceso a APIs de browser debe ser exclusivamente en handlers de eventos |
| Cierres de Mes/Trimestre como entidades | Se calculan como agregaciones de semanas cerradas |
| CRM, CAC, LTV, cohortes avanzadas | Fuera de scope. Primero medir, analizar cuando haya suficiente historial |
| Dashboard de empleados como vista reducida del admin | Rechazado — son rutas separadas con datos distintos. Empleados NUNCA ven montos en pesos |
| Ruta `(empleado)/dashboard/` | Colisionaría con `(admin)/dashboard/` en la misma URL `/dashboard` (los route groups no forman parte de la URL). Se usa `/panel` |
| Linkear `equipo` con `usuarios` | Son conceptos deliberadamente separados desde la migración 017 (personal operativo sin login vs. cuentas de acceso). No se tocó esa decisión |
| Reusar `/equipo` para gestión de accesos | El handoff v4 lo sugería, pero contradecía la separación ya establecida en 017. Se creó `/usuarios` como ruta dedicada |
| Mostrar montos en pesos en `metas_equipo.descripcion` | El handoff v4 daba como ejemplo "Bono $X por persona", pero viola el principio 2.10. Se deja como texto libre con advertencia en el comentario SQL de la tabla, sin monto sugerido |
| Tablas `empleados`/`asistencia`/`stock_conteos`/`stock_compras` (Fase 0) | Vacías, sin uso en el código, superadas por `equipo` y por el módulo de stock real. Se dropearon en la migración 028 |
| Convertir TODOS los ingredientes controlados a contar en unidad_receta | Solo tiene sentido cuando la unidad de receta es físicamente fácil de contar (medallones de a tray). Para Cheddar (140 fetas por unidad de compra) contar en unidad de compra (bloque/bolsa) sigue siendo más práctico. Se implementó como toggle por ingrediente, no como cambio global |

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
| `npx next build` rompía con error de TS en `src-fase0-backup/lib/supabase/server.ts` | Carpeta de respaldo vieja de Fase 0, sin referencias activas, igual quedaba dentro del type-check de `tsconfig.json` (`**/*.ts`) | Excluida explícitamente: `"exclude": ["node_modules", "src-fase0-backup"]` |
| `Module '"./actions"' has no exported member 'PeriodoInfo'` en `consumo-interno/page.tsx` | `PeriodoInfo` está definido en `gastos/actions.ts`, no en `consumo-interno/actions.ts` — el import apuntaba al archivo equivocado | Import corregido a `../gastos/actions` |
| `Property 'icon' does not exist on type` en `EmptyState` | El componente compartido solo soportaba `{message, action}`, pero 3 páginas (`gastos`, `equipo`, `consumo-interno`) ya lo usaban con `{icon, title, description}` | Se extendió `EmptyState` para soportar ambos modos |
| `'salud' is possibly 'null'` en `dashboard/page.tsx` | Una función anidada (`fraseSemaforo`) dentro de un componente perdía el null-narrowing de TypeScript sobre `salud` por ser un closure separado — TS no garantiza que el valor siga siendo no-nulo dentro de una función definida después del chequeo | `fraseSemaforo` pasó a recibir `salud` como parámetro en vez de capturarlo del closure |
| `Type 'string' is not assignable to type '"gray"\|"green"\|"red"\|"yellow"'` en `equipo/page.tsx` | `ROL_COLORS` estaba tipado como `Record<string, string>`, incompatible con el prop `color` de `Badge` (unión literal) | Tipado explícito `Record<string, BadgeColor>` con `BadgeColor = 'gray'\|'green'\|'red'\|'yellow'` |
| **Fuga de RLS en `periodos`** (crítico) | `periodos_select` (migración 022) usaba `USING (true)` para cualquier usuario autenticado — dejaba leer ventas/beneficio neto a un empleado vía API directa, aunque ninguna pantalla lo mostrara. Nunca importó porque no existían cuentas empleado hasta esta sesión | Migración 030: policy restringida a `public.get_my_rol() = 'admin'` + vista `periodos_margen_empleado` con solo las columnas seguras, grant a `authenticated` |
| Identidad de Git incorrecta bloqueaba el deploy en Vercel | Nunca se configuró `git config user.email` en la máquina — los 14 commits del historial (desde el primer commit) tenían el email auto-generado `lucasalaniz@MacBook-Air-de-Lucas.local`. Vercel verifica el autor del commit contra cuentas conocidas y bloqueó el deploy | Se reescribió toda la historia con `git filter-branch --env-filter` (autor + committer, incluyendo los tags anotados `v0.8.0`/`v0.9.0`) al email real, y se hizo `git push --force`. **Pendiente: Lucas debe correr `git config --global user.email "bsediciones@gmail.com"` (y `user.name`) una vez para que los próximos commits salgan bien de entrada** — Claude no configura `git config` por política propia |
| Cálculo de merma con unidades mixtas | Al agregar `conteo_en_unidad_receta`, la fórmula original sumaba `stockInicio + compras − stockFin` y convertía el total una sola vez al final con `factor_conversion`. Eso es matemáticamente válido solo si los 3 términos están en la misma unidad — con Carne contándose en medallones pero las compras siempre en kg, el resultado quedaba mal | Cada término se convierte individualmente a `unidad_receta` antes de combinarse (ver fórmula en sección 7.7) |

---

## 13. SISTEMA DE EMPLEADOS + STOCK — ESPECIFICACIÓN IMPLEMENTADA (referencia)

Esta sección documenta, a modo de referencia histórica, cómo terminó implementado el sistema que el handoff v4 especificaba como "próxima etapa". Si necesitás extender este sistema, leé esto antes de adivinar el diseño original.

### 13.1 Autenticación / roles
- `usuarios.rol` (admin/empleado) + `usuarios.activo` ya existían. Se agregó la UI de gestión (`/usuarios`) y el baneo real a nivel Auth al desactivar.
- El middleware ya tenía la redirección por rol desde un scaffold de Fase 0 (`/panel` para empleado, bloqueo de rutas admin) — se extendió con el chequeo de `activo` y se agregó `/usuarios` a la lista de rutas admin.

### 13.2 Dashboard de empleados — diferencias vs. el plan original del v4
- El v4 proponía la ruta `(empleado)/dashboard/` — **no se usó** porque colisiona con `(admin)/dashboard/` en la URL. Se usó `/panel` (que ya existía como placeholder de Fase 0).
- El v4 sugería ejemplos de recompensa con montos en pesos ("Bono $X por persona") — **no se implementó así** por el principio 2.10. La tabla `metas_equipo.descripcion` es texto libre con una advertencia en el comentario SQL, pero Lucas puede poner lo que quiera ahí — es una convención, no una restricción técnica.
- El v4 sugería que `/equipo` (la tabla de personal) se ampliara para gestionar accesos — **no se hizo** porque contradice la separación ya establecida entre `equipo` (personal sin login) y `usuarios` (cuentas de acceso) desde la migración 017. Se creó `/usuarios` como ruta separada.

### 13.3 Módulo de stock — diferencias vs. el plan original del v4
- Los nombres de tabla propuestos (`compras_ingredientes`, `conteos_stock`) coincidían con tablas viejas y vacías de Fase 0 (`stock_compras`, `stock_conteos`) que nunca se usaron — se dropearon antes de crear las nuevas.
- El v4 no especificaba qué pasa si falta el conteo de inicio de semana — se implementó un respaldo (usar el cierre de la semana anterior) con la fuente marcada explícitamente en la UI, nunca silenciosamente.
- El v4 no contemplaba que un ingrediente pudiera contarse en una unidad distinta a la de compra — se agregó `conteo_en_unidad_receta` como toggle por ingrediente (caso real: Carne en medallones, no en kg) después de que Lucas lo pidiera tras ver el módulo funcionando.
- Las compras siempre quedan en `unidad_compra` (como compra Lucas), nunca en `unidad_receta` — solo el *conteo físico* (`conteos_stock`) puede estar en cualquiera de las dos unidades.

### 13.4 Verificación end-to-end
Se probó el flujo completo con un navegador headless (Playwright) contra producción, con cuentas de prueba creadas y eliminadas después: alta de empleado vía UI admin, login de empleado con redirección correcta a `/panel` (nunca a `/dashboard`), bloqueo de `/dashboard`/`/stock`/`/usuarios` para el rol empleado, guardado de conteo nocturno, desactivación de acceso (bloquea el login real, no solo el flag), y confirmación visual (captura de pantalla) de que `/panel` no muestra ningún monto en pesos.

---

## 14. PRÓXIMA ETAPA — RECUPERACIÓN DE CLIENTES (a especificar)

Acordado con Lucas como la siguiente funcionalidad grande a construir, **después** de cerrar la medición manual de merma (sección 15). A diferencia de la sección 13, esto **todavía no tiene una especificación detallada** — antes de implementar, el próximo Claude debe sentarse con Lucas a definir el alcance concreto. Lo que ya existe como base:

- El tab "Clientes" del dashboard (función SQL `obtener_salud_clientes`) ya identifica clientes de **alto valor en riesgo** (3+ pedidos, sin comprar hace más de `cliente_ventana_activo_dias` días) con su nombre, celular y un botón de WhatsApp directo (`https://wa.me/54XXXXXXXXXX`).
- Lo que falta para que esto sea "recuperación de clientes" y no solo "visibilidad de clientes en riesgo" es, presumiblemente, algún mecanismo para que Lucas registre qué hizo con cada cliente identificado (contactado / recuperado / sin respuesta / perdido definitivo) y poder medir la efectividad de esos intentos a lo largo del tiempo. **Esto no se acordó en detalle — es una hipótesis de punto de partida, no un plan.**
- Preguntas a resolver con Lucas antes de escribir una migración:
  - ¿El registro de contacto es manual (un botón "marcar como contactado") o se integra con algo (WhatsApp Business API, por ejemplo)? Probablemente manual dado el principio de "no CRM avanzado" del v4.
  - ¿Se necesita una tabla nueva (`clientes_seguimiento` o similar) o alcanza con extender `clientes`?
  - ¿Qué define "recuperado"? ¿Volvió a comprar después del contacto, en qué ventana de tiempo?
  - ¿Esto es solo para admin, o los empleados de caja podrían marcar contactos también?

No avances con migraciones ni código de esta sección sin esa conversación — es exactamente el tipo de decisión que el principio "no inventar causalidad" (2.9) y la costumbre de este proyecto de especificar en detalle antes de construir (ver cómo se armó la sección 13 originalmente) exigen consultar primero.

---

## 15. ROADMAP — ESTADO COMPLETO

| Etapa | Estado |
|-------|--------|
| Deploy en Vercel + dominio + Supabase Auth en producción | ✅ Completo |
| Sistema de roles/permisos para empleados | ✅ Completo |
| Gestión de usuarios (crear/desactivar accesos) | ✅ Completo |
| Dashboard de empleados (`/panel`) | ✅ Completo |
| Sistema de metas/recompensas configurable | ✅ Completo |
| Módulo de stock: compras + conteos + análisis de merma | ✅ Completo (código y RLS) |
| **Medición manual de merma — 3 semanas** | ⏳ **En curso — Lucas y el equipo deben empezar a cargar conteos reales (inicio de semana + cierre de cada noche) para los 4 ingredientes controlados** |
| Evaluar el módulo de stock con datos reales (¿la fórmula tiene sentido? ¿hace falta ajustar umbrales del semáforo, la ventana de compras, o agregar/quitar ingredientes controlados?) | ⏳ Pendiente, depende de la medición de 3 semanas |
| Recuperación de clientes | ⏳ Próxima etapa grande — **especificación pendiente con Lucas** (ver sección 14) |

---

## 16. INSTRUCCIONES PARA ARRANCAR

### Al iniciar en Claude Code:
1. Leer este handoff completo antes de tocar cualquier archivo.
2. Verificar el estado actual del código con `npx next build` — si hay errores de TypeScript, resolverlos antes de agregar funcionalidades.
3. Revisar la estructura de archivos real del proyecto con `ls -la src/app/` para confirmar que coincide con la sección 9.
4. Antes de tocar cualquier módulo marcado ✅, consultar con Lucas.
5. Antes de escribir código para "Recuperación de clientes" (sección 14), conversar con Lucas para definir el alcance — no hay spec detallada todavía, a diferencia del sistema de empleados/stock que sí la tenía.

### Archivos clave a revisar antes de empezar:
- `src/app/(admin)/dashboard/actions.ts` — `KpisPeriodo`, `calcularKpis()` (ahora exportada), `SaludClientes`
- `src/app/(admin)/stock/actions.ts` — `obtenerAnalisisMerma()`, la fórmula de merma con unidades mixtas
- `src/app/(empleado)/panel/actions.ts` — patrón de "calcular completo con admin client, exponer solo lo seguro"
- `src/middleware.ts` — autenticación, roles, chequeo de `activo`
- `src/app/globals.css` — tokens de diseño y `@media print`
- `src/components/layout/Sidebar.tsx` y `EmpleadoNav.tsx` — qué nav links existen en cada lado

### Variables de entorno necesarias (ya configuradas en Vercel):
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

### Comandos útiles:
```bash
npm run dev          # desarrollo local
npx next build       # verificar errores de TypeScript antes de entregar
git push origin main # dispara auto-deploy en Vercel
```

### Antes de hacer commit (una sola vez, pendiente):
Lucas todavía no corrió esto — si los commits vuelven a salir con un email placeholder, es por esto:
```bash
git config --global user.name "Lucas Alaniz"
git config --global user.email "bsediciones@gmail.com"
```

### Cómo entregar código:
- Siempre verificar que compila (`npx next build`) antes de entregar.
- Cuando se toca `dashboard/actions.ts`, siempre reemplazar `dashboard/page.tsx` al mismo tiempo.
- Los archivos de Evolución/Auditoría son interdependientes: `evolucion/actions.ts`, `auditoria/actions.ts`, `dashboard/page.tsx`, `configuracion/actions.ts` deben mantenerse en sync.
- Si se toca `stock/actions.ts`, revisar si `ConteoForm.tsx` (compartido con el lado empleado) necesita el mismo cambio.
- Nunca usar `new Date()` directamente en JSX. Sí está bien usarlo dentro de un server action (se ejecuta en el servidor, no hay mismatch de hidratación).
- Nunca usar `await import(...)` o `require(...)` dentro de componentes React.
- Nunca usar separadores Unicode (═══) en archivos SQL.
- Nunca editar una migración ya aplicada — agregar una nueva.
- Design tokens siempre, nunca colores hardcodeados (no `text-zinc-*`, no `text-emerald-*`).
- Cualquier server action que use `createAdminClient()` (bypasea RLS) debe verificar el rol del caller manualmente al principio de la función.
- Antes de dar por terminada una funcionalidad con login/roles, probarla de punta a punta (lo ideal es con un navegador real — Playwright funcionó bien para esto en esta sesión, instalado ad-hoc con `npm install -D playwright --no-save` para no tocar `package.json`).

---

## 17. RIESGOS Y CONSIDERACIONES TÉCNICAS

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

11. **RLS y empleados — patrón general:** cualquier tabla nueva que un empleado necesite leer requiere una policy `empleado_read`/`empleado_insert` explícita usando `public.get_my_rol()`. El default de RLS es bloquear todo sin policy. **Y al revés**: cualquier tabla con datos en pesos NUNCA debe tener una policy que permita `rol = 'empleado'` ni `USING (true)` para `authenticated` — ver el bug de `periodos` en la sección 12, que estuvo así desde la migración 022 sin que nadie lo notara hasta que se creó la primera cuenta empleado real.

12. **`createAdminClient()` bypasea RLS por completo.** Cualquier server action que lo use es, en los hechos, una puerta sin cerradura — la única protección es el código que escribas. Siempre verificar el rol del caller con el cliente normal (RLS-protegido) ANTES de tocar el admin client. Ver `exigirAdmin()` en `usuarios/actions.ts` como patrón a seguir.

13. **Desactivar un usuario no alcanza con un flag.** `usuarios.activo = false` por sí solo no impide que alguien siga logueado o vuelva a loguearse — Supabase Auth no lo sabe. Hace falta banear a nivel Auth (`ban_duration`) además de actualizar el flag. El middleware además fuerza `signOut()` si detecta `activo = false` en una sesión ya abierta.

14. **Identidad de Git no configurada en la máquina de Lucas.** Sin `git config user.name`/`user.email`, cada commit usa un email auto-generado (`usuario@nombre-de-la-máquina.local`) que puede bloquear el deploy en Vercel (verificación de autor). Confirmar que Lucas corrió la configuración de la sección 16 antes de asumir que un futuro push va a deployar sin problemas.

15. **Unidades mixtas en cálculos de stock.** `ingredientes.conteo_en_unidad_receta` puede activarse para cualquier ingrediente desde Productos → Ingredientes sin tocar código. Si se agrega cualquier cálculo nuevo que combine `conteos_stock` con `compras_ingredientes` o con cualquier cantidad en `unidad_receta` (consumo teórico, consumo interno), repasar la sección 7.7 — convertir cada término individualmente, nunca sumar primero y convertir al final.

16. **No instalar herramientas de testing como dependencia permanente sin que Lucas lo sepa.** Playwright se instaló en esta sesión con `--no-save` específicamente para no modificar `package.json`/`package-lock.json` — quedó en `node_modules` (gitignored) pero no en el repo. Si hace falta para una sesión de testing futura, mismo criterio: no committear esa dependencia sin que sea una decisión consciente de Lucas.
