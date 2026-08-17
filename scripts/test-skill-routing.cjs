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

const {
  listSkills,
  selectCandidateSkills,
  selectRuntimeResourcesForPlanner,
} = require("../src/lib/agent/skill-registry.ts");
const { planNextStep, __plannerTestHooks } = require("../src/lib/agent/planner.ts");
const { __messageServiceTestHooks } = require("../src/lib/server/message-service.ts");
const {
  buildPlannerContextText,
  normalizePlannerOutput,
  resolvePlannerAgentRuntime,
  buildAPlusRuntimeInputText,
  buildAPlusRuntimePlannerOutput,
  buildAPlusBriefFormPlannerOutput,
  selectPrimaryAPlusRuntimeResource,
  planWithCleanAPlusRuntime,
} = __plannerTestHooks;
const {
  buildAPlusBriefFormSpec,
  captureAPlusArtifacts,
  isAPlusBriefFormPlanner,
  parseAPlusBriefSubmission,
  selectReferenceAssets,
} = __messageServiceTestHooks;

const now = "2026-07-06T00:00:00.000Z";

const makeConversation = (overrides = {}) => ({
  id: "conv_skill_test",
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

const ecommerceCases = [
  "我想要生成电商图",
  "是 3C 产品的电商图，一个标准的电商图会有哪些参数呢？",
  "做一个 3C 充电宝的详情卖点图，科技感，突出金属质感和快充",
  "用我上传的这张产品图做 Amazon 主图",
  "帮这个产品做一套 Amazon Premium A+ 套图策划",
  "用我上传的产品图直接生成一整套 7 张 Amazon A+ 图",
  "根据刚才的 A+ 策划输出模块03的生图 prompt",
  "指导模板已经确认了，现在按模块02生成这张 A+ 图",
];

(async () => {
  const skills = await listSkills();
  const ecommerceSkill = skills.find((skill) => skill.id === "ecommerce-product-image");
  assert.ok(ecommerceSkill, "ecommerce-product-image skill must be available for routing tests");

  for (const userText of ecommerceCases) {
    const candidates = await selectCandidateSkills({ userText, limit: 2 });
    assert.equal(
      candidates[0]?.id,
      "ecommerce-product-image",
      `expected ecommerce skill for: ${userText}`,
    );
  }

  for (const example of ecommerceSkill.examples.positive) {
    if (!example.expectedSkillId) {
      continue;
    }
    const candidates = await selectCandidateSkills({ userText: example.input, limit: 2 });
    assert.equal(
      candidates[0]?.id,
      example.expectedSkillId,
      `positive example ${example.id} should recall ${example.expectedSkillId}`,
    );
  }

  for (const example of ecommerceSkill.examples.negative) {
    const candidates = await selectCandidateSkills({ userText: example.input, limit: 2 });
    assert.equal(
      candidates.some((skill) => skill.id === "ecommerce-product-image"),
      false,
      `negative example ${example.id} should not recall ecommerce skill`,
    );
  }

  for (const skill of skills.filter((entry) => entry.id !== "ecommerce-product-image")) {
    for (const example of skill.examples.positive) {
      if (!example.expectedSkillId) {
        continue;
      }
      const candidates = await selectCandidateSkills({ userText: example.input, limit: 3 });
      assert.equal(
        candidates[0]?.id,
        example.expectedSkillId,
        `positive example ${skill.id}/${example.id} should rank its skill first; got ${candidates
          .map((candidate) => candidate.id)
          .join(", ")}`,
      );
    }

    for (const example of skill.examples.negative) {
      const candidates = await selectCandidateSkills({ userText: example.input, limit: 3 });
      assert.equal(
        candidates.some((candidate) => candidate.id === skill.id),
        false,
        `negative example ${skill.id}/${example.id} must not recall ${skill.id}`,
      );
    }
  }

  const unrelatedCandidates = await selectCandidateSkills({
    userText: "我们先聊一个赛博朋克角色的世界观设定",
    limit: 2,
  });
  assert.equal(
    unrelatedCandidates.some((skill) => skill.id === "ecommerce-product-image"),
    false,
    "character worldbuilding should not recall ecommerce skill",
  );

  const manuallyLoadedCandidates = await selectCandidateSkills({
    userText: "先按这个方向做一张",
    activeSkillId: "ecommerce-product-image",
    limit: 2,
  });
  assert.equal(
    manuallyLoadedCandidates[0]?.id,
    "ecommerce-product-image",
    "manual activeSkillId should preload the selected skill for the current conversation",
  );

  const candidateSkills = await selectCandidateSkills({
    userText: "帮这个产品做一套 Amazon Premium A+ 套图策划",
    limit: 2,
  });
  const context = buildPlannerContextText({
    conversation: makeConversation({
      agentState: {
        activeSkillId: "ecommerce-product-image",
        creativeBrief: {
          productCategory: "3C",
          shotType: "A+ 套图",
          aPlusStage: "guidance_template",
        },
        updatedAt: now,
      },
    }),
    userText: "帮这个产品做一套 Amazon Premium A+ 套图策划",
    uploadedAssets: [],
    explicitReferenceAssetIds: [],
    inferredReferenceAssetIds: [],
    candidateSkills,
  });
  assert.ok(context.includes("Candidate skills:"), "context includes candidate skill section");
  assert.ok(
    context.includes("ecommerce-product-image"),
    "context includes ecommerce skill id",
  );
  assert.ok(
    context.includes("Amazon Premium A+ 套图三阶段流水线"),
    "context includes loaded A+ workflow instructions",
  );
  assert.ok(
    context.includes("Loaded skill examples:") &&
      context.includes("Skill examples: ecommerce-product-image"),
    "context includes only the recalled skills' golden examples",
  );
  assert.ok(
    context.includes("Active creative brief and saved skill artifacts:"),
    "context includes active creative brief and saved artifacts section",
  );
  assert.ok(
    context.includes("Runtime skill resources selected for this turn:"),
    "context includes runtime resources section",
  );
  assert.ok(
    context.includes("Runtime resource: ecommerce-product-image/a-plus-guidance-template"),
    "A+ planning turn includes the runtime guidance template prompt",
  );
  assert.ok(
    context.includes("Preferred agent model: google-ai-studio/gemini-3.5-flash"),
    "A+ planning turn includes the fixed planner agent model metadata",
  );
  assert.ok(
    context.includes("你是一名资深的亚马逊详情页内容策划专家"),
    "A+ planning turn loads guidance prompt content from runtime resources",
  );

  const selectedGuidanceResources = selectRuntimeResourcesForPlanner({
    candidateSkills,
    agentState: {
      activeSkillId: "ecommerce-product-image",
      creativeBrief: {
        productCategory: "3C",
        shotType: "A+ 套图",
        aPlusStage: "guidance_template",
      },
      updatedAt: now,
    },
    userText: "帮这个产品做一套 Amazon Premium A+ 套图策划",
  });
  const forcedAPlusRuntime = resolvePlannerAgentRuntime({
    agentProviderId: "deepseek",
    agentModelId: "deepseek-v4-pro",
    selectedRuntimeResources: selectedGuidanceResources,
  });
  assert.equal(
    forcedAPlusRuntime.provider.id,
    "google-ai-studio",
    "A+ runtime resource overrides the user-selected agent provider",
  );
  assert.equal(
    forcedAPlusRuntime.model.providerModel,
    "gemini-3.5-flash",
    "A+ runtime resource pins planner calls to gemini-3.5-flash",
  );

  const ordinaryRuntime = resolvePlannerAgentRuntime({
    agentProviderId: "deepseek",
    agentModelId: "deepseek-v4-pro",
    selectedRuntimeResources: [],
  });
  assert.equal(
    ordinaryRuntime.provider.id,
    "deepseek",
    "non-A+ turns keep the user-selected agent provider",
  );

  const firstAPlusPlanner = await planNextStep({
    conversation: makeConversation(),
    userText: "用我上传的产品图直接生成一整套 7 张 Amazon A+ 图",
    uploadedAssets: [],
    explicitReferenceAssetIds: [],
    inferredReferenceAssetIds: [],
    agentProviderId: "deepseek",
    agentModelId: "deepseek-v4-pro",
  });
  assert.equal(
    firstAPlusPlanner.nextAction,
    "clarify",
    "first A+ generation intent must ask through the A+ brief card before guidance runtime",
  );
  assert.equal(firstAPlusPlanner.shouldGenerate, false);
  assert.equal(firstAPlusPlanner.skillBrief?.aPlusStage, "brief_form");
  assert.equal(
    isAPlusBriefFormPlanner(firstAPlusPlanner),
    true,
    "first A+ planner output must be recognizable as an A+ brief form turn",
  );
  const briefFormSpec = buildAPlusBriefFormSpec(firstAPlusPlanner);
  assert.equal(briefFormSpec.status, "pending");

  const explicitBriefPlanner = buildAPlusBriefFormPlannerOutput();
  assert.equal(isAPlusBriefFormPlanner(explicitBriefPlanner), true);

  const candidateAPlusPlanner = await planNextStep({
    conversation: makeConversation(),
    userText:
      "产品名称：磁吸无线充电宝\n卖点：轻薄便携、强磁吸附、安全温控\n销售平台：Amazon US\n直接生成 A+ 图",
    uploadedAssets: [],
    explicitReferenceAssetIds: [],
    inferredReferenceAssetIds: [],
    agentProviderId: "deepseek",
    agentModelId: "deepseek-v4-pro",
  });
  const candidateBriefFormSpec = buildAPlusBriefFormSpec(candidateAPlusPlanner);
  assert.deepEqual(
    candidateBriefFormSpec.candidateValues?.productName,
    ["磁吸无线充电宝"],
    "A+ brief form should surface recognized product name candidates",
  );
  assert.deepEqual(
    candidateBriefFormSpec.candidateValues?.sellingPoints,
    ["轻薄便携", "强磁吸附", "安全温控"],
    "A+ brief form should surface recognized selling point candidates",
  );
  assert.deepEqual(
    candidateBriefFormSpec.candidateValues?.targetCountry,
    ["美国"],
    "A+ brief form should infer target country candidates from platform text",
  );
  assert.deepEqual(
    candidateBriefFormSpec.candidateValues?.salesPlatform,
    ["Amazon US"],
    "A+ brief form should surface recognized sales platform candidates",
  );

  const partialBrief = parseAPlusBriefSubmission(
    [
      "电商图方案信息已确认：",
      "产品名称：磁吸无线充电宝",
      "重点突出的卖点：轻薄便携",
      "安全温控",
      "销售平台：Amazon US",
      "请先基于这些信息生成电商图方案。",
    ].join("\n"),
  );
  assert.equal(partialBrief?.productName, "磁吸无线充电宝");
  assert.equal(partialBrief?.sellingPoints, "轻薄便携\n安全温控");
  assert.equal(partialBrief?.targetCountry, "", "A+ brief country field is optional");
  assert.equal(partialBrief?.salesPlatform, "Amazon US");

  const normalAPlusDiscussionResources = selectRuntimeResourcesForPlanner({
    candidateSkills,
    agentState: {
      activeSkillId: "ecommerce-product-image",
      creativeBrief: {
        productCategory: "3C",
        shotType: "A+ 套图",
        aPlusStage: "guidance_template",
      },
      updatedAt: now,
    },
    userText: "A+ 这套模块逻辑是什么意思？先解释一下",
  });
  assert.equal(
    normalAPlusDiscussionResources.length,
    0,
    "normal A+ discussion must not select clean runtime resources or force Gemini 3.5 Flash",
  );

  for (const regressionCase of [
    {
      userText: "A+ 指导模板是什么？",
      creativeBrief: {
        productCategory: "3C",
        shotType: "A+ 套图",
        aPlusStage: "guidance_template",
      },
      label: "ordinary guidance-template explanation after guidance history",
    },
    {
      userText: "生成一张白底主图",
      creativeBrief: {
        productCategory: "3C",
        shotType: "A+ 套图",
        aPlusStage: "guidance_template",
      },
      label: "ordinary main-image generation after guidance history",
    },
    {
      userText: "生成一张白底主图",
      creativeBrief: {
        productCategory: "3C",
        shotType: "A+ 单模块",
        aPlusStage: "module_prompt",
        selectedModule: "02",
      },
      label: "ordinary main-image generation after module history",
    },
    {
      userText: "写一段广告标题",
      creativeBrief: {
        productCategory: "3C",
        shotType: "A+ 单模块",
        aPlusStage: "module_prompt",
        selectedModule: "02",
      },
      label: "ordinary copywriting after module history",
    },
  ]) {
    const ordinaryResources = selectRuntimeResourcesForPlanner({
      candidateSkills,
      agentState: {
        activeSkillId: "ecommerce-product-image",
        creativeBrief: regressionCase.creativeBrief,
        updatedAt: now,
      },
      userText: regressionCase.userText,
    });
    assert.equal(
      ordinaryResources.length,
      0,
      `${regressionCase.label} must not select A+ runtime resources`,
    );
  }

  const moduleContext = buildPlannerContextText({
    conversation: makeConversation({
      agentState: {
        activeSkillId: "ecommerce-product-image",
        creativeBrief: {
          productCategory: "3C",
          shotType: "A+ 单模块",
          aPlusStage: "module_prompt",
          selectedModule: "02",
        },
        aPlusArtifacts: {
          guidanceTemplate: {
            text: "【A+ 指导模板】已确认的产品策划",
            updatedAt: now,
            sourceMessageId: "msg_guidance",
          },
        },
        updatedAt: now,
      },
    }),
    userText: "根据刚才的 A+ 策划输出模块02的生图 prompt",
    uploadedAssets: [],
    explicitReferenceAssetIds: [],
    inferredReferenceAssetIds: [],
    candidateSkills,
  });
  assert.ok(
    moduleContext.includes("Runtime resource: ecommerce-product-image/a-plus-module-02-translator"),
    "module prompt turn includes the selected module runtime translator",
  );
  assert.ok(
    moduleContext.includes("从 Premium A+ 策划方案中精确定位【模块02】"),
    "module prompt turn loads the module-specific translator prompt",
  );
  assert.ok(
    moduleContext.includes("【A+ 指导模板】已确认的产品策划"),
    "module prompt turn includes saved A+ guidance artifact from agent state",
  );

  const moduleResources = selectRuntimeResourcesForPlanner({
    candidateSkills,
    agentState: {
      activeSkillId: "ecommerce-product-image",
      creativeBrief: {
        productCategory: "3C",
        shotType: "A+ 单模块",
        aPlusStage: "module_prompt",
        selectedModule: "02",
      },
      updatedAt: now,
    },
    userText: "根据刚才的 A+ 策划输出模块02的生图 prompt",
  });
  assert.equal(
    selectPrimaryAPlusRuntimeResource(moduleResources)?.resource.id,
    "a-plus-module-02-translator",
    "module-specific A+ runtime resource is primary when both guidance and module resources match",
  );

  const batchModuleResources = selectRuntimeResourcesForPlanner({
    candidateSkills,
    agentState: {
      activeSkillId: "ecommerce-product-image",
      creativeBrief: {
        productCategory: "3C",
        shotType: "A+ 套图",
        aPlusStage: "module_image",
      },
      aPlusArtifacts: {
        guidanceTemplate: {
          text: "【A+ 指导模板】已确认的产品策划",
          updatedAt: now,
          sourceMessageId: "msg_guidance",
        },
      },
      updatedAt: now,
    },
    userText: "按模块01-03分别生成 A+ 图",
  });
  assert.deepEqual(
    batchModuleResources.map(({ resource }) => resource.id),
    [
      "a-plus-module-01-translator",
      "a-plus-module-02-translator",
      "a-plus-module-03-translator",
    ],
    "A+ batch module image request should select one translator per requested module",
  );

  const missingGuidancePlanner = await planWithCleanAPlusRuntime({
    conversation: makeConversation({
      agentState: {
        activeSkillId: "ecommerce-product-image",
        creativeBrief: {
          productCategory: "3C",
          shotType: "A+ 单模块",
          aPlusStage: "module_prompt",
          selectedModule: "02",
        },
        updatedAt: now,
      },
    }),
    userText: "输出模块02的生图 prompt",
    uploadedAssets: [],
    explicitReferenceAssetIds: [],
    inferredReferenceAssetIds: [],
    runtimeResource: selectPrimaryAPlusRuntimeResource(moduleResources),
    model: "gemini-3.5-flash",
  });
  assert.equal(
    missingGuidancePlanner.nextAction,
    "clarify",
    "module translator must not run before an A+ guidance template exists",
  );
  assert.equal(missingGuidancePlanner.shouldGenerate, false);
  assert.ok(
    missingGuidancePlanner.assistantReply.includes("电商图方案"),
    "missing guidance reply must ask for the ecommerce image scheme",
  );

  const cleanRuntimeInput = buildAPlusRuntimeInputText({
    userText: "根据刚才的 A+ 策划输出模块02的生图 prompt",
    stage: "module_prompt",
    selectedModule: "02",
    guidanceTemplate: "【A+ 指导模板】已确认的产品策划",
  });
  assert.ok(
    cleanRuntimeInput.includes("User requirement:"),
    "clean A+ runtime input includes the current user requirement",
  );
  assert.ok(
    cleanRuntimeInput.includes("Saved Premium A+ guidance template:"),
    "clean A+ runtime input includes saved guidance when translating a module",
  );
  assert.equal(
    cleanRuntimeInput.includes("Candidate skills:"),
    false,
    "clean A+ runtime input must not include generic planner skill context",
  );
  assert.equal(
    cleanRuntimeInput.includes("RecentConversation"),
    false,
    "clean A+ runtime input must not include recent conversation context",
  );

  const cleanGuidancePlanner = buildAPlusRuntimePlannerOutput({
    text: "【A+ 指导模板】完整模板内容\n模块01\n模块02\n模块03\n模块04\n模块05\n模块06\n模块07",
    stage: "guidance_template",
    referenceAssetIds: ["asset_product"],
  });
  assert.equal(cleanGuidancePlanner.nextAction, "discuss");
  assert.equal(cleanGuidancePlanner.shouldGenerate, false);
  assert.ok(
    cleanGuidancePlanner.assistantReply.includes("电商图方案已经整理好了"),
    "clean A+ guidance reply must use the user-facing ecommerce scheme name",
  );
  assert.equal(
    cleanGuidancePlanner.assistantReply.includes("【A+ 指导模板】完整模板内容"),
    false,
    "clean A+ guidance reply must not expose the full guidance template",
  );
  assert.equal(
    cleanGuidancePlanner.internalArtifacts?.aPlusGuidanceTemplate,
    "【A+ 指导模板】完整模板内容\n模块01\n模块02\n模块03\n模块04\n模块05\n模块06\n模块07",
    "clean A+ guidance output keeps the full guidance template as an internal artifact",
  );

  const cleanImagePlanner = buildAPlusRuntimePlannerOutput({
    text: "[Module] Amazon Premium A+ Content - Module 02.",
    stage: "module_image",
    selectedModule: "02",
    referenceAssetIds: ["asset_product"],
  });
  assert.equal(cleanImagePlanner.nextAction, "reference_generate");
  assert.equal(cleanImagePlanner.generation?.inheritConversationContext, false);
  assert.equal(
    cleanImagePlanner.generation?.prompt,
    "[Module] Amazon Premium A+ Content - Module 02.",
    "clean A+ module image output uses the fixed generated prompt directly",
  );
  const historicalProductAsset = {
    id: "asset_product",
    kind: "upload",
    label: "用户上传的产品图",
    alt: "",
    focus: "无线耳机产品图",
    url: "/media/test/asset_product.png",
    mimeType: "image/png",
    width: 1000,
    height: 1000,
    createdAt: now,
  };
  const cleanImageReferences = await selectReferenceAssets(
    makeConversation({ assets: [historicalProductAsset] }),
    cleanImagePlanner,
    [],
    [],
  );
  assert.deepEqual(
    cleanImageReferences.map((asset) => asset.id),
    ["asset_product"],
    "clean A+ module image generation must keep explicitly selected historical product references",
  );

  const cleanBatchImagePlanner = await planWithCleanAPlusRuntime({
    conversation: makeConversation({
      assets: [historicalProductAsset],
      agentState: {
        activeSkillId: "ecommerce-product-image",
        creativeBrief: {
          productCategory: "3C",
          shotType: "A+ 套图",
          aPlusStage: "module_image",
        },
        aPlusArtifacts: {
          guidanceTemplate: {
            text: "【A+ 指导模板】已确认的产品策划",
            updatedAt: now,
            sourceMessageId: "msg_guidance",
          },
          modulePrompts: {
            "01": {
              text: "[Module] Amazon Premium A+ Content - Module 01.",
              updatedAt: now,
              sourceMessageId: "msg_module_01",
            },
            "02": {
              text: "[Module] Amazon Premium A+ Content - Module 02.",
              updatedAt: now,
              sourceMessageId: "msg_module_02",
            },
            "03": {
              text: "[Module] Amazon Premium A+ Content - Module 03.",
              updatedAt: now,
              sourceMessageId: "msg_module_03",
            },
          },
        },
        updatedAt: now,
      },
    }),
    userText: "按模块01-03分别生成 A+ 图",
    uploadedAssets: [],
    explicitReferenceAssetIds: [],
    inferredReferenceAssetIds: [],
    runtimeResource: selectPrimaryAPlusRuntimeResource(batchModuleResources),
    runtimeResources: batchModuleResources,
    model: "gemini-3.5-flash",
  });
  assert.equal(cleanBatchImagePlanner.nextAction, "reference_generate");
  assert.equal(cleanBatchImagePlanner.generation?.outputCount, 1);
  assert.deepEqual(
    cleanBatchImagePlanner.generation?.tasks?.map((task) => task.aPlusModule),
    ["01", "02", "03"],
    "clean A+ batch image output must prepare one task per module",
  );
  assert.deepEqual(
    cleanBatchImagePlanner.generation?.tasks?.map((task) => task.referenceAssetIds),
    [["asset_product"], ["asset_product"], ["asset_product"]],
    "each A+ batch task keeps product references",
  );

  const normalized = normalizePlannerOutput(
    {
      assistantReply: "可以，我们先把 A+ 的 7 个模块结构定下来。",
      nextAction: "discuss",
      selectedSkillId: "ecommerce-product-image",
      skillConfidence: "high",
      skillBrief: {
        productCategory: "3C",
        shotType: "A+ 套图",
        aPlusStage: "guidance_template",
        openQuestions: ["核心卖点是什么？"],
        nested: { unsafe: true },
      },
      shouldGenerate: false,
      needsClarification: false,
      generation: null,
    },
    {
      assistantReply: "fallback",
      nextAction: "clarify",
      shouldGenerate: false,
      needsClarification: true,
      generation: null,
    },
    new Set(),
    new Set(["ecommerce-product-image"]),
  );
  assert.equal(normalized.selectedSkillId, "ecommerce-product-image");
  assert.equal(normalized.skillConfidence, "high");
  assert.deepEqual(normalized.skillBrief?.openQuestions, ["核心卖点是什么？"]);
  assert.equal(
    Object.prototype.hasOwnProperty.call(normalized.skillBrief ?? {}, "nested"),
    false,
    "nested skill brief values must be dropped",
  );

  const invalidSkill = normalizePlannerOutput(
    {
      assistantReply: "我选一个不存在的 skill。",
      nextAction: "discuss",
      selectedSkillId: "ghost-skill",
      skillConfidence: "high",
      shouldGenerate: false,
      needsClarification: false,
      generation: null,
    },
    {
      assistantReply: "fallback",
      nextAction: "clarify",
      shouldGenerate: false,
      needsClarification: true,
      generation: null,
    },
    new Set(),
    new Set(["ecommerce-product-image"]),
  );
  assert.equal(invalidSkill.selectedSkillId, undefined, "invalid skill id is cleared");

  const capturedGuidance = captureAPlusArtifacts({
    current: undefined,
    updatedAt: now,
    sourceMessageId: "msg_guidance",
    planner: {
      assistantReply: "电商图方案已生成好。\n\n大概来说，我已经整理好这套 A+ 详情页的整体视觉方案。",
      nextAction: "discuss",
      selectedSkillId: "ecommerce-product-image",
      skillConfidence: "high",
      skillBrief: {
        aPlusStage: "guidance_template",
      },
      shouldGenerate: false,
      needsClarification: false,
      generation: null,
      internalArtifacts: {
        aPlusGuidanceTemplate: "【A+ 指导模板】完整模板内容",
      },
    },
  });
  assert.equal(
    capturedGuidance?.guidanceTemplate?.text,
    "【A+ 指导模板】完整模板内容",
    "guidance template artifact is captured from internal artifact",
  );

  const unchangedAfterClarify = captureAPlusArtifacts({
    current: capturedGuidance,
    updatedAt: now,
    sourceMessageId: "msg_missing_guidance",
    planner: missingGuidancePlanner,
  });
  assert.equal(
    unchangedAfterClarify?.guidanceTemplate?.text,
    "【A+ 指导模板】完整模板内容",
    "A+ clarify replies must not overwrite saved guidance artifacts",
  );
  assert.equal(
    unchangedAfterClarify?.modulePrompts?.["02"],
    undefined,
    "A+ clarify replies must not be saved as module prompts",
  );

  const capturedModulePrompt = captureAPlusArtifacts({
    current: capturedGuidance,
    updatedAt: now,
    sourceMessageId: "msg_module",
    planner: {
      assistantReply: "正在按模块02生成。",
      nextAction: "reference_generate",
      selectedSkillId: "ecommerce-product-image",
      skillConfidence: "high",
      skillBrief: {
        aPlusStage: "module_image",
        selectedModule: "02",
      },
      shouldGenerate: true,
      needsClarification: false,
      generation: {
        mode: "reference_generate",
        prompt: "[Module] Amazon Premium A+ Content - Module 02 (Core Value Proposition).",
        referenceAssetIds: ["asset_product"],
        inheritConversationContext: true,
        outputCount: 1,
      },
    },
  });
  assert.equal(
    capturedModulePrompt?.modulePrompts?.["02"]?.text,
    "[Module] Amazon Premium A+ Content - Module 02 (Core Value Proposition).",
    "module prompt artifact is captured from generation.prompt when generating",
  );

  console.log("skill routing tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
