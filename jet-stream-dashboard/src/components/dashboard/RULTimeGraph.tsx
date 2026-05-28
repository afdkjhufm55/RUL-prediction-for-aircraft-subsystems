import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { Activity } from 'lucide-react';

interface RULPoint {
  cycle: number;
  rul: number;
  status: string;
}

interface RULTimeGraphProps {
  data: RULPoint[];
}

const STATUS_COLORS: Record<string, string> = {
  HEALTHY: '#10b981',
  DEGRADED: '#eab308',
  WARNING: '#f97316',
  CRITICAL: '#ef4444',
};

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as RULPoint;
  const color = STATUS_COLORS[d.status] ?? '#60a5fa';
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1">Cycle {d.cycle}</p>
      <p className="font-mono font-bold" style={{ color }}>
        RUL: {d.rul.toFixed(1)} cycles
      </p>
      <p style={{ color }} className="font-medium">{d.status}</p>
    </div>
  );
};

export function RULTimeGraph({ data }: RULTimeGraphProps) {
  const latest = data[data.length - 1];
  const statusColor = latest ? (STATUS_COLORS[latest.status] ?? '#60a5fa') : '#60a5fa';

  if (!data || data.length === 0) {
    return (
      <div className="panel p-4 h-[260px] flex flex-col justify-center items-center text-muted-foreground">
        <Activity className="w-8 h-8 mb-2 opacity-30" />
        <p className="text-sm">Waiting for RUL data...</p>
      </div>
    );
  }

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">RUL Over Time</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {latest && (
            <span className="font-mono font-bold" style={{ color: statusColor }}>
              {latest.rul.toFixed(1)} cycles remaining
            </span>
          )}
          <span>{data.length} points</span>
        </div>
      </div>

      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          {/* right margin increased to 56px so 'insideRight' labels have room to render */}
          <AreaChart data={data} margin={{ top: 4, right: 56, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="rulGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={statusColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={statusColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis
              dataKey="cycle"
              type="number"
              domain={['dataMin', 'dataMax']}
              stroke="#4b5563"
              tick={{ fill: '#6b7280', fontSize: 10 }}
              label={{ value: 'Cycle', position: 'insideBottomRight', offset: -4, fill: '#6b7280', fontSize: 10 }}
            />
            <YAxis
              domain={[0, 130]}
              stroke="#4b5563"
              tick={{ fill: '#6b7280', fontSize: 10 }}
              label={{ value: 'RUL', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 10 }}
              width={36}
            />
            <Tooltip content={<CustomTooltip />} />
            {/* position: 'insideRight' keeps labels within the SVG; right margin provides the space */}
            <ReferenceLine y={70} stroke="#10b981" strokeDasharray="4 4" strokeOpacity={0.5}
              label={{ value: 'Healthy', position: 'insideRight', fill: '#10b981', fontSize: 9 }} />
            <ReferenceLine y={40} stroke="#f97316" strokeDasharray="4 4" strokeOpacity={0.5}
              label={{ value: 'Warning', position: 'insideRight', fill: '#f97316', fontSize: 9 }} />
            <ReferenceLine y={15} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.5}
              label={{ value: 'Critical', position: 'insideRight', fill: '#ef4444', fontSize: 9 }} />
            <Area
              type="monotone"
              dataKey="rul"
              stroke={statusColor}
              strokeWidth={2}
              fill="url(#rulGradient)"
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}