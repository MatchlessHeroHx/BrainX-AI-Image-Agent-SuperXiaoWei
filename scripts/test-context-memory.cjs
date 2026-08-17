/* eslint-disable @typescript-eslint/no-var-requires, no-console */
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
  ];
  return candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  ) ?? null;
};

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  const aliasPath = resolveAliasPath(request);
  return aliasPath
    ? aliasPath
    : originalResolveFilename.call(this, request, parent, isMain, options);
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
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  module._compile(output, filename);
};

const {
  buildAssetSemanticSummary,
  mergeUserPreferenceMemories,
  updateConversationMemory,
} = require("../src/lib/server/context-memory.ts");
const {
  buildConversationContextSnapshot,
  selectRelevantAssetsForContext,
} = require("../src/lib/server/conversation-context.ts");
const { __plannerTestHooks } = require("../src/lib/agent/planner.ts");

const now = "2026-08-14T08:00:00.000Z";

const makeConversation = (overrides = {}) => ({
  id: "conv_memory",
  title: "新会话",
  subtitle: "",
  carryHint: "",
  createdAt: now,
  updatedAt: now,
  messages: [],
  assets: [],
  jobs: [],
  ...overrides,
});

const makeMessage = (index) => ({
  id: `msg_${index}`,
  role: index % 2 === 0 ? "user" : "assistant",
  text: `memory-message-${index}`,
  createdAt: new Date(Date.parse(now) + index * 1000).toISOString(),
  mode: "discuss",
  attachmentIds: [],
});

const makeAsset = (index, overrides = {}) => ({
  id: `asset_${index}`,
  kind: index % 3 === 0 ? "upload" : "generated",
  label: `历史图片 ${index}`,
  alt: "",
  focus: `普通画面 ${index}`,
  url: `/media/test/asset_${index}.png`,
  mimeType: "image/png",
  width: 1000,
  height: 1000,
  createdAt: new Date(Date.parse(now) + index * 1000).toISOString(),
  semanticSummary: {
    summary: `普通灰色画面 ${index}`,
    referenceDimensions: ["构图"],
    editableRegions: ["背景"],
    updatedAt: now,
  },
  ...overrides,
});

{
  const merged = mergeUserPreferenceMemories({
    current: [
      { value: "偏写实", updatedAt: "2026-08-10T00:00:00.000Z" },
      { value: "商品图不加文字", updatedAt: "2026-08-11T00:00:00.000Z" },
    ],
    learned: ["偏写实", "不喜欢客服语气"],
    removed: ["商品图不加文字"],
    updatedAt: now,
    sourceConversationId: "conv_new",
  });
  assert.deepEqual(
    merged.map((entry) => entry.value),
    ["偏写实", "不喜欢客服语气"],
    "durable preferences are deduplicated, removable, and shared independently of a conversation",
  );
}

{
  const conversation = makeConversation({ messages: [makeMessage(0), makeMessage(1)] });
  const store = { version: 1, conversations: [conversation] };
  updateConversationMemory({
    store,
    conversation,
    updatedAt: now,
    sourceMessageId: "msg_planned_assistant",
    planner: {
      assistantReply: "我会继续保持写实风格。",
      nextAction: "discuss",
      shouldGenerate: false,
      needsClarification: false,
      generation: null,
      memoryUpdate: {
        conversationSummary: "用户正在制作一组写实商品图，当前等待选择主图或场景图。",
        learnedUserPreferences: ["偏写实"],
      },
    },
  });
  assert.equal(
    conversation.summary?.text,
    "用户正在制作一组写实商品图，当前等待选择主图或场景图。",
  );
  assert.equal(
    conversation.summary?.summarizedMessageCount,
    3,
    "summary includes the assistant message that is appended immediately after planning",
  );
  assert.equal(store.userPreferences[0]?.value, "偏写实");
  assert.equal(conversation.agentState, undefined);
}

