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
  IMAGE_AGENT_SKILLS_DIR,
  listSkillManifestsSync,
  listSkills,
} = require("../src/lib/agent/skill-registry.ts");

const allowedExampleActions = new Set([
  "discuss",
  "clarify",
  "generate",
  "edit",
  "reference_generate",
  "reframe",
]);

(async () => {
  assert.ok(
    fs.existsSync(IMAGE_AGENT_SKILLS_DIR),
    "prompts/image-agent/skills must exist",
  );

  const skills = await listSkills();
  const requiredSkillIds = [
    "direction-discussion",
    "key-visual-poster",
    "product-texture-shot",
    "character-poster",
    "reference-style-transfer",
    "local-image-edit",
    "image-critique",
    "prompt-writing",
  ];
  assert.ok(skills.length >= 9, "the eight core scene skills plus ecommerce must be registered");
  for (const skillId of requiredSkillIds) {
    assert.ok(
      skills.some((skill) => skill.id === skillId),
      `assessment skill must be registered: ${skillId}`,
    );
  }

  const ids = new Set();
  for (const skill of skills) {
    assert.ok(skill.id, "skill id is required");
    assert.ok(!ids.has(skill.id), `duplicate skill id: ${skill.id}`);
    ids.add(skill.id);
    assert.ok(skill.name, `${skill.id}: name is required`);
    assert.ok(skill.version, `${skill.id}: version is required`);
    assert.ok(skill.description, `${skill.id}: description is required`);
    if (skill.id === "ecommerce-product-image") {
      assert.equal(skill.executionMode, "custom", "A+ must be an explicit custom pseudo-Skill");
      assert.equal(skill.customWorkflowId, "a-plus", "A+ must declare its custom workflow id");
    } else {
      assert.equal(
        skill.executionMode,
        "generic",
        `${skill.id}: ordinary Skills must use the generic DeepSeek harness path`,
      );
      assert.equal(
        skill.customWorkflowId,
        undefined,
        `${skill.id}: ordinary Skills must not own application workflows`,
      );
      assert.equal(
        skill.runtimeResources.some(
          (resource) =>
            resource.preferredAgentProviderId || resource.preferredAgentModelId,
        ),
        false,
        `${skill.id}: ordinary Skills must not override the DeepSeek harness model`,
      );
    }
    assert.ok(skill.triggers.length >= 3, `${skill.id}: at least 3 triggers required`);
    assert.ok(skill.body.length > 500, `${skill.id}: body should contain real instructions`);
    assert.ok(skill.examples, `${skill.id}: examples.json is required`);
    assert.ok(
      skill.examples.positive.length >= 3,
      `${skill.id}: at least 3 positive examples required`,
    );
    assert.ok(
      skill.examples.negative.length >= 2,
      `${skill.id}: at least 2 negative examples required`,
    );
    assert.ok(
      Array.isArray(skill.runtimeResources),
      `${skill.id}: runtimeResources must be available`,
    );

    const exampleIds = new Set();
    for (const example of [
      ...skill.examples.positive,
      ...skill.examples.negative,
    ]) {
      assert.ok(example.id, `${skill.id}: every example needs an id`);
      assert.ok(!exampleIds.has(example.id), `${skill.id}: duplicate example id ${example.id}`);
      exampleIds.add(example.id);
      assert.ok(example.input, `${skill.id}/${example.id}: input is required`);
      if (example.expectedAction) {
        assert.ok(
          allowedExampleActions.has(example.expectedAction),
          `${skill.id}/${example.id}: unsupported expectedAction ${example.expectedAction}`,
        );
      }
      if (skill.examples.positive.includes(example)) {
        assert.ok(
          Array.isArray(example.assertions) && example.assertions.length > 0,
          `${skill.id}/${example.id}: positive golden case needs quality assertions`,
        );
      }
    }

    if (requiredSkillIds.includes(skill.id)) {
      for (const heading of [
        "适用",
        "不适用",
        "信息充分度",
        "追问",
        "assistantReply",
        "prompt",
        "正例",
        "反例",
        "质量",
      ]) {
        assert.ok(
          skill.fullText.toLowerCase().includes(heading.toLowerCase()),
          `${skill.id}: SKILL.md must cover ${heading}`,
        );
      }
    }
  }

  const ecommerce = skills.find((skill) => skill.id === "ecommerce-product-image");
  const manifests = listSkillManifestsSync();
  assert.ok(
    manifests.some((skill) => skill.id === "ecommerce-product-image"),
    "sync skill manifests must include ecommerce-product-image",
  );
  assert.ok(ecommerce, "ecommerce-product-image skill must be registered");
  assert.ok(
    ecommerce.fullText.includes("Amazon Premium A+"),
    "ecommerce skill must include Amazon Premium A+ workflow instructions",
  );
  assert.ok(
    ecommerce.fullText.includes("A+ 单模块 Prompt Translator"),
    "ecommerce skill must include A+ module prompt translator instructions",
  );
  assert.ok(
    ecommerce.fullText.includes("A+ 套图三阶段流水线"),
    "ecommerce skill must include the gated A+ three-stage workflow",
  );
  assert.ok(
    ecommerce.fullText.includes("runtime-resources.json") &&
      ecommerce.fullText.includes("a-plus-guidance-template"),
    "ecommerce skill must reference runtime A+ prompt resources instead of docs as runtime inputs",
  );
  assert.ok(
    ecommerce.runtimeResources.some((resource) => resource.id === "a-plus-guidance-template"),
    "ecommerce runtime resources must include the A+ guidance template prompt",
  );
  assert.ok(
    ecommerce.runtimeResources.some((resource) => resource.id === "a-plus-module-01-translator") &&
      ecommerce.runtimeResources.some((resource) => resource.id === "a-plus-module-07-translator"),
    "ecommerce runtime resources must include A+ module translator prompts",
  );
  assert.ok(
    ecommerce.runtimeResources
      .find((resource) => resource.id === "a-plus-guidance-template")
      ?.content.includes("你是一名资深的亚马逊详情页内容策划专家"),
    "A+ guidance prompt content must be loaded from the runtime prompt file",
  );
  assert.ok(
    ecommerce.runtimeResources
      .find((resource) => resource.id === "a-plus-module-03-translator")
      ?.content.includes("从 Premium A+ 策划方案中精确定位【模块03】"),
    "A+ module translator prompt content must be loaded from runtime prompt files",
  );
  assert.ok(
    ecommerce.runtimeResources
      .filter((resource) => resource.id.startsWith("a-plus-"))
      .every(
        (resource) =>
          resource.preferredAgentProviderId === "google-ai-studio" &&
          resource.preferredAgentModelId === "gemini-3.5-flash",
      ),
    "A+ runtime resources must pin the planner agent model to google-ai-studio/gemini-3.5-flash",
  );
  assert.ok(
    ecommerce.fullText.includes("不要用一个泛化 prompt 同时生成 7 张不同模块图"),
    "ecommerce skill must forbid generating the full A+ set from one generic prompt",
  );

  console.log("skill registry tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
