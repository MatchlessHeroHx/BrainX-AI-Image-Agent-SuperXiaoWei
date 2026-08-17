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

const { __plannerTestHooks } = require("../src/lib/agent/planner.ts");
const { normalizePlannerOutput, repairPlannerOutput, buildOfflineUnavailableOutput } =
  __plannerTestHooks;
const {
  DEFAULT_AGENT_PROVIDER_ID,
  DEFAULT_AGENT_MODEL_ID,
  listUserSelectableAgentProviders,
} = require("../src/lib/ai/agent-models.ts");
const {
  getAgentHarnessAdapter,
  resolveAgentHarnessRuntime,
} = require("../src/lib/agent/harness/registry.ts");

// --- Architecture contract: provider-neutral harness, DeepSeek by default. ---
assert.equal(DEFAULT_AGENT_PROVIDER_ID, "deepseek");
assert.equal(DEFAULT_AGENT_MODEL_ID, "deepseek-v4-pro");
assert.equal(getAgentHarnessAdapter("deepseek").id, "deepseek");
assert.equal(getAgentHarnessAdapter("google-ai-studio").id, "google-ai-studio");

const defaultHarnessRuntime = resolveAgentHarnessRuntime({});
assert.equal(defaultHarnessRuntime.provider.id, "deepseek");
assert.equal(defaultHarnessRuntime.model.id, "deepseek-v4-pro");

const geminiHarnessRuntime = resolveAgentHarnessRuntime({
  providerId: "google-ai-studio",
  modelId: "gemini-3.7-flash",
});
assert.equal(geminiHarnessRuntime.provider.id, "google-ai-studio");
assert.equal(geminiHarnessRuntime.model.id, "gemini-3.7-flash");
assert.equal(geminiHarnessRuntime.model.capabilities.vision, true);
assert.equal(geminiHarnessRuntime.model.capabilities.promptCaching, true);

const userSelectableAgentModels = listUserSelectableAgentProviders().flatMap((provider) =>
  provider.models.map((model) => `${provider.id}/${model.id}`),
);
assert.deepEqual(userSelectableAgentModels.sort(), [
  "deepseek/deepseek-v4-pro",
  "google-ai-studio/gemini-3.7-flash",
]);
assert.equal(
  resolveAgentHarnessRuntime({
    providerId: "google-ai-studio",
    modelId: "gemini-3.5-flash",
  }).model.id,
  "gemini-3.5-flash",
  "A+ internal model remains resolvable without appearing in the user picker",
);

const plannerSource = fs.readFileSync(
  path.join(projectRoot, "src/lib/agent/planner.ts"),
  "utf8",
);
assert.equal(
  plannerSource.includes("generateStructuredJsonWithDeepSeek") ||
    plannerSource.includes("generateStructuredJsonWithGemini"),
  false,
  "planner must call the Agent harness adapter instead of provider clients",
);
assert.ok(
  plannerSource.includes("agentRuntime.adapter.generateStructuredJson"),
  "planner must execute generic planning through the harness adapter contract",
);
assert.ok(
  plannerSource.includes("agentProviderId: params.agentProviderId") &&
    plannerSource.includes("agentModelId: params.agentModelId"),
  "planner must forward the user-selected Agent runtime into harness resolution",
);

const now = "2026-05-07T00:00:00.000Z";

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

const makeAsset = (overrides = {}) => ({
  id: "generated_1",
  kind: "generated",
  label: "上一张角色设定图",
  alt: "",
  focus: "角色设定图，暖色背景",
  url: "/generated_1.png",
  mimeType: "image/png",
  width: 1024,
  height: 1024,
  createdAt: now,
  sourceMessageId: "msg_prev",
  ...overrides,
});

const makeParams = (overrides = {}) => ({
  conversation: makeConversation(),
  userText: "",
  uploadedAssets: [],
  explicitReferenceAssetIds: [],
  inferredReferenceAssetIds: [],
  ...overrides,
});

const NEUTRAL_DEFAULT = buildOfflineUnavailableOutput();

