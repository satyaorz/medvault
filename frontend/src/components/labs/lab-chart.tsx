"use client"

import { format } from "date-fns"
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, XAxis, YAxis } from "recharts"

import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { buildLabChartModel, type LabChartDatum } from "@/lib/lab-chart"
import { FLAG_LABELS, flagColor, formatDate, formatNumber, formatOriginalLab, formatReferenceRange, withUnit } from "@/lib/format"
import type { LabPoint } from "@/lib/types"

const config = {
  value: { label: "Result", color: "var(--chart-1)" },
  range: { label: "Reference range", color: "var(--success)" },
} satisfies ChartConfig

interface DotProps {
  cx?: number
  cy?: number
  payload?: LabChartDatum
}

function FlagDot({ cx, cy, payload }: DotProps) {
  if (cx === undefined || cy === undefined || !payload) return null
  return <circle cx={cx} cy={cy} r={5} fill={flagColor(payload.flag)} stroke="var(--card)" strokeWidth={2} />
}

function TooltipBody({ active, payload, unit }: { active?: boolean; payload?: { payload: LabChartDatum }[]; unit: string | null }) {
  const datum = payload?.[0]?.payload
  if (!active || !datum) return null
  const range = formatReferenceRange(datum.point.reference_low, datum.point.reference_high, unit)
  return (
    <div className="grid min-w-44 gap-1 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="font-medium">{formatDate(datum.point.measured_at)}</p>
      <p className="text-sm font-semibold tabular-nums">
        {withUnit(formatNumber(datum.value), unit)}
        {datum.flag ? <span style={{ color: flagColor(datum.flag) }}> · {FLAG_LABELS[datum.flag]}</span> : null}
      </p>
      {range ? <p className="text-muted-foreground">Reference {range}</p> : null}
      <p className="text-muted-foreground">Printed as {formatOriginalLab(datum.point)}</p>
    </div>
  )
}

export function LabChart({ results, unit }: { results: LabPoint[]; unit: string | null }) {
  const model = buildLabChartModel(results)
  if (model.data.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No numeric results to chart — see the table below.</p>
  }
  const single = model.data.length === 1
  const t0 = model.data[0].t
  const t1 = model.data.at(-1)!.t
  const day = 86_400_000
  const xDomain: [number, number] = single ? [t0 - 30 * day, t0 + 30 * day] : [t0, t1]
  const spanDays = (t1 - t0) / day

  return (
    <figure aria-label={`Trend chart with ${model.data.length} results`}>
      <ChartContainer config={config} className="aspect-auto h-72 w-full">
        <ComposedChart data={model.data} margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={xDomain}
            tickFormatter={(t: number) => format(t, spanDays > 400 ? "MMM yy" : "d MMM")}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
            padding={{ left: 12, right: 12 }}
          />
          <YAxis
            domain={model.domain}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v: number) => formatNumber(v)}
          />
          {model.perPointBand ? (
            <Area
              dataKey="range"
              type="monotone"
              stroke="none"
              fill="var(--color-range)"
              fillOpacity={0.12}
              isAnimationActive={false}
              activeDot={false}
            />
          ) : model.band ? (
            <ReferenceArea
              y1={model.band.low ?? model.domain[0]}
              y2={model.band.high ?? model.domain[1]}
              fill="var(--color-range)"
              fillOpacity={0.12}
              ifOverflow="hidden"
            />
          ) : null}
          <ChartTooltip cursor={{ strokeDasharray: "4 4" }} content={<TooltipBody unit={unit} />} />
          <Line
            dataKey="value"
            type="monotone"
            stroke="var(--color-value)"
            strokeWidth={2}
            dot={<FlagDot />}
            activeDot={{ r: 7 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ChartContainer>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {model.perPointBand || model.band ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-sm bg-success/20" aria-hidden /> Reference range
          </span>
        ) : (
          <span>No reference range on these reports</span>
        )}
        {(["low", "normal", "high"] as const).map((flag) => (
          <span key={flag} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full" style={{ background: flagColor(flag) }} aria-hidden />
            {FLAG_LABELS[flag]}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
