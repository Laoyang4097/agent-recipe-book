// 解题配方库 · ESLint 平铺配置（ESLint 9 flat config）
//
// 设计目标：只拦「真会出 bug」的写法（未定义变量、未使用变量），
// 风格统一交给 prettier 处理。与项目 CI 哲学一致：韧性优先，门禁不阻塞迭代。
import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    rules: {
      // 未使用变量只警告不给错误：本地探测脚本常留临时变量，不卡 CI。
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // 派生物 / 生成目录不扫：它们由真源复现，不是人工维护的代码。
    ignores: [
      "node_modules/**",
      "recipes/**",
      "llms.txt",
      "api/experiences.json",
      "assets/**",
      "docs/**",
    ],
  },
];
