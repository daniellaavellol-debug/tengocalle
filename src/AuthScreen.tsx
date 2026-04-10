import { useState } from 'react';
import { supabase } from './lib/supabase';

type Mode = 'login' | 'register' | 'reset';

export default function AuthScreen() {
  const [mode,     setMode]     = useState<Mode>('login');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [message,  setMessage]  = useState<{ text: string; error: boolean } | null>(null);

  const msg = (text: string, error = true) => setMessage({ text, error });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setMessage(null);

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) msg(error.message);
      // Si OK → onAuthStateChange en App.tsx maneja el redirect automáticamente

    } else if (mode === 'register') {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) msg(error.message);
      else msg('Revisa tu email para confirmar tu cuenta.', false);

    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) msg(error.message);
      else msg('Link enviado. Revisa tu email.', false);
    }

    setLoading(false);
  };

  const handleGoogle = async () => {
    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // window.location.origin = dominio exacto en producción o localhost en dev.
        // Este valor debe estar en Supabase → Auth → URL Configuration → Redirect URLs.
        redirectTo: window.location.origin,
      },
    });
    // signInWithOAuth redirige el navegador al éxito — si llegamos aquí es un error.
    if (error) {
      msg(`Google: ${error.message}`);
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-full bg-black flex flex-col items-center justify-center px-6">

      {/* Logo */}
      <div className="mb-10 text-center">
        <h1 className="text-6xl font-black italic text-white tracking-tighter leading-none">CALLE</h1>
        <p className="text-white/40 font-bold uppercase tracking-[0.3em] text-xs mt-2">La ciudad es tuya</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4">

        {/* Google */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 py-3 rounded-xl bg-white text-black font-black text-sm uppercase tracking-widest transition-opacity disabled:opacity-50"
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
          </svg>
          Continuar con Google
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-white/30 text-xs font-bold uppercase tracking-widest">o</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Email form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            disabled={loading}
            className="w-full px-4 py-3 rounded-xl bg-black border border-white/15 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-orange-500 transition-colors disabled:opacity-50"
          />
          {mode !== 'reset' && (
            <input
              type="password"
              placeholder="Contraseña"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={loading}
              className="w-full px-4 py-3 rounded-xl bg-black border border-white/15 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-orange-500 transition-colors disabled:opacity-50"
            />
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl font-black text-sm uppercase tracking-widest transition-all disabled:opacity-50 active:scale-[0.98]"
            style={{ backgroundColor: '#FF5F1F', color: '#000' }}
          >
            {loading ? '...' : mode === 'login' ? 'Entrar a la Calle' : mode === 'register' ? 'Crear Cuenta' : 'Enviar Link'}
          </button>
        </form>

        {/* Message — inline styles para garantizar visibilidad sin depender del CDN de Tailwind */}
        {message && (
          <p style={{
            color: message.error ? '#f87171' : '#4ade80',
            fontSize: '0.75rem', fontWeight: 700, textAlign: 'center',
            padding: '0.5rem', borderRadius: '0.5rem',
            background: message.error ? 'rgba(239,68,68,0.1)' : 'rgba(74,222,128,0.1)',
          }}>
            {message.text}
          </p>
        )}

        {/* Mode switcher */}
        <div className="flex flex-col items-center gap-1 pt-1">
          {mode === 'login' && (
            <>
              <button onClick={() => { setMode('register'); setMessage(null); }} className="text-orange-500 text-xs font-bold hover:underline">
                ¿Sin cuenta? Regístrate
              </button>
              <button onClick={() => { setMode('reset'); setMessage(null); }} className="text-white/30 text-xs font-medium hover:text-white/50">
                Olvidé mi contraseña
              </button>
            </>
          )}
          {mode !== 'login' && (
            <button onClick={() => { setMode('login'); setMessage(null); }} className="text-orange-500 text-xs font-bold hover:underline">
              ¿Ya tienes cuenta? Inicia sesión
            </button>
          )}
        </div>
      </div>

      <p className="mt-8 text-white/15 text-xs text-center tracking-wide">
        Al entrar aceptas correr, rodar y pedalear la calle.
      </p>
    </div>
  );
}
