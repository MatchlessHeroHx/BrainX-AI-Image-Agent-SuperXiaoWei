import type { CustomWorkflowResourceSelectionInput } from "@/lib/agent/custom-workflows/types";

const normalizeSearchText = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

const skillBriefValueAsString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const A_PLUS_MODULE_IDS = ["01", "02", "03", "04", "05", "06", "07"] as const;

const normalizeAPlusModule = (value: unknown) => {
  const text = skillBriefValueAsString(value);
  if (!text) {
    return undefined;
  }

  const match = /(?:module|模块)\s*0?([1-7])\b/i.exec(text) ?? /^0?([1-7])$/.exec(text);
  return match ? `0${match[1]}`.slice(-2) : undefined;
};

const detectAPlusModuleFromText = (text: string) => {
  const match = /(?:module|模块)\s*0?([1-7])\b/i.exec(text);
  return match ? `0${match[1]}`.slice(-2) : undefined;
};

const normalizeAPlusModuleNumber = (value: string | number) => {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 1 || numberValue > 7) {
    return undefined;
  }
  return `0${numberValue}`.slice(-2);
};

const CHINESE_A_PLUS_NUMBERS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
};

const parseAPlusCountToken = (value: string) =>
  CHINESE_A_PLUS_NUMBERS[value] ?? Number(value);

const pushAPlusModule = (modules: string[], value: string | number) => {
  const moduleId = normalizeAPlusModuleNumber(value);
  if (moduleId && !modules.includes(moduleId)) {
    modules.push(moduleId);
  }
};

const pushAPlusModuleRange = (
  modules: string[],
  start: string | number,
  end: string | number,
) => {
  const startNumber = typeof start === "number" ? start : Number(start);
  const endNumber = typeof end === "number" ? end : Number(end);
  if (
    !Number.isInteger(startNumber) ||
    !Number.isInteger(endNumber) ||
    startNumber < 1 ||
    startNumber > 7 ||
    endNumber < 1 ||
    endNumber > 7
  ) {
    return;
  }

  const [from, to] =
    startNumber <= endNumber ? [startNumber, endNumber] : [endNumber, startNumber];
  for (let index = from; index <= to; index += 1) {
    pushAPlusModule(modules, index);
  }
};

const detectAPlusModulesFromText = (text: string) => {
  const modules: string[] = [];

  if (
    /(?:整套|全套|全部|所有|每个模块|各个模块|7\s*(?:张|个模块)|七\s*(?:张|个模块))/.test(
      text,
    )
  ) {
    return [...A_PLUS_MODULE_IDS];
  }

  for (const match of text.matchAll(
    /(?:模块|module)?\s*0?([1-7])\s*(?:-|~|到|至|—|–)\s*(?:模块|module)?\s*0?([1-7])/gi,
  )) {
    pushAPlusModuleRange(modules, match[1], match[2]);
  }

  for (const match of text.matchAll(/前\s*([1-7一二三四五六七两])\s*个?\s*模块/g)) {
    const count = parseAPlusCountToken(match[1]);
    if (Number.isInteger(count) && count >= 1 && count <= 7) {
      pushAPlusModuleRange(modules, 1, count);
    }
  }

  for (const match of text.matchAll(
    /(?:模块|module)\s*((?:0?[1-7]\s*(?:[,，、/和及]|and|&|\s)+)*0?[1-7])/gi,
  )) {
    for (const numberMatch of match[1].matchAll(/0?([1-7])/g)) {
      pushAPlusModule(modules, numberMatch[1]);
    }
  }

  for (const match of text.matchAll(/(?:模块|module)\s*0?([1-7])\b/gi)) {
    pushAPlusModule(modules, match[1]);
  }

  return modules;
};

const hasDiscussionOnlyIntent = (text: string) =>
  /(?:解释|说明|为什么|是什么|什么意思|啥意思|有什么用|作用|聊聊|讨论|怎么看|是否|可以吗|怎么理解)/.test(
    text,
  );

const hasExplicitAPlusTopic = (text: string) =>
  /(?:a\s*\+|premium\s*a\s*\+|amazon\s*a\s*\+|亚马逊\s*a\s*\+)/i.test(text);

