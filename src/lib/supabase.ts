import { createClient } from '@supabase/supabase-js';

const supabaseUrl    = import.meta.env.VITE_SUPABASE_URL    as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  // En producción esto aparece en la consola de Vercel y en el Error Boundary.
  // No usar placeholders: un createClient con URL falsa silencia el error real.
  const missing = [
    !supabaseUrl     && 'VITE_SUPABASE_URL',
    !supabaseAnonKey && 'VITE_SUPABASE_ANON_KEY',
  ].filter(Boolean).join(', ');
  throw new Error(
    `Variables de entorno faltantes: ${missing}. ` +
    'Configúralas en Vercel → Settings → Environment Variables y redespliega.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
