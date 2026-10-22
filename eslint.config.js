import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-electron/**",
      "release/**",
      "build/**",
      "packaging/**",
      "coverage/**",
      "node_modules/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    files: ["src/main/**", "src/mcp/**", "src/preload/**", "scripts/**", "tests/**", "*.config.*"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["src/renderer/**", "tests/renderer/**"],
    languageOptions: { globals: globals.browser },
  },
  {
    // TypeScript 编译器已经检查未定义的标识符，no-undef 会误报 DOM 类型（如 ScrollBehavior）。
    files: ["**/*.ts", "**/*.cts", "**/*.vue"],
    rules: { "no-undef": "off" },
  },
  {
    files: ["scripts/**"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    rules: {
      // 删除等危险操作统一使用应用内确认弹窗，原生 confirm 会阻塞渲染进程且无法统一样式。
      "no-restricted-globals": [
        "error",
        {
          name: "confirm",
          message: "请使用应用内确认弹窗（requestConfirm / DeleteConfirmDialog）。",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "window",
          property: "confirm",
          message: "请使用应用内确认弹窗（requestConfirm / DeleteConfirmDialog）。",
        },
      ],
      // 表单对象是父级 Store 持有的响应式对象，子组件按设计直接编辑其字段，只禁止整体重新赋值。
      "vue/no-mutating-props": ["error", { shallowOnly: true }],
      // AppSelect / AppSwitch 等组件把 ariaLabel 声明为必填 prop，写成 aria-label 会被当作原生属性导致类型检查失败。
      "vue/attribute-hyphenation": ["warn", "always", { ignore: ["ariaLabel"] }],
      // TypeScript 可选 prop 不需要默认值。
      "vue/require-default-prop": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  prettier,
);
