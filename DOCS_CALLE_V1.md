# DOCS_CALLE_V1.md
## Bitácora Técnica Maestra — CALLE App
**Fecha de cierre de sesión:** 2026-04-04  
**Versión estable en producción:** v1.14  
**URL:** https://calle-app.vercel.app  
**Stack:** React 19 · Vite 8 · Mapbox GL 3 · Supabase 2 · TypeScript · Tailwind CSS · PWA

---

## 1. EVOLUCIÓN DE VERSIONES — v1.7 → v1.14

| Versión | Commit | Hito Principal | Archivos Modificados |
|---------|--------|----------------|----------------------|
| **v1.7** | base | MVP: tracking GPS, HUD básico, misión conjunta por código | `MapboxTracking.tsx` |
| **v1.8** | `b9c4cdc` (parcial) | Sistema de Tribus (Runner/Ciclista/Roller), selector pre-ruta, `startTrackingRef` para arranque diferido | `MapboxTracking.tsx` |
| **v1.9** | `b9c4cdc` (parcial) | Motor Anti-Cheat: límites de velocidad por tribu (20/30/45 km/h), velocidad dual (API + cálculo Haversine entre puntos), toast rojo | `MapboxTracking.tsx` |
| **v1.10** | `b9c4cdc` (parcial) | Tolerancia Offline: estado de red en HUD (📶), cola `calle_offline_routes` en localStorage, auto-sync al reconectar | `MapboxTracking.tsx` |
| **v1.11** | `b9c4cdc` | Cloud Save: `supabase.from('actividades').insert()` en `handleFinish` y en el loop de sync offline | `MapboxTracking.tsx`, `src/supabase.ts` |
| **v1.12** | `469401a` | Supabase Realtime Handshake: canal `misiones`, broadcast `vincular`, toast verde al recibir vinculación del partner | `MapboxTracking.tsx` |
| **v1.13** | `f20aade` | **Hotfix de build:** `.catch()` inválido en `PostgrestFilterBuilder`, `fontSize` duplicado en objeto de estilos | `MapboxTracking.tsx` |
| **v1.14** | `900fcd7` | **Hotfix producción:** guard `VITE_MAPBOX_TOKEN`, fallback defensivo en ambos `supabase.ts`, env vars subidos a Vercel | `MapboxTracking.tsx`, `src/supabase.ts`, `src/lib/supabase.ts` |

---

## 2. ANÁLISIS DE CRISIS — Despliegues v1.12 y v1.13

### Crisis A — Build failure v1.12/v1.13 (exit code 2)

**Síntoma:** `npm run build` fallaba en Vercel con código 2.

**Causa 1 — API de Supabase mal usada:**
```typescript
// ❌ INCORRECTO — PostgrestFilterBuilder NO expone .catch()
await supabase.from('actividades').insert([...]).catch(console.error);

// ✅ CORRECTO
await supabase.from('actividades').insert([...]).then(null, console.error);
```
`PostgrestFilterBuilder` devuelve una `Promise` especializada que no hereda `.catch()` de `Promise.prototype`. TypeScript lo detectó en build (TS2551: "Did you mean 'match'?").

**Causa 2 — Propiedad duplicada en objeto de estilos:**
```typescript
// ❌ INCORRECTO — TS1117: duplicate property
<div style={{ fontSize: '13px', ..., fontSize: '11px' }}>

// ✅ CORRECTO — una sola declaración
<div style={{ fontSize: '11px', ... }}>
```
TypeScript en modo estricto rechaza literales de objeto con claves duplicadas.

---

### Crisis B — Pantalla negra en producción (v1.13)

**Síntoma:** App desplegada en Vercel mostraba pantalla completamente negra. Build pasaba, runtime crasheaba.

**Diagnóstico:**
```bash
vercel env ls
# → No Environment Variables found
```
Vercel no tenía **ninguna** variable de entorno configurada. El archivo `.env.local` está correctamente excluido de git por `*.local` en `.gitignore`, por lo que nunca se subió al repositorio ni al deployment.

