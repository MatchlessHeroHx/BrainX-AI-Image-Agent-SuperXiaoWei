# Image Agent Prompt Controls

这个目录集中管理图像创作 Agent 的提示词、场景 Skill、兜底回复和会影响用户输入的快捷 prompt。

后续如果需要优化「回复风格 / 行为规则 / 兜底话术 / 快捷提示词」，先从这里确认每一层的职责，不要在多个层级重复定义同一套人格和表达规范。

## 提示词层级与优先级

当前 Agent 会同时接触五类信息，但它们不是五套平行的 System prompt：

1. `system.md`：唯一的人格、关系感、通用表达风格和通用行为来源。
2. Planner 输出 schema：只描述字段含义与结构要求，不重新规定口吻或回复模板。
3. `plannerRuntimeInstructions`：只补充本轮运行时契约，例如严格 JSON 和记忆更新，不复制 System 规则。
4. 会话上下文：只提供事实、资产、历史、偏好和本轮输入，不作为人格指令解释。
5. Skill 与 runtime resource：可以强约束特定场景的判断顺序、追问门槛、交付内容、prompt recipe 和质量标准；它们不替换 Agent 身份，也不另造一套通用说话方式。

发生冲突时，通用人格与表达以 `system.md` 为准；专业场景逻辑以命中的 Skill 为准；schema 和运行时上下文都不能借字段描述或示例改变 Agent 的关系感与口吻。

## 文件职责

### `system.md`

主系统提示词。它决定模型正常可用时的核心行为：

- Agent 人格、语气、称呼、自我介绍方式。
- 什么时候讨论，什么时候追问，什么时候生成、改图、参考生成或重新开始。
- `assistantReply` 的回复风格、长度、禁忌表达。
- `generation.prompt` 的写法、语言、结构和质量要求。
- 输出 JSON 的字段要求和示例。

适合在这里改：

- “更专业 / 更轻松 / 更像设计师 / 更少卖萌”这类整体风格。
- 追问策略，比如少问问题、只问一个关键问题、信息不足时也先给方向。
- 是否主动给建议、是否解释判断、是否暴露内部流程。
- 图片模型 prompt 的写作方法和质量标准。

不适合在这里改：

- 代码级字段名。
- JSON schema 结构。
- 已经写在 runtime fallback 里的固定文案。

### `runtime-copy.json`

运行时配置和兜底文案。它负责那些不一定来自模型输出、但仍然会影响 Agent 观感和行为的内容：

- `schemaDescriptions`: 结构化输出 schema 的字段描述。
- `fallbackSystemPrompt`: `system.md` 读取失败时的最小应急契约，不维护第二份完整 System 副本。
- `plannerRuntimeInstructions`: planner 每次拼最终 prompt 时追加的结构与记忆规则，不定义人格和通用表达。
- `behaviorDefaults`: 行为默认值，比如模糊“几版”时默认生成几张。
- `fallbackImagePrompt`: 模型不可用或 planner 失败时，代码生成图片 prompt 的模板。
- `fallbackAssistantReplies`: 模型离线、输出修复等路径里的固定回复。
- `assistantNotes`: 生成结果、参考图识别、补充信息等辅助 note。
- `failureMessage`: 图片调用失败时给用户看到的回复。
- `plannerPrompt`: 拼接 planner 上下文时使用的段落标题和空状态说明。
- `workspaceText`: 新会话、历史记录等工作台文案。
- `referenceResolver`: 参考图识别原因文案。
- `conversationContext`: 传给 planner 的会话摘要、继承提示、结果摘要。
- `plannerOutputExample`: TypeScript 中复用的结构化输出示例。

适合在这里改：

- 没有模型参与时的兜底回复。
- 生成失败、生成成功、本地预览、参考图识别的提示语。
- 会话上下文如何描述给 planner。
- 默认生成数量等简单行为参数。

注意：

