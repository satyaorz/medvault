import { sparklinePoints } from "@/lib/sparkline"
import { cn } from "@/lib/utils"

export function Sparkline({
  values,
  width = 96,
  height = 28,
  className,
}: {
  values: number[]
  width?: number
  height?: number
  className?: string
}) {
  const points = sparklinePoints(values, width, height)
  if (!points) return <span className={cn("block", className)} style={{ width, height }} aria-hidden />
  const last = points.split(" ").at(-1)!.split(",").map(Number)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("overflow-visible text-primary", className)} aria-hidden>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill="currentColor" />
    </svg>
  )
}
