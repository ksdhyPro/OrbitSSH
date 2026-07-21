import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAiReasoningEffort,
  normalizeAiReasoningParameter,
  normalizeAiReasoningValues,
  setAiReasoningRequestValue,
} from "../../dist-electron/shared/ai-reasoning.js";

test("思考参数支持顶层和嵌套路径", () => {
  const effortBody = {};
  const toggleBody = {};

  assert.equal(
    setAiReasoningRequestValue(effortBody, "reasoning_effort", "high"),
    true,
  );
  assert.deepEqual(effortBody, { reasoning_effort: "high" });

  assert.equal(
    setAiReasoningRequestValue(toggleBody, "thinking.type", "enabled"),
    true,
  );
  assert.deepEqual(toggleBody, { thinking: { type: "enabled" } });
});

test("思考参数不会覆盖请求保留字段或原型链", () => {
  assert.equal(normalizeAiReasoningParameter("messages"), "");
  assert.equal(normalizeAiReasoningParameter("__proto__.polluted"), "");
  assert.equal(normalizeAiReasoningParameter("thinking.constructor"), "");
  assert.equal(normalizeAiReasoningParameter("thinking.type"), "thinking.type");
});

test("思考强度列表会去空、去重并保持用户顺序", () => {
  assert.deepEqual(
    normalizeAiReasoningValues([" low ", "none", "OFF", "high", "low", "", 1]),
    ["low", "high"],
  );
  assert.equal(normalizeAiReasoningEffort("none"), "medium");
  assert.equal(normalizeAiReasoningEffort(" xhigh "), "xhigh");
});
