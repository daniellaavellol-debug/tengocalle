import { useState } from 'react';
import Welcome from './Welcome';
import Home from './Home';
import MapboxTracking from './MapboxTracking';
import ClassSelection from './ClassSelection';
import Summary from './Summary';
import Stats from './Stats';
import LosK from './LosK';
import BottomNav from './BottomNav';
import InstallPrompt from './components/InstallPrompt';
import { syncUserData } from './lib/db';
import { calculateLevel } from './lib/xp';

type Step = 'welcome' | 'class-select' | 'home' | 'map' | 'summary' | 'stats' | 'losk';

export interface Missions {
  salALaCalle: boolean;
  aveNocturna: boolean;
  sociable: boolean;
}

export interface UserData {
  name: string;
  userClass: string;
  multiplier: number;
  totalXp: number;
  totalKm: number;
  streak: number;
  encounters: number;
  missions: Missions;
  completedMissionIds: number[]; // IDs de misiones dinámicas de Supabase
}

interface SessionData {
  xp: number;
  distanceKm: number;
  durationSec: number;
  startedAt: number;
  missionBonusXp: number;
  newMissionIds: number[];
}

const DEFAULT_USER: UserData = {
  name: '', userClass: '', multiplier: 1.0,
  totalXp: 0, totalKm: 0, streak: 0, encounters: 0,
  missions: { salALaCalle: false, aveNocturna: false, sociable: false },
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

const BOTTOM_NAV_STEPS: Step[] = ['home', 'stats', 'losk'];

export default function App() {
  const [user, setUser] = useState<UserData>(() => {
    const saved = loadUser();
    if (saved) return { ...DEFAULT_USER, ...saved, missions: { ...DEFAULT_USER.missions, ...saved.missions } };
    return DEFAULT_USER;
  });

  const [step, setStep] = useState<Step>(() =>
    localStorage.getItem('calle_user') ? 'home' : 'welcome'
  );

  const [session, setSession] = useState<SessionData>({
    xp: 0, distanceKm: 0, durationSec: 0, startedAt: 0, missionBonusXp: 0, newMissionIds: [],
  });

  const handleJoin = (name: string) => {
    setUser(prev => ({ ...prev, name }));
    setStep('class-select');
  };

  const handleClassSelect = (selectedClass: string, mult: number) => {
    const updated: UserData = { ...user, userClass: selectedClass, multiplier: mult };
    setUser(updated);
    saveUser(updated);
    setStep('home');
  };

  const handleStartSession = () => {
    setSession(prev => ({ ...prev, startedAt: Date.now() }));
    setStep('map');
  };

  // MapboxTracking llama a esto tras chequear misiones Supabase
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
    const newMissions = { ...user.missions };
    let bonusXp = session.missionBonusXp; // XP de misiones dinámicas ya calculado

    // Misiones estáticas
    if (!newMissions.salALaCalle) { newMissions.salALaCalle = true; bonusXp += 50; }
    const startHour = new Date(session.startedAt).getHours();
    if (!newMissions.aveNocturna && startHour >= 18) { newMissions.aveNocturna = true; bonusXp += 100; }

    const updated: UserData = {
      ...user,
      totalXp: user.totalXp + session.xp + bonusXp,
      totalKm: user.totalKm + session.distanceKm,
      missions: newMissions,
      completedMissionIds: [...new Set([...user.completedMissionIds, ...session.newMissionIds])],
    };
    setUser(updated);
    saveUser(updated);
    setStep('home');
  };

  const handleEncounter = () => {
    const newMissions = { ...user.missions };
    let bonusXp = 50;
    if (!newMissions.sociable) { newMissions.sociable = true; bonusXp += 150; }
    const updated: UserData = { ...user, totalXp: user.totalXp + bonusXp, encounters: user.encounters + 1, missions: newMissions };
    setUser(updated);
    saveUser(updated);
  };

  const newlyCompleted = {
    salALaCalle: !user.missions.salALaCalle,
    aveNocturna: !user.missions.aveNocturna && new Date(session.startedAt).getHours() >= 18,
  };

  const userLevel = calculateLevel(user.totalXp);

  return (
    <div className="w-full h-screen bg-black overflow-hidden select-none">
      {step === 'welcome' && <Welcome onJoin={handleJoin} />}
      {step === 'class-select' && <ClassSelection onSelect={handleClassSelect} />}

      {step === 'home' && (
        <Home
          userName={user.name} userClass={user.userClass}
          totalXp={user.totalXp} userLevel={userLevel}
          missions={user.missions} completedMissionIds={user.completedMissionIds}
          onStart={handleStartSession} onEncounter={handleEncounter}
        />
      )}

      {step === 'map' && (
        <MapboxTracking
          multiplier={user.multiplier} userClass={user.userClass}
          userLevel={userLevel} completedMissionIds={user.completedMissionIds}
          onFinish={handleFinish} onBack={() => setStep('home')}
        />
      )}

      {step === 'summary' && (
        <Summary
          xp={session.xp} distanceKm={session.distanceKm} durationSec={session.durationSec}
          multiplier={user.multiplier} userClass={user.userClass}
          newlyCompleted={newlyCompleted} missionBonusXp={session.missionBonusXp}
          onHome={handleGoHome}
        />
      )}

      {step === 'stats' && <Stats user={user} />}
      {step === 'losk' && <LosK />}

      {BOTTOM_NAV_STEPS.includes(step) && (
        <BottomNav current={step as 'home' | 'stats' | 'losk'} onNavigate={(tab) => setStep(tab)} />
      )}

      <InstallPrompt />
    </div>
  );
}
