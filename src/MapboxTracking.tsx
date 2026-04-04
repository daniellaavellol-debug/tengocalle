import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { checkSessionMissions } from './lib/missions';
import { supabase } from './supabase';

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string) || '';
const JOINT_MIN_SPEED_KMH = 1;

// Límites anti-cheat por tribu (km/h)
const TRIBE_SPEED_LIMITS: Record<string, number> = {
  Runner: 20,
  Roller: 30,
  Ciclista: 45,
};
const STREAK_KEY = 'calle_streak';

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

interface StreakData {
  count: number;
  lastTs: number;
}

function loadStreak(): StreakData {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (!raw) return { count: 0, lastTs: 0 };
    return JSON.parse(raw) as StreakData;
  } catch {
    return { count: 0, lastTs: 0 };
  }
}

function computeStreakCount(data: StreakData): number {
  const now = Date.now();
  const elapsed = now - data.lastTs;
  const h48 = 48 * 60 * 60 * 1000;
  if (data.lastTs === 0) return 0;
  if (elapsed <= h48) return data.count;
  return 0;
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
  completedMissionIds: number[];
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
  durationSec: number;
  lastPos: { lat: number; lon: number } | null;
  jointDistance: number;
  jointMissionActive: boolean;
  savedAt: number;
}

function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSession;
    if (Date.now() - (parsed.savedAt ?? 0) > SESSION_MAX_AGE_MS) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

const TRIBES = ['Runner', 'Ciclista', 'Roller'] as const;

