import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts';
import { TrendingDown } from 'lucide-react';

const MODELS = [
  {
    name: 'Baseline\nCNN-BiLSTM',
    shortName: 'Baseline',
    features: 29,
    rmse: 7.31,
    mae: 6.14,
    color: '#6366f1',
    dimColor: '#4338ca',
  },
  {
    name: 'Hybrid\nCNN-BiLSTM',
    shortName: 'Hybrid',
    features: 35,
    rmse: 6.27,
    mae: 5.70,
    color: '#10b981',
    dimColor: '#047857',
  },
];

const rmseData = MODELS.map((m) => ({ name: m.shortName, value: m.rmse, color: m.color }));
const maeData  = MODELS.map((m) => ({ name: m.shortName, value: m.mae,  color: m.color }));

const rmseImprovement = (((7.31 - 6.27) / 7.31) * 100).toFixed(1);
const maeImprovement  = (((6.14 - 5.70) / 6.14) * 100).toFixed(1);

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const model = MODELS.find((m) => m.shortName === label);
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg space-y-1">
      <p className="font-semibold text-foreground">{label} CNN-BiLSTM</p>
      {model && (
        <p className="text-muted-foreground">Features: <span className="text-foreground font-mono">{model.features}</span></p>
      )}
      <p className="text-muted-foreground">
        {payload[0].name}: <span className="font-mono font-bold" style={{ color: payload[0].payload.color }}>
          {payload[0].value.toFixed(2)} cycles
        </span>
      </p>
    </div>
  );
};

function MiniBar({
  data,
  label,
  improvement,
  domain,
}: {
  data: { name: string; value: number; color: string }[];
  label: string;
  improvement: string;
  domain: [number, number];
}) {
  return (
    <div className="flex-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
        <span className="text-[11px] font-mono text-emerald-400">↓ {improvement}%</span>
      </div>
      <div className="h-[130px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 8, left: -8, bottom: 0 }} barSize={32}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis
              dataKey="name"
              stroke="#4b5563"
              tick={{ fill: '#9ca3af', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={domain}
              stroke="#4b5563"
              tick={{ fill: '#6b7280', fontSize: 9 }}
              width={28}
              tickFormatter={(v) => v.toFixed(1)}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar dataKey="value" name={label} radius={[4, 4, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} fillOpacity={0.9} />
              ))}
              <LabelList
                dataKey="value"
                position="top"
                formatter={(v: number) => v.toFixed(2)}
                style={{ fill: '#d1d5db', fontSize: 10, fontFamily: 'monospace' }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ModelComparisonChart() {
  return (
    <div className="panel p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <TrendingDown className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-semibold">Model Comparison</span>
        <span className="ml-auto text-xs text-muted-foreground">N-CMAPSS DS02 · held-out test set</span>
      </div>

      {/* Two bar charts side by side */}
      <div className="flex gap-6">
        <MiniBar data={rmseData} label="RMSE (cycles)" improvement={rmseImprovement} domain={[5, 8]} />
        <MiniBar data={maeData}  label="MAE  (cycles)" improvement={maeImprovement}  domain={[4.5, 7]} />
      </div>

      {/* Summary table */}
      <div className="mt-4 rounded-lg overflow-hidden border border-border text-xs">
        {/* Header row */}
        <div className="grid grid-cols-4 bg-secondary/60 text-muted-foreground">
          <div className="px-3 py-2 font-medium">Model</div>
          <div className="px-3 py-2 font-medium text-right">Features</div>
          <div className="px-3 py-2 font-medium text-right">RMSE</div>
          <div className="px-3 py-2 font-medium text-right">MAE</div>
        </div>
        {/* Baseline row */}
        <div className="grid grid-cols-4 border-t border-border">
          <div className="px-3 py-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" />
            <span className="text-foreground">Baseline CNN-BiLSTM</span>
          </div>
          <div className="px-3 py-2 text-right font-mono text-muted-foreground">29</div>
          <div className="px-3 py-2 text-right font-mono text-muted-foreground">7.31</div>
          <div className="px-3 py-2 text-right font-mono text-muted-foreground">6.14</div>
        </div>
        {/* Hybrid row */}
        <div className="grid grid-cols-4 border-t border-border bg-emerald-500/5">
          <div className="px-3 py-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
            <span className="text-foreground font-medium">Hybrid CNN-BiLSTM</span>
          </div>
          <div className="px-3 py-2 text-right font-mono text-emerald-400">35</div>
          <div className="px-3 py-2 text-right font-mono text-emerald-400 font-bold">6.27</div>
          <div className="px-3 py-2 text-right font-mono text-emerald-400 font-bold">5.70</div>
        </div>
        {/* Improvement row */}
        <div className="grid grid-cols-4 border-t border-border bg-emerald-500/10">
          <div className="px-3 py-2 text-emerald-400 font-medium">Improvement</div>
          <div className="px-3 py-2 text-right font-mono text-emerald-400">+6 physics</div>
          <div className="px-3 py-2 text-right font-mono text-emerald-400">↓ {rmseImprovement}%</div>
          <div className="px-3 py-2 text-right font-mono text-emerald-400">↓ {maeImprovement}%</div>
        </div>
      </div>
    </div>
  );
}
