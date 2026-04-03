import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { checkSessionMissions } from './lib/missions';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;
const SPEED_LIMIT_KMH = 60;
const JOINT_MIN_SPEED_KMH = 1; // anti-idle: por debajo no cuenta para misión conjunta

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
  completedMissionIds: number[];
  onFinish: (xp: number, distanceKm: number, durationSec: number, missionBonusXp: number, newMissionIds: number[]) => void;
  onBack: () => void;
}

const SESSION_KEY = 'calle_active_session';

const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 horas

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

export default function MapboxTracking({ multiplier, userClass, userLevel, completedMissionIds, onFinish, onBack }: Props) {
  const sessionStartHourRef = useRef(new Date().getHours());
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPosRef = useRef<{ lat: number; lon: number } | null>(null);
  const routeCoordsRef = useRef<[number, number][]>([]);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  // Restore session from localStorage if available
  const _saved = loadSession();

  // Refs para el cálculo final (evitan stale closure en handleFinish)
  const distanceRef = useRef(_saved?.distanceKm ?? 0);
  const durationRef = useRef(_saved?.durationSec ?? 0);
  const speedRef = useRef(0);

  const encounterRef = useRef(false); // encuentro registrado durante la sesión

  // Refs para Misión Conjunta
  const jointMissionActiveRef = useRef(_saved?.jointMissionActive ?? false);
  const jointRejectedRef = useRef(false);        // misión rechazada (para +100 fallback)
  const jointDistanceRef = useRef(_saved?.jointDistance ?? 0);
  const userCodeRef = useRef(Math.floor(1000 + Math.random() * 9000)); // ID 4 dígitos

  // Restore lastPos from saved session
  if (_saved?.lastPos && !lastPosRef.current) {
    lastPosRef.current = _saved.lastPos;
  }

  const [distanceKm, setDistanceKm] = useState(_saved?.distanceKm ?? 0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_route, setRoute] = useState<[number, number][]>([]);
  const [durationSec, setDurationSec] = useState(_saved?.durationSec ?? 0);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [speedLocked, setSpeedLocked] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [encounterDone, setEncounterDone] = useState(false); // feedback visual
  const [socialBoost, setSocialBoost] = useState(false);     // banner x2

  // Estado de Misión Conjunta (para UI)
  const [jointProgress, setJointProgress] = useState(_saved?.jointDistance ?? 0);
  const [jointStatus, setJointStatus] = useState<'idle' | 'active' | 'rejected'>(
    _saved?.jointMissionActive ? 'active' : 'idle'
  );

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

      // Capa de ruta recorrida
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

      // Arrancar timer de sesión
      timerRef.current = setInterval(() => {
        durationRef.current += 1;
        setDurationSec(s => s + 1);
      }, 1000);

      // Arrancar GPS
      if (navigator.geolocation) {
        watchIdRef.current = navigator.geolocation.watchPosition(
          (pos) => {
            const { latitude: lat, longitude: lon, speed } = pos.coords;

            // Actualizar velocidad
            const kmh = speed != null ? Math.round(speed * 3.6) : speedRef.current;
            speedRef.current = kmh;
            setSpeedKmh(kmh);

            const locked = kmh > SPEED_LIMIT_KMH;
            setSpeedLocked(locked);

            // Acumular distancia solo si no está bloqueado por velocidad
            if (!locked) {
              if (lastPosRef.current) {
                const d = haversineKm(lastPosRef.current.lat, lastPosRef.current.lon, lat, lon);
                if (d > 0.003) { // filtro de ruido: mínimo 3 metros
                  const newDist = distanceRef.current + d;
                  distanceRef.current = newDist;
                  setDistanceKm(newDist);
                  lastPosRef.current = { lat, lon };

                  // Misión Conjunta: acumular si activa y velocidad ≥ 1 km/h (anti-idle)
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

            // Actualizar línea de ruta
            routeCoordsRef.current.push([lon, lat]);
            setRoute([...routeCoordsRef.current]);
            const source = mapRef.current?.getSource('route') as mapboxgl.GeoJSONSource;
            source?.setData({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: routeCoordsRef.current },
              properties: {},
            });

            // Mover marcador
            if (markerRef.current) {
              markerRef.current.setLngLat([lon, lat]);
            } else {
              const CLASS_COLORS: Record<string, string> = {
                Runner: '#3B82F6', Ciclista: '#F97316', Roller: '#22C55E',
              };
              const color = CLASS_COLORS[userClass] ?? '#F97316';
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
    });

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      markerRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  const handleVincular = () => {
    const code = window.prompt('Ingresa el código del otro usuario (4 dígitos):');
    if (!code || !/^\d{4}$/.test(code.trim())) return; // código inválido: no hace nada

    const accepted = window.confirm(
      `¿Aceptar Misión Conjunta con #${code.trim()}?\n\nRecorran juntos entre 1 km y 8 km para DUPLICAR (×2) todo el XP de hoy.\n\nSi rechazan, solo suman +100 XP.`
    );
    if (accepted) {
      jointMissionActiveRef.current = true;
      jointDistanceRef.current = 0;
      setJointProgress(0);
      setJointStatus('active');
      if (mapRef.current?.isStyleLoaded()) {
        mapRef.current.setPaintProperty('route-line', 'line-color', '#00FFFF');
      }
    } else {
      jointRejectedRef.current = true;
      setJointStatus('rejected');
    }
  };

  const handleEncounterDuring = () => {
    encounterRef.current = true;
    setEncounterDone(true);
    setTimeout(() => setEncounterDone(false), 2500);
  };

  const handleFinish = async () => {
    setFinishing(true);
    if (timerRef.current) clearInterval(timerRef.current);
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);

    const finalDist = distanceRef.current;
    const finalDuration = durationRef.current;
    const baseXp = Math.round((10 * finalDist + 2 * (finalDuration / 60)) * multiplier);

    let bonusXp = 0;
    let newIds: number[] = [];
    let supabaseOk = false;
    try {
      ({ bonusXp, newIds } = await checkSessionMissions(
        { distanceKm: finalDist, durationSec: finalDuration, startHour: sessionStartHourRef.current },
        completedMissionIds, userLevel, userClass,
      ));
      supabaseOk = true;
    } catch (e) {
      console.warn('[handleFinish] Supabase error, keeping session:', e);
    }

    const jointActive = jointMissionActiveRef.current;
    const jointRejected = jointRejectedRef.current;
    const jointDist = jointDistanceRef.current;
    const jointSuccess = jointActive && jointDist >= 1.0 && jointDist <= 8.0;
    const hasJointMission = jointActive || jointRejected;

    let finalXp: number;
    let finalMissionBonus: number;

    if (jointSuccess) {
      // Misión Conjunta exitosa: ×2 todo el XP
      finalXp = Math.round((baseXp + bonusXp) * 2);
      finalMissionBonus = 0; // ya incluido en el doble
      setSocialBoost(true);
      await new Promise(r => setTimeout(r, 2000));
    } else if (hasJointMission) {
      // Misión rechazada o fallida (< 1km o > 8km): +100 XP consolación
      finalXp = baseXp + 100;
      finalMissionBonus = bonusXp;
    } else {
      // Sin misión conjunta: comportamiento original con encuentro social
      const hasSocialBoost = encounterRef.current && finalDist >= 1.0;
      finalXp = hasSocialBoost ? Math.round((baseXp + bonusXp) * 2) : baseXp;
      finalMissionBonus = hasSocialBoost ? 0 : bonusXp;
      if (hasSocialBoost) {
        setSocialBoost(true);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (supabaseOk) localStorage.removeItem(SESSION_KEY);
    onFinish(finalXp, finalDist, finalDuration, finalMissionBonus, newIds);
  };

  // Preview de XP en tiempo real
  const xpPreview = Math.round((10 * distanceKm + 2 * (durationSec / 60)) * multiplier);

  // Color del HUD según estado
  const hudBorderColor = speedLocked ? '#ef4444' : jointStatus === 'active' ? '#00FFFF' : '#f97316';

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', backgroundColor: '#0f172a' }}>

      {/* MAPA */}
      <div
        ref={mapContainerRef}
        style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
      />

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

      {/* HUD SUPERIOR DERECHO: clase + ID + misión conjunta */}
      <div style={{
        position: 'absolute', top: '24px', right: '16px', zIndex: 200,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px',
      }}>
        {/* Badge de clase */}
        <div style={{
          background: '#f97316', color: 'black', borderRadius: '999px',
          padding: '6px 14px', fontWeight: 900, fontSize: '11px',
          textTransform: 'uppercase', letterSpacing: '2px', fontStyle: 'italic',
        }}>
          {userClass} ×{multiplier}
        </div>

        {/* Misión Conjunta: idle → ID + botón VINCULAR */}
        {jointStatus === 'idle' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              background: 'rgba(0,0,0,0.85)', color: '#94a3b8',
              borderRadius: '999px', padding: '5px 12px', fontWeight: 900,
              fontSize: '12px', letterSpacing: '3px', fontFamily: 'monospace',
              border: '1px solid rgba(255,255,255,0.15)',
            }}>
              #{userCodeRef.current}
            </span>
            <button
              onClick={handleVincular}
              style={{
                background: 'rgba(0,0,0,0.85)', color: '#00FFFF',
                border: '2px solid #00FFFF', borderRadius: '999px',
                padding: '5px 14px', fontWeight: 900, fontSize: '11px',
                textTransform: 'uppercase', letterSpacing: '1px', cursor: 'pointer',
                boxShadow: '0 0 8px rgba(0,255,255,0.25)',
              }}
            >
              🤝 Vincular
            </button>
          </div>
        )}

        {/* Misión Conjunta: active → progreso en tiempo real */}
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

        {/* Misión Conjunta: rejected → indicador */}
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

      {/* BANNER MISIÓN CONJUNTA x2 / CONEXIÓN CALLEJERA */}
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
            {jointStatus === 'active' ? '¡MISIÓN CONJUNTA!' : '¡CONEXIÓN CALLEJERA!'}
          </p>
          <p style={{ fontWeight: 700, fontSize: '11px', opacity: 0.7, marginTop: '4px' }}>
            Tu XP se duplicó
          </p>
        </div>
      )}

      {/* FLASH: encuentro registrado */}
      {encounterDone && (
        <div style={{
          position: 'absolute', top: '90px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(34,197,94,0.92)', color: 'white', padding: '8px 20px',
          borderRadius: '999px', fontWeight: 900, fontSize: '12px', zIndex: 200,
          textTransform: 'uppercase', letterSpacing: '2px', whiteSpace: 'nowrap',
        }}>
          🤝 ¡Encuentro registrado!
        </div>
      )}

      {/* AVISO DE BLOQUEO POR VELOCIDAD */}
      {speedLocked && (
        <div style={{
          position: 'absolute', top: '90px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(239,68,68,0.92)', color: 'white', padding: '8px 22px',
          borderRadius: '999px', fontWeight: 900, fontSize: '12px', zIndex: 200,
          textTransform: 'uppercase', letterSpacing: '2px', whiteSpace: 'nowrap',
        }}>
          ⚠️ XP bloqueado · &gt;{SPEED_LIMIT_KMH} km/h
        </div>
      )}

      {/* HUD INFERIOR: distancia, tiempo, XP */}
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
        <span style={{ color: speedLocked ? '#ef4444' : jointStatus === 'active' ? '#00FFFF' : '#f97316' }}>
          {speedLocked ? `🔒 ${speedKmh} km/h` : `✨ ${xpPreview} XP`}
        </span>
        <span style={{ opacity: 0.5, fontSize: '9px', alignSelf: 'center' }}>v1.5</span>
      </div>

      {/* BOTÓN ENCUENTRO DURANTE SESIÓN */}
      <button
        onClick={handleEncounterDuring}
        disabled={encounterDone || encounterRef.current}
        style={{
          position: 'absolute', bottom: '100px', right: '20px', zIndex: 200,
          background: encounterRef.current ? 'rgba(34,197,94,0.9)' : 'rgba(0,0,0,0.85)',
          color: 'white', border: `2px solid ${encounterRef.current ? '#22C55E' : '#f97316'}`,
          borderRadius: '999px', padding: '10px 16px', fontWeight: 900,
          fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px',
          cursor: encounterRef.current ? 'default' : 'pointer', whiteSpace: 'nowrap',
        }}
      >
        {encounterRef.current ? '✓ Encuentro' : '🤝 Encuentro'}
      </button>

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
    </div>
  );
}