export default function MapboxTracking({ multiplier, userClass, userLevel, userXp, completedMissionIds, onFinish, onBack }: Props) {
  const sessionStartHourRef = useRef(new Date().getHours());
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPosRef = useRef<{ lat: number; lon: number } | null>(null);
  const routeCoordsRef = useRef<[number, number][]>([]);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  // Ref para arrancar timer+GPS después de que el usuario elija tribu
  const startTrackingRef = useRef<(() => void) | null>(null);
  const trackingStartedRef = useRef(false);
  const userTribeRef = useRef('');

  const _saved = loadSession();

  const distanceRef = useRef(_saved?.distanceKm ?? 0);
  const durationRef = useRef(_saved?.durationSec ?? 0);
  const speedRef = useRef(0);
  const lastGpsTsRef = useRef<number | null>(null);

  const jointMissionActiveRef = useRef(_saved?.jointMissionActive ?? false);
  const jointRejectedRef = useRef(false);
  const jointDistanceRef = useRef(_saved?.jointDistance ?? 0);
  const userCodeRef = useRef(Math.floor(1000 + Math.random() * 9000));
  const onFinishRef = useRef(onFinish);
  useEffect(() => { onFinishRef.current = onFinish; }, [onFinish]);

  if (_saved?.lastPos && !lastPosRef.current) {
    lastPosRef.current = _saved.lastPos;
  }

  // Si hay sesión guardada, saltar el selector y usar la clase del perfil
  const [userTribe, setUserTribe] = useState(_saved ? (userClass || '') : '');
  const [trackingStarted, setTrackingStarted] = useState(!!_saved);

  const [distanceKm, setDistanceKm] = useState(_saved?.distanceKm ?? 0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_route, setRoute] = useState<[number, number][]>([]);
  const [durationSec, setDurationSec] = useState(_saved?.durationSec ?? 0);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [isCheating, setIsCheating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [socialBoost, setSocialBoost] = useState(false);

  const [jointProgress, setJointProgress] = useState(_saved?.jointDistance ?? 0);
  const [jointStatus, setJointStatus] = useState<'idle' | 'active' | 'rejected'>(
    _saved?.jointMissionActive ? 'active' : 'idle'
  );

  const [streakCount] = useState<number>(() => computeStreakCount(loadStreak()));
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlineToast, setOfflineToast] = useState('');

  // Modal states
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState('');
  const [pendingCode, setPendingCode] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [realtimeToast, setRealtimeToast] = useState('');

  // Sincronizar userTribeRef cuando cambia el estado
  useEffect(() => { userTribeRef.current = userTribe; }, [userTribe]);

  // Supabase Realtime: escuchar handshake de vincular
  useEffect(() => {
    const myCode = userCodeRef.current.toString();
    const channel = supabase.channel('misiones')
      .on('broadcast', { event: 'vincular' }, (payload) => {
        if (payload.payload.targetCode === myCode) {
          jointMissionActiveRef.current = true;
          jointDistanceRef.current = 0;
          setJointProgress(0);
          setJointStatus('active');
          if (mapRef.current?.isStyleLoaded()) {
            mapRef.current.setPaintProperty('route-line', 'line-color', '#00FFFF');
          }
          setRealtimeToast('¡Tu partner te ha vinculado! Misión Cian activada.');
          setTimeout(() => setRealtimeToast(''), 4000);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const session: SavedSession = {
        distanceKm: distanceRef.current,
        durationSec: durationRef.current,
        lastPos: lastPosRef.current,
        jointDistance: jointDistanceRef.current,
        jointMissionActive: jointMissionActiveRef.current,
        savedAt: Date.now(),
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

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
      if ('wakeLock' in navigator) {
        navigator.wakeLock.request('screen')
          .then(lock => { wakeLockRef.current = lock; })
          .catch(() => {});
      }

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

      // Función que arranca el timer y el GPS — se ejecuta solo tras elegir tribu
      const doStart = () => {
        timerRef.current = setInterval(() => {
          durationRef.current += 1;
          setDurationSec(s => s + 1);
        }, 1000);

        if (navigator.geolocation) {
          watchIdRef.current = navigator.geolocation.watchPosition(
            (pos) => {
              const { latitude: lat, longitude: lon, speed } = pos.coords;
              const now = pos.timestamp;

              // Velocidad: API nativa o calculada entre los dos últimos puntos GPS
              let kmh: number;
              if (speed != null) {
                kmh = Math.round(speed * 3.6);
              } else if (lastPosRef.current && lastGpsTsRef.current != null) {
                const dtSec = (now - lastGpsTsRef.current) / 1000;
                if (dtSec > 0) {
                  const dKm = haversineKm(lastPosRef.current.lat, lastPosRef.current.lon, lat, lon);
                  kmh = Math.round((dKm / dtSec) * 3600);
                } else {
                  kmh = speedRef.current;
                }
              } else {
                kmh = speedRef.current;
              }
              lastGpsTsRef.current = now;
              speedRef.current = kmh;
              setSpeedKmh(kmh);

              // Anti-cheat: límite de velocidad por tribu
              const tribeLimit = TRIBE_SPEED_LIMITS[userTribeRef.current] ?? 45;
              const cheat = kmh > tribeLimit;
              setIsCheating(cheat);

              if (!cheat) {
                if (lastPosRef.current) {
                  const d = haversineKm(lastPosRef.current.lat, lastPosRef.current.lon, lat, lon);
                  if (d > 0.003) {
                    const newDist = distanceRef.current + d;
                    distanceRef.current = newDist;
                    setDistanceKm(newDist);
                    lastPosRef.current = { lat, lon };

                    if (jointMissionActiveRef.current && kmh >= JOINT_MIN_SPEED_KMH) {
                      const newJointDist = jointDistanceRef.current + d;
                      jointDistanceRef.current = newJointDist;
                      setJointProgress(newJointDist);
                    }
                  }
                } else {
                  lastPosRef.current = { lat, lon };
                  mapRef.current?.setCenter([lon, lat]);
                }
              } else if (!lastPosRef.current) {
                lastPosRef.current = { lat, lon };
              }

              routeCoordsRef.current.push([lon, lat]);
              setRoute([...routeCoordsRef.current]);
              const source = mapRef.current?.getSource('route') as mapboxgl.GeoJSONSource;
              source?.setData({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: routeCoordsRef.current },
                properties: {},
              });

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
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
      markerRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Iniciar salida tras elegir tribu ──────────────────────────────────────
  const handleIniciar = () => {
    if (!userTribe) return;
    userTribeRef.current = userTribe;
    trackingStartedRef.current = true;
    setTrackingStarted(true);
    // Si el mapa ya cargó, arrancar de inmediato; si no, el on('load') lo hará
    if (startTrackingRef.current) startTrackingRef.current();
  };

  // ── Modal: paso 1 — ingresar código ──────────────────────────────────────
  const handleCodeSubmit = () => {
    const trimmed = codeInput.trim();
    if (!/^\d{4}$/.test(trimmed)) {
      setCodeError('Ingresa exactamente 4 dígitos.');
      return;
    }
    setPendingCode(trimmed);
    setShowCodeModal(false);
    setCodeInput('');
    setCodeError('');
    setShowConfirmModal(true);
  };

  // ── Modal: paso 2 — aceptar / rechazar misión ─────────────────────────────
  const handleConfirmMission = async (accepted: boolean) => {
    setShowConfirmModal(false);
    if (accepted) {
      jointMissionActiveRef.current = true;
      jointDistanceRef.current = 0;
      setJointProgress(0);
      setJointStatus('active');
      if (mapRef.current?.isStyleLoaded()) {
        mapRef.current.setPaintProperty('route-line', 'line-color', '#00FFFF');
      }
      // Handshake: notificar al partner via Realtime
      await supabase.channel('misiones').send({
        type: 'broadcast',
        event: 'vincular',
        payload: { targetCode: pendingCode },
      }).catch(console.error);
    } else {
      jointRejectedRef.current = true;
      setJointStatus('rejected');
    }
  };

  const handleFinish = async () => {
    setFinishing(true);
    if (timerRef.current) clearInterval(timerRef.current);
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;

    const finalDist = distanceRef.current;
    const finalDuration = durationRef.current;
    const baseXp = Math.round((10 * finalDist + 2 * (finalDuration / 60)) * multiplier);

    let bonusXp = 0;
    let newIds: number[] = [];
    let supabaseOk = false;
    try {
      ({ bonusXp, newIds } = await checkSessionMissions(
        { distanceKm: finalDist, durationSec: finalDuration, startHour: sessionStartHourRef.current },
        completedMissionIds, userLevel, userTribeRef.current || userClass,
      ));
      supabaseOk = true;
    } catch (e) {
      console.warn('[handleFinish] Supabase error, keeping session:', e);
    }

    const jointActive = jointMissionActiveRef.current;
    const jointRejected = jointRejectedRef.current;
    const jointDist = jointDistanceRef.current;
    const jointSuccess = jointActive && jointDist >= 1.0;
    const hasJointMission = jointActive || jointRejected;

    let finalXp: number;
    let finalMissionBonus: number;

    if (jointSuccess) {
      // Total_XP = (BaseXP * Multiplicador) * 2 — baseXp ya incluye el multiplicador
      finalXp = baseXp * 2;
      finalMissionBonus = bonusXp;
      setSocialBoost(true);
      await new Promise(r => setTimeout(r, 2000));
    } else if (hasJointMission) {
      // Rechazó o aceptó pero no completó el km → +100 XP fijos
      finalXp = baseXp + 100;
      finalMissionBonus = bonusXp;
    } else {
      finalXp = baseXp;
      finalMissionBonus = bonusXp;
    }

    // Guardado en la nube
    await supabase.from('actividades').insert([{
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

    if (supabaseOk) {
      localStorage.removeItem(SESSION_KEY);
      const prev = loadStreak();
      const now = Date.now();
      const h24 = 24 * 60 * 60 * 1000;
      const alreadyTodayh = prev.lastTs > 0 && (now - prev.lastTs) < h24;
      const newStreak: StreakData = alreadyTodayh
        ? prev
        : { count: computeStreakCount(prev) + 1, lastTs: now };
      localStorage.setItem(STREAK_KEY, JSON.stringify(newStreak));
    }
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

  const xpPreview = Math.round((10 * distanceKm + 2 * (durationSec / 60)) * multiplier);
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
          <button
            onClick={handleIniciar}
            disabled={!userTribe}
            style={{
              background: userTribe ? '#f97316' : '#1e293b',
              color: userTribe ? 'black' : '#475569',
              border: 'none', borderRadius: '999px',
              padding: '16px 0', width: '100%', maxWidth: '340px',
              fontWeight: 900, fontSize: '15px',
              textTransform: 'uppercase', letterSpacing: '3px',
              cursor: userTribe ? 'pointer' : 'not-allowed',
              fontStyle: 'italic',
              boxShadow: userTribe ? '0 0 28px rgba(249,115,22,0.45)' : 'none',
              transition: 'all 0.2s',
            }}
          >
            {userTribe ? `${TRIBE_ICONS[userTribe]} Iniciar Salida` : 'Selecciona una tribu'}
          </button>

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
                  Mi ID: #{userCodeRef.current}
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
            <span style={{ opacity: 0.5, fontSize: '9px', alignSelf: 'center' }}>v1.14</span>
          </div>

          {/* BOTÓN FINALIZAR */}
          <button
            onClick={handleFinish}
            disabled={finishing}
            style={{
              position: 'absolute', bottom: '32px', left: '50%', transform: 'translateX(-50%)',
              zIndex: 200, background: finishing ? '#555' : '#f97316', color: 'black',
              border: 'none', borderRadius: '999px', padding: '16px 44px',
              fontWeight: 900, fontSize: '15px', textTransform: 'uppercase',
              letterSpacing: '2px', cursor: finishing ? 'not-allowed' : 'pointer',
              fontStyle: 'italic', boxShadow: '0 0 24px rgba(249,115,22,0.5)',
              whiteSpace: 'nowrap', transition: 'background 0.2s',
            }}
          >
            {finishing ? 'Calculando XP...' : '🏁 Finalizar Salida'}
          </button>
        </>
      )}

      {/* ── MODAL 1: Ingresar código ── */}
      {showCodeModal && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <p style={modalTitle}>Vincular Usuario</p>
            <p style={modalSub}>
              Tu código: <strong style={{ color: '#f97316', letterSpacing: '3px' }}>#{userCodeRef.current}</strong>
              <br />Ingresa el código de 4 dígitos de tu compañero.
            </p>
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={codeInput}
              onChange={e => { setCodeInput(e.target.value.replace(/\D/g, '')); setCodeError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleCodeSubmit()}
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
            <button onClick={handleCodeSubmit} style={btnPrimary}>Continuar</button>
            <button onClick={() => setShowCodeModal(false)} style={btnSecondary}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ── MODAL 2: Confirmar misión ── */}
      {showConfirmModal && (
        <div style={modalOverlay}>
          <div style={{
            background: '#0f172a',
            border: '2px solid #00FFFF',
            borderRadius: '1.25rem',
            padding: '28px 24px',
            width: '100%',
            maxWidth: '340px',
            boxShadow: '0 0 48px rgba(0,255,255,0.25)',
          }}>
            <p style={{
              color: '#00FFFF', fontWeight: 900, fontSize: '20px',
              fontStyle: 'italic', textTransform: 'uppercase',
              letterSpacing: '2px', marginBottom: '4px',
            }}>
              ¡Conexión Callejera!
            </p>
            <p style={{ color: '#475569', fontSize: '11px', marginBottom: '18px' }}>
              {activeTribeIcon} {userTribe} vinculando con{' '}
              <strong style={{ color: '#00FFFF', letterSpacing: '4px', fontFamily: 'monospace' }}>
                #{pendingCode}
              </strong>
            </p>

            <div style={{
              background: '#0a1628', border: '1px solid #1e3a5f',
              borderRadius: '0.875rem', padding: '16px', marginBottom: '20px',
            }}>
              <p style={{ color: '#e2e8f0', fontSize: '13px', lineHeight: 1.7, margin: 0 }}>
                Sumen{' '}
                <strong style={{ color: '#00FFFF' }}>+1 km extra</strong>{' '}
                en su ruta para{' '}
                <strong style={{ color: '#f97316', fontSize: '15px' }}>DUPLICAR ×2</strong>{' '}
                el XP de hoy.
              </p>
            </div>

            <button
              onClick={() => handleConfirmMission(true)}
              style={{
                background: '#00FFFF', color: '#0a1628',
                border: 'none', borderRadius: '999px',
                padding: '14px 0', width: '100%',
                fontWeight: 900, fontSize: '14px',
                textTransform: 'uppercase', letterSpacing: '2px',
                cursor: 'pointer', fontStyle: 'italic',
                boxShadow: '0 0 20px rgba(0,255,255,0.4)',
              }}
            >
              🤝 Aceptar Misión
            </button>

            <button
              onClick={() => handleConfirmMission(false)}
              style={{
                background: 'transparent', color: '#64748b',
                border: '1px solid #1e293b', borderRadius: '999px',
                padding: '11px 0', width: '100%',
                fontWeight: 700, fontSize: '12px',
                textTransform: 'uppercase', letterSpacing: '1px',
                cursor: 'pointer', marginTop: '10px',
              }}
            >
              Rechazar · +100 XP fijos
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