// --- Prompt-layer contract: system.md owns the Agent's general voice and
// conversational behavior. Runtime/schema layers may enforce structure and
// persistence, but must not carry a second persona or reply-style playbook. ----
{
  const runtimePromptCopy = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "prompts/image-agent/runtime-copy.json"), "utf8"),
  );
  const assistantReplyDescription = runtimePromptCopy.schemaDescriptions.assistantReply;
  assert.equal(
    /concise|简短|简洁/.test(assistantReplyDescription),
    false,
    "assistantReply schema description must not globally bias replies toward concise answers",
  );
  assert.match(
    assistantReplyDescription,
    /Follow the system prompt for persona, tone, wording, length, and conversational behavior/,
    "assistantReply schema description must defer general expression to system.md",
  );

  const runtimeInstructions = runtimePromptCopy.plannerRuntimeInstructions.join("\n");
  assert.match(
    runtimeInstructions,
    /system prompt is the sole authority for general persona and conversational voice/,
    "runtime instructions must explicitly preserve system.md authority",
  );
  assert.match(
    runtimeInstructions,
    /Skills may constrain scene-specific reasoning and deliverables/,
    "runtime instructions must preserve scene-specific Skill authority",
  );
  for (const duplicatedStyleRule of [
    "designer friend talking to a friend",
    "customer-service register",
    "cutesy catchphrases",
    "common response frame",
    "telegraphic clauses",
  ]) {
    assert.equal(
      runtimeInstructions.includes(duplicatedStyleRule),
      false,
      `runtime instructions must not duplicate reply-style rule "${duplicatedStyleRule}"`,
    );
  }
  assert.ok(
    runtimePromptCopy.fallbackSystemPrompt.length <= 4,
    "fallback system prompt must stay a minimal emergency contract, not a stale copy of system.md",
  );

  const systemPrompt = fs.readFileSync(
    path.join(projectRoot, "prompts/image-agent/system.md"),
    "utf8",
  );
  assert.ok(
    systemPrompt.includes("You are chat-first") &&
      systemPrompt.includes("How you talk") &&
      systemPrompt.includes("They ask to learn / compare / break something down"),
    "system prompt must remain the canonical persona and reply-style source",
  );
  const combinedPromptText = `${systemPrompt}\n${JSON.stringify(runtimePromptCopy)}`;
  const specialCaseTerms = [
    "\u5343\u79a7\u5e74\u68a6\u6838",
    ["Y", "2K"].join(""),
    ["Dream", "core"].join(""),
  ];
  for (const term of specialCaseTerms) {
    assert.equal(
      combinedPromptText.includes(term),
      false,
      `prompt controls must not rely on special-case anchor "${term}"`,
    );
  }
}

const previousAsset = makeAsset();

// repairPlannerOutput: an LLM edit that resolved to ZERO valid references has
// nothing to act on, so it must downgrade to clarify rather than generate blind.
const badEdit = {
  assistantReply: "我会直接改成蓝色。",
  nextAction: "edit",
  shouldGenerate: true,
  needsClarification: false,
  generation: {
    mode: "edit",
    prompt: "Change the referenced image color to blue.",
    referenceAssetIds: [],
    inheritConversationContext: true,
    outputCount: 1,
  },
};
const repaired = repairPlannerOutput(badEdit);
assert.equal(repaired.nextAction, "clarify", "edit without any valid reference downgrades to clarify");
assert.equal(repaired.shouldGenerate, false);

// normalizePlannerOutput: nextAction drives generation.mode; a self-labeled
// "edit" turn carrying a generate-mode block is normalized so mode follows the
// action, with the (validated) reference preserved.
const normalized = normalizePlannerOutput(
  {
    assistantReply: "我会改上一张。",
    nextAction: "edit",
    shouldGenerate: true,
    needsClarification: false,
    generation: {
      mode: "generate",
      prompt: "Change the background to dusk while preserving the subject.",
      referenceAssetIds: [previousAsset.id],
      inheritConversationContext: true,
      outputCount: 1,
    },
  },
  NEUTRAL_DEFAULT,
  new Set([previousAsset.id]),
);
assert.equal(normalized.generation?.mode, "edit", "generation mode follows nextAction");
assert.deepEqual(
  normalized.generation?.referenceAssetIds,
  [previousAsset.id],
  "validated reference id is preserved",
);

