import { useState, useEffect, lazy, Suspense } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import AuthScreen from './AuthScreen';
import TribeSelection from './TribeSelection';
import Home from './Home';
import Summary from './Summary';
import Stats from './Stats';
import BottomNav from './BottomNav';
import InstallPrompt from './components/InstallPrompt';
import JointMissionInviteModal from './components/JointMissionInviteModal';
import { useGlobalHandshake } from './hooks/useGlobalHandshake';
import { syncUserData } from './lib/db';
import { calculateLevel } from './lib/xp';
import { getStreakDisplay } from './utils/streakLogic';

// Code splitting — estos módulos solo se cargan cuando el usuario los visita
const MapboxTracking = lazy(() => import('./MapboxTracking'));
const LosK           = lazy(() => import('./LosK'));
const MissionsScreen = lazy(() => import('./components/MissionsScreen'));

// ─── Auth states ──────────────────────────────────────────────────────────────
// 'loading'         → verificando sesión al arrancar (máx 6 s)
// 'unauthenticated' → sin sesión → AuthScreen
// 'no-tribe'        → autenticado pero sin tribu en profiles → TribeSelection
// 'ready'           → autenticado + tribu elegida → flujo normal
type AuthState = 'loading' | 'unauthenticated' | 'no-tribe' | 'ready';

type Step = 'home' | 'map' | 'summary' | 'stats' | 'losk' | 'missions';

export interface UserData {
  name: string;
  userClass: string;
  multiplier: number;
  totalXp: number;
  totalKm: number;
  streak: number;
  encounters: number;
  completedMissionIds: number[];
}

interface SessionData {
  xp: number;
  distanceKm: number;
  durationSec: number;
  startedAt: number;
  missionBonusXp: number;
  newMissionIds: number[];
}

// Multiplicadores por clase (minúscula = valor de DB, capitalizada = display)
const CLASS_MULTIPLIERS: Record<string, number> = {
  ciclista: 1.0, Ciclista: 1.0,
  runner:   1.2, Runner:   1.2,
  roller:   1.5, Roller:   1.5,
};

const DEFAULT_USER: UserData = {
  name: '', userClass: '', multiplier: 1.0,
  totalXp: 0, totalKm: 0, streak: 0, encounters: 0,
  completedMissionIds: [],
};

function loadUser(): UserData | null {
  try {
    const raw = localStorage.getItem('calle_user');
    if (raw) return JSON.parse(raw) as UserData;
  } catch {}
  return null;
}

function saveUser(data: UserData) {
  localStorage.setItem('calle_user', JSON.stringify(data));
  syncUserData(data);
}

interface RemoteStats {
  total_xp:   number | null;
  total_km:   number | null;
  streak:     number | null;
  encounters: number | null;
}

/**
 * Construye el UserData fusionando tres fuentes de verdad (en orden de prioridad):
 *   1. profiles  → nombre y tribu (siempre desde Supabase)
 *   2. users     → XP, KM, streak, encuentros (Supabase gana si es mayor)
 *   3. localStorage → misiones y completedMissionIds (no están en Supabase aún)
 */
function buildUserData(
  authUser: User,
  profileName: string,
  tribe: string,
  remote: RemoteStats | null,
): UserData {
  const saved = loadUser();
  const mult      = CLASS_MULTIPLIERS[tribe] ?? 1.0;
  const userClass = tribe.charAt(0).toUpperCase() + tribe.slice(1);
  const name =
    profileName ||
    authUser.user_metadata?.full_name ||
    authUser.email?.split('@')[0] ||
    'Callejero';

  // Supabase gana sobre localStorage (mayor valor = más reciente)
  const totalXp   = Math.max(remote?.total_xp   ?? 0, saved?.totalXp   ?? 0);
  const totalKm   = Math.max(remote?.total_km    ?? 0, saved?.totalKm   ?? 0);
  const streak    = Math.max(remote?.streak      ?? 0, saved?.streak    ?? 0);
  const encounters = Math.max(remote?.encounters ?? 0, saved?.encounters ?? 0);

  return {
    ...DEFAULT_USER,
    completedMissionIds: saved?.completedMissionIds ?? [],
    name,
    userClass,
    multiplier: mult,
    totalXp,
    totalKm,
    streak,
    encounters,
  };
}

const BOTTOM_NAV_STEPS: Step[] = ['home', 'stats', 'losk'];

