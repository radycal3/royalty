# ROYALTY V1 — Guía de Deploy (Fase 0)

---

## Paso 1: Crear repositorio en GitHub

1. Andá a github.com → New Repository.
2. Nombre: `royalty` (privado).
3. No inicialices con README ni .gitignore (ya los tenemos).
4. Copiá la URL del repo (ej: `https://github.com/tu-usuario/royalty.git`).

---

## Paso 2: Subir el código

```bash
cd royalty
git init
git add .
git commit -m "Fase 0: cimientos del proyecto"
git branch -M main
git remote add origin https://github.com/tu-usuario/royalty.git
git push -u origin main
```

---

## Paso 3: Crear proyecto en Supabase

1. Andá a supabase.com → New Project.
2. Nombre: `royalty`
3. Región: South America (São Paulo) — la más cercana a Rosario.
4. Generá una contraseña segura para la base de datos (guardala).
5. Esperá a que el proyecto se cree (~2 minutos).

---

## Paso 4: Ejecutar las migraciones SQL

Desde el dashboard de Supabase:

1. Andá a **SQL Editor**.
2. Ejecutá cada archivo SQL en orden, uno por uno:
   - `001_usuarios.sql`
   - `002_configuracion.sql`
   - `003_periodos.sql`
   - `004_ingredientes.sql`
   - `005_productos.sql`
   - `006_ventas.sql`
   - `007_empleados.sql`
   - `008_cadetes.sql`
   - `009_gastos.sql`
   - `010_stock.sql`
   - `011_laboratorio.sql`
   - `012_snapshots.sql`
   - `013_seed.sql`

Para cada uno: pegá el contenido del archivo → clic en "Run".

**Verificación:** después de ejecutar todos, andá a **Table Editor**. Deberías ver las 18 tablas creadas (usuarios, configuracion, periodos_operativos, ingredientes, ingredientes_costos, productos, productos_precios, recetas, mapeo_pedix, importaciones, pedidos, pedidos_lineas, empleados, asistencia, cadetes, gastos_publicidad, gastos_equipo, gastos_cadeteria, consumo_interno, stock_conteos, stock_compras, cambios_estrategicos, snapshots_semanales).

---

## Paso 5: Crear el usuario admin (Lucas)

### 5a. Crear el usuario en Supabase Auth

Desde el dashboard de Supabase:

1. Andá a **Authentication** → **Users** → **Add User**.
2. Email: `lucas@royalty.com` (o el email real que quieras usar).
3. Password: la que quieras (mínimo 6 caracteres).
4. Clic en "Create User".
5. Copiá el **User UID** que se generó (es un UUID largo).

### 5b. Insertar el usuario en la tabla usuarios

Andá a **SQL Editor** y ejecutá:

```sql
insert into public.usuarios (id, email, nombre, rol)
values (
  'ACÁ-PEGÁ-EL-UUID-DEL-PASO-ANTERIOR',
  'lucas@royalty.com',
  'Lucas',
  'admin'
);
```

Reemplazá el UUID y el email con los valores reales.

### 5c. (Opcional) Crear un usuario empleado para probar

Repetí el mismo proceso:
1. Authentication → Add User → email: `marcos@royalty.com`, password.
2. Copiá el UUID.
3. SQL Editor:

```sql
insert into public.usuarios (id, email, nombre, rol)
values (
  'UUID-DEL-EMPLEADO',
  'marcos@royalty.com',
  'Marcos',
  'empleado'
);
```

---

## Paso 6: Obtener las claves de Supabase

Desde el dashboard de Supabase:

1. Andá a **Settings** → **API**.
2. Copiá:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role secret key** → `SUPABASE_SERVICE_ROLE_KEY`

---

## Paso 7: Configurar variables de entorno locales

En la carpeta del proyecto, creá el archivo `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```

---

## Paso 8: Instalar dependencias y probar localmente

```bash
npm install
npm run dev
```