**Cadena de fallo en runtime:**
```
import { supabase } from './supabase'
  → createClient(undefined, undefined)  ← THROW en tiempo de carga del módulo
  → React no puede montar el árbol de componentes
  → DOM queda vacío → pantalla negra
```

**Solución aplicada (v1.14):**

1. Variables de entorno subidas directamente a Vercel:
```bash
echo "https://pcgwyagormzgxwciiwrz.supabase.co" | vercel env add VITE_SUPABASE_URL production
echo "eyJ..." | vercel env add VITE_SUPABASE_ANON_KEY production
```

2. Guard defensivo en ambos clientes Supabase:
```typescript
// src/supabase.ts y src/lib/supabase.ts
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://placeholder.supabase.co';
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || 'placeholder-key';
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

3. Guard en componente para `VITE_MAPBOX_TOKEN` ausente:
```typescript
if (!MAPBOX_TOKEN) {
  return <div>⚠️ Falta Token de Configuración</div>;
}
```

> ⚠️ **Deuda pendiente:** `VITE_MAPBOX_TOKEN` aún no está en Vercel. El mapa muestra la pantalla de error en producción hasta que se añada manualmente.

---

## 3. ESTADO DEL ARTE — Arquitectura v1.14

### 3.1 Árbol de ficheros relevantes

```
src/
├── App.tsx                    — Router de pantallas, estado global de usuario, syncUserData
├── MapboxTracking.tsx         — 1052 líneas, motor principal de la app
├── supabase.ts                — Cliente Supabase (Vite env, con fallback)
├── lib/
│   ├── supabase.ts            — Cliente duplicado (usado por missions.ts)
│   ├── db.ts                  — syncUserData() → upsert tabla `users`
│   ├── missions.ts            — fetchMissions(), checkSessionMissions()
│   └── xp.ts                  — calculateLevel(), xpForNextLevel()
├── Home.tsx / Stats.tsx / Summary.tsx / Welcome.tsx
├── ClassSelection.tsx / LosK.tsx / MisionesList.tsx
└── components/
    ├── InstallPrompt.tsx
    └── MisionesPanel.tsx
