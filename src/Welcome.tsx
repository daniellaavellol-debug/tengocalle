import { useState } from 'react';

export default function Welcome({ onJoin }: { onJoin: (name: string) => void }) {
  const [name, setName] = useState('');

  return (
    <div className="h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 text-center">
      <h1 className="text-4xl font-black text-orange-500 mb-2 italic">CALLE</h1>
      <p className="text-slate-400 mb-8 font-medium italic">¿Cuánta calle tienes?</p>
      
      <div className="w-full max-w-xs space-y-4">
        <input 
          type="text" 
          placeholder="¿Tu nombre, Callejero?" 
          className="w-full p-4 rounded-xl bg-slate-800 border border-slate-700 text-center text-xl focus:border-orange-500 outline-none"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        
        <button 
          onClick={() => name && onJoin(name)}
          className="w-full bg-orange-500 hover:bg-orange-600 text-black font-black py-4 rounded-xl transition-all uppercase tracking-widest shadow-lg shadow-orange-500/20"
        >
          ENTRAR AHORA
        </button>
      </div>
    </div>
  );
}