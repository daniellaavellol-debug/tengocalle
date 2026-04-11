# ARQUITECTURA MVP — CALLE v1.14
> Documento actualizado al estado real de producción. Última revisión: 2026-04-04.  
> URL en producción: **https://calle-app.vercel.app**  
> Versión anterior del documento: v1.6 (obsoleta — ver sección 7 para diferencias)

---

## 1. TECH STACK

| Capa | Tecnología | Versión | Notas |
|------|-----------|---------|-------|
| Bundler | Vite + TypeScript | 8.0 / 5.9 | `tsc -b && vite build` |
| UI | React | 19.2 | Sin framework de routing — navegación por estado |
| Mapas | Mapbox GL JS | 3.21 | Estilo `dark-v11`, ruta naranja / cian en misión conjunta |
| Backend / DB | Supabase | 2.101 | PostgreSQL + Realtime Broadcast |
| PWA | vite-plugin-pwa | 1.2 | Workbox, `autoUpdate`, `skipWaiting`, `clientsClaim` |
| Deploy | Vercel | — | Node 20, `.npmrc` con `legacy-peer-deps=true` |
| CSS | Tailwind CSS | — | PostCSS; warnings de `@tailwind` en build (no bloquean) |

**Variables de entorno requeridas en Vercel (production):**

| Variable | Estado | Uso |
|----------|--------|-----|
| `VITE_MAPBOX_TOKEN` | ⚠️ PENDIENTE añadir | Token `pk.*` de Mapbox GL |
| `VITE_SUPABASE_URL` | ✅ Configurado | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | ✅ Configurado | Clave pública anon de Supabase |

> Sin `VITE_MAPBOX_TOKEN` el componente `MapboxTracking` renderiza la pantalla de error "⚠️ Falta Token de Configuración" en vez de la pantalla negra.

---

## 2. ARQUITECTURA DE COMPONENTES

```
App.tsx  (router de estados + estado global de usuario)
│
├── Welcome.tsx           — Onboarding y nombre
├── ClassSelection.tsx    — Selección de clase/tribu inicial del perfil
├── Home.tsx              — Dashboard: XP, nivel, racha, misiones activas
├── MapboxTracking.tsx    — ★ Motor principal (1052 líneas)
├── Summary.tsx           — Resumen post-salida: XP ganado, distancia, misiones
├── Stats.tsx             — Estadísticas históricas del usuario
├── LosK.tsx              — Pantalla social (en desarrollo)
├── MisionesList.tsx      — Lista de misiones disponibles
│
├── components/
│   ├── InstallPrompt.tsx     — Banner PWA "Añadir a pantalla de inicio"
│   └── MisionesPanel.tsx     — Panel lateral de misiones activas
│
└── lib/
    ├── supabase.ts       — Cliente Supabase con fallback defensivo
    ├── db.ts             — syncUserData() → upsert tabla `users`
    ├── missions.ts       — fetchMissions(), checkSessionMissions()
    └── xp.ts             — calculateLevel(), xpForNextLevel()
```

**Estado global del usuario** (`App.tsx`, persistido en `localStorage`):

```typescript
interface UserData {
  name: string;
  userClass: string;       // tribu del perfil permanente
  multiplier: number;      // 1.0 | 1.2 | 1.5 según clase
  totalXp: number;
  totalKm: number;
  streak: number;
  encounters: number;
  missions: { salALaCalle: boolean; aveNocturna: boolean; sociable: boolean };
  completedMissionIds: number[];
}
```

---

## 3. MOTOR DE TRACKING — MapboxTracking.tsx

### 3.1 GPS y distancia

- `navigator.geolocation.watchPosition` con `enableHighAccuracy: true`, `maximumAge: 0`, `timeout: 10000`
- Filtro de ruido: descarta movimientos < **3 m** entre puntos consecutivos
- Distancia calculada con **fórmula Haversine** (precisión submétrica a escala urbana)
- La ruta se dibuja en tiempo real sobre el mapa Mapbox con capa GeoJSON `LineString`

### 3.2 Fórmula XP

```
BaseXP = (10 × distancia_km + 2 × duración_min) × multiplicador_tribu
```

| Tribu | Multiplicador |
|-------|--------------|
| Runner | 1.2 |
| Ciclista | 1.0 |
| Roller | 1.5 |

El multiplicador viene del perfil del usuario (`userClass` → `multiplier` calculado en `ClassSelection.tsx`).

### 3.3 Sistema de Niveles

