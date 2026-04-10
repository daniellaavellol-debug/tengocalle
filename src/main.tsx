import { StrictMode, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { PostHogProvider } from './providers/PostHogProvider';

// ─── Error Boundary global ────────────────────────────────────────────────────
// Si cualquier módulo lanza durante render, muestra diagnóstico visible en lugar
// de pantalla negra vacía.
interface EBState { error: Error | null }
class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { error: null };
  static getDerivedStateFromError(e: Error): EBState { return { error: e }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[CALLE ErrorBoundary]', error, info);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', background: '#000', color: '#fff',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '2rem', fontFamily: 'system-ui, sans-serif', textAlign: 'center',
      }}>
        <p style={{ color: '#FF5F1F', fontWeight: 900, fontSize: '2.5rem', fontStyle: 'italic', marginBottom: '0.5rem' }}>
          CALLE
        </p>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: '2rem' }}>
          Error de carga
        </p>
        <p style={{ color: '#ef4444', fontSize: '0.85rem', fontWeight: 700, marginBottom: '1rem', maxWidth: '360px', wordBreak: 'break-word' }}>
          {error.message}
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: '#FF5F1F', color: '#000', border: 'none',
            borderRadius: '0.75rem', padding: '0.75rem 2rem',
            fontWeight: 900, fontSize: '0.8rem', letterSpacing: '0.1em',
            textTransform: 'uppercase', cursor: 'pointer',
          }}
        >
          Reintentar
        </button>
      </div>
    );
  }
}

// ─── Mount ────────────────────────────────────────────────────────────────────
const rootEl = document.getElementById('root');
if (!rootEl) {
  document.body.innerHTML = '<div style="color:#FF5F1F;background:#000;height:100vh;display:flex;align-items:center;justify-content:center;font:900 2rem system-ui">CALLE — Sin #root</div>';
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <PostHogProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </PostHogProvider>
    </StrictMode>,
  );
}
