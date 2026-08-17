import { promises as fs, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { IMAGE_AGENT_PROMPT_DIR } from "@/lib/agent/prompt-config";
import { getCustomWorkflowDefinition } from "@/lib/agent/custom-workflows/registry";
import type {
  LoadedSkill,
  SkillExamplesFile,
  SkillManifest,
  SkillRuntimeResource,
  SkillSelectionContext,
} from "@/lib/agent/skill-types";
import type { ConversationAgentState } from "@/lib/types";

export const IMAGE_AGENT_SKILLS_DIR = path.join(IMAGE_AGENT_PROMPT_DIR, "skills");

const stripYamlQuotes = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parseYamlScalarOrArray = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map(stripYamlQuotes)
      .filter(Boolean);
  }

  return stripYamlQuotes(trimmed);
};

const parseSkillFrontmatter = (content: string) => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);

  if (!match) {
    throw new Error("SKILL.md is missing YAML frontmatter.");
  }

  const [, frontmatter, body] = match;
  const data: Record<string, string | string[]> = {};
  let currentArrayKey: string | null = null;

  for (const rawLine of frontmatter.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }

    const arrayMatch = /^\s*-\s*(.+)$/.exec(line);
    if (arrayMatch && currentArrayKey) {
      const current = data[currentArrayKey];
      data[currentArrayKey] = [
        ...(Array.isArray(current) ? current : []),
        stripYamlQuotes(arrayMatch[1]),
      ];
      continue;
    }

    const keyValueMatch = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!keyValueMatch) {
      continue;
    }

    const [, key, rawValue] = keyValueMatch;
    if (!rawValue.trim()) {
      data[key] = [];
      currentArrayKey = key;
      continue;
    }

    data[key] = parseYamlScalarOrArray(rawValue);
    currentArrayKey = null;
  }

  return { data, body: body.trim(), fullText: content.trim() };
};