{
  const observation = {
    mainSubject: "a brushed aluminum power bank",
    style: "cool studio product photography",
    dominantColors: ["silver", "charcoal"],
    containsText: false,
    hasLogo: false,
    compositionHint: "center-weighted 45-degree view",
    referenceDimensions: ["metal material", "cool rim lighting"],
    editableRegions: ["product body", "background"],
    capturedAt: now,
  };
  const semantic = buildAssetSemanticSummary(makeAsset(0), observation);
  assert.ok(semantic.summary.includes("brushed aluminum power bank"));
  assert.deepEqual(semantic.referenceDimensions, ["metal material", "cool rim lighting"]);
  assert.deepEqual(semantic.editableRegions, ["product body", "background"]);
}

{
  const assets = Array.from({ length: 15 }, (_, index) => makeAsset(index));
  assets[1] = makeAsset(1, {
    label: "琥珀咖啡参考",
    semanticSummary: {
      summary: "琥珀色咖啡馆，暖侧光，拱形构图",
      palette: ["琥珀色", "深棕"],
      referenceDimensions: ["琥珀配色", "暖侧光", "拱形构图"],
      editableRegions: ["背景", "桌面"],
      updatedAt: now,
    },
  });
  const conversation = makeConversation({
    assets,
    summary: {
      text: "已确定要延续暖色咖啡品牌方向。",
      summarizedMessageCount: 0,
      updatedAt: now,
    },
  });
  const relevant = selectRelevantAssetsForContext(conversation, {
    userText: "继续用琥珀配色和暖侧光的那张参考",
    assetLimit: 10,
  });
  assert.ok(
    relevant.some((asset) => asset.id === "asset_1"),
    "an older semantically relevant asset survives long-session catalog compression",
  );
  assert.equal(relevant.length, 10);

  const snapshot = buildConversationContextSnapshot(conversation, {
    userText: "继续用琥珀配色和暖侧光的那张参考",
    userPreferences: ["不喜欢太客服", "偏写实"],
    assetLimit: 10,
  });
  assert.equal(snapshot.conversationSummary, "已确定要延续暖色咖啡品牌方向。");
  assert.ok(snapshot.preferenceSummary.includes("Durable cross-conversation preferences"));
  assert.ok(snapshot.preferenceSummary.includes("不喜欢太客服"));
  assert.ok(snapshot.assetCatalog.includes("semantic:"));
  assert.ok(snapshot.assetCatalog.includes("reusable:"));
  assert.ok(snapshot.assetCatalog.includes("5 older or less relevant assets omitted"));
}

{
  const messages = Array.from({ length: 12 }, (_, index) => makeMessage(index));
  const context = __plannerTestHooks.buildPlannerContextText({
    conversation: makeConversation({
      messages,
      summary: {
        text: "前十条消息已经被压缩，当前目标是继续完成品牌海报。",
        summarizedMessageCount: 10,
        updatedAt: now,
      },
    }),
    userText: "继续",
    uploadedAssets: [],
    explicitReferenceAssetIds: [],
    inferredReferenceAssetIds: [],
    candidateSkills: [],
    userPreferences: ["偏写实"],
  });
  assert.ok(context.includes("Persistent conversation summary"));
  assert.ok(context.includes("memoryUpdate.conversationSummary"));
  assert.ok(context.includes("前十条消息已经被压缩"));
  assert.equal(context.includes("memory-message-2"), false);
  assert.ok(context.includes("memory-message-10"));
  assert.ok(context.includes("memory-message-11"));
}

{
  const normalized = __plannerTestHooks.normalizePlannerOutput(
    {
      assistantReply: "继续讨论。",
      nextAction: "discuss",
      shouldGenerate: false,
      needsClarification: false,
      generation: null,
      memoryUpdate: {
        conversationSummary: `  当前目标  ${"x".repeat(2_000)}  `,
        learnedUserPreferences: ["偏写实", "偏写实", { unsafe: true }],
      },
    },
    {
      assistantReply: "fallback",
      nextAction: "clarify",
      shouldGenerate: false,
      needsClarification: true,
      generation: null,
    },
    new Set(),
    new Set(),
  );
  assert.ok(normalized.memoryUpdate?.conversationSummary.length <= 1_600);
  assert.deepEqual(normalized.memoryUpdate?.learnedUserPreferences, ["偏写实"]);
}

console.log("context memory tests passed");
