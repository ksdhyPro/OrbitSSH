// 状态栏迷你折线：表达近期趋势而非绝对刻度。模板目前暂时隐藏，绘制逻辑保留在这里便于恢复。

export const MAX_SPARKLINE_POINTS = 24;
export const SPARKLINE_WIDTH = 38;
export const SPARKLINE_HEIGHT = 12;
const SPARKLINE_PADDING = 1;
// 最小显示区间避免稳定数据被夸大成剧烈波动。
export const MIN_SPARKLINE_RANGE = 12;

/** 追加一个 0–100 的采样值，只保留最近 MAX_SPARKLINE_POINTS 个。 */
export function appendSparklineValue(values: number[], value: number): void {
  values.push(Math.min(100, Math.max(0, value)));
  if (values.length > MAX_SPARKLINE_POINTS) {
    values.splice(0, values.length - MAX_SPARKLINE_POINTS);
  }
}

export function sparklineToneClass(percent: number): string {
  if (percent <= 80) return "sparkline-safe";
  if (percent <= 95) return "sparkline-warn";
  return "sparkline-danger";
}

/** 按近期数据范围缩放，稳定数据保持在中线附近，返回 SVG polyline 的 points。 */
export function sparklinePoints(values: number[] | undefined): string {
  if (!values?.length) return "";

  const drawableWidth = SPARKLINE_WIDTH - SPARKLINE_PADDING * 2;
  const drawableHeight = SPARKLINE_HEIGHT - SPARKLINE_PADDING * 2;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const midpoint = (minimum + maximum) / 2;
  const visibleRange = Math.max(maximum - minimum, MIN_SPARKLINE_RANGE);
  const upperBound = midpoint + visibleRange / 2;
  const toY = (value: number): number =>
    SPARKLINE_PADDING + ((upperBound - value) / visibleRange) * drawableHeight;

  // 首次或稳定采样显示在中线，避免高占用率让折线长期贴住顶部。
  if (values.length === 1) {
    const y = toY(values[0]!);
    return `${SPARKLINE_PADDING},${y.toFixed(1)} ${SPARKLINE_WIDTH - SPARKLINE_PADDING},${y.toFixed(1)}`;
  }

  const intervalCount = Math.max(values.length - 1, 1);
  return values
    .map((value, index) => {
      const x = SPARKLINE_PADDING + (index / intervalCount) * drawableWidth;
      return `${x.toFixed(1)},${toY(value).toFixed(1)}`;
    })
    .join(" ");
}
