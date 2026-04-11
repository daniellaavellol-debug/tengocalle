/**
 * EarlyAccessCard.tsx — Componente de presentación (sin props, sin estado).
 * Invita a los early adopters a dar feedback en Instagram.
 */

export default function EarlyAccessCard() {
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl px-5 py-4">
      <p className="text-white text-sm font-semibold mb-1">
        TU VOZ CONSTRUYE CALLE
      </p>
      <p className="text-gray-400 text-xs leading-relaxed">
        Estamos en fase de pruebas y queremos tu feedback. Encuéntranos en{' '}
        <a
          href="https://instagram.com/tengocalle.cl"
          target="_blank"
          rel="noopener noreferrer"
          className="text-orange-500 font-semibold hover:underline"
        >
          @tengocalle.cl
        </a>{' '}
        y ayúdanos a crear la mejor experiencia.
      </p>
    </div>
  );
}
