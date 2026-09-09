export type AxisMetric = 'weight' | 'calories' | 'steps'

export interface NiceAxis {
  min: number
  max: number
  step: number
  ticks: number[]
}

const minimumStep: Record<AxisMetric, number> = {
  weight: 0.5,
  calories: 100,
  steps: 500,
}

function niceStep(rawStep: number, metric: AxisMetric) {
  const safeStep = Math.max(rawStep, minimumStep[metric])
  const exponent = Math.floor(Math.log10(safeStep))
  const magnitude = 10 ** exponent
  const fraction = safeStep / magnitude
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  let step = niceFraction * magnitude

  if (metric === 'weight' && rawStep >= 0.25) step = Math.max(1, step)
  if (metric === 'calories') step = Math.max(100, step)
  if (metric === 'steps') step = Math.max(500, step)
  return step
}

function roundToStep(value: number, step: number) {
  const precision = Math.max(0, Math.ceil(-Math.log10(step)) + 2)
  return Number(value.toFixed(precision))
}

export function calculateNiceAxis({
  min,
  max,
  targetTickCount = 4,
  metric,
}: {
  min: number
  max: number
  targetTickCount?: number
  metric: AxisMetric
}): NiceAxis {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 1, ticks: [0, 1] }

  const lower = Math.min(min, max)
  const upper = Math.max(min, max)
  const rawRange = upper - lower
  const safeTarget = Math.max(3, Math.min(5, Math.round(targetTickCount)))
  const step = niceStep(rawRange > 0 ? rawRange / (safeTarget - 1) : minimumStep[metric], metric)
  const padding = rawRange > 0 ? step * 0.35 : step
  let axisMin = Math.floor((lower - padding) / step) * step
  let axisMax = Math.ceil((upper + padding) / step) * step

  if (axisMin === axisMax) axisMax += step
  axisMin = roundToStep(Math.max(0, axisMin), step)
  axisMax = roundToStep(axisMax, step)

  const ticks: number[] = []
  for (let value = axisMin; value <= axisMax + step * 0.001; value += step) {
    ticks.push(roundToStep(value, step))
    if (ticks.length > 8) break
  }
  return { min: axisMin, max: axisMax, step, ticks }
}

export function formatAxisTick(value: number, metric: AxisMetric, step: number) {
  return value.toLocaleString('de-DE', {
    maximumFractionDigits: metric === 'weight' && step < 1 ? 1 : 0,
    minimumFractionDigits: metric === 'weight' && step < 1 ? 1 : 0,
  })
}