// Reference resolution is the Agent's job now, not a regex's. The resolver is a
// structural pass-through: it must NOT infer references from message text.
const { resolveReferenceContext } = require("../src/lib/server/reference-resolver.ts");
const makeNoisyAsset = (id, label, focus) => ({
  id,
  kind: "generated",
  label,
  alt: "",
  focus,
  url: `/media/test/${id}.png`,
  mimeType: "image/png",
  width: 100,
  height: 100,
  createdAt: now,
});

// Whatever the user types, the resolver must never infer an asset from the
// text — not noisy functional words, and not even genuine pronouns like
// "上一张" or "我上传的那张". That judgment now belongs to the Agent. The
// resolver only echoes back references the caller already resolved structurally.
const resolverNoInferenceCases = [
  "你刚刚是用什么模型生成的图片",
  "根据这个键盘，来生成一个使用场景图",
  "来整合成一个大海报",
  "把上一张色调调暖一点",
  "改一下我上传的那张",
  "再把你刚生成的图片里面的桌面上，增加一个小汽车",
];
const resolverAssets = [
  { ...makeNoisyAsset("up_a", "用户上传的产品图", "手持风扇"), kind: "upload" },
  makeNoisyAsset("gen_a", "生成结果 v1", "紫色风扇"),
];
for (const text of resolverNoInferenceCases) {
  const resolved = resolveReferenceContext({
    conversation: makeConversation({ assets: resolverAssets }),
    userText: text,
    uploadedAssets: [],
    explicitReferenceAssetIds: [],
  });
  assert.deepEqual(
    resolved.inferredAssetIds,
    [],
    `resolver must not infer from text "${text}", got ${JSON.stringify(resolved.inferredAssetIds)}`,
  );
  assert.equal(resolved.hardReset, false, `resolver must not detect hardReset from "${text}"`);
  assert.equal(resolved.resolutionNote, undefined, `resolver must not annotate "${text}"`);
}

// The resolver passes caller-resolved explicit references straight through.
const passthroughResolved = resolveReferenceContext({
  conversation: makeConversation({ assets: resolverAssets }),
  userText: "改这张",
  uploadedAssets: [],
  explicitReferenceAssetIds: ["gen_a"],
});
assert.deepEqual(
  passthroughResolved.assetIds,
  ["gen_a"],
  "explicit references must pass through unchanged",
);
assert.deepEqual(
  passthroughResolved.inferredAssetIds,
  [],
  "explicit references are not counted as inferred",
);

// Screenshot regression: "再把你刚生成的图片里加个小汽车" — the LLM (which sees the
// full catalog) picks the latest generated image and emits an `edit`. The repair
// gate must HONOR that choice on the strength of the validated reference id
// alone, not veto it because the colloquial phrasing isn't in any keyword list.
{
  const llmEditOnGenerated = {
    assistantReply: "行，我在你刚那张的桌面上加一辆小汽车，别的都不动。",
    nextAction: "edit",
    shouldGenerate: true,
    needsClarification: false,
    generation: {
      mode: "edit",
      prompt: "Add a small toy car on the desk in the referenced image. Modify ONLY that; keep everything else pixel-stable.",
      referenceAssetIds: ["gen_a"],
      inheritConversationContext: true,
      outputCount: 1,
    },
  };
  const repairedEdit = repairPlannerOutput(llmEditOnGenerated);
  assert.equal(
    repairedEdit.nextAction,
    "edit",
    "LLM edit with a valid reference id must NOT be downgraded to clarify on unfamiliar phrasing",
  );
  assert.equal(repairedEdit.shouldGenerate, true);
  assert.deepEqual(repairedEdit.generation?.referenceAssetIds, ["gen_a"]);
}


const { __messageServiceTestHooks } = require("../src/lib/server/message-service.ts");
const { ensureUploadObservations } = __messageServiceTestHooks;

