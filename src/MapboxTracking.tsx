import { useEffect, useRef, useState } from 'react';
import { trackMissionStarted } from './providers/PostHogProvider';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { batchUpdateProgress, fetchMissionsByTribe, evaluateSessionMissions } from './hooks/useMissions';
import {
  deriveEncounterCode,
  lookupReceiverByCode,
  confirmEncuentro,
  subscribeToEncuentroUpdates,
  respondToHandshake,
  ensureEncounterCode,
  type HandshakeRequest,
} from './services/handshakeService';
import { useHandshakeListener } from './hooks/useHandshakeListener';
import { supabase } from './lib/supabase';
import { getStreakDisplay, updateStreak } from './utils/streakLogic';
import { calcTotalXp, calcXpPreview } from './utils/xpLogic';
import {
  getMisionDelDia,
  missionConditionMet,
  type DailyMission,
} from './services/missionService';

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string) || '';
const JOINT_MIN_SPEED_KMH = 1;

// Límites anti-cheat por tribu (km/h)
const TRIBE_SPEED_LIMITS: Record<string, number> = {
  Runner: 20,
  Roller: 30,
  Ciclista: 45,
};
const TRIBE_ICONS: Record<string, string> = {
  Runner: '🏃‍♂️',
  Ciclista: '🚴‍♂️',
  Roller: '🛼',
};

const CLASS_COLORS: Record<string, string> = {
  Runner: '#3B82F6',
  Ciclista: '#F97316',
  Roller: '#22C55E',
};

function getLevelName(xp: number): string {
  if (xp <= 500) return 'Sin Calle';
  if (xp <= 1500) return 'Callejero';
  if (xp <= 3500) return 'Patiperro';
  if (xp <= 7000) return 'Dueño del Barrio';
  return 'Leyenda de la Calle';
}


function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Tiempo activo real en segundos, descontando pausas. */
function computeElapsed(startTime: number, totalPausedMs: number, pauseStartTime: number | null): number {
  const currentPause = pauseStartTime !== null ? Date.now() - pauseStartTime : 0;
  return Math.max(0, Math.floor((Date.now() - startTime - totalPausedMs - currentPause) / 1000));
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

interface Props {
  multiplier: number;
  userClass: string;
  userLevel: number;
  userXp: number;
  userId: string | null;
  userName: string;
  completedMissionIds: number[];
  /** true cuando B aceptó la invitación fuera del mapa — activa modo cian al montar */
  startJointMission?: boolean;
  /** Llamado una vez que el modo cian se activó, para que App.tsx limpie el flag */
  onJointMissionStarted?: () => void;
  onFinish: (xp: number, distanceKm: number, durationSec: number, missionBonusXp: number, newMissionIds: number[]) => void;
  onBack: () => void;
}

const SESSION_KEY = 'calle_active_session';
const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const OFFLINE_QUEUE_KEY = 'calle_offline_routes';

interface OfflineRoute {
  xp: number;
  distanceKm: number;
  durationSec: number;
  missionBonusXp: number;
  savedAt: number;
}

interface SavedSession {
  distanceKm: number;
  durationSec: number;        // legacy — mantenido para compat; fuente de verdad: startTime
  startTime: number;          // epoch ms cuando arrancó el tracking
  totalPausedMs: number;      // ms acumulados en pausa
  isPaused: boolean;          // estaba pausado al guardar
  pauseStartTime: number | null; // epoch ms cuando comenzó la pausa activa
  lastPos: { lat: number; lon: number } | null;
  jointDistance: number;
  jointMissionActive: boolean;
  completedMissionIds: number[];
  routeCoords: [number, number][];
  savedAt: number;
}

function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSession;

    // Descartar sesión vencida (> 2 horas desde savedAt)
    if (Date.now() - (parsed.savedAt ?? 0) > SESSION_MAX_AGE_MS) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }

    // Sanity check: si startTime es 0 o está en el futuro, corregirlo
    // usando durationSec como fallback. Si durationSec también es absurdo
    // (> SESSION_MAX_AGE_MS), la sesión está corrompida — descartarla.
    const MAX_DURATION_SEC = SESSION_MAX_AGE_MS / 1000; // 7200 s = 2 h
    if (!parsed.startTime || parsed.startTime > Date.now()) {
      const legacyDur = parsed.durationSec ?? 0;
      if (legacyDur > MAX_DURATION_SEC) {
        console.warn('[loadSession] Sesión corrompida (durationSec absurdo:', legacyDur, '). Descartando.');
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      // Reconstruir startTime desde durationSec legacy
      parsed.startTime = Date.now() - legacyDur * 1000 - (parsed.totalPausedMs ?? 0);
    }

    return parsed;
  } catch {
    return null;
  }
}

const TRIBES = ['Runner', 'Ciclista', 'Roller'] as const;

