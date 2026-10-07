'use client';

import { useState, type ReactNode } from 'react';
import { Sparkles, FlaskConical } from 'lucide-react';
import AnalistaTab from './AnalistaTab';
import DecisionesTab from './DecisionesTab';

export default function LaboratorioPage() {
  const [tab, setTab] = useState<'analista' | 'decisiones'>('analista');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-text-primary">
          <FlaskConical className="h-5 w-5 text-brand" /> Laboratorio
        </h1>
        <p className="text-sm text-text-muted">Tu analista de negocio y el seguimiento de decisiones.</p>
      </div>

      <div className="flex gap-1 border-b border-border">
        <TabBtn active={tab === 'analista'} onClick={() => setTab('analista')} icon={<Sparkles className="h-4 w-4" />} label="Analista" />
        <TabBtn active={tab === 'decisiones'} onClick={() => setTab('decisiones')} icon={<FlaskConical className="h-4 w-4" />} label="Decisiones" />
      </div>

      {/* Ambos montados (hidden/block) para no perder estado al cambiar de tab */}
      <div className={tab === 'analista' ? 'block' : 'hidden'}><AnalistaTab /></div>
      <div className={tab === 'decisiones' ? 'block' : 'hidden'}><DecisionesTab /></div>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
        active ? 'border-brand text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary'
      }`}
    >
      {icon} {label}
    </button>
  );
}
