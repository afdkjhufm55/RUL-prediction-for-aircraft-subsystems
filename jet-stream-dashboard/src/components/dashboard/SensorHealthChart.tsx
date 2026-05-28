import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { Gauge } from 'lucide-react';
import type { SensorData } from '@/types/digitalTwin';
import { SENSOR_CONFIGS, OPTIMAL_SENSORS } from '@/types/digitalTwin';

interface SensorHealthChartProps {
  sensors: SensorData;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg space-y-1">
      <p className="font-semibold text-foreground">{d.label}</p>
      <p className="text-muted-foreground">Current: <span className="font-mono text-foreground">{d.current.toFixed(1)} {d.unit}</span></p>
      <p className="text-muted-foreground">Optimal: <span className="font-mono text-emerald-400">{d.optimal.toFixed(1)} {d.unit}</span></p>
      <p className="text-muted-foreground">Health: <span className="font-mono" style={{ color: d.color }}>{d.health.toFixed(0)}%</span></p>
    </div>
  );
};

export function SensorHealthChart({ sensors }: SensorHealthChartProps) {
  const data = SENSOR_CONFIGS.map((cfg) => {
    const current = sensors[cfg.key] ?? cfg.optimal;
    const optimal = OPTIMAL_SENSORS[cfg.key];
    const range = cfg.max - cfg.min;

    // Health = how close to optimal vs how far it could deviate
    const deviation = Math.abs(current - optimal) / range;
    const health = Math.max(0, Math.min(100, (1 - deviation * 2) * 100));

    const color =
      health > 75 ? '#10b981' :
      health > 50 ? '#eab308' :
      health > 25 ? '#f97316' : '#ef4444';

    return {
      key: cfg.key,
      label: cfg.label,
      unit: cfg.unit,
      current,
      optimal,
      health,
      color,
      // Short label for axis
      shortLabel: cfg.key.toUpperCase(),
    };
  });

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-3">
        <Gauge className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Sensor Health</span>
        <span className="ml-auto text-xs text-muted-foreground">vs optimal</span>
      </div>

      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }} barSize={28}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis
              dataKey="shortLabel"
              stroke="#4b5563"
              tick={{ fill: '#9ca3af', fontSize: 10 }}
            />
            <YAxis
              domain={[0, 100]}
              stroke="#4b5563"
              tick={{ fill: '#6b7280', fontSize: 10 }}
              width={30}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <ReferenceLine y={75} stroke="#10b981" strokeDasharray="4 4" strokeOpacity={0.4} />
            <ReferenceLine y={50} stroke="#eab308" strokeDasharray="4 4" strokeOpacity={0.4} />
            <Bar dataKey="health" radius={[4, 4, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.key} fill={entry.color} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Colour legend */}
      <div className="flex gap-4 mt-2 text-[10px] text-muted-foreground justify-center">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Good (&gt;75%)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />Fair (50–75%)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />Poor (25–50%)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Critical (&lt;25%)</span>
      </div>
    </div>
  );
}
