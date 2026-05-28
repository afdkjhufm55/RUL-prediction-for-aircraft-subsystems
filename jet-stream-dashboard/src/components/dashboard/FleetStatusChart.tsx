import { useEffect, useState } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Users } from 'lucide-react';

interface FleetEngine {
  id: number;
  rul: number;
  status: string;
}

interface FleetData {
  engines: FleetEngine[];
}

const STATUS_COLORS: Record<string, string> = {
  HEALTHY:  '#10b981',
  DEGRADED: '#eab308',
  WARNING:  '#f97316',
  CRITICAL: '#ef4444',
};

const STATUS_ORDER = ['HEALTHY', 'DEGRADED', 'WARNING', 'CRITICAL'];

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold" style={{ color: d.payload.color }}>{d.name}</p>
      <p className="text-muted-foreground">{d.value} engines ({d.payload.pct}%)</p>
    </div>
  );
};

const renderCustomLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, value }: any) => {
  if (value === 0) return null;
  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight="bold">
      {value}
    </text>
  );
};

export function FleetStatusChart() {
  const [chartData, setChartData] = useState<{ name: string; value: number; color: string; pct: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/fleet_status.json')
      .then((r) => r.json())
      .then((json: FleetData) => {
        const counts: Record<string, number> = { HEALTHY: 0, DEGRADED: 0, WARNING: 0, CRITICAL: 0 };
        json.engines.forEach((e) => {
          if (counts[e.status] !== undefined) counts[e.status]++;
        });
        const t = json.engines.length;
        setTotal(t);
        setChartData(
          STATUS_ORDER.map((s) => ({
            name: s,
            value: counts[s],
            color: STATUS_COLORS[s],
            pct: t > 0 ? ((counts[s] / t) * 100).toFixed(0) : '0',
          }))
        );
        setLoaded(true);
      })
      .catch(() => {
        // fleet_status.json not available — show placeholder
        setLoaded(false);
      });
  }, []);

  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Fleet Status</span>
        {loaded && <span className="ml-auto text-xs text-muted-foreground">{total} engines</span>}
      </div>

      {!loaded ? (
        <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
          fleet_status.json not available
        </div>
      ) : (
        <>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={78}
                  paddingAngle={2}
                  dataKey="value"
                  labelLine={false}
                  label={renderCustomLabel}
                >
                  {chartData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1">
            {chartData.map((d) => (
              <div key={d.name} className="flex items-center gap-1.5 text-[10px]">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                <span className="text-muted-foreground">{d.name}</span>
                <span className="font-mono ml-auto text-foreground">{d.value}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