```typescript
function getLevelName(xp: number): string {
  if (xp <= 500)  return 'Sin Calle';
  if (xp <= 1500) return 'Callejero';
  if (xp <= 3500) return 'Patiperro';
  if (xp <= 7000) return 'Dueño del Barrio';
  return 'Leyenda de la Calle';
}
```

El HUD superior muestra: `{icono_tribu} LVL {número} · {nombre_nivel}`

> ⚠️ **Deuda técnica:** existe un segundo cálculo de nivel en `src/lib/xp.ts` (`1000 XP/nivel`) que no usa los umbrales cualitativos. Ambos deben unificarse en Sprint A.

### 3.4 Rachas (Streak)

- Almacenadas en `localStorage` bajo la key `calle_streak` como `{ count: number, lastTs: number }`
- Si la última actividad fue hace **≤ 48 horas**: racha vigente
- Si fue hace **> 48 horas**: racha rota, vuelve a 0
- La racha se incrementa al finalizar una sesión con Supabase OK (no en modo offline)
- Se muestra en HUD como `🔥 {n}`

### 3.5 Motor Anti-Cheat

Velocidad detectada por **doble fuente** (la primera disponible tiene precedencia):
1. `position.coords.speed` de la Geolocation API (metros/segundo → km/h)
2. Cálculo manual entre los dos últimos puntos GPS: `(haversineKm / Δt_segundos) × 3600`

**Límites por tribu:**

| Tribu | Límite km/h | Razón |
|-------|------------|-------|
| Runner | 20 | Velocidad máxima humana en carrera |
| Roller | 30 | Patinaje urbano agresivo |
| Ciclista | 45 | Ciclismo urbano rápido |

Si `velocidad > límite_tribu` → `isCheating = true`:
- La acumulación de distancia **se pausa**
- La acumulación de XP **se pausa**
- Se muestra toast rojo: `"⚠️ Velocidad anómala. XP pausado."`
- El borde del HUD inferior cambia a rojo `#ef4444`

### 3.6 Wake Lock API

```typescript
navigator.wakeLock.request('screen')
  .then(lock => { wakeLockRef.current = lock; })
  .catch(() => {}); // batería baja o permiso denegado — silencioso
```

Previene que la pantalla del móvil se apague durante una salida activa. Se libera en `handleFinish` y en el cleanup del `useEffect`.

### 3.7 Persistencia de Sesión

- Auto-Save cada **30 segundos** en `localStorage` → key `calle_active_session`
- Estructura guardada: `{ distanceKm, durationSec, lastPos, jointDistance, jointMissionActive, savedAt }`
- Al montar el componente: si existe una sesión guardada con **< 2 horas** de antigüedad, se restaura automáticamente (saltando el selector de tribu)
- Si Supabase responde OK al finalizar: `localStorage.removeItem('calle_active_session')`

---

## 4. MISIÓN CONJUNTA — Handshake Realtime

### 4.1 Flujo completo

La misión conjunta conecta a dos usuarios en tiempo real usando **Supabase Realtime Broadcast**. No requiere un servidor intermedio.

```
Usuario A                          Supabase Realtime                  Usuario B
    │                                  channel('misiones')                 │
    │── Mi ID: #4821 (en HUD) ────────────────────────────────────────────│
    │                                                                       │
    │    [A abre modal → escribe #7344 → pulsa CONTINUAR]                  │
    │                                                                       │
    │── Modal confirmación ──────────────────────────────────────────────  │
    │   "Sumen +1 km extra para DUPLICAR ×2 el XP"                        │
    │                                                                       │
    │    [A pulsa ACEPTAR MISIÓN]                                           │
    │                                                                       │
    │── send({ event: 'vincular',  ──────────────────────────────────────► │
    │         payload: { targetCode: '7344' } })                           │
    │                                                                       │
    │                              ◄── broadcast entregado ─────────────── │
    │                                                                       │
    │                                                  [B recibe el evento] │
    │                                                  targetCode === myCode│
    │                                                  → Misión activada    │
    │                                                  → Ruta cambia a CIAN │
    │                              Toast verde en B: ────────────────────── │
    │                              "¡Tu partner te ha vinculado!            │
    │                               Misión Cian activada."                  │
```

### 4.2 Implementación técnica

**Suscripción al canal (en `useEffect`, mount):**
```typescript
const channel = supabase.channel('misiones')
  .on('broadcast', { event: 'vincular' }, (payload) => {
    if (payload.payload.targetCode === userCodeRef.current.toString()) {
      // Activar misión cian en el receptor
      jointMissionActiveRef.current = true;
      mapRef.current.setPaintProperty('route-line', 'line-color', '#00FFFF');
      setRealtimeToast('¡Tu partner te ha vinculado! Misión Cian activada.');
    }
  })
  .subscribe();

// Cleanup
return () => { supabase.removeChannel(channel); };
```

