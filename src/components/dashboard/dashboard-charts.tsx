"use client";

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { formatCents } from "@/lib/format";

export interface CategoryBreakdownItem {
  categoryId: string;
  name: string;
  color: string;
  amountCents: number;
  percentage: number;
}

export interface MonthlyTrendItem {
  monthKey: string; // YYYY-MM
  label: string; // z.B. "Nov"
  fixedCents: number;
  variableCents: number;
  totalCents: number;
}

export function CategoryDonutChart({
  data,
  totalCents,
}: {
  data: CategoryBreakdownItem[];
  totalCents: number;
}) {
  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-xs text-zinc-500">
        Noch keine Ausgaben in diesem Monat.
      </div>
    );
  }

  return (
    <div className="grid sm:grid-cols-2 gap-4 items-center">
      <div className="h-52 relative">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="amountCents"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={52}
              outerRadius={78}
              paddingAngle={2}
              strokeWidth={0}
            >
              {data.map((entry) => (
                <Cell key={entry.categoryId} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number) => [formatCents(value), "Ausgaben"]}
              contentStyle={{
                borderRadius: "12px",
                fontSize: "12px",
                border: "1px solid rgba(161,161,170,0.2)",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-xs text-zinc-500 uppercase font-semibold">
            Gesamt
          </span>
          <span className="text-sm font-bold">{formatCents(totalCents)}</span>
        </div>
      </div>

      <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
        {data.map((item) => (
          <div
            key={item.categoryId}
            className="flex items-center justify-between text-xs"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span className="truncate font-medium">{item.name}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-semibold">
                {formatCents(item.amountCents)}
              </span>
              <span className="text-xs text-zinc-500 w-9 text-right">
                {item.percentage}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MonthlyBarChart({ data }: { data: MonthlyTrendItem[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="rgba(161, 161, 170, 0.2)"
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "#71717a" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(val: number) => `${Math.round(val / 100)}€`}
            tick={{ fontSize: 11, fill: "#71717a" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: number, name: string) => [
              formatCents(value),
              name === "fixedCents" ? "Fixkosten" : "Variable Kosten",
            ]}
            contentStyle={{
              borderRadius: "12px",
              fontSize: "12px",
              border: "1px solid rgba(161,161,170,0.2)",
            }}
          />
          <Bar
            dataKey="fixedCents"
            name="fixedCents"
            stackId="expenses"
            fill="var(--brand-primary)"
            radius={[0, 0, 4, 4]}
          />
          <Bar
            dataKey="variableCents"
            name="variableCents"
            stackId="expenses"
            fill="#d4d4d8"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-5 text-xs text-zinc-500 mt-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-brand" />
          <span>Fixkosten</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-xs bg-zinc-300" />
          <span>Variable Kosten</span>
        </div>
      </div>
    </div>
  );
}