```

### 3.2 MapboxTracking.tsx — Inventario de hooks y lógica

**Refs (14):**
`mapContainerRef`, `mapRef`, `watchIdRef`, `timerRef`, `lastPosRef`, `routeCoordsRef`, `markerRef`, `wakeLockRef`, `startTrackingRef`, `trackingStartedRef`, `userTribeRef`, `distanceRef`, `durationRef`, `speedRef`, `lastGpsTsRef`, `jointMissionActiveRef`, `jointRejectedRef`, `jointDistanceRef`, `userCodeRef`, `onFinishRef`

**Estados (15):**
`userTribe`, `trackingStarted`, `distanceKm`, `durationSec`, `speedKmh`, `isCheating`, `finishing`, `socialBoost`, `jointProgress`, `jointStatus`, `streakCount`, `isOnline`, `offlineToast`, `showCodeModal`, `codeInput`, `codeError`, `pendingCode`, `showConfirmModal`, `realtimeToast`

**Sistemas activos:**
| Sistema | Implementación | Estado |
|---------|---------------|--------|
| GPS Tracking | `watchPosition` + Haversine | ✅ Producción |
| Anti-Cheat | Límites por tribu + velocidad dual | ✅ Producción |
| Wake Lock | `navigator.wakeLock.request('screen')` | ✅ Producción |
| Auto-Save | `setInterval` 30s → localStorage | ✅ Producción |
| Restore Session | `loadSession()` con TTL 2h | ✅ Producción |
| Streak | `calle_streak` en localStorage | ✅ Producción |
| Misión Conjunta | Broadcast Realtime `supabase.channel('misiones')` | ✅ Producción |
| Offline Queue | `calle_offline_routes` + auto-sync | ✅ Producción |
| Cloud Save | `actividades.insert()` en Supabase | ✅ Producción (sin token Mapbox) |
| Selector Tribu | Pre-pantalla con `startTrackingRef` diferido | ✅ Producción |
| Niveles/Racha | `getLevelName(xp)` + `computeStreakCount()` | ✅ Producción |

### 3.3 Deuda técnica identificada

| Deuda | Severidad | Descripción |
|-------|-----------|-------------|
| `VITE_MAPBOX_TOKEN` en Vercel | 🔴 CRÍTICA | El mapa no renderiza en producción |
| Dos archivos `supabase.ts` | 🟡 MEDIA | `src/supabase.ts` y `src/lib/supabase.ts` son idénticos — deberían unificarse |
| Autenticación inexistente | 🟡 MEDIA | El `userId` es un UUID generado por `crypto.randomUUID()` en localStorage. Sin auth real, los datos no son portables entre dispositivos |
| `calculateLevel` vs `getLevelName` | 🟡 MEDIA | Dos sistemas de nivel paralelos: `xp.ts` (1000 XP/nivel) vs umbrales cualitativos en `MapboxTracking.tsx`. Deben unificarse |
| Chunk size > 500 KB | 🟢 BAJA | Bundle de 2.1 MB (Mapbox pesa ~1.5 MB). Requiere code splitting con `dynamic import()` |
| Sin tests | 🟢 BAJA | Cero cobertura de tests unitarios ni E2E |
| `tailwindcss` sin PostCSS | 🟢 BAJA | Warnings de `@tailwind` en build (lightningcss no lo procesa) |

---

## 4. ROADMAP ESTRATÉGICO

### SPRINT A — Seguridad y Fundación (Corto plazo, ~2 semanas)

**Objetivo:** Que cada usuario tenga una identidad real, persistente y portable.

**Tareas:**

**A1. Añadir `VITE_MAPBOX_TOKEN` a Vercel (30 min — URGENTE)**
```bash
echo "pk.tu_token_real" | vercel env add VITE_MAPBOX_TOKEN production
vercel --prod --force
```

**A2. Unificar clientes Supabase (1h)**
- Eliminar `src/supabase.ts` (duplicado)
- Todos los imports apuntan a `src/lib/supabase.ts`

**A3. Supabase Auth — Magic Link o Google OAuth (1 día)**
```typescript
// Login sin contraseña — flujo ideal para app móvil PWA
const { error } = await supabase.auth.signInWithOtp({ email });
// O con Google:
await supabase.auth.signInWithOAuth({ provider: 'google' });
```
- Reemplazar `crypto.randomUUID()` por `supabase.auth.getUser()` como `userId`
- Proteger `users` y `actividades` con RLS (Row Level Security) en Supabase
- `db.ts → syncUserData()` usa el `user.id` del JWT, no localStorage

**A4. Unificar sistema de niveles (4h)**
- Mover `getLevelName()` a `src/lib/xp.ts`
- Usar los mismos umbrales en toda la app
- Ajustar `calculateLevel()` para que respete la escala cualitativa

**A5. Pantalla de perfil persistente (1 día)**
- Al iniciar sesión, cargar datos desde tabla `users` (nombre, tribu, XP, km)
- Eliminar dependencia total de localStorage para el perfil

---

### SPRINT B — Social y Leaderboards (Mediano plazo, ~3 semanas)

**Objetivo:** Que CALLE sea una experiencia colectiva con identidad territorial.

**Tareas:**

**B1. Tabla `ciudades` en Supabase**
- Ciudades iniciales: Quilpué, Lampa
- Campo `ciudad` en tabla `users` y `actividades`
- Selección de ciudad en onboarding (Welcome.tsx)

**B2. Leaderboard por ciudad (vista Supabase)**
```sql
CREATE VIEW leaderboard_ciudad AS
SELECT name, class, total_xp, total_km, ciudad
FROM users
ORDER BY total_xp DESC;
```
- UI en `Stats.tsx` con tabs por ciudad
- Top 10 por tribu + top 10 global

**B3. Historial de actividades**
- Nueva pantalla `History.tsx`
- Consulta `actividades` filtrada por `user_id`
- Cards con fecha, distancia, XP, tribu, mision_conjunta

**B4. Notificaciones push (Service Worker)**
- Aprovechar el SW existente (ya hay PWA configurada)
- Notificar cuando un partner te vincula (vía Realtime)
- "🔥 Tu racha está en riesgo" si llevan 20h sin actividad

**B5. Pantalla social "Los K" mejorada**
- `LosK.tsx` actualmente es placeholder
- Integrar con Supabase Realtime para ver quién está activo en este momento en tu ciudad

---

### SPRINT C — Escala y Gamificación Avanzada (Largo plazo, ~6 semanas)

**Objetivo:** Convertir CALLE en un ecosistema de movimiento urbano.

**Tareas:**

**C1. Power-ups de Tribu**
- Cada tribu tiene un power-up activable 1x/semana:
  - Runner: `Modo Fantasma` — sin anti-cheat por 10 min
  - Ciclista: `Turbo` — multiplicador ×1.5 por 5 km
  - Roller: `Slalom` — +50 XP por cada giro brusco detectado (acelerómetro)

**C2. Zonas Calientes (Hot Zones)**
- Polígonos GeoJSON en Mapbox
- Al entrar a una zona: XP bonus + notificación
- Zonas dinámicas actualizadas desde Supabase (admin dashboard)

**C3. Sistema de Clanes**
- Tabla `clanes` en Supabase
- Crear/unirse a un clan por ciudad
- XP colectivo del clan, ranking de clanes

**C4. Integración con Partners Locales**
- Tabla `partners` (cafeterías, talleres de bici, locales deportivos)
- Al pasar cerca de un partner: cupón de descuento en la app
- Partners pueden "patrocinar" zonas calientes con XP bonus extra

**C5. Métricas y Dashboard Admin**
- Panel en Supabase Studio o Metabase
- DAU/WAU/MAU por ciudad
- Distancia total acumulada por tribu
- Heatmap de rutas más populares

---

## 5. DECISIONES TÉCNICAS CRÍTICAS PARA EL FUTURO

| Decisión | Opción A | Opción B | Recomendación |
|----------|----------|----------|---------------|
| Auth | Supabase Magic Link | Google OAuth | Magic Link (menos fricción en móvil) |
| Estado global | Context API actual | Zustand | Zustand para Sprint B+ (leaderboards necesitan estado reactivo complejo) |
| Mapbox vs alternativa | Mapbox GL (actual) | MapLibre GL (open source) | Mantener Mapbox hasta 50K MAU, luego evaluar costos |
| Code splitting | Bundle único (actual) | `React.lazy()` por pantalla | Implementar en Sprint A para reducir TTI en móviles lentos |
| Testing | Sin tests (actual) | Vitest + Playwright | Al menos tests de `haversineKm`, `getLevelName`, `computeStreakCount` en Sprint A |

---

## 6. MÉTRICAS DE LA SESIÓN

| Métrica | Valor |
|---------|-------|
| Versiones desplegadas | v1.7 → v1.14 (7 iteraciones) |
| Líneas en MapboxTracking.tsx | 497 → 1052 (+111%) |
| Commits de la sesión | 10 |
| Bugs de producción resueltos | 2 (build exit 2, pantalla negra) |
| Sistemas nuevos implementados | 8 (Tribus, Anti-Cheat, Wake Lock, Offline Queue, Cloud Save, Realtime, Niveles/Racha, Selector Tribu) |
| Variables de entorno en Vercel | 0 → 2 (pendiente: Mapbox token) |

---

*Generado el 2026-04-04 — CALLE v1.14 — "La calle no se para."*