const requireString = (
  data: Record<string, string | string[]>,
  key: string,
  filePath: string,
) => {
  const value = data[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${filePath}: frontmatter "${key}" must be a non-empty string.`);
  }
  return value.trim();
};

const optionalStringArray = (data: Record<string, string | string[]>, key: string) => {
  const value = data[key];
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter(Boolean);
  }
  return [value.trim()].filter(Boolean);
};

const parseDefaultAction = (
  data: Record<string, string | string[]>,
  filePath: string,
): SkillManifest["defaultAction"] => {
  const value = data.defaultAction;
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value === "string" &&
    (["clarify_or_generate", "discuss", "generate"] as const).includes(
      value as NonNullable<SkillManifest["defaultAction"]>,
    )
  ) {
    return value as SkillManifest["defaultAction"];
  }
  throw new Error(`${filePath}: frontmatter "defaultAction" is invalid.`);
};

const parseExecutionMode = (
  data: Record<string, string | string[]>,
  filePath: string,
): Pick<SkillManifest, "executionMode" | "customWorkflowId"> => {
  const rawMode = data.executionMode;
  const executionMode = rawMode === undefined ? "generic" : rawMode;

  if (executionMode !== "generic" && executionMode !== "custom") {
    throw new Error(`${filePath}: frontmatter "executionMode" must be generic or custom.`);
  }

  const rawWorkflowId = data.customWorkflow;
  const customWorkflowId =
    typeof rawWorkflowId === "string" && rawWorkflowId.trim()
      ? rawWorkflowId.trim()
      : undefined;

  if (executionMode === "custom" && !customWorkflowId) {
    throw new Error(
      `${filePath}: custom Skills must declare a non-empty "customWorkflow".`,
    );
  }

  if (executionMode === "generic" && customWorkflowId) {
    throw new Error(
      `${filePath}: generic Skills cannot declare "customWorkflow".`,
    );
  }

  return { executionMode, customWorkflowId };
};

const readExamplesFile = async (skillDir: string): Promise<SkillExamplesFile | undefined> => {
  const filePath = path.join(skillDir, "examples.json");

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as SkillExamplesFile;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
};

type RuntimeResourceManifestEntry = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  file?: unknown;
  triggers?: unknown;
  aPlusStages?: unknown;
  selectedModules?: unknown;
  preferredAgentProviderId?: unknown;
  preferredAgentModelId?: unknown;
};

const optionalString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const normalizeStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
    : [];

const readRuntimeResourcesFile = async (
  skillDir: string,
): Promise<SkillRuntimeResource[]> => {
  const manifestPath = path.join(skillDir, "runtime-resources.json");

  let rawManifest: string;
  try {
    rawManifest = await fs.readFile(manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const parsed = JSON.parse(rawManifest) as RuntimeResourceManifestEntry[];
  if (!Array.isArray(parsed)) {
    throw new Error(`${manifestPath}: runtime resources manifest must be an array.`);
  }

  return Promise.all(
    parsed.map(async (entry, index) => {
      const id = optionalString(entry.id);
      const name = optionalString(entry.name);
      const file = optionalString(entry.file);

      if (!id || !name || !file) {
        throw new Error(
          `${manifestPath}: runtime resource at index ${index} must include id, name and file.`,
        );
      }

      const resourcePath = path.join(skillDir, file);
      const content = (await fs.readFile(resourcePath, "utf8")).trim();

      if (!content) {
        throw new Error(`${resourcePath}: runtime resource content must not be empty.`);
      }

      return {
        id,
        name,
        description: optionalString(entry.description),
        file,
        content,
        triggers: normalizeStringArray(entry.triggers),
        aPlusStages: normalizeStringArray(entry.aPlusStages),
        selectedModules: normalizeStringArray(entry.selectedModules),
        preferredAgentProviderId: optionalString(entry.preferredAgentProviderId),
        preferredAgentModelId: optionalString(entry.preferredAgentModelId),
      };
    }),
  );
};

const readSkillFromDirectory = async (entryName: string): Promise<LoadedSkill> => {
  const skillDir = path.join(IMAGE_AGENT_SKILLS_DIR, entryName);
  const filePath = path.join(skillDir, "SKILL.md");
  const content = await fs.readFile(filePath, "utf8");
  const { data, body, fullText } = parseSkillFrontmatter(content);
  const execution = parseExecutionMode(data, filePath);
  const runtimeResources = await readRuntimeResourcesFile(skillDir);

  if (
    execution.executionMode === "generic" &&
    runtimeResources.some(
      (resource) => resource.preferredAgentProviderId || resource.preferredAgentModelId,
    )
  ) {
    throw new Error(
      `${filePath}: generic Skills cannot override the DeepSeek harness provider/model.`,
    );
  }

  if (execution.customWorkflowId) {
    getCustomWorkflowDefinition(execution.customWorkflowId);
  }

  const manifest: SkillManifest = {
    id: requireString(data, "id", filePath),
    name: requireString(data, "name", filePath),
    version: requireString(data, "version", filePath),
    description: requireString(data, "description", filePath),
    triggers: optionalStringArray(data, "triggers"),
    antiTriggers: optionalStringArray(data, "antiTriggers"),
    defaultAction: parseDefaultAction(data, filePath),
    ...execution,
    directoryName: entryName,
  };

  return {
    ...manifest,
    body,
    fullText,
    examples: await readExamplesFile(skillDir),
    runtimeResources,
  };
};

const readSkillManifestFromDirectory = async (entryName: string): Promise<SkillManifest> => {
  const skillDir = path.join(IMAGE_AGENT_SKILLS_DIR, entryName);
  const filePath = path.join(skillDir, "SKILL.md");
  const content = await fs.readFile(filePath, "utf8");
  const { data } = parseSkillFrontmatter(content);
  const execution = parseExecutionMode(data, filePath);

  return {
    id: requireString(data, "id", filePath),
    name: requireString(data, "name", filePath),
    version: requireString(data, "version", filePath),
    description: requireString(data, "description", filePath),
    triggers: optionalStringArray(data, "triggers"),
    antiTriggers: optionalStringArray(data, "antiTriggers"),
    defaultAction: parseDefaultAction(data, filePath),
    ...execution,
    directoryName: entryName,
  };
};

const readSkillManifestFromDirectorySync = (entryName: string): SkillManifest => {
  const skillDir = path.join(IMAGE_AGENT_SKILLS_DIR, entryName);
  const filePath = path.join(skillDir, "SKILL.md");
  const content = readFileSync(filePath, "utf8");
  const { data } = parseSkillFrontmatter(content);
  const execution = parseExecutionMode(data, filePath);

  return {
    id: requireString(data, "id", filePath),
    name: requireString(data, "name", filePath),
    version: requireString(data, "version", filePath),
    description: requireString(data, "description", filePath),
    triggers: optionalStringArray(data, "triggers"),
    antiTriggers: optionalStringArray(data, "antiTriggers"),
    defaultAction: parseDefaultAction(data, filePath),
    ...execution,
    directoryName: entryName,
  };
};

export const listSkills = async (): Promise<LoadedSkill[]> => {
  let entries: string[];
  try {
    entries = (await fs.readdir(IMAGE_AGENT_SKILLS_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const skills = await Promise.all(entries.map(readSkillFromDirectory));
  const seen = new Set<string>();
  for (const skill of skills) {
    if (seen.has(skill.id)) {
      throw new Error(`Duplicate skill id "${skill.id}" in prompts/image-agent/skills.`);
    }
    seen.add(skill.id);
  }
  return skills;
};

export const listSkillManifests = async (): Promise<SkillManifest[]> => {
  let entries: string[];
  try {
    entries = (await fs.readdir(IMAGE_AGENT_SKILLS_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const manifests = await Promise.all(entries.map(readSkillManifestFromDirectory));
  const seen = new Set<string>();
  for (const manifest of manifests) {
    if (seen.has(manifest.id)) {
      throw new Error(`Duplicate skill id "${manifest.id}" in prompts/image-agent/skills.`);
    }
    seen.add(manifest.id);
  }
  return manifests;
};

export const listSkillManifestsSync = (): SkillManifest[] => {
  let entries: string[];
  try {
    entries = readdirSync(IMAGE_AGENT_SKILLS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const manifests = entries.map(readSkillManifestFromDirectorySync);
  const seen = new Set<string>();
  for (const manifest of manifests) {
    if (seen.has(manifest.id)) {
      throw new Error(`Duplicate skill id "${manifest.id}" in prompts/image-agent/skills.`);
    }
    seen.add(manifest.id);
  }
  return manifests;
};

export const loadSkill = async (skillId: string): Promise<LoadedSkill | null> => {
  const manifest = (await listSkillManifests()).find((skill) => skill.id === skillId);
  return manifest ? readSkillFromDirectory(manifest.directoryName) : null;
};

const normalizeSearchText = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

const buildSemanticSearchTokens = (value: string) => {
  const tokens = new Set<string>();
  for (const match of normalizeSearchText(value).matchAll(/[a-z0-9+][a-z0-9+_-]+|[\u3400-\u9fff]+/g)) {
    const term = match[0];
    if (/^[\u3400-\u9fff]+$/.test(term)) {
      for (let size = 2; size <= Math.min(4, term.length); size += 1) {
        for (let index = 0; index <= term.length - size; index += 1) {
          tokens.add(term.slice(index, index + size));
        }
      }
    } else if (term.length >= 2) {
      tokens.add(term);
    }
  }
  return tokens;
};

const scoreSkill = (skill: SkillManifest, context: SkillSelectionContext) => {
  const text = normalizeSearchText(context.userText);
  let score = context.activeSkillId === skill.id ? 5 : 0;

  for (const trigger of skill.triggers) {
    const normalizedTrigger = normalizeSearchText(trigger);
    if (normalizedTrigger && text.includes(normalizedTrigger)) {
      score += normalizedTrigger.length <= 2 ? 3 : 4;
    }
  }

  for (const antiTrigger of skill.antiTriggers) {
    const normalizedAntiTrigger = normalizeSearchText(antiTrigger);
    if (normalizedAntiTrigger && text.includes(normalizedAntiTrigger)) {
      score -= 6;
    }
  }

  const userTokens = buildSemanticSearchTokens(context.userText);
  const descriptionTokens = buildSemanticSearchTokens(`${skill.name} ${skill.description}`);
  let semanticOverlap = 0;
  for (const token of userTokens) {
    if (descriptionTokens.has(token)) {
      semanticOverlap += token.length >= 4 ? 0.5 : token.length === 3 ? 0.3 : 0.15;
    }
  }
  score += Math.min(2, semanticOverlap);

  return score;
};

export const selectCandidateSkills = async (
  context: SkillSelectionContext,
): Promise<LoadedSkill[]> => {
  const limit = Math.max(1, context.limit ?? 2);
  const scored = (await listSkillManifests())
    .map((skill) => ({ skill, score: scoreSkill(skill, context) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id));

  return Promise.all(
    scored.slice(0, limit).map((entry) => readSkillFromDirectory(entry.skill.directoryName)),
  );
};

const formatJsonForPrompt = (value: unknown) => JSON.stringify(value, null, 2);

export const selectRuntimeResourcesForPlanner = (params: {
  candidateSkills: LoadedSkill[];
  agentState?: ConversationAgentState;
  userText: string;
}) => {
  const text = normalizeSearchText(params.userText);

  return params.candidateSkills.flatMap((skill) => {
    if (skill.executionMode === "generic") {
      return skill.runtimeResources
        .filter((resource) =>
          resource.triggers.some((trigger) => {
            const normalizedTrigger = normalizeSearchText(trigger);
            return normalizedTrigger && text.includes(normalizedTrigger);
          }),
        )
        .map((resource) => ({ skill, resource }));
    }

    return getCustomWorkflowDefinition(skill.customWorkflowId!).selectRuntimeResources({
      skill,
      agentState: params.agentState,
      userText: params.userText,
    });
  });
};

export const formatSkillContextForPlanner = (params: {
  candidateSkills: LoadedSkill[];
  agentState?: ConversationAgentState;
  userText: string;
}) => {
  const selectedRuntimeResources = selectRuntimeResourcesForPlanner(params);
  const customWorkflowInstructions = Array.from(
    new Set(
      params.candidateSkills
        .filter((skill) => skill.executionMode === "custom" && skill.customWorkflowId)
        .flatMap((skill) =>
          getCustomWorkflowDefinition(skill.customWorkflowId!).plannerInstructions,
        ),
    ),
  );

  const candidateBlock = params.candidateSkills.length
    ? params.candidateSkills
        .map(
          (skill) =>
            `- ${skill.id} | ${skill.name} | v${skill.version} | mode: ${skill.executionMode}${skill.customWorkflowId ? `/${skill.customWorkflowId}` : ""} | ${skill.description} | triggers: ${skill.triggers.join(", ")}`,
        )
        .join("\n")
    : "- none";
  const loadedInstructions = params.candidateSkills.length
    ? params.candidateSkills
        .map((skill) => `--- Loaded skill: ${skill.id} (${skill.name}) ---\n${skill.fullText}`)
        .join("\n\n")
    : "No skill instructions loaded for this turn.";
  const loadedExamples = params.candidateSkills.length
    ? params.candidateSkills
        .map((skill) => {
          if (!skill.examples) {
            return `--- Skill examples: ${skill.id} ---\nNo examples provided.`;
          }
          const positive = skill.examples.positive
            .slice(0, 3)
            .map(
              (example) =>
                `+ ${example.input}${example.expectedAction ? ` -> ${example.expectedAction}` : ""}`,
            );
          const negative = skill.examples.negative
            .slice(0, 2)
            .map(
              (example) =>
                `- ${example.input}${example.reason ? ` | not this skill: ${example.reason}` : ""}`,
            );
          return [`--- Skill examples: ${skill.id} ---`, ...positive, ...negative].join("\n");
        })
        .join("\n\n")
    : "No skill examples loaded for this turn.";
  const runtimeResources = selectedRuntimeResources.length
    ? selectedRuntimeResources
        .map(
          ({ skill, resource }) =>
            [
              `--- Runtime resource: ${skill.id}/${resource.id} (${resource.name}) ---`,
              resource.description ? `Usage: ${resource.description}` : undefined,
              `Path: ${resource.file}`,
              resource.preferredAgentModelId
                ? `Preferred agent model: ${
                    resource.preferredAgentProviderId
                      ? `${resource.preferredAgentProviderId}/`
                      : ""
                  }${resource.preferredAgentModelId}`
                : undefined,
              "Content:",
              resource.content,
            ]
              .filter(Boolean)
              .join("\n"),
        )
        .join("\n\n")
    : "No runtime skill resources selected for this turn.";
  const activeAgentState = params.agentState
    ? formatJsonForPrompt(params.agentState)
    : "No active creative brief yet.";

  return [
    "Candidate skills:",
    candidateBlock,
    "",
    "Loaded skill instructions:",
    loadedInstructions,
    "",
    "Loaded skill examples:",
    loadedExamples,
    "",
    "Runtime skill resources selected for this turn:",
    runtimeResources,
    "",
    "Active creative brief and saved skill artifacts:",
    activeAgentState,
    "",
    "Skill routing rules:",
    "- Generic Skills are knowledge plugins. Apply their instructions inside the shared DeepSeek harness; they do not own provider selection, state machines, forms, or application code.",
    "- Custom Skills are explicit application workflows. Do not treat their special runtime behavior as the extension contract for ordinary Skills.",
    "- Skills may control scene-specific decisions, clarification gates, deliverable content, prompt recipes, and quality checks. The system prompt remains authoritative for persona and general conversational style.",
    "- If a loaded skill applies to the user's intent, set selectedSkillId to that skill id.",
    "- If no loaded skill applies, omit selectedSkillId.",
    "- Follow the selected skill's clarification strategy and prompt recipe before the generic prompt craft rules.",
    "- Treat selected runtime skill resources as authoritative business prompts. They are copied out of docs for runtime use; docs paths are human/developer references only.",
    "- Fill skillBrief with compact, reusable facts only: category, creative type, channel, reference mode, constraints, copy policy, open questions, or similar fields.",
    ...customWorkflowInstructions.map((instruction) => `- Custom workflow: ${instruction}`),
  ].join("\n");
};

export const __skillRegistryTestHooks = {
  parseSkillFrontmatter,
  scoreSkill,
};