- JSON 里使用 `{name}` 形式做占位符，例如 `{count}`、`{label}`。
- 改文案可以只改 JSON。
- 新增、删除或重命名 JSON 字段时，需要同步修改 `src/lib/agent/prompt-config.ts` 里的 TypeScript 类型。
- 不要把 `system.md` 的人格、禁词、句式和长度规则复制进 `schemaDescriptions` 或 `plannerRuntimeInstructions`。这些位置只写它们独有的运行时职责。

### `ui-prompts.json`

前端会插入输入框的 prompt。它们最终会变成用户消息，因此也会间接影响 Agent 行为：

- `initialPrompts`: 空会话首页展示的快捷提示词。
- `referencePrompts`: 用户选中参考图后展示的快捷提示词。
- `selectedReferencePrompt`: 点击“带入当前参考”时填入输入框的默认文字。

适合在这里改：

- 首页 prompt suggestion。
- 选中参考图后的快捷操作文案。
- 让用户更容易输入高质量需求的模板。

### `skills/`

场景化创作 Skill。每个 Skill 是一个目录，至少包含：

- `SKILL.md`: frontmatter + 完整专业规则、追问策略、prompt recipe、质量检查。
- `examples.json`: 正例 / 反例和关键断言，供回归测试使用。

当前包含电商商品图以及评估方案定义的 8 个首批场景 Skill：创意方向讨论、品牌主视觉海报、商品材质棚拍、角色海报、参考风格另起、局部编辑、图片点评和提示词写作。registry 先只读取 manifest 做 top-3 召回，再加载候选 Skill 的正文与资源，避免把所有专业知识长期塞进 `system.md`。

Skill 分为两类：

- `executionMode: generic`（默认）：通用知识插件，只定义适用场景、专业规则、追问策略、prompt recipe 与 examples。它没有自己的代码、状态机、表单或模型选择，统一在用户当前选择的 Harness 模型中执行。后续新增 Skill 原则上都应使用这一类。
- `executionMode: custom`：应用级定制工作流，必须同时声明 `customWorkflow`。目前只有 A+ 使用 `customWorkflow: a-plus`，用于承载专用三阶段流程、表单、中间产物和固定模型；它是明确的“伪 Skill”例外。

普通 Skill 不要通过 `preferredAgentProviderId` 覆盖用户的基础模型选择，也不要在 `planner.ts`、`message-service.ts` 或 UI 中增加按 Skill id 判断的分支。

Skill 可以规定某类任务的回复需要覆盖哪些专业信息，也可以规定必要的追问和交付结构。这不属于对 System 的重复；但诸如“像谁说话”、固定开场、通用语气、口头禅、标点和 emoji 偏好，仍然只由 `system.md` 管理。

## 代码入口

这个目录由以下代码读取：

- `src/lib/agent/prompt-config.ts`: 读取 `runtime-copy.json`，提供模板格式化和兜底文案方法。
- `src/lib/agent/skill-registry.ts`: 读取 `skills/*/SKILL.md` 和 `examples.json`，召回候选 Skill 并拼接 planner context。
- `src/lib/agent/ui-prompt-config.ts`: 读取 `ui-prompts.json`。
- `src/lib/agent/contract.ts`: 读取 `system.md`，失败时使用 `fallbackSystemPrompt`。
- `src/lib/agent/planner.ts`: 使用系统 prompt、运行时指令、fallback 回复和 fallback 图片 prompt。
- `src/lib/agent/reasoning-prompt.ts`: 限定内部推理和可见进度说明的职责，避免它们形成第二个 Agent 人格。
- `src/lib/server/message-service.ts`: 使用生成 note、失败文案、上传图 focus、默认生成图 label。
- `src/lib/server/conversation-context.ts`: 使用传给 planner 的会话上下文文案。
- `src/lib/server/context-memory.ts`: 保存滚动会话摘要、跨会话偏好，并生成资产语义摘要；长会话只向 planner 提供摘要、未压缩的新消息和相关资产。
- `src/lib/server/reference-resolver.ts`: 使用参考图识别原因文案。
- `src/lib/server/store.ts`: 使用新会话和历史记录相关文案。
- `src/components/app-shell.tsx`、`src/components/chat-composer.tsx`: 使用 `ui-prompts.json`。

