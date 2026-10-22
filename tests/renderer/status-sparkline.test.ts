import { describe, expect, it } from "vitest";

import {
  MAX_SPARKLINE_POINTS,
  MIN_SPARKLINE_RANGE,
  SPARKLINE_HEIGHT,
  appendSparklineValue,
  sparklinePoints,
  sparklineToneClass,
} from "../../src/renderer/utils/status-sparkline";

function parsePoints(points: string): Array<{ x: number; y: number }> {
  return points.split(" ").map(pair => {
    const [x, y] = pair.split(",").map(Number);
    return { x: x!, y: y! };
  });
}

describe("状态栏迷你折线", () => {
  it("采样限制在 0–100，并只保留最近 24 个点", () => {
    const values: number[] = [];
    for (let index = 0; index < 30; index += 1) appendSparklineValue(values, index * 10 - 50);

    expect(values).toHaveLength(MAX_SPARKLINE_POINTS);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBe(100);
  });

  it("单个采样和稳定数据显示在中线，不会贴住顶部", () => {
    const middle = SPARKLINE_HEIGHT / 2;
    for (const points of [sparklinePoints([97]), sparklinePoints([97, 97, 97])]) {
      for (const { y } of parsePoints(points)) expect(y).toBeCloseTo(middle, 0);
    }
  });

  it("小幅波动按最小区间缩放，大幅波动占满高度", () => {
    const small = parsePoints(sparklinePoints([50, 52]));
    const large = parsePoints(sparklinePoints([10, 90]));
    const smallSpan = Math.abs(small[0]!.y - small[1]!.y);
    const largeSpan = Math.abs(large[0]!.y - large[1]!.y);

    expect(smallSpan).toBeLessThan(((SPARKLINE_HEIGHT - 2) * 2) / MIN_SPARKLINE_RANGE + 0.1);
    expect(largeSpan).toBeCloseTo(SPARKLINE_HEIGHT - 2, 0);
    expect(sparklinePoints(undefined)).toBe("");
  });

  it("按占用率给出安全、警告、危险三档样式", () => {
    expect(sparklineToneClass(80)).toBe("sparkline-safe");
    expect(sparklineToneClass(90)).toBe("sparkline-warn");
    expect(sparklineToneClass(99)).toBe("sparkline-danger");
  });
});