**Emisión del evento (en `handleConfirmMission` al aceptar):**
```typescript
await supabase.channel('misiones').send({
  type: 'broadcast',
  event: 'vincular',
  payload: { targetCode: pendingCode }, // código que ingresó el usuario
});
```

### 4.3 Reglas de XP de la misión

| Escenario | XP resultante |
|-----------|--------------|
| Aceptó y recorrió **≥ 1 km** juntos | `BaseXP × 2` |
| Aceptó pero recorrió **< 1 km** | `BaseXP + 100 XP fijos` |
| Rechazó la misión | `BaseXP + 100 XP fijos` |
| Sin misión conjunta | `BaseXP` |

> **Cambio respecto a v1.6:** Se eliminó el límite superior de 8 km. Solo existe el mínimo de 1 km. El multiplicador ×2 se aplica únicamente al `BaseXP` (ya incluye el multiplicador de tribu), no al bonus de misiones de Supabase.

### 4.4 Estados visuales

| Estado | Color ruta | HUD superior | Indicador |
|--------|-----------|--------------|-----------|
| Sin misión | Naranja `#f97316` | Pill "Mi ID: #XXXX · 🤝 Vincular" | — |
| Misión activa | Cian `#00FFFF` | Pill "{progreso} / 1.0 km" con glow cian | Borde HUD cian |
| Rechazada | Naranja `#f97316` | Pill "✗ +100 XP" en rojo | — |

---

## 5. TOLERANCIA OFFLINE

### 5.1 Estado de red en HUD

El HUD superior muestra un indicador de conectividad en tiempo real:
- `📶 Online` — borde verde `#22c55e`
- `📶 Offline` — borde rojo `#ef4444`

Implementado con `window.addEventListener('online' | 'offline')`.

### 5.2 Cola de rutas offline

Si el usuario finaliza una ruta sin conexión (`!navigator.onLine`):
1. Los datos se guardan en `localStorage` bajo la key `calle_offline_routes` como array de `OfflineRoute[]`
2. `onFinish` **no se llama** — el perfil no se actualiza aún
3. Se muestra toast: `"Sin red. Ruta guardada localmente."`

**Estructura de cada ruta en cola:**
```typescript
interface OfflineRoute {
  xp: number;
  distanceKm: number;
  durationSec: number;
  missionBonusXp: number;
  savedAt: number; // timestamp Unix
}
```

### 5.3 Auto-Sync al reconectar

Al detectar el evento `'online'`:
1. Lee el array de `calle_offline_routes`
2. Para cada ruta: hace `supabase.from('actividades').insert(...)` y llama `onFinish()`
3. Vacía el array de localStorage
4. Muestra toast: `"🔄 Rutas offline sincronizadas"`

---

## 6. INFRAESTRUCTURA Y CLOUD

### 6.1 Supabase

**Tablas en uso:**

| Tabla | Descripción | Llamada desde |
|-------|-------------|---------------|
| `actividades` | Registro de cada sesión finalizada | `handleFinish` en `MapboxTracking.tsx` |
| `users` | Perfil del usuario (upsert por device UUID) | `syncUserData()` en `lib/db.ts` |
| `missions` | Definición de misiones disponibles | `fetchMissions()` en `lib/missions.ts` |

> **Nota:** Las tablas se llaman desde el código pero **no tienen RLS (Row Level Security) configurado** aún. Cualquier cliente con la `anon_key` puede leer/escribir. Prioridad Sprint A.

**Realtime:**
- Canal `misiones` con evento `vincular` — Broadcast (no persiste en DB, peer-to-peer vía websocket)
- Sin suscripciones Postgres (`INSERT`/`UPDATE`) implementadas todavía

**Autenticación:**
- No implementada aún. El `userId` es un UUID generado por `crypto.randomUUID()` y guardado en `localStorage` (`calle_device_id`)
- Cada dispositivo tiene una identidad no portable

### 6.2 Vercel

- Deploy automático en rama `master`
- Sin CI configurado — deploys manuales con `vercel --prod --force`
- Variables de entorno configuradas directamente vía `vercel env add`
- Build command: `npm run build` → `tsc -b && vite build`
- Output directory: `dist/`

### 6.3 Mapbox

