import { useEffect } from 'react';
import type { ReactNode } from 'react';
import posthog from 'posthog-js';

const POSTHOG_KEY  = import.meta.env.VITE_POSTHOG_KEY  as string | undefined;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST as string | undefined;

// Inicialización única — se ejecuta cuando el módulo se carga por primera vez.
// posthog.init es idempotente si se llama varias veces con la misma key.
if (POSTHOG_KEY) {
  posthog.init(POSTHOG_KEY, {
    api_host:              POSTHOG_HOST ?? 'https://app.posthog.com',
    capture_pageview:      false,   // páginas SPA manejadas manualmente si hace falta
    capture_pageleave:     false,
    persistence:           'localStorage',
    autocapture:           false,   // solo eventos explícitos
    disable_session_recording: true,
  });
} else {
  console.warn('[PostHog] VITE_POSTHOG_KEY no definida — analytics desactivado.');
}

// ─── Helpers de eventos (importar donde se necesiten) ────────────────────────

/** Usuario votó una misión (like/dislike o toggle off). */
export function trackMissionVoted(params: {
  missionId: number;
  voteType: 'like' | 'dislike' | 'removed';
  userClass: string;
}) {
  if (!POSTHOG_KEY) return;
  posthog.capture('mission_voted', {
    mission_id: params.missionId,
    vote_type:  params.voteType,
    user_class: params.userClass,
  });
}

/** Usuario inició una salida. */
export function trackMissionStarted(params: {
  userClass: string;
}) {
  if (!POSTHOG_KEY) return;
  posthog.capture('mission_started', {
    user_class: params.userClass,
  });
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Identifica al usuario autenticado en PostHog cuando el provider monta.
    // Si no hay sesión, PostHog sigue funcionando como usuario anónimo.
    import('../lib/supabase').then(({ supabase }) => {
      supabase.auth.getUser().then(({ data }) => {
        const uid = data?.user?.id;
        if (uid && POSTHOG_KEY) posthog.identify(uid);
      });
    });
  }, []);

  return <>{children}</>;
}