// --- Structural contract: discuss/clarify never carry a generation payload ---
// normalizePlannerOutput is the gate that runs on raw LLM output: a discuss/
// clarify action must come out with shouldGenerate=false and generation=null,
// even if the model contradicted itself by attaching a generation block.
{
  const normalizedDiscuss = normalizePlannerOutput(
    {
      assistantReply: "我们先聊聊方向。",
      nextAction: "discuss",
      shouldGenerate: true, // self-contradictory; the gate must zero it out
      needsClarification: false,
      generation: {
        mode: "generate",
        prompt: "irrelevant",
        referenceAssetIds: [],
        inheritConversationContext: true,
        outputCount: 1,
      },
    },
    NEUTRAL_DEFAULT,
    new Set(),
  );
  assert.equal(normalizedDiscuss.nextAction, "discuss", "discuss action preserved");
  assert.equal(normalizedDiscuss.shouldGenerate, false, "discuss must not generate");
  assert.equal(normalizedDiscuss.generation, null, "discuss must drop generation payload");
}

// --- Structural contract: hallucinated reference IDs are filtered out --------
{
  const normalizedRefs = normalizePlannerOutput(
    {
      assistantReply: "我参考那张图。",
      nextAction: "reference_generate",
      shouldGenerate: true,
      needsClarification: false,
      generation: {
        mode: "reference_generate",
        prompt: "A new poster inspired by the referenced image.",
        referenceAssetIds: ["does_not_exist", "ghost_id"],
        inheritConversationContext: true,
        outputCount: 1,
      },
    },
    NEUTRAL_DEFAULT,
    new Set(["real_asset"]),
  );
assert.equal(
  (normalizedRefs.generation?.referenceAssetIds ?? []).some(
    (id) => id === "does_not_exist" || id === "ghost_id",
  ),
  false,
  "non-existent reference IDs must be filtered out",
);
}

// --- Structural contract: generation.tasks represents distinct prompts while
// outputCount remains same-prompt samples per task. --------------------------
{
  const normalizedTasks = normalizePlannerOutput(
    {
      assistantReply: "我按三个方案分别做图，每个方案一张。",
      nextAction: "generate",
      shouldGenerate: true,
      needsClarification: false,
      generation: {
        mode: "generate",
        prompt: "Plan A prompt.",
        referenceAssetIds: ["real_asset"],
        inheritConversationContext: true,
        outputCount: 1,
        tasks: [
          {
            label: "方案 A",
            prompt: "Plan A prompt.",
            referenceAssetIds: ["real_asset"],
          },
          {
            label: "方案 B",
            prompt: "Plan B prompt.",
            referenceAssetIds: ["ghost_id"],
          },
          {
            label: "方案 C",
            prompt: "Plan C prompt.",
            inheritConversationContext: false,
          },
        ],
      },
    },
    NEUTRAL_DEFAULT,
    new Set(["real_asset"]),
  );
  assert.equal(normalizedTasks.generation?.outputCount, 1);
  assert.equal(normalizedTasks.generation?.tasks?.length, 3);
  assert.equal(normalizedTasks.generation?.tasks?.[1].prompt, "Plan B prompt.");
  assert.deepEqual(
    normalizedTasks.generation?.tasks?.[1].referenceAssetIds,
    ["real_asset"],
    "task with invalid references falls back to parent references",
  );
  assert.equal(
    normalizedTasks.generation?.tasks?.[2].inheritConversationContext,
    false,
    "task-level inheritConversationContext is preserved",
  );
}

// --- Structural contract: skill routing fields are optional, validated, and
// preserved only when the selected skill id exists in the loaded candidate set.
{
  const normalizedSkill = normalizePlannerOutput(
    {
      assistantReply: "可以，我们先把 A+ 的 7 个模块结构定下来。",
      nextAction: "discuss",
      selectedSkillId: "ecommerce-product-image",
      skillConfidence: "medium",
      skillBrief: {
        productCategory: "3C",
        shotType: "A+ 套图",
        openQuestions: ["核心卖点是什么？"],
        nested: { shouldBeDropped: true },
      },
      shouldGenerate: false,
      needsClarification: false,
      generation: null,
    },
    NEUTRAL_DEFAULT,
    new Set(),
    new Set(["ecommerce-product-image"]),
  );
  assert.equal(normalizedSkill.selectedSkillId, "ecommerce-product-image");
  assert.equal(normalizedSkill.skillConfidence, "medium");
  assert.deepEqual(normalizedSkill.skillBrief?.openQuestions, ["核心卖点是什么？"]);
  assert.equal(
    Object.prototype.hasOwnProperty.call(normalizedSkill.skillBrief ?? {}, "nested"),
    false,
    "nested skillBrief values must be dropped",
  );

  const normalizedUnknownSkill = normalizePlannerOutput(
    {
      assistantReply: "我选了一个不存在的 skill。",
      nextAction: "discuss",
      selectedSkillId: "ghost-skill",
      skillConfidence: "high",
      shouldGenerate: false,
      needsClarification: false,
      generation: null,
    },
    NEUTRAL_DEFAULT,
    new Set(),
    new Set(["ecommerce-product-image"]),
  );
  assert.equal(
    normalizedUnknownSkill.selectedSkillId,
    undefined,
    "unknown selectedSkillId must be cleared",
  );
}

