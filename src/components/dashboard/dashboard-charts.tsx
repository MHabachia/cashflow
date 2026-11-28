"use client";

import {
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