Abrí `http://localhost:3000`. Deberías:
1. Ver la página de login.
2. Ingresar con `lucas@royalty.com` y tu contraseña.
3. Ser redirigido al dashboard con el sidebar completo.
4. Poder navegar entre todas las secciones (todas muestran placeholder).
5. Ver en el header: "Semana 1 · 19 Jun–21 Jun" con badge "Abierto".

Si creaste el usuario empleado:
1. Cerrar sesión.
2. Ingresar con `marcos@royalty.com`.
3. Ser redirigido al Panel Equipo (sin sidebar).
4. Intentar navegar a `/dashboard` manualmente → debe redirigir a `/panel`.

---

## Paso 9: Deploy a Vercel

1. Andá a vercel.com → **Add New Project**.
2. Importá el repositorio `royalty` desde GitHub.
3. Framework Preset: **Next.js** (se detecta automáticamente).
4. En **Environment Variables**, agregá las 3 variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Clic en **Deploy**.
6. Esperá a que termine (~2-3 minutos).

---

## Paso 10: Configurar dominio (opcional)

Si querés un dominio custom:
1. En Vercel → Settings → Domains.
2. Agregá tu dominio (ej: `app.royaltyburgers.com`).
3. Configurá los DNS según las instrucciones de Vercel.

---

## Paso 11: Verificación final

### Como admin:
- [ ] Login funciona.
- [ ] Sidebar muestra las 8 secciones + Configuración.
- [ ] Header muestra el período activo con badge "Abierto".
- [ ] Todas las secciones cargan sin error.
- [ ] Cerrar sesión funciona.

### Como empleado:
- [ ] Login funciona.
- [ ] Se ve el Panel Equipo (sin sidebar).
- [ ] No se puede acceder a rutas admin.

### En Supabase:
- [ ] Todas las tablas existen.
- [ ] La tabla `configuracion` tiene 7 registros.
- [ ] La tabla `periodos_operativos` tiene 1 registro (Semana 1, estado "abierto").
- [ ] La tabla `usuarios` tiene al menos 1 registro (Lucas, admin).

---

## Ajustar el primer período operativo

El seed crea el período Semana 1 con fechas 19-21 Jun 2026. Si tus fechas reales son distintas, actualizá desde SQL Editor:

```sql
update public.periodos_operativos
set fecha_inicio = '2026-06-XX',
    fecha_fin = '2026-06-XX'
where numero_semana = 1 and anio = 2026;
```

---

## Estructura del proyecto entregado

```
royalty/
├── .env.example
├── .gitignore
├── next.config.js
├── package.json
├── postcss.config.js
├── tsconfig.json
├── src/
│   ├── middleware.ts
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── login/page.tsx
│   │   ├── (admin)/
│   │   │   ├── layout.tsx
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── importar/page.tsx
│   │   │   ├── productos/page.tsx
│   │   │   ├── gastos/page.tsx
│   │   │   ├── stock/page.tsx
│   │   │   ├── equipo/page.tsx
│   │   │   ├── cadetes/page.tsx
│   │   │   ├── laboratorio/page.tsx
│   │   │   └── configuracion/page.tsx
│   │   └── (empleado)/
│   │       ├── layout.tsx
│   │       └── panel/page.tsx
│   ├── components/layout/
│   │   ├── AdminHeader.tsx
│   │   ├── LogoutButton.tsx
│   │   └── Sidebar.tsx
│   └── lib/supabase/
│       ├── admin.ts
│       ├── client.ts
│       └── server.ts
└── supabase/migrations/
    ├── 001_usuarios.sql
    ├── 002_configuracion.sql
    ├── 003_periodos.sql
    ├── 004_ingredientes.sql
    ├── 005_productos.sql
    ├── 006_ventas.sql
    ├── 007_empleados.sql
    ├── 008_cadetes.sql
    ├── 009_gastos.sql
    ├── 010_stock.sql
    ├── 011_laboratorio.sql
    ├── 012_snapshots.sql
    └── 013_seed.sql
```

Fase 0 completada. Cuando verifiques todo, avanzamos a Fase 1.
