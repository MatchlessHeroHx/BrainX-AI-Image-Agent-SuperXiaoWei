/* eslint-disable @typescript-eslint/no-var-requires, no-console */
// Offline-contract suite. Production sends every turn to the LLM planner, which
// owns intent classification (discuss / clarify / generate / edit / etc.) per
// prompts/image-agent/system.md. There is NO regex routing anymore — not even
// as an offline fallback. When the LLM is unavailable (no provider configured,
// or the call fails) the planner returns a single honest "unavailable" notice
// and generates nothing. This suite proves that across many kinds of turns,
// `planNextStep` never routes, never generates, and never resurrects the old
// "我这边现在没有能直接描述的图片" dead-end while offline.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const originalResolveFilename = Module._resolveFilename;

const resolveAliasPath = (request) => {
  if (!request.startsWith("@/")) {
    return null;
  }
  const basePath = path.join(projectRoot, "src", request.slice(2));
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.json`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
  ];
  return (
    candidates.find(
      (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
    ) ?? null
  );
};

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  const aliasPath = resolveAliasPath(request);
  if (aliasPath) {
    return aliasPath;
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      resolveJsonModule: true,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  module._compile(output, filename);
};

const { getGeminiApiKey } = require("../src/lib/ai/google-ai.ts");
const { getDeepSeekApiKey } = require("../src/lib/ai/deepseek-ai.ts");

// This suite must run with NO agent provider configured, so planNextStep takes
// the offline branch deterministically. A dev machine may have a key in env or
// an API-Key file; if so, we can't force offline here, so skip rather than make
// a real network call or assert against a live LLM.
delete process.env.GOOGLE_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.DEEPSEEK_API_KEY;
delete process.env.AGENT_PROVIDER;

if (getGeminiApiKey() || getDeepSeekApiKey()) {
  console.log(
    "Skipping offline-contract suite: an agent API key is configured " +
      "(env or key file). Offline path can only be verified without a key.",
  );
  process.exit(0);
}

const { planNextStep } = require("../src/lib/agent/planner.ts");
const { IMAGE_AGENT_PROMPTS } = require("../src/lib/agent/prompt-config.ts");

const OFFLINE_REPLY = IMAGE_AGENT_PROMPTS.fallbackAssistantReplies.offlineUnavailable;
const DEAD_END_TEXT = "我这边现在没有能直接描述的图片";

const now = "2026-06-12T00:00:00.000Z";

const makeAsset = (overrides = {}) => ({
  id: "generated_1",
  kind: "generated",
  label: "上一张图",
  alt: "",
  focus: "场景图",
  url: "/generated_1.png",
  mimeType: "image/png",
  width: 1024,
  height: 1024,
  createdAt: now,
  sourceMessageId: "msg_prev",
  ...overrides,
});

const makeConversation = ({ assets = [], messages = [] } = {}) => ({
  id: "conv_test",
  title: "新会话",
  subtitle: "",
  carryHint: "",
  createdAt: now,
  updatedAt: now,
  messages,
  assets,
  jobs: [],
});

// A spread of turn types that, WITH an LLM, would route to discuss / clarify /
// generate / edit / reference_generate / reframe. Offline, every one of them
// must collapse to the same non-generating notice.
const priorAsset = makeAsset();
const scenarios = [
  { name: "greeting", userText: "你好" },
  { name: "concept question", userText: "你觉得后室是一种怎样的风格" },
  { name: "prompt-writing", userText: "写一个体现赛博朋克风格的提示词" },
  { name: "clear generate", userText: "生成一张赛博朋克都市夜景" },
  { name: "vague aesthetic", userText: "做点有氛围感的" },
  {
    name: "edit on prior image",
    userText: "把上一张的背景换成黄昏",
    conversation: makeConversation({ assets: [priorAsset] }),
  },
  {
    name: "colloquial reference edit (screenshot bug)",
    userText: "再把你刚生成的图片里面的桌面上，增加一个小汽车",
    conversation: makeConversation({ assets: [priorAsset] }),
  },
  { name: "hard reset", userText: "前面的都不要了，重新开始，画一只狐狸" },
];

(async () => {
  let passed = 0;
  for (const scenario of scenarios) {
    const plan = await planNextStep({
      conversation: scenario.conversation ?? makeConversation(),
      userText: scenario.userText,
      uploadedAssets: [],
      explicitReferenceAssetIds: [],
      inferredReferenceAssetIds: [],
    });

    assert.equal(
      plan.shouldGenerate,
      false,
      `${scenario.name}: offline must not generate`,
    );
    assert.equal(plan.generation, null, `${scenario.name}: offline carries no generation`);
    assert.equal(
      plan.assistantReply,
      OFFLINE_REPLY,
      `${scenario.name}: offline must return the unavailable notice verbatim`,
    );
    assert.ok(
      !plan.assistantReply.includes(DEAD_END_TEXT),
      `${scenario.name}: must never resurrect the old dead-end reply`,
    );
    console.log(`  ✓ ${scenario.name}  [offline → unavailable notice, no generation]`);
    passed += 1;
  }

  console.log(`\nAll ${passed} offline-contract scenarios passed.`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
