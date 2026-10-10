/** Build an SVG polyline `points` string for a sparkline. Pure so it can be unit-tested. */
export function sparklinePoints(values: number[], width: number, height: number, padding = 2): string {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return ""
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const span = max - min || 1
  const innerW = width - padding * 2
  const innerH = height - padding * 2
  const step = finite.length > 1 ? innerW / (finite.length - 1) : 0
  return finite
    .map((v, i) => {
      const x = finite.length > 1 ? padding + i * step : width / 2
      // Flat series sit in the middle instead of hugging the bottom edge.
      const y = max === min ? height / 2 : padding + innerH - ((v - min) / span) * innerH
      return `${round(x)},${round(y)}`
    })
    .join(" ")
}

const round = (n: number) => Math.round(n * 100) / 100