const hasAPlusGuidanceRuntimeIntent = (text: string) => {
  if (hasDiscussionOnlyIntent(text)) {
    return false;
  }

  const guidanceTerm =
    /(?:指导模板|策划案|套图策划|模块结构|7\s*(?:张|个模块)|整套|做一套)/i.test(text);
  const explicitGuidanceTemplate = /(?:指导模板)/.test(text);
  const explicitSetRequest =
    hasExplicitAPlusTopic(text) &&
    /(?:指导模板|策划|规划|结构|套图|7\s*张|整套|做一套|生成|输出|创建|generate|create|produce)/i.test(
      text,
    );

  return explicitGuidanceTemplate || explicitSetRequest || (hasExplicitAPlusTopic(text) && guidanceTerm);
};

const hasAPlusModuleRuntimeIntent = (text: string, activeSelectedModule?: string) => {
  if (hasDiscussionOnlyIntent(text)) {
    return false;
  }

  const mentionedModule = detectAPlusModuleFromText(text);
  const hasModuleScope = Boolean(mentionedModule || activeSelectedModule);
  if (!hasModuleScope) {
    return false;
  }

  const promptIntent = /(?:prompt|提示词|脚本|生图\s*prompt|生图提示词)/i.test(text);
  const outputTextIntent = /(?:输出|生成|写|创建|翻译|转成|generate|create|produce|write|translate)/i.test(
    text,
  );
  const imageIntent =
    /(?:生成.*(?:图|图片)|出图|做图|渲染|render|generate\s+(?:the\s+)?image|create\s+(?:the\s+)?image)/i.test(
      text,
    );

  return (
    (promptIntent && (outputTextIntent || Boolean(mentionedModule) || hasExplicitAPlusTopic(text))) ||
    (imageIntent && (Boolean(mentionedModule) || hasExplicitAPlusTopic(text)))
  );
};

export const selectAPlusRuntimeResources = (
  params: CustomWorkflowResourceSelectionInput,
) => {
  const activeBrief = params.agentState?.creativeBrief;
  const text = normalizeSearchText(params.userText);
  const mentionedModules = detectAPlusModulesFromText(params.userText);
  const mentionedModule = mentionedModules[0] ?? detectAPlusModuleFromText(params.userText);
  const activeAPlusStage = skillBriefValueAsString(activeBrief?.aPlusStage);
  const savedSelectedModule = normalizeAPlusModule(activeBrief?.selectedModule);
  const hasSavedGuidance = Boolean(params.agentState?.aPlusArtifacts?.guidanceTemplate?.text);
  const batchModuleImageIntent =
    hasSavedGuidance &&
    mentionedModules.length > 1 &&
    /(?:生成.*(?:图|图片)|出图|做图|渲染|render|generate\s+(?:the\s+)?image|create\s+(?:the\s+)?image)/i.test(
      params.userText,
    );
  const moduleRuntimeIntent =
    hasAPlusModuleRuntimeIntent(params.userText, savedSelectedModule) || batchModuleImageIntent;
  const guidanceRuntimeIntent =
    hasAPlusGuidanceRuntimeIntent(params.userText) && !moduleRuntimeIntent;
  const activeSelectedModules =
    mentionedModules.length > 0
      ? mentionedModules
      : mentionedModule
        ? [mentionedModule]
        : moduleRuntimeIntent && savedSelectedModule
          ? [savedSelectedModule]
          : [];

  return params.skill.runtimeResources
    .filter((resource) => {
      const triggerMatch = resource.triggers.some((trigger) => {
        const normalizedTrigger = normalizeSearchText(trigger);
        return normalizedTrigger && text.includes(normalizedTrigger);
      });
      const stageMatch = activeAPlusStage
        ? resource.aPlusStages.includes(activeAPlusStage)
        : false;
      const moduleMatch =
        activeSelectedModules.length > 0 &&
        resource.selectedModules.some((moduleId) => activeSelectedModules.includes(moduleId));

      if (resource.selectedModules.length > 0) {
        return moduleRuntimeIntent && (triggerMatch || moduleMatch);
      }

      return guidanceRuntimeIntent && (triggerMatch || stageMatch);
    })
    .map((resource) => ({ skill: params.skill, resource }));
};
