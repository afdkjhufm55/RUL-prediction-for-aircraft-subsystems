import { BarChart2 } from 'lucide-react';
import { RULTimeGraph } from './RULTimeGraph';
import { PhysicsRadar } from './PhysicsRadar';
import { ModelComparisonChart } from './ModelComparisonChart';
import type { PredictionData, SensorData } from '@/types/digitalTwin';

interface RULPoint {
  cycle: number;
  rul: number;
  status: string;
}

interface AnalyticsPanelProps {
  rulHistory: RULPoint[];
  prediction: PredictionData | null;
  sensors: SensorData;
}

export function AnalyticsPanel({ rulHistory, prediction }: AnalyticsPanelProps) {
  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center gap-2 px-1">
        <BarChart2 className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Analytics</span>
        <div className="flex-1 h-px bg-border ml-2" />
      </div>

      {/* Row 1: RUL over time — full width */}
      <RULTimeGraph data={rulHistory} />

      {/* Row 2: Physics radar + Model comparison */}
      <div className="grid grid-cols-2 gap-4">
        <PhysicsRadar prediction={prediction} />
        <ModelComparisonChart />
      </div>
    </div>
  );
}
