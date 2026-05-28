import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { Zap } from 'lucide-react';
import type { PredictionData } from '@/types/digitalTwin';

interface PhysicsRadarProps {
  prediction: PredictionData | null;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground">{payload[0].payload.metric}</p>
      <p className="font-mono font-bold text-primary">{(payload[0].value as number).toFixed(1)}%</p>
    </div>
  );
};

export function PhysicsRadar({ prediction }: PhysicsRadarProps) {
  const p = prediction;

  const data = [
    {
      metric: 'Thermal',
      value: p ? Math.min(100, (p.temperature / 627) * 100) : 0,
      fullMark: 100,
    },
    {
      metric: 'Stress',
      value: p ? Math.min(100, (p.pressure ?? 0) * 100) : 0,
      fullMark: 100,
    },
    {
      metric: 'Vibration',
      value: p ? Math.min(100, (p.vibration ?? 0) * 100) : 0,
      fullMark: 100,
    },
    {
      metric: 'Fatigue',
      value: p ? Math.min(100, (p.physics_degradation ?? 0) * 100) : 0,
      fullMark: 100,
    },
    {
      metric: 'Deformation',
      value: p ? Math.min(100, ((p.deformation_mm ?? 0) / 0.18929) * 100) : 0,
      fullMark: 100,
    },
    {
      metric: 'Thermal\nMargin',
      value: p ? Math.min(100, Math.max(0, (1 - (p.thermal_margin ?? 1)) * 100)) : 0,
      fullMark: 100,
    },
  ];

  // Colour shifts red as overall degradation increases
  const avgLoad = data.reduce((s, d) => s + d.value, 0) / data.length;
  const radarColor = avgLoad > 70 ? '#ef4444' : avgLoad > 45 ? '#f97316' : avgLoad > 25 ? '#eab308' : '#10b981';

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Physics Load</span>
        <span className="ml-auto text-xs text-muted-foreground">ANSYS-derived</span>
      </div>

      {!prediction ? (
        <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
          Waiting for data...
        </div>
      ) : (
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
              <PolarGrid stroke="#1f2937" />
              <PolarAngleAxis
                dataKey="metric"
                tick={{ fill: '#9ca3af', fontSize: 10 }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Radar
                name="Load %"
                dataKey="value"
                stroke={radarColor}
                fill={radarColor}
                fillOpacity={0.25}
                strokeWidth={2}
                dot={{ r: 3, fill: radarColor }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Legend row */}
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-1">
        <span>0% = nominal</span>
        <span>100% = limit</span>
      </div>
    </div>
  );
}