export default function App() {
  const [authState, setAuthState]       = useState<AuthState>('loading');
  const [authUser,  setAuthUser]        = useState<User | null>(null);
  const [user,      setUser]            = useState<UserData>(DEFAULT_USER);
  const [step,      setStep]            = useState<Step>('home');
  const [session,   setSession]         = useState<SessionData>({
    xp: 0, distanceKm: 0, durationSec: 0, startedAt: 0, missionBonusXp: 0, newMissionIds: [],
  });
  // true cuando B aceptó la invitación fuera del mapa y debe activar modo cian al entrar
  const [pendingJointMission, setPendingJointMission] = useState(false);

  // ─── Canal global de invitaciones Realtime ───────────────────────────────
  // Se desactiva (userId = null) mientras step === 'map' para no duplicar
  // el canal que ya tiene MapboxTracking/useHandshakeListener.
  const { incoming, accepting, accept, reject } = useGlobalHandshake(
    authState === 'ready' && step !== 'map' ? (authUser?.id ?? null) : null,
    () => {
      setPendingJointMission(true);
      setStep('map');
    },
  );

  // ─── Chequea perfil en Supabase tras autenticación ───────────────────────
  const checkProfile = async (au: User) => {
    setAuthUser(au);

    // 1. profiles → tribe + nombre (obligatorio para continuar)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('tribe, name')
      .eq('id', au.id)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      console.warn('[checkProfile:profiles]', profileError.message);
    }

    if (!profile?.tribe) {
      setAuthState('no-tribe');
      return;
    }

    // 2. actividades → XP total (suma de xp_ganado filtrado por user_id)
    const { data: xpRows, error: xpError } = await supabase
      .from('actividades')
      .select('xp_ganado')
      .eq('user_id', au.id);          // columna: user_id (no id_usuario)

    if (xpError) console.warn('[checkProfile:actividades]', xpError.message);
    const totalXpFromDB = (xpRows ?? []).reduce(
      (sum: number, r: { xp_ganado: number | null }) => sum + (r.xp_ganado ?? 0),
      0,
    );

    // 3. users → KM, streak, encuentros (XP ya no viene de aquí)
    const { data: remote, error: statsError } = await supabase
      .from('users')
      .select('total_km, streak, encounters')
      .eq('id', au.id)
      .single();

    if (statsError && statsError.code !== 'PGRST116') {
      console.warn('[checkProfile:users]', statsError.message);
    }

    setUser(buildUserData(au, profile.name ?? '', profile.tribe, {
      total_xp:   totalXpFromDB,
      total_km:   remote?.total_km   ?? 0,
      streak:     remote?.streak     ?? 0,
      encounters: remote?.encounters ?? 0,
    }));
    setAuthState('ready');
  };

  // ─── Auth listener ────────────────────────────────────────────────────────
  useEffect(() => {
    // Timeout de seguridad: si getSession tarda más de 6 s (red lenta / error),
    // libera el loading para mostrar AuthScreen en lugar de pantalla negra infinita.
    const loadingTimeout = setTimeout(() => {
      setAuthState(prev => prev === 'loading' ? 'unauthenticated' : prev);
    }, 6000);

    supabase.auth.getSession()
      .then(({ data: { session: s } }) => {
        clearTimeout(loadingTimeout);
        if (!s?.user) { setAuthState('unauthenticated'); return; }
        checkProfile(s.user);
      })
      .catch(() => {
        clearTimeout(loadingTimeout);
        setAuthState('unauthenticated');
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!s?.user) {
        setAuthState('unauthenticated');
        setAuthUser(null);
        return;
      }
      checkProfile(s.user);
    });

    return () => {
      clearTimeout(loadingTimeout);
      subscription.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Callback de TribeSelection ──────────────────────────────────────────
  const handleTribeSelected = (tribeLabel: string, name: string, mult: number) => {
    setUser(prev => ({ ...prev, name, userClass: tribeLabel, multiplier: mult }));
    setAuthState('ready');
  };

  // ─── Handlers de sesión ───────────────────────────────────────────────────
  const handleStartSession = () => {
    setSession(prev => ({ ...prev, startedAt: Date.now() }));
    setStep('map');
  };

  const handleFinish = (
    xp: number,
    distanceKm: number,
    durationSec: number,
    missionBonusXp: number,
    newMissionIds: number[],
  ) => {
    setSession(prev => ({ ...prev, xp, distanceKm, durationSec, missionBonusXp, newMissionIds }));
    setStep('summary');
  };

  const handleGoHome = () => {
    const { count: newStreakCount } = getStreakDisplay();

    const updated: UserData = {
      ...user,
      totalXp:            user.totalXp + session.xp + session.missionBonusXp,
      totalKm:            user.totalKm + session.distanceKm,
      streak:             newStreakCount,
      completedMissionIds: [...new Set([...user.completedMissionIds, ...session.newMissionIds])],
    };
    setUser(updated);
    saveUser(updated);
    setStep('home');
  };

  const handleEncounter = () => {
    const bonusXp = user.encounters === 0 ? 200 : 50;
    const updated: UserData = {
      ...user,
      totalXp:    user.totalXp + bonusXp,
      encounters: user.encounters + 1,
    };
    setUser(updated);
    saveUser(updated);
  };

  const userLevel = calculateLevel(user.totalXp);

  // ─── Auth gates ───────────────────────────────────────────────────────────
  // Estilos inline en loading/error: no dependen del CDN de Tailwind.
  // Si el CDN falla en producción, estas pantallas siguen siendo visibles.
  if (authState === 'loading') {
    return (
      <div style={{
        width: '100vw', height: '100vh', background: '#000',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '1rem',
      }}>
        <span style={{
          color: '#FF5F1F', fontWeight: 900, fontSize: '2.5rem',
          fontStyle: 'italic', letterSpacing: '-0.02em',
          animation: 'pulse 1.5s ease-in-out infinite',
        }}>
          CALLE
        </span>
        <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
        <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.7rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Cargando...
        </span>
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return <AuthScreen />;
  }

  if (authState === 'no-tribe') {
    return <TribeSelection authUser={authUser!} onComplete={handleTribeSelected} />;
  }

  // ─── App principal (authState === 'ready') ────────────────────────────────
  return (
    <div className="w-full h-screen bg-black overflow-hidden select-none">
      {step === 'home' && (
        <Home
          userName={user.name}
          userClass={user.userClass}
          totalXp={user.totalXp}
          userLevel={userLevel}
          encounters={user.encounters}
          onStart={handleStartSession}
          onEncounter={handleEncounter}
          onMissions={() => setStep('missions')}
        />
      )}

      {step === 'map' && (
        <Suspense fallback={<div style={{ width: '100vw', height: '100vh', background: '#000' }} />}>
          <MapboxTracking
            multiplier={user.multiplier}
            userClass={user.userClass}
            userLevel={userLevel}
            userXp={user.totalXp}
            userId={authUser?.id ?? null}
            userName={user.name}
            completedMissionIds={user.completedMissionIds}
            startJointMission={pendingJointMission}
            onJointMissionStarted={() => setPendingJointMission(false)}
            onFinish={handleFinish}
            onBack={() => setStep('home')}
          />
        </Suspense>
      )}

      {step === 'summary' && (
        <Summary
          xp={session.xp}
          distanceKm={session.distanceKm}
          durationSec={session.durationSec}
          multiplier={user.multiplier}
          userClass={user.userClass}
          missionBonusXp={session.missionBonusXp}
          onHome={handleGoHome}
        />
      )}

      {step === 'stats' && <Stats user={user} />}

      {step === 'losk' && (
        <Suspense fallback={<div style={{ width: '100vw', height: '100vh', background: '#000' }} />}>
          <LosK />
        </Suspense>
      )}

      {step === 'missions' && (
        <Suspense fallback={<div style={{ width: '100vw', height: '100vh', background: '#000' }} />}>
          <MissionsScreen
            userClass={user.userClass}
            userId={authUser?.id ?? null}
            totalXp={user.totalXp}
            completedMissionIds={user.completedMissionIds}
            onBack={() => setStep('home')}
          />
        </Suspense>
      )}

      {BOTTOM_NAV_STEPS.includes(step) && (
        <BottomNav
          current={step as 'home' | 'stats' | 'losk'}
          onNavigate={(tab) => setStep(tab)}
        />
      )}

      {/* Modal global de invitación Misión Conjunta (fuera del mapa) */}
      {incoming && (
        <JointMissionInviteModal
          initiatorName={incoming.initiatorName}
          accepting={accepting}
          onAccept={accept}
          onReject={reject}
        />
      )}

      <InstallPrompt />
    </div>
  );
}