// --- Structural contract: discuss-flavored words no longer override a request -
// Previously a "讨论/分析" keyword forced the LLM's generate decision back to
// discuss. That override is gone: repair must respect a valid generate output
// even when the text contains discussion-flavored words.
{
  const generateWithDiscussWord = {
    assistantReply: "我先画一版你看看。",
    nextAction: "generate",
    shouldGenerate: true,
    needsClarification: false,
    generation: {
      mode: "generate",
      prompt: "A cyberpunk city poster at night, neon reflections on wet asphalt.",
      referenceAssetIds: [],
      inheritConversationContext: true,
      outputCount: 1,
    },
  };
  const repaired = repairPlannerOutput(generateWithDiscussWord);
  assert.equal(
    repaired.nextAction,
    "generate",
    "discuss-flavored words must NOT override a valid LLM generate decision",
  );
  assert.equal(repaired.shouldGenerate, true);
}

// Existing multi-image behavior is preserved: N same-direction variants stay as
// one prompt with outputCount=N, not multiple distinct tasks.
{
  const samePromptVariants = normalizePlannerOutput(
    {
      assistantReply: "我按同一个方向抽三张给你挑。",
      nextAction: "generate",
      shouldGenerate: true,
      needsClarification: false,
      generation: {
        mode: "generate",
        prompt: "One coherent poster direction, rendered as multiple samples.",
        referenceAssetIds: [],
        inheritConversationContext: true,
        outputCount: 3,
      },
    },
    NEUTRAL_DEFAULT,
    new Set(),
  );
  assert.equal(samePromptVariants.generation?.outputCount, 3);
  assert.equal(
    samePromptVariants.generation?.tasks,
    undefined,
    "same-prompt variants must not be converted into distinct tasks",
  );
}

// --- Offline contract: when the LLM is unavailable we do NOT route with regex.
// buildOfflineUnavailableOutput must produce a non-generating notice that tells
// the user we're temporarily unreachable — never a guessed action or image.
{
  const offline = buildOfflineUnavailableOutput();
  assert.equal(offline.shouldGenerate, false, "offline must never generate");
  assert.equal(offline.generation, null, "offline carries no generation payload");
  assert.equal(offline.nextAction, "clarify", "offline is a non-committal clarify");
  assert.ok(
    typeof offline.assistantReply === "string" && offline.assistantReply.trim().length > 0,
    "offline reply must be a non-empty user-facing notice",
  );
}

// --- ensureUploadObservations: no-op when observations already exist, and it
// skips SVG placeholders (no real pixels). No API key in the test env, so this
// must resolve without attempting a network call. -----------------------------
(async () => {
  const alreadyObserved = makeAsset({
    id: "obs_1",
    kind: "upload",
    observations: {
      mainSubject: "x",
      style: "y",
      dominantColors: [],
      containsText: false,
      hasLogo: false,
      capturedAt: now,
    },
  });
  const svgPlaceholder = makeAsset({
    id: "svg_1",
    kind: "generated",
    mimeType: "image/svg+xml",
    observations: undefined,
  });
  await ensureUploadObservations([alreadyObserved, svgPlaceholder]);
  assert.equal(
    alreadyObserved.observations.mainSubject,
    "x",
    "existing observations must be left untouched",
  );
  assert.equal(svgPlaceholder.observations, undefined, "SVG placeholder must be skipped");

  console.log("planner regression tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
