/**
 * useHandshake — Publica el código del usuario en `handshake_codes` al montar
 * y expone su código derivado deterministamente.
 *
 * Esquema: handshake_codes(user_id uuid PK, code text)
 * Filtra siempre por user_id para cumplir con RLS.
 */
import { useEffect } from 'react';
import { deriveEncounterCode, ensureHandshakeCode } from '../services/handshakeService';

export function useHandshake(userId: string | null): string {
  const myCode = userId ? deriveEncounterCode(userId) : '';

  useEffect(() => {
    if (!userId) return;
    void ensureHandshakeCode(userId);
  }, [userId]);

  return myCode;
}