export default function MapboxTracking({ multiplier, userClass, userLevel, userXp, userId, userName: _userName, completedMissionIds, startJointMission, onJointMissionStarted, onFinish, onBack }: Props) {
  const sessionStartHourRef = useRef(new Date().getHours());
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPosRef = useRef<{ lat: number; lon: number } | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  // Ref para arrancar timer+GPS después de que el usuario elija tribu
  const startTrackingRef = useRef<(() => void) | null>(null);
  const trackingStartedRef = useRef(false);
  const userTribeRef = useRef('');

  const _saved = loadSession();

  // Inicializar con coordenadas guardadas para restaurar el trazado al recargar
  const routeCoordsRef = useRef<[number, number][]>(_saved?.routeCoords ?? []);

  const distanceRef = useRef(_saved?.distanceKm ?? 0);
  const speedRef = useRef(0);
  const lastGpsTsRef = useRef<number | null>(null);

  // ── Timing basado en wall-clock ──────────────────────────────────────────────
  // loadSession() ya garantiza que startTime > 0 y es razonable.
  // Guarda explícita extra: si por alguna razón llega 0 (epoch), derivamos
  // desde durationSec para no calcular 29M minutos.
  const savedStartTime = (_saved?.startTime && _saved.startTime > 0)
    ? _saved.startTime
    : (_saved ? Date.now() - Math.min(_saved.durationSec ?? 0, SESSION_MAX_AGE_MS / 1000) * 1000 - (_saved.totalPausedMs ?? 0) : 0);
  const savedTotalPausedMs  = _saved?.totalPausedMs ?? 0;
  const savedPauseStartTime = _saved?.pauseStartTime ?? null;
  const savedIsPaused       = _saved?.isPaused ?? false;

  const startTimeRef      = useRef<number>(savedStartTime);
  const totalPausedMsRef  = useRef<number>(savedTotalPausedMs);
  const pauseStartTimeRef = useRef<number | null>(savedPauseStartTime);
  const isPausedRef       = useRef<boolean>(savedIsPaused);

  const initialDuration = _saved
    ? computeElapsed(savedStartTime, savedTotalPausedMs, savedPauseStartTime)
    : 0;
  const durationRef = useRef(initialDuration);

  const jointMissionActiveRef = useRef(_saved?.jointMissionActive ?? false);
  const jointRejectedRef = useRef(false);
  const jointDistanceRef = useRef(_saved?.jointDistance ?? 0);
  // Código estático derivado del userId (prop) — sincrónico, sin async
  const derivedCode   = userId ? deriveEncounterCode(userId) : '';
  const userCodeRef   = useRef<string>(derivedCode);
  const displayCode   = derivedCode; // no necesita estado — userId es estable
  // Actualizar refs si userId cambia (salvaguarda)
  userCodeRef.current = derivedCode;
  const userIdRef     = useRef<string | null>(userId);
  userIdRef.current   = userId;

  const onFinishRef = useRef(onFinish);
  useEffect(() => { onFinishRef.current = onFinish; }, [onFinish]);

  // Publicar encounter_code en profiles para que otros nos puedan encontrar
  useEffect(() => {
    if (userId) void ensureEncounterCode(userId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (_saved?.lastPos && !lastPosRef.current) {
    lastPosRef.current = _saved.lastPos;
  }

  // Si hay sesión guardada, saltar el selector y usar la clase del perfil
  const [userTribe, setUserTribe] = useState(_saved ? (userClass || '') : '');
  const [trackingStarted, setTrackingStarted] = useState(!!_saved);

  const [distanceKm, setDistanceKm] = useState(_saved?.distanceKm ?? 0);
  // routePath: fuente de verdad React del trazado. Actualizado en cada punto GPS válido.
  // Se usará en Summary para mostrar la ruta completada.
  const [routePath, setRoutePath] = useState<[number, number][]>(_saved?.routeCoords ?? []);
  void routePath; // consumido explícitamente — lectura futura en Summary/export
  const [durationSec, setDurationSec] = useState(initialDuration);
  const [isPaused, setIsPaused] = useState(savedIsPaused);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [isCheating, setIsCheating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [socialBoost, setSocialBoost] = useState(false);

  const [jointProgress, setJointProgress] = useState(_saved?.jointDistance ?? 0);
  const [jointStatus, setJointStatus] = useState<'idle' | 'active' | 'rejected'>(
    _saved?.jointMissionActive ? 'active' : 'idle'
  );

  const [streakCount] = useState<number>(() => getStreakDisplay().count);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineToast, setOfflineToast] = useState('');

  // GPS lock — false hasta recibir precisión < 30 m fuera de coords de fallback
  const [isGpsLocked, setIsGpsLocked] = useState<boolean>(!!_saved);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const prelockWatchRef = useRef<number | null>(null);

  // Misión del día
  const [dailyMission, setDailyMission] = useState<DailyMission | null>(null);
  const dailyMissionRef = useRef<DailyMission | null>(null); // para acceder en handleFinish sin stale closure

  // ── Handshake modal states ────────────────────────────────────────────────
  const [showCodeModal,    setShowCodeModal]    = useState(false);
  const [codeInput,        setCodeInput]        = useState('');
  const [codeError,        setCodeError]        = useState('');
  const [codeSubmitting,   setCodeSubmitting]   = useState(false);

  // Iniciador (A): esperando respuesta de B
  const [waitingHandshake, setWaitingHandshake] = useState<{
    requestId: string; receiverName: string;
  } | null>(null);
  const [waitingTimeLeft,  setWaitingTimeLeft]  = useState(60);
  const waitingCleanupRef = useRef<(() => void) | null>(null);

  // Receptor (B): solicitud entrante de A
  const [incomingRequest, setIncomingRequest] = useState<HandshakeRequest | null>(null);

  const [realtimeToast, setRealtimeToast] = useState('');

  // ── Timer countdown para el waiting state (iniciador A) ─────────────────
  useEffect(() => {
    if (!waitingHandshake) return;
    setWaitingTimeLeft(60);

    const interval = setInterval(() => {
      setWaitingTimeLeft(t => {
        if (t <= 1) {
          clearInterval(interval);
          // Timeout: cancelar request en DB + activar jointRejected (consolation XP)
          waitingCleanupRef.current?.();
          waitingCleanupRef.current = null;
          setWaitingHandshake(null);
          jointRejectedRef.current = true;
          setJointStatus('rejected');
          setRealtimeToast('Tiempo agotado. Sin respuesta de tu compañero.');
          setTimeout(() => setRealtimeToast(''), 4000);
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingHandshake?.requestId]);

  // Sincronizar userTribeRef cuando cambia el estado
  useEffect(() => { userTribeRef.current = userTribe; }, [userTribe]);

  // Cargar misión del día al montar (no bloquea el render ni el mapa)
  useEffect(() => {
    const cls = userClass || userTribe;
    if (!cls) return;
    getMisionDelDia(cls).then(result => {
      dailyMissionRef.current = result;
      setDailyMission(result);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // GPS pre-lock: watch independiente que solo valida señal antes de INICIAR.
  // Se cancela automáticamente al obtener lock o al desmontar el componente.
  useEffect(() => {
    // Si restauramos sesión, el GPS ya estaba activo — lock implícito
    if (_saved || !navigator.geolocation) return;

    const FALLBACK_LAT = -33.0494;  // centro de Valparaíso (coordenada de fallback del mapa)
    const FALLBACK_LON = -71.4429;

    prelockWatchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        setGpsAccuracy(Math.round(accuracy));
        const distFromFallback = haversineKm(lat, lon, FALLBACK_LAT, FALLBACK_LON);
        const isFallback = distFromFallback < 0.1; // dentro de 100 m del fallback
        if (accuracy < 30 && !isFallback) {
          setIsGpsLocked(true);
          if (prelockWatchRef.current != null) {
            navigator.geolocation.clearWatch(prelockWatchRef.current);
            prelockWatchRef.current = null;
          }
        }
      },
      () => { /* error GPS: el estado queda en rojo sin accuracy */ },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );

    return () => {
      if (prelockWatchRef.current != null) {
        navigator.geolocation.clearWatch(prelockWatchRef.current);
        prelockWatchRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── activateCian: activa misión conjunta en ambos lados ──────────────────
  const activateCian = () => {
    jointMissionActiveRef.current = true;
    jointDistanceRef.current = 0;
    setJointProgress(0);
    setJointStatus('active');
    // (el color de la ruta se actualiza en el efecto del mapa que observa jointStatus)
    if (mapRef.current?.isStyleLoaded()) {
      mapRef.current.setPaintProperty('route-line', 'line-color', '#00FFFF');
    }
  };

  // ── Activación automática cuando B acepta desde fuera del mapa ────────────
  // startJointMission llega como true si el usuario aceptó en el modal global de App.tsx.
  // Se ejecuta una sola vez al montar (dependencias vacías intencionadas).
  useEffect(() => {
    if (!startJointMission) return;
    activateCian();
    onJointMissionStarted?.(); // limpia el flag en App.tsx
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Listener receptor (B): solicitudes entrantes via Postgres Changes ─────
  // Solo activo cuando startJointMission es false (misión no iniciada aún).
  // Si ya arrancamos con joint mission, no necesitamos escuchar más invitaciones.
  useHandshakeListener(startJointMission ? null : userId, (req) => {
    setIncomingRequest(req);
  });

  // Red: escucha online/offline + auto-sync al reconectar
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      try {
        const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
        if (!raw) return;
        const queue: OfflineRoute[] = JSON.parse(raw);
        if (queue.length === 0) return;
        // Subir cada ruta a Supabase
        for (const r of queue) {
          await supabase.from('actividades').insert([{
            user_id: userIdRef.current,  // columna: user_id (no id_usuario)
            tribu: userTribeRef.current,
            distancia: r.distanceKm,
            xp_ganado: r.xp,
            mision_conjunta: false,
          }]).then(null, console.error);
          onFinishRef.current(r.xp, r.distanceKm, r.durationSec, r.missionBonusXp, []);
        }
        localStorage.removeItem(OFFLINE_QUEUE_KEY);
        setOfflineToast('🔄 Rutas offline sincronizadas');
        setTimeout(() => setOfflineToast(''), 3500);
      } catch {}
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Si había sesión guardada, marcar como iniciado desde el principio
  useEffect(() => {
    if (_saved) {
      trackingStartedRef.current = true;
      userTribeRef.current = userClass || '';
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-Save cada 30 segundos
  useEffect(() => {
    const id = setInterval(() => {
      const allCoords = routeCoordsRef.current;
      const session: SavedSession = {
        distanceKm: distanceRef.current,
        durationSec: durationRef.current,
        startTime: startTimeRef.current,
        totalPausedMs: totalPausedMsRef.current,
        isPaused: isPausedRef.current,
        pauseStartTime: pauseStartTimeRef.current,
        lastPos: lastPosRef.current,
        jointDistance: jointDistanceRef.current,
        jointMissionActive: jointMissionActiveRef.current,
        completedMissionIds,
        // Guardar últimos 500 puntos para no saturar localStorage (~16 KB)
        routeCoords: allCoords.length > 500 ? allCoords.slice(-500) : allCoords,
        savedAt: Date.now(),
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    // Wake Lock: definidos en el scope del efecto para que el cleanup los vea
    const acquireWakeLock = () => {
      if ('wakeLock' in navigator) {
        navigator.wakeLock.request('screen')
          .then(lock => { wakeLockRef.current = lock; })
          .catch(() => {});
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) {
        acquireWakeLock();
      }
    };

    mapRef.current = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-71.4429, -33.0494],
      zoom: 15,
      attributionControl: false,
    });

    mapRef.current.on('load', () => {
      mapRef.current?.resize();

      // Wake Lock: evitar bloqueo de pantalla durante el tracking
      acquireWakeLock();
      // Re-adquirir si el SO cancela el lock al volver de segundo plano
      document.addEventListener('visibilitychange', handleVisibility);

      mapRef.current?.addSource('route', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
      });
      mapRef.current?.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#f97316', 'line-width': 5, 'line-opacity': 0.9 },
      });

      if (jointMissionActiveRef.current) {
        mapRef.current?.setPaintProperty('route-line', 'line-color', '#00FFFF');
      }

      // Restaurar trazado si venimos de sesión guardada
      if (routeCoordsRef.current.length > 0) {
        const restoredSource = mapRef.current?.getSource('route') as mapboxgl.GeoJSONSource;
        restoredSource?.setData({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: routeCoordsRef.current },
          properties: {},
        });
      }

      // Función que arranca el timer y el GPS — se ejecuta solo tras elegir tribu
      const doStart = () => {
        // Intervalo a 500ms para suavidad; el valor se computa desde wall-clock, no se acumula
        timerRef.current = setInterval(() => {
          if (isPausedRef.current) return;
          const elapsed = computeElapsed(startTimeRef.current, totalPausedMsRef.current, null);
          durationRef.current = elapsed;
          setDurationSec(elapsed);
        }, 500);

        if (navigator.geolocation) {
          watchIdRef.current = navigator.geolocation.watchPosition(
            (pos) => {
              // No procesar coordenadas ni distancia mientras está pausado
              if (isPausedRef.current) return;

              const { latitude: lat, longitude: lon, speed } = pos.coords;
              const now = pos.timestamp;

              // ── Cálculo de distancia y velocidad ──────────────────────────
              // dKm y haversineKmh se calculan UNA vez y se reutilizan.
              const dtSec = lastGpsTsRef.current != null
                ? Math.max(0, (now - lastGpsTsRef.current) / 1000)
                : 0;

              let dKm = 0;
              let haversineKmh = 0;
              if (lastPosRef.current && dtSec > 0) {
                dKm = haversineKm(lastPosRef.current.lat, lastPosRef.current.lon, lat, lon);
                haversineKmh = (dKm / dtSec) * 3600;
              }

              // Velocidad para el display: preferimos la nativa si existe, sino la calculada
              const displayKmh = speed != null ? Math.round(speed * 3.6) : Math.round(haversineKmh);

              lastGpsTsRef.current = now;
              speedRef.current = displayKmh;
              setSpeedKmh(displayKmh);

              // ── Anti-cheat implacable ─────────────────────────────────────
              // Usamos el MAYOR entre velocidad nativa y Haversine.
              // Así un chip GPS que reporte "0 km/h" con coordenadas saltadas = descarte.
              const HARD_CAP_KMH = 45; // ninguna tribu supera esto
              const tribeLimit = Math.min(TRIBE_SPEED_LIMITS[userTribeRef.current] ?? HARD_CAP_KMH, HARD_CAP_KMH);
              const worstKmh = Math.max(displayKmh, haversineKmh);
              const cheat = worstKmh > tribeLimit;
              setIsCheating(cheat);

              if (cheat) {
                // BLOQUEO TOTAL: no se suma distancia, no se traza, no se acumula XP.
                // Solo anclamos posición si es el primer punto (para referencias futuras).
                if (!lastPosRef.current) lastPosRef.current = { lat, lon };
                return;
              }

              // ── Punto válido: procesar ────────────────────────────────────
              // Helper: sincroniza el source de Mapbox y el estado React
              const flushRoute = () => {
                const coords = routeCoordsRef.current;
                const source = mapRef.current?.getSource('route') as mapboxgl.GeoJSONSource;
                source?.setData({
                  type: 'Feature',
                  geometry: { type: 'LineString', coordinates: coords },
                  properties: {},
                });
                setRoutePath([...coords]);
              };

              if (lastPosRef.current) {
                if (dKm > 0.003) {
                  const newDist = distanceRef.current + dKm;
                  distanceRef.current = newDist;
                  setDistanceKm(newDist);
                  lastPosRef.current = { lat, lon };

                  if (jointMissionActiveRef.current && displayKmh >= JOINT_MIN_SPEED_KMH) {
                    const newJointDist = jointDistanceRef.current + dKm;
                    jointDistanceRef.current = newJointDist;
                    setJointProgress(newJointDist);
                  }

                  routeCoordsRef.current.push([lon, lat]);
                  flushRoute();
                }
              } else {
                // Primera posición válida: anclar y dibujar punto inicial
                lastPosRef.current = { lat, lon };
                mapRef.current?.setCenter([lon, lat]);
                routeCoordsRef.current.push([lon, lat]);
                flushRoute();
              }

              // Mover marker solo a posiciones validadas
              if (markerRef.current) {
                markerRef.current.setLngLat([lon, lat]);
              } else {
                const color = CLASS_COLORS[userTribeRef.current] ?? '#F97316';
                const el = document.createElement('div');
                el.style.cssText =
                  `width:16px;height:16px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 10px ${color}`;
                markerRef.current = new mapboxgl.Marker({ element: el })
                  .setLngLat([lon, lat])
                  .addTo(mapRef.current!);
                mapRef.current?.flyTo({ center: [lon, lat], zoom: 16 });
              }
            },
            (err) => console.warn('GPS error:', err.message),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
          );
        }
      };

      startTrackingRef.current = doStart;

      // Auto-arrancar si venimos de sesión guardada
      if (trackingStartedRef.current) doStart();
    });

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
      markerRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Iniciar salida tras elegir tribu ──────────────────────────────────────
  const handleIniciar = () => {
    if (!userTribe || !isGpsLocked) return;
    userTribeRef.current = userTribe;
    trackingStartedRef.current = true;
    setTrackingStarted(true);
    startTimeRef.current = Date.now(); // ancla el cronómetro a la pared
    trackMissionStarted({ userClass: userTribe });
    // Si el mapa ya cargó, arrancar de inmediato; si no, el on('load') lo hará
    if (startTrackingRef.current) startTrackingRef.current();
  };

  // ── Pausa / Reanudar ─────────────────────────────────────────────────────
  const handleTogglePause = () => {
    if (isPausedRef.current) {
      // Reanudar: acumular tiempo de esta pausa y limpiar
      if (pauseStartTimeRef.current !== null) {
        totalPausedMsRef.current += Date.now() - pauseStartTimeRef.current;
        pauseStartTimeRef.current = null;
      }
      isPausedRef.current = false;
      setIsPaused(false);
    } else {
      // Pausar: registrar el momento exacto de inicio de pausa
      pauseStartTimeRef.current = Date.now();
      isPausedRef.current = true;
      setIsPaused(true);
    }
  };

  // ── Handshake aceptado (A detecta UPDATE 'accepted') ─────────────────────
  const handleHandshakeAccepted = () => {
    waitingCleanupRef.current?.();
    waitingCleanupRef.current = null;
    setWaitingHandshake(null);
    activateCian();
    setRealtimeToast('¡Conexión confirmada! Misión Conjunta activada.');
    setTimeout(() => setRealtimeToast(''), 4000);
  };

  // ── Handshake rechazado (A detecta UPDATE 'rejected'/'expired') ─────────────
  // XP base (+50) ya fue otorgado por confirmEncuentro() al crear el encuentro.
  const handleHandshakeRejected = () => {
    waitingCleanupRef.current?.();
    waitingCleanupRef.current = null;
    setWaitingHandshake(null);
    setJointStatus('rejected');
    setRealtimeToast('Tu compañero rechazó la misión conjunta. +50 XP base garantizados.');
    setTimeout(() => setRealtimeToast(''), 4000);
  };

  // ── Modal paso 1: A ingresa código de B → busca receptor → confirma encuentro ──
  // Usa el mismo flujo que Home: INSERT en encuentros (status=pending) +
  // grantXP +50 a ambos. B recibe el pop-up naranja de EncuentroPopup
  // sin importar en qué pantalla esté (componente montado globalmente en App.tsx).
  const handleCodeSubmit = async () => {
    const trimmed = codeInput.trim();
    if (!/^\d{4}$/.test(trimmed)) {
      setCodeError('Ingresa exactamente 4 dígitos.');
      return;
    }
    if (trimmed === displayCode) {
      setCodeError('Ese es tu propio código.');
      return;
    }
    if (!userId) { setCodeError('Sin sesión activa.'); return; }

    setCodeSubmitting(true);
    setCodeError('');

    // 1. Buscar receptor por código en handshake_codes
    const receiver = await lookupReceiverByCode(trimmed);
    if (!receiver) {
      setCodeError('Código no encontrado. Pídele a tu compañero que abra la app.');
      setCodeSubmitting(false);
      return;
    }

    // 2. Confirmar encuentro — INSERT en encuentros + grantXP +50 base a ambos
    const result = await confirmEncuentro(receiver.id, trimmed);
    if (!result.success) {
      setCodeError(result.error ?? 'Error al enviar invitación. Intenta de nuevo.');
      setCodeSubmitting(false);
      return;
    }

    // 3. Cerrar modal de entrada + mostrar waiting
    setShowCodeModal(false);
    setCodeInput('');
    setCodeSubmitting(false);
    setWaitingHandshake({ requestId: result.encuentroId!, receiverName: receiver.name });

    // 4. Suscribirse al UPDATE en encuentros (B acepta/rechaza desde EncuentroPopup)
    const channel = subscribeToEncuentroUpdates(
      result.encuentroId!,
      (enc) => {
        if (enc.status === 'accepted') {
          handleHandshakeAccepted();
        } else if (enc.status === 'rejected' || enc.status === 'expired') {
          handleHandshakeRejected();
        }
      },
    );
    waitingCleanupRef.current = () => { supabase.removeChannel(channel); };
  };

  // ── B responde a solicitud entrante ───────────────────────────────────────
  const handleIncomingResponse = async (accepted: boolean) => {
    if (!incomingRequest) return;
    setIncomingRequest(null);

    await respondToHandshake(incomingRequest.requestId, accepted ? 'accepted' : 'rejected');

    if (accepted) {
      activateCian();
      setRealtimeToast('¡Misión Conjunta activada! Rueda con tu compañero.');
      setTimeout(() => setRealtimeToast(''), 4000);
    } else {
      setRealtimeToast('Solicitud rechazada. +50 XP por contacto.');
      setTimeout(() => setRealtimeToast(''), 3000);

      // 50 XP para B por haber tenido contacto social
      if (userIdRef.current) {
        void supabase.from('actividades').insert({
          user_id:         userIdRef.current,
          xp_ganado:       50,
          distancia:       0,
          mision_conjunta: false,
        });
      }
    }
  };

  const handleFinish = async () => {
    setFinishing(true);
    if (timerRef.current) clearInterval(timerRef.current);
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;

    const finalDist = distanceRef.current;
    const finalDuration = computeElapsed(startTimeRef.current, totalPausedMsRef.current, null);
    const sessionCtx = { distanceKm: finalDist, durationSec: finalDuration, startHour: sessionStartHourRef.current };
    const activeClass = userTribeRef.current || userClass;

    // ── Misiones de sesión (evaluateSessionMissions) ─────────────────────────
    let sessionMissionBonusXp = 0;
    let newIds: number[] = [];
    let supabaseOk = false;
    try {
      const allMissions = await fetchMissionsByTribe(activeClass);
      const results = evaluateSessionMissions(allMissions, sessionCtx, completedMissionIds);
      const completed = results.filter(r => r.completed);
      sessionMissionBonusXp = completed.reduce((sum, r) => sum + (r.mission.xp_reward ?? 0), 0);
      newIds = completed.map(r => r.mission.id);
      supabaseOk = true;

      if (completed.length > 0) {
        const { data: { user: authU } } = await supabase.auth.getUser();
        if (authU) {
          const batchUpdates = completed.map(r => ({
            missionId: r.mission.id,
            progressValue: 100,
            completed: true,
            xpEarned: r.mission.xp_reward ?? 0,
          }));
          void batchUpdateProgress(authU.id, batchUpdates);
        }
      }
    } catch (e) {
      console.warn('[handleFinish] Supabase error, keeping session:', e);
    }

    const totalMissionBonusXp = sessionMissionBonusXp;

    // ── Misión conjunta (social boost) ────────────────────────────────────────
    const jointActive  = jointMissionActiveRef.current;
    const jointRejected = jointRejectedRef.current;
    const jointDist    = jointDistanceRef.current;
    const jointSuccess = jointActive && jointDist >= 1.0;
    const hasJointMission = jointActive || jointRejected;

    // ── XP final con fórmula oficial ─────────────────────────────────────────
    // El bonus de encuentro social (misión conjunta) vale +100 si hubo misión,
    // y se multiplica igual que el resto.
    const encounterBonus = hasJointMission ? 100 : 0;

    let finalXp = calcTotalXp({
      distanceKm:      finalDist,
      durationSec:     finalDuration,
      userClass:       activeClass,
      roundMultiplier: multiplier,
      missionBonusXp:  totalMissionBonusXp,
      encounterBonusXp: encounterBonus,
    });

    const finalMissionBonus = totalMissionBonusXp;

    if (jointSuccess) {
      finalXp = finalXp * 2; // ×2 por misión conjunta completada
      setSocialBoost(true);
      await new Promise(r => setTimeout(r, 2000));
    }

    // Guardado en la nube
    await supabase.from('actividades').insert([{
      user_id: userId,                 // columna: user_id (no id_usuario)
      tribu: userTribeRef.current || userClass,
      distancia: finalDist,
      xp_ganado: finalXp,
      mision_conjunta: hasJointMission,
    }]).then(null, console.error);

    // Cola offline: si no hay red, guardar localmente y no llamar onFinish aún
    if (!navigator.onLine) {
      try {
        const queue: OfflineRoute[] = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
        queue.push({ xp: finalXp, distanceKm: finalDist, durationSec: finalDuration, missionBonusXp: finalMissionBonus, savedAt: Date.now() });
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
      } catch {}
      setOfflineToast('Sin red. Ruta guardada localmente.');
      setTimeout(() => setOfflineToast(''), 3500);
      setFinishing(false);
      return;
    }

    // Limpiar sesión activa si Supabase respondió bien
    if (supabaseOk) localStorage.removeItem(SESSION_KEY);

    // Actualizar racha siempre, independiente de Supabase
    updateStreak(finalDist);

    onFinish(finalXp, finalDist, finalDuration, finalMissionBonus, newIds);
  };

  // Guard: token de Mapbox requerido
  if (!MAPBOX_TOKEN) {
    return (
      <div style={{
        width: '100vw', height: '100vh', background: '#0a0f1a',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px',
      }}>
        <p style={{ color: '#ef4444', fontWeight: 900, fontSize: '18px', textTransform: 'uppercase', letterSpacing: '2px' }}>
          ⚠️ Falta Token de Configuración
        </p>
        <p style={{ color: '#475569', fontSize: '12px' }}>VITE_MAPBOX_TOKEN no está definido.</p>
        <button onClick={onBack} style={{
          background: '#f97316', color: 'black', border: 'none', borderRadius: '999px',
          padding: '10px 28px', fontWeight: 900, fontSize: '12px', cursor: 'pointer',
          textTransform: 'uppercase', letterSpacing: '2px',
        }}>← Volver</button>
      </div>
    );
  }

  const xpPreview = calcXpPreview(distanceKm, durationSec, userTribe || userClass, multiplier);
  const hudBorderColor = isCheating ? '#ef4444' : jointStatus === 'active' ? '#00FFFF' : '#f97316';
  const activeTribeIcon = TRIBE_ICONS[userTribe] ?? '';

  // Estilos compartidos para modales
  const modalOverlay: React.CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 500,
    background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '24px',
  };
  const modalBox: React.CSSProperties = {
    background: '#0f172a', border: '2px solid #f97316',
    borderRadius: '1.25rem', padding: '28px 24px', width: '100%', maxWidth: '340px',
    boxShadow: '0 0 40px rgba(249,115,22,0.3)',
  };
  const modalTitle: React.CSSProperties = {
    color: '#f97316', fontWeight: 900, fontSize: '18px',
    fontStyle: 'italic', textTransform: 'uppercase', letterSpacing: '2px',
    marginBottom: '6px',
  };
  const modalSub: React.CSSProperties = {
    color: '#94a3b8', fontSize: '12px', marginBottom: '20px', lineHeight: 1.5,
  };
  const btnPrimary: React.CSSProperties = {
    background: '#f97316', color: 'black', border: 'none',
    borderRadius: '999px', padding: '12px 0', width: '100%',
    fontWeight: 900, fontSize: '13px', textTransform: 'uppercase',
    letterSpacing: '2px', cursor: 'pointer', fontStyle: 'italic',
  };
  const btnSecondary: React.CSSProperties = {
    background: 'transparent', color: '#64748b',
    border: '1px solid #334155', borderRadius: '999px',
    padding: '10px 0', width: '100%', fontWeight: 700,
    fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px',
    cursor: 'pointer', marginTop: '10px',
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', backgroundColor: '#0f172a' }}>

      {/* MAPA — siempre presente en background */}
      <div
        ref={mapContainerRef}
        style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
      />

      {/* ── INDICADOR DE SEÑAL GPS — visible en todos los estados ─────────── */}
      <div style={{
        position: 'absolute', top: '14px', right: '14px', zIndex: 460,
        display: 'flex', alignItems: 'center', gap: '6px',
        background: 'rgba(0,0,0,0.72)', borderRadius: '999px',
        padding: '5px 12px', border: '1px solid rgba(255,255,255,0.07)',
        pointerEvents: 'none',
      }}>
        <div style={{
          width: '8px', height: '8px', borderRadius: '50%',
          background: isGpsLocked ? '#22c55e' : (gpsAccuracy !== null ? '#facc15' : '#ef4444'),
          boxShadow: isGpsLocked
            ? '0 0 7px #22c55e99'
            : (gpsAccuracy !== null ? '0 0 7px #facc1599' : 'none'),
          transition: 'background 0.4s, box-shadow 0.4s',
        }} />
        <span style={{
          color: '#94a3b8', fontSize: '9px', fontWeight: 700,
          letterSpacing: '0.5px', textTransform: 'uppercase',
        }}>
          {isGpsLocked ? 'GPS OK' : (gpsAccuracy !== null ? `${gpsAccuracy}m` : 'GPS...')}
        </span>
      </div>

      {/* ── GPS LOCK OVERLAY — bloquea hasta señal < 30 m ─────────────────── */}
      {!isGpsLocked && !trackingStarted && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 450,
          background: 'rgba(0,0,0,0.95)', backdropFilter: 'blur(8px)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: '16px', padding: '32px',
        }}>
          <style>{`@keyframes calle-spin{to{transform:rotate(360deg)}}`}</style>

          {/* Botón volver */}
          <button
            onClick={onBack}
            style={{
              position: 'absolute', top: '28px', left: '20px',
              background: 'transparent', color: '#475569',
              border: '1px solid #1e293b', borderRadius: '999px',
              padding: '7px 16px', fontWeight: 700, fontSize: '11px',
              textTransform: 'uppercase', letterSpacing: '1px', cursor: 'pointer',
            }}
          >
            ← Volver
          </button>

          {/* Spinner */}
          <div style={{
            width: '72px', height: '72px', borderRadius: '50%',
            border: '4px solid rgba(255,95,31,0.12)',
            borderTop: '4px solid #FF5F1F',
            animation: 'calle-spin 0.85s linear infinite',
          }} />

          <span style={{ fontSize: '40px', marginTop: '-6px' }}>🛰️</span>

          <p style={{
            color: '#FF5F1F', fontWeight: 900, fontSize: '18px',
            fontStyle: 'italic', textTransform: 'uppercase',
            letterSpacing: '3px', textAlign: 'center', margin: 0,
          }}>
            Sintonizando señal
          </p>
          <p style={{
            color: '#64748b', fontSize: '12px', letterSpacing: '0.5px',
            textAlign: 'center', lineHeight: 1.7, margin: 0,
          }}>
            Buscando tu ubicación en la calle...
          </p>

          {/* Accuracy en tiempo real */}
          {gpsAccuracy !== null ? (
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '1rem', padding: '12px 28px', textAlign: 'center',
            }}>
              <p style={{ color: '#64748b', fontSize: '10px', margin: '0 0 4px', letterSpacing: '1px', textTransform: 'uppercase' }}>
                Precisión actual
              </p>
              <p style={{
                color: gpsAccuracy < 50 ? '#facc15' : '#ef4444',
                fontWeight: 900, fontSize: '28px', fontStyle: 'italic', margin: 0,
              }}>
                {gpsAccuracy}m
              </p>
              <p style={{ color: '#334155', fontSize: '10px', margin: '4px 0 0', letterSpacing: '0.5px' }}>
                necesita &lt; 30 m
              </p>
            </div>
          ) : (
            <p style={{ color: '#334155', fontSize: '11px', letterSpacing: '0.5px' }}>
              Activa el GPS de tu dispositivo
            </p>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          PANTALLA: SELECTOR DE TRIBU (antes de iniciar)
      ══════════════════════════════════════════════════════ */}
      {!trackingStarted && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 400,
          background: 'rgba(10,15,26,0.96)', backdropFilter: 'blur(6px)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '32px 24px',
        }}>
          {/* Botón volver */}
          <button
            onClick={onBack}
            style={{
              position: 'absolute', top: '28px', left: '20px',
              background: 'transparent', color: '#475569',
              border: '1px solid #1e293b', borderRadius: '999px',
              padding: '7px 16px', fontWeight: 700, fontSize: '11px',
              textTransform: 'uppercase', letterSpacing: '1px', cursor: 'pointer',
            }}
          >
            ← Volver
          </button>

          {/* Título */}
          <p style={{
            color: '#f97316', fontWeight: 900, fontSize: '26px',
            fontStyle: 'italic', textTransform: 'uppercase',
            letterSpacing: '4px', marginBottom: '6px', textAlign: 'center',
          }}>
            Elige tu Tribu
          </p>
          <p style={{
            color: '#475569', fontSize: '12px', marginBottom: '36px',
            letterSpacing: '1px', textAlign: 'center',
          }}>
            LVL {userLevel} · {getLevelName(userXp)}
            {streakCount > 0 && <span style={{ color: '#facc15', marginLeft: '10px' }}>🔥 {streakCount}</span>}
          </p>

          {/* Botones de tribu */}
          <div style={{ display: 'flex', gap: '14px', marginBottom: '40px', width: '100%', maxWidth: '340px' }}>
            {TRIBES.map(tribe => {
              const selected = userTribe === tribe;
              const color = CLASS_COLORS[tribe];
              return (
                <button
                  key={tribe}
                  onClick={() => setUserTribe(tribe)}
                  style={{
                    flex: 1,
                    background: selected ? `${color}18` : 'rgba(15,23,42,0.9)',
                    border: `2px solid ${selected ? color : '#1e293b'}`,
                    borderRadius: '1rem', padding: '18px 8px',
                    cursor: 'pointer', textAlign: 'center',
                    boxShadow: selected ? `0 0 18px ${color}55` : 'none',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>{TRIBE_ICONS[tribe]}</div>
                  <div style={{
                    color: selected ? color : '#64748b',
                    fontWeight: 900, fontSize: '10px',
                    textTransform: 'uppercase', letterSpacing: '1.5px',
                  }}>
                    {tribe}
                  </div>
                  {selected && (
                    <div style={{
                      width: '6px', height: '6px', borderRadius: '50%',
                      background: color, margin: '8px auto 0',
                      boxShadow: `0 0 6px ${color}`,
                    }} />
                  )}
                </button>
              );
            })}
          </div>

          {/* Botón Iniciar */}
          {(() => {
            const ready = !!userTribe && isGpsLocked;
            return (
              <button
                onClick={handleIniciar}
                disabled={!ready}
                style={{
                  background: ready ? '#f97316' : '#1e293b',
                  color: ready ? 'black' : '#475569',
                  border: 'none', borderRadius: '999px',
                  padding: '16px 0', width: '100%', maxWidth: '340px',
                  fontWeight: 900, fontSize: '15px',
                  textTransform: 'uppercase', letterSpacing: '3px',
                  cursor: ready ? 'pointer' : 'not-allowed',
                  fontStyle: 'italic',
                  boxShadow: ready ? '0 0 28px rgba(249,115,22,0.45)' : 'none',
                  transition: 'all 0.2s',
                }}
              >
                {!userTribe
                  ? 'Selecciona una tribu'
                  : !isGpsLocked
                  ? '🛰️ Esperando GPS...'
                  : `${TRIBE_ICONS[userTribe]} Iniciar Salida`}
              </button>
            );
          })()}

          <p style={{ color: '#1e293b', fontSize: '10px', marginTop: '20px', letterSpacing: '1px' }}>
            ×{multiplier} multiplicador activo
          </p>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          HUD EN RUTA (solo visible tras iniciar)
      ══════════════════════════════════════════════════════ */}
      {trackingStarted && (
        <>
          {/* BOTÓN VOLVER */}
          <button
            onClick={onBack}
            style={{
              position: 'absolute', top: '32px', left: '24px', zIndex: 200,
              background: 'rgba(0,0,0,0.8)', color: 'white', border: '2px solid #f97316',
              borderRadius: '999px', padding: '8px 20px', fontWeight: 900,
              fontSize: '11px', textTransform: 'uppercase', letterSpacing: '2px',
              cursor: 'pointer', fontStyle: 'italic',
            }}
          >
            ← Volver
          </button>

          {/* HUD SUPERIOR DERECHO */}
          <div style={{
            position: 'absolute', top: '24px', right: '16px', zIndex: 200,
            display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px',
          }}>
            {/* Icono de red */}
            <div style={{
              background: 'rgba(0,0,0,0.75)', borderRadius: '999px',
              padding: '4px 10px',
              border: `1px solid ${isOnline ? '#22c55e' : '#ef4444'}`,
              color: isOnline ? '#22c55e' : '#ef4444',
              fontWeight: 700, fontSize: '11px', letterSpacing: '1px',
              whiteSpace: 'nowrap',
            }}>
              📶 {isOnline ? 'Online' : 'Offline'}
            </div>

            {/* Badge nivel + tribu */}
            <div style={{
              background: 'rgba(0,0,0,0.88)', color: '#f97316',
              border: '2px solid #f97316', borderRadius: '999px',
              padding: '6px 14px', fontWeight: 900, fontSize: '11px',
              textTransform: 'uppercase', letterSpacing: '2px', fontStyle: 'italic',
              whiteSpace: 'nowrap',
            }}>
              {activeTribeIcon} LVL {userLevel} · {getLevelName(userXp)}
            </div>

            {/* Badge tribu + multiplicador */}
            <div style={{
              background: CLASS_COLORS[userTribe] ?? '#f97316', color: 'black',
              borderRadius: '999px', padding: '6px 14px', fontWeight: 900, fontSize: '11px',
              textTransform: 'uppercase', letterSpacing: '2px', fontStyle: 'italic',
            }}>
              {userTribe} ×{multiplier}
            </div>

            {/* Racha */}
            {streakCount > 0 && (
              <div style={{
                background: 'rgba(0,0,0,0.88)', color: '#facc15',
                border: '2px solid #facc15', borderRadius: '999px',
                padding: '6px 14px', fontWeight: 900, fontSize: '13px',
                whiteSpace: 'nowrap', letterSpacing: '1px',
                boxShadow: '0 0 10px rgba(250,204,21,0.35)',
              }}>
                🔥 {streakCount}
              </div>
            )}

            {/* idle: ID + VINCULAR en una línea */}
            {jointStatus === 'idle' && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0',
                background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '999px', overflow: 'hidden',
              }}>
                <span style={{
                  color: '#94a3b8', padding: '6px 12px',
                  fontWeight: 900, fontSize: '12px', letterSpacing: '3px',
                  fontFamily: 'monospace', borderRight: '1px solid rgba(255,255,255,0.1)',
                }}>
                  Mi ID: #{displayCode}
                </span>
                <button
                  onClick={() => { setShowCodeModal(true); setCodeInput(''); setCodeError(''); }}
                  style={{
                    background: 'transparent', color: '#00FFFF',
                    border: 'none', padding: '6px 14px',
                    fontWeight: 900, fontSize: '11px',
                    textTransform: 'uppercase', letterSpacing: '1px', cursor: 'pointer',
                  }}
                >
                  🤝 Vincular
                </button>
              </div>
            )}

            {/* active: progreso cian */}
            {jointStatus === 'active' && (
              <div style={{
                background: 'rgba(0,0,0,0.9)', color: '#00FFFF',
                border: '2px solid #00FFFF', borderRadius: '999px',
                padding: '6px 16px', fontWeight: 900, fontSize: '12px',
                whiteSpace: 'nowrap', letterSpacing: '1px',
                boxShadow: '0 0 12px rgba(0,255,255,0.4)',
              }}>
                🤝 {jointProgress.toFixed(2)} / 1.0 km
              </div>
            )}

            {/* rejected: consolación */}
            {jointStatus === 'rejected' && (
              <div style={{
                background: 'rgba(0,0,0,0.85)', color: '#ef4444',
                border: '1px solid #ef4444', borderRadius: '999px',
                padding: '5px 14px', fontWeight: 900, fontSize: '11px',
                textTransform: 'uppercase', letterSpacing: '1px',
              }}>
                ✗ +100 XP
              </div>
            )}
          </div>

          {/* BANNER ×2 */}
          {socialBoost && (
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              background: jointStatus === 'active' ? '#00FFFF' : '#f97316',
              color: 'black', zIndex: 300,
              borderRadius: '1.5rem', padding: '20px 32px', textAlign: 'center',
              boxShadow: jointStatus === 'active'
                ? '0 0 40px rgba(0,255,255,0.8)'
                : '0 0 40px rgba(249,115,22,0.8)',
            }}>
              <p style={{ fontWeight: 900, fontSize: '28px', fontStyle: 'italic', lineHeight: 1 }}>×2 🎉</p>
              <p style={{ fontWeight: 900, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '2px', marginTop: '6px' }}>
                ¡CONEXIÓN CALLEJERA!
              </p>
              <p style={{ fontWeight: 700, fontSize: '11px', opacity: 0.7, marginTop: '4px' }}>
                Tu XP se duplicó
              </p>
            </div>
          )}

          {/* TOAST REALTIME HANDSHAKE */}
          {realtimeToast !== '' && (
            <div style={{
              position: 'absolute', top: '24px', left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(0,255,180,0.15)', color: '#00ffb4',
              border: '1px solid #00ffb4', padding: '8px 20px',
              borderRadius: '999px', fontWeight: 700, fontSize: '12px', zIndex: 210,
              whiteSpace: 'nowrap', letterSpacing: '1px',
              boxShadow: '0 0 14px rgba(0,255,180,0.3)',
            }}>
              🤝 {realtimeToast}
            </div>
          )}

          {/* TOAST OFFLINE / SYNC */}
          {offlineToast !== '' && (
            <div style={{
              position: 'absolute', top: '56px', left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(15,23,42,0.97)', color: '#e2e8f0',
              border: '1px solid #334155', padding: '8px 20px',
              borderRadius: '999px', fontWeight: 700, fontSize: '12px', zIndex: 210,
              whiteSpace: 'nowrap', letterSpacing: '1px',
              boxShadow: '0 0 12px rgba(0,0,0,0.5)',
            }}>
              {offlineToast}
            </div>
          )}

          {/* TOAST ANTI-CHEAT */}
          {isCheating && (
            <div style={{
              position: 'absolute', top: '90px', left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(239,68,68,0.95)', color: 'white', padding: '8px 22px',
              borderRadius: '999px', fontWeight: 900, fontSize: '12px', zIndex: 200,
              textTransform: 'uppercase', letterSpacing: '2px', whiteSpace: 'nowrap',
              boxShadow: '0 0 16px rgba(239,68,68,0.6)',
            }}>
              ⚠️ Velocidad anómala. XP pausado.
            </div>
          )}

          {/* MISIÓN DEL DÍA — pill sobre el HUD principal */}
          {dailyMission && !dailyMission.alreadyCompleted && trackingStarted && (() => {
            const m = dailyMission.mission;
            // Progreso en tiempo real para misiones de distancia o tiempo
            let progressText = '';
            if (m.condition_type === 'distance_km') {
              const pct = Math.min(100, Math.round((distanceKm / m.condition_value) * 100));
              progressText = `${distanceKm.toFixed(2)} / ${m.condition_value} km · ${pct}%`;
            } else if (m.condition_type === 'duration_min') {
              const minActual = Math.floor(durationSec / 60);
              progressText = `${minActual} / ${m.condition_value} min`;
            }
            const done = missionConditionMet(m, {
              distanceKm, durationSec, startHour: sessionStartHourRef.current,
            });
            return (
              <div style={{
                position: 'absolute', bottom: '160px', left: '50%', transform: 'translateX(-50%)',
                background: done ? 'rgba(34,197,94,0.15)' : 'rgba(0,0,0,0.85)',
                border: `1.5px solid ${done ? '#22c55e' : '#f97316'}`,
                borderRadius: '999px', padding: '7px 18px',
                display: 'flex', alignItems: 'center', gap: '8px',
                zIndex: 100, whiteSpace: 'nowrap',
                boxShadow: done ? '0 0 14px rgba(34,197,94,0.4)' : 'none',
                transition: 'all 0.3s',
              }}>
                <span style={{ fontSize: '15px' }}>{done ? '✅' : (m.icon ?? '🎯')}</span>
                <div>
                  <p style={{ color: done ? '#22c55e' : '#f97316', fontWeight: 900, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1.5px', lineHeight: 1 }}>
                    {done ? '¡Misión cumplida!' : m.title}
                  </p>
                  {!done && progressText && (
                    <p style={{ color: '#94a3b8', fontSize: '9px', fontWeight: 700, marginTop: '2px' }}>
                      {progressText}
                    </p>
                  )}
                </div>
                <span style={{ color: '#22c55e', fontWeight: 900, fontSize: '10px', marginLeft: '4px' }}>
                  +{m.xp_reward} XP
                </span>
              </div>
            );
          })()}

          {/* HUD INFERIOR v1.8 */}
          <div style={{
            position: 'absolute', bottom: '110px', left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.88)', color: 'white', padding: '14px 28px',
            borderRadius: '999px', fontWeight: 'bold', fontSize: '13px',
            border: `1px solid ${hudBorderColor}`,
            zIndex: 100, whiteSpace: 'nowrap', display: 'flex', gap: '20px',
            transition: 'border-color 0.3s',
          }}>
            <span>📍 {distanceKm.toFixed(2)} km</span>
            <span>⏱ {formatTime(durationSec)}</span>
            <span style={{ color: isCheating ? '#ef4444' : jointStatus === 'active' ? '#00FFFF' : '#f97316' }}>
              {isCheating ? `🔒 ${speedKmh} km/h` : `✨ ${xpPreview} XP`}
            </span>
            <span style={{ opacity: 0.5, fontSize: '9px', alignSelf: 'center' }}>v1.22.0</span>
          </div>

          {/* BOTONES INFERIORES: Pausa + Finalizar */}
          <div style={{
            position: 'absolute', bottom: '32px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 200, display: 'flex', gap: '12px', alignItems: 'center',
          }}>
            {/* Pausa / Reanudar */}
            <button
              onClick={handleTogglePause}
              disabled={finishing}
              style={{
                background: isPaused ? '#facc15' : 'rgba(0,0,0,0.85)',
                color: isPaused ? 'black' : '#facc15',
                border: '2px solid #facc15',
                borderRadius: '999px', padding: '16px 24px',
                fontWeight: 900, fontSize: '14px', textTransform: 'uppercase',
                letterSpacing: '2px', cursor: finishing ? 'not-allowed' : 'pointer',
                fontStyle: 'italic', whiteSpace: 'nowrap', transition: 'all 0.2s',
                boxShadow: isPaused ? '0 0 20px rgba(250,204,21,0.5)' : 'none',
              }}
            >
              {isPaused ? '▶ Reanudar' : '⏸ Pausa'}
            </button>

          {/* BOTÓN FINALIZAR */}
          <button
            onClick={handleFinish}
            disabled={finishing}
            style={{
              background: finishing ? '#555' : '#f97316', color: 'black',
              border: 'none', borderRadius: '999px', padding: '16px 44px',
              fontWeight: 900, fontSize: '15px', textTransform: 'uppercase',
              letterSpacing: '2px', cursor: finishing ? 'not-allowed' : 'pointer',
              fontStyle: 'italic', boxShadow: '0 0 24px rgba(249,115,22,0.5)',
              whiteSpace: 'nowrap', transition: 'background 0.2s',
            }}
          >
            {finishing ? 'Calculando XP...' : '🏁 Finalizar Salida'}
          </button>
          </div>{/* fin botones inferiores */}
        </>
      )}

      {/* ── MODAL 1: A ingresa código de B ── */}
      {showCodeModal && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <p style={modalTitle}>Vincular Compañero</p>
            <p style={modalSub}>
              Tu código: <strong style={{ color: '#f97316', letterSpacing: '3px' }}>#{displayCode || '…'}</strong>
              <br />Ingresa el código de 4 dígitos de tu compañero.
            </p>
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={codeInput}
              onChange={e => { setCodeInput(e.target.value.replace(/\D/g, '')); setCodeError(''); }}
              onKeyDown={e => e.key === 'Enter' && void handleCodeSubmit()}
              placeholder="0000"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#1e293b', border: `2px solid ${codeError ? '#ef4444' : '#f97316'}`,
                borderRadius: '0.75rem', color: 'white',
                fontSize: '28px', fontWeight: 900, letterSpacing: '8px',
                textAlign: 'center', padding: '14px 0', outline: 'none',
                fontFamily: 'monospace', marginBottom: '8px',
              }}
            />
            {codeError && (
              <p style={{ color: '#ef4444', fontSize: '11px', textAlign: 'center', marginBottom: '12px' }}>
                {codeError}
              </p>
            )}
            <button
              onClick={() => void handleCodeSubmit()}
              disabled={codeSubmitting}
              style={{ ...btnPrimary, opacity: codeSubmitting ? 0.6 : 1, cursor: codeSubmitting ? 'not-allowed' : 'pointer' }}
            >
              {codeSubmitting ? 'Buscando...' : 'Enviar Invitación'}
            </button>
            <button onClick={() => setShowCodeModal(false)} style={btnSecondary}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ── MODAL 2: A esperando respuesta de B ── */}
      {waitingHandshake && (
        <div style={modalOverlay}>
          <div style={{
            background: '#0f172a', border: '2px solid #f97316',
            borderRadius: '1.25rem', padding: '28px 24px',
            width: '100%', maxWidth: '340px',
            boxShadow: '0 0 40px rgba(249,115,22,0.2)',
          }}>
            <p style={{
              color: '#f97316', fontWeight: 900, fontSize: '18px',
              fontStyle: 'italic', textTransform: 'uppercase',
              letterSpacing: '2px', marginBottom: '6px',
            }}>
              Invitación enviada
            </p>
            <p style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '20px', lineHeight: 1.5 }}>
              Esperando que{' '}
              <strong style={{ color: '#e2e8f0' }}>{waitingHandshake.receiverName}</strong>{' '}
              acepte la Misión Conjunta...
            </p>

            {/* Spinner + countdown */}
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <div style={{
                display: 'inline-block', width: '56px', height: '56px',
                border: '4px solid rgba(249,115,22,0.2)',
                borderTop: '4px solid #f97316', borderRadius: '50%',
                animation: 'spin 1s linear infinite', marginBottom: '12px',
              }} />
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              <p style={{ color: '#f97316', fontWeight: 900, fontSize: '28px', lineHeight: 1 }}>
                {waitingTimeLeft}s
              </p>
              <p style={{ color: '#475569', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Tiempo restante
              </p>
            </div>

            <div style={{
              background: '#0a1628', border: '1px solid #1e3a5f',
              borderRadius: '0.75rem', padding: '12px', marginBottom: '16px',
            }}>
              <p style={{ color: '#e2e8f0', fontSize: '12px', lineHeight: 1.6, margin: 0 }}>
                Sumen <strong style={{ color: '#00FFFF' }}>+1 km</strong> en ruta para{' '}
                <strong style={{ color: '#f97316' }}>DUPLICAR ×2</strong> el XP de hoy.
              </p>
            </div>

            <button
              onClick={() => {
                waitingCleanupRef.current?.();
                waitingCleanupRef.current = null;
                setWaitingHandshake(null);
                jointRejectedRef.current = true;
                setJointStatus('rejected');
              }}
              style={btnSecondary}
            >
              Cancelar · +100 XP fijos
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL 3: B recibe solicitud de A ── */}
      {incomingRequest && (
        <div style={modalOverlay}>
          <div style={{
            background: '#0f172a', border: '2px solid #00FFFF',
            borderRadius: '1.25rem', padding: '28px 24px',
            width: '100%', maxWidth: '340px',
            boxShadow: '0 0 48px rgba(0,255,255,0.25)',
          }}>
            <p style={{
              color: '#00FFFF', fontWeight: 900, fontSize: '11px',
              textTransform: 'uppercase', letterSpacing: '0.25em', marginBottom: '4px',
            }}>
              ¡Encuentro Callejero!
            </p>
            <p style={{
              color: '#ffffff', fontWeight: 900, fontSize: '20px',
              fontStyle: 'italic', textTransform: 'uppercase',
              letterSpacing: '-0.01em', lineHeight: 1.1, marginBottom: '4px',
            }}>
              {incomingRequest.initiatorName}
            </p>
            <p style={{ color: '#64748b', fontSize: '12px', marginBottom: '18px' }}>
              te ha encontrado y quiere iniciar una Misión Conjunta
            </p>

            <div style={{
              background: '#0a1628', border: '1px solid #1e3a5f',
              borderRadius: '0.875rem', padding: '14px', marginBottom: '20px',
            }}>
              <p style={{ color: '#e2e8f0', fontSize: '12px', lineHeight: 1.6, margin: 0 }}>
                Sumen <strong style={{ color: '#00FFFF' }}>+1 km</strong> en ruta para{' '}
                <strong style={{ color: '#f97316', fontSize: '14px' }}>DUPLICAR ×2</strong>{' '}
                el XP de hoy.
              </p>
            </div>

            <button
              onClick={() => void handleIncomingResponse(true)}
              style={{
                background: '#00FFFF', color: '#0a1628', border: 'none',
                borderRadius: '999px', padding: '14px 0', width: '100%',
                fontWeight: 900, fontSize: '14px', textTransform: 'uppercase',
                letterSpacing: '2px', cursor: 'pointer', fontStyle: 'italic',
                boxShadow: '0 0 20px rgba(0,255,255,0.4)',
              }}
            >
              🤝 Aceptar Misión
            </button>
            <button
              onClick={() => void handleIncomingResponse(false)}
              style={{
                background: 'transparent', color: '#64748b',
                border: '1px solid #1e293b', borderRadius: '999px',
                padding: '11px 0', width: '100%', fontWeight: 700,
                fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px',
                cursor: 'pointer', marginTop: '10px',
              }}
            >
              Rechazar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