- Estilo: `mapbox://styles/mapbox/dark-v11`
- Centro inicial: `-71.4429, -33.0494` (Quilpué, Chile)
- Zoom inicial: 15
- Capa de ruta: GeoJSON `LineString` actualizada en cada punto GPS
- Marcador de posición actual: `div` personalizado con color de la tribu elegida

---

## 7. DIFERENCIAS v1.6 → v1.14 (Auditoría de cambios)

| Sección | En v1.6 (obsoleto) | En v1.14 (actual) |
|---------|-------------------|-------------------|
| Anti-cheat velocidad | Límite global 60 km/h | Límites por tribu: 20/30/45 km/h + velocidad calculada entre puntos GPS |
| Límite misión conjunta | Éxito entre 1 km y 8 km | Solo mínimo ≥ 1 km (sin límite superior) |
| XP misión éxito | `(BaseXP + BonusXP) × 2` | `BaseXP × 2` (el bonus de misiones se suma aparte) |
| Vinculación | Modal local, sin red | Supabase Realtime Broadcast (handshake bidireccional) |
| Selector de tribu | Hardcoded desde perfil | Pantalla de selección pre-ruta con arranque diferido de GPS/timer |
| Sistema de niveles | No documentado | `getLevelName(xp)` con 5 niveles cualitativos en HUD |
| Rachas | No implementado | `calle_streak` en localStorage, ventana de 48h |
| Wake Lock | No implementado | `navigator.wakeLock.request('screen')` |
| Offline | No implementado | Cola `calle_offline_routes` + auto-sync |
| Cloud Save | Mencionado como integración Supabase genérica | `actividades.insert()` en cada sesión finalizada |
| Codebase de referencia | `C:/Proyectos/CALLE v0/proyecto` (Next.js + Leaflet — **ABANDONADO**) | `C:/Proyectos/CALLE v0/calle-app` (Vite + Mapbox) |

> **IMPORTANTE:** El archivo `C:/Proyectos/CALLE v0/proyecto/PROGRESO.md` documenta una codebase **completamente diferente y abandonada** basada en Next.js, Leaflet, QR codes y `GameContext.tsx`. Ese código NO está en producción. Toda la arquitectura descrita en este documento corresponde exclusivamente a `calle-app/`.

---

## 8. DEUDA TÉCNICA PENDIENTE

| ID | Deuda | Severidad | Sprint |
|----|-------|-----------|--------|
| DT-01 | `VITE_MAPBOX_TOKEN` no está en Vercel — mapa no renderiza en producción | 🔴 CRÍTICA | Ahora |
| DT-02 | Dos archivos `supabase.ts` idénticos (`src/` y `src/lib/`) | 🟡 MEDIA | Sprint A |
| DT-03 | Sin autenticación real — UUID de device no es portable | 🟡 MEDIA | Sprint A |
| DT-04 | Sin RLS en Supabase — datos expuestos a cualquier cliente | 🟡 MEDIA | Sprint A |
| DT-05 | Dos sistemas de nivel en paralelo (`getLevelName` vs `calculateLevel`) | 🟡 MEDIA | Sprint A |
| DT-06 | Bundle único de 2.1 MB — Mapbox representa ~70% del peso | 🟢 BAJA | Sprint B |
| DT-07 | Sin tests unitarios ni E2E | 🟢 BAJA | Sprint B |

---

## 9. CHANGELOG TÉCNICO DE SESIÓN

| Fecha | Versión | Cambio |
|-------|---------|--------|
| 2026-04-04 | v1.7 | Sistema de progresión: `getLevelName()`, racha 🔥, HUD nivel |
| 2026-04-04 | v1.8 | Wake Lock API, selector de tribu pre-ruta, `startTrackingRef` diferido |
| 2026-04-04 | v1.9 | Motor Anti-Cheat: límites por tribu, velocidad dual GPS/Haversine |
| 2026-04-04 | v1.10 | Tolerancia offline: `calle_offline_routes`, auto-sync, indicador 📶 |
| 2026-04-04 | v1.11 | Cloud Save: `actividades.insert()` en Supabase en cada sesión |
| 2026-04-04 | v1.12 | Supabase Realtime Handshake: canal `misiones`, broadcast `vincular`, toast verde |
| 2026-04-04 | v1.13 | Hotfix build: `.catch()` inválido en Supabase → `.then(null, cb)`, `fontSize` duplicado |
| 2026-04-04 | v1.14 | Hotfix producción: guard `MAPBOX_TOKEN`, fallback Supabase client, env vars en Vercel |

---

*CALLE v1.14 — "La calle no se para."*  
*Documento mantenido por el equipo de desarrollo. Próxima actualización: post Sprint A.*