原则上，优化 Agent 语言和 prompt 行为时先改这个目录；只有在需要新增配置字段、改变数据结构或改变真实业务逻辑时，才改 `src/`。

## 常见修改路径

### 想统一 Agent 说话风格

只改 `system.md` 中对应的人格、表达和示例规则。不要再向 schema、Planner runtime 或普通 Skill 复制一遍。

如果模型不可用或代码修复路径的直出文案不一致，再单独校正 `runtime-copy.json` 的 `fallbackAssistantReplies`、`assistantNotes`、`failureMessage`；这些是静态 UI 文案对齐，不是第二套人格提示词。

### 想调整什么时候追问、什么时候直接生成

通用路由先改 `system.md` 的 decision tree；某个专业场景独有的追问门槛或流程则改对应 Skill。

如果 Planner 不可用时也要一致，需要同步看 `src/lib/agent/planner.ts` 的离线和输出修复逻辑。简单默认值可以放在 `runtime-copy.json` 的 `behaviorDefaults`，复杂判断仍然属于代码逻辑。

### 想提高图片 prompt 质量

优先改 `system.md` 的 `English prompt craft`。

如果 planner 失败时的图片 prompt 也要更好，改 `runtime-copy.json` 的 `fallbackImagePrompt`。

### 想优化首页快捷提示

只改 `ui-prompts.json`。

不要把大量产品说明塞进快捷 prompt。这里的目标是帮助用户快速发起一个可执行需求。

### 想改失败、处理中、生成完成后的话术

优先改 `runtime-copy.json`：

- 图片调用失败：`failureMessage`
- 补充信息 note：`assistantNotes.clarification`
- 生成结果 note：`assistantNotes.singleResult`、`assistantNotes.multipleResultTemplate`
- 本地预览 note：`assistantNotes.localPreviewTemplate`
- 参考图 note：`assistantNotes.referenceGenerationTemplate`、`assistantNotes.referenceResolutionTemplate`

## 修改边界

只改 prompt 文件通常可以覆盖：

- 文案风格。
- 系统提示词。
- 兜底回复。
- prompt examples。
- 快捷提示词。
- 简单默认值。

需要改代码的情况：

- 新增 JSON 字段或改变字段层级。
- 改变 `PlannerOutput` 字段结构。
- 新增 `nextAction`。
- 改变参考图选择、生成调用、文件保存等真实流程。
- 增加新的模板占位符但没有在代码中传值。

## 验证方式

改完后至少跑：

```bash
pnpm typecheck
pnpm lint
```

如果改了 JSON 结构、planner 行为或前端快捷 prompt，再跑：

```bash
pnpm build
```

如果改了 `skills/`，至少跑：

```bash
pnpm test:skills
```

如果改了会话摘要、偏好记忆或资产召回，再跑：

```bash
pnpm test:context
```

人工检查建议覆盖这些场景：

- 空输入，只上传图。
- 用户说“先别出图，给我几个方向”。
- 用户给清晰文生图需求。
- 用户说“改上一张 / 参考这张 / 不要参考前面的”。
- 图片模型不可用时是否走兜底文案，且风格仍然一致。

## 给独立优化 Agent 的工作建议

1. 先读 `system.md`，理解当前人格、行为和输出格式。
2. 再读 `runtime-copy.json`，找出哪些固定文案会绕过模型直接展示给用户。
3. 最后读 `ui-prompts.json`，检查前端是否在引导用户输入符合预期的需求。
4. 做风格优化时，让 System 负责模型回复；只检查 fallback 和代码直出文案是否与它明显冲突，不把完整风格规范复制过去。
5. 不要改动 JSON key，除非同时更新 TypeScript 类型和调用点。
6. 改完用上面的验证命令确认没有类型或构建问题。
