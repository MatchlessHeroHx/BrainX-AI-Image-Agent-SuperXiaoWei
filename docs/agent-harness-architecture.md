# Agent Harness 架构约定

## 核心结论

本项目的通用 Agent 围绕 provider-neutral Harness 构建。用户可以在页面选择 DeepSeek 或 Gemini 作为基础模型；两者都负责理解用户意图、选择候选 Skill、维护简报与记忆，并输出稳定的 `PlannerOutput`。图片生成 Provider、视觉 perception 和定制工作流属于外围能力，不改变这条核心链。

```text
用户消息 / 资产事实
        ↓
Skill manifest 召回（只加载 top-3）
        ↓
用户所选 Harness Adapter + 通用 Skill 正文/examples
        ↓
统一 PlannerOutput 合同
        ↓
参数确认 → 图片 Provider Adapter → 资产持久化
```

## Harness Provider 边界

`src/lib/agent/planner.ts` 只能调用 `AgentHarnessAdapter`，不得直接调用 DeepSeek、Gemini 或其他模型客户端。

Provider Adapter 负责：

- 认证与配置检查；
- 供应商请求格式；
- structured JSON、multimodal、prompt caching 等差异；
- token usage 归一化；
- 将结果收敛为统一 Harness result。

DeepSeek 是默认 provider，Gemini 3.7 Flash 是页面公开的可选 provider/model。用户选择属于通用 Harness 配置；普通 Skill 自身仍不能切换核心模型。需要固定模型的明确 custom workflow 可以覆盖用户选择。

## 通用 Skill 合同

没有声明 `executionMode` 的 Skill 自动视为 `generic`。通用 Skill 可以包含：

- manifest：名称、版本、描述、触发词、反触发词；
- `SKILL.md`：场景规则、追问策略、prompt recipe、质量标准；
- `examples.json`：正例、反例和回归断言；
- 可按触发词加载的文本 runtime resource。

通用 Skill 不可以拥有：

- 专用 TypeScript 分支；
- 独立状态机或持久化结构；
- 专用 UI 表单；
- 自己选择 Agent provider/model；
- 绕过统一 `PlannerOutput` 的执行路径。

因此新增普通 Skill 时，只应增加 Skill 目录和测试数据，不修改 `planner.ts`、`message-service.ts`、公共类型或前端组件。

## A+ custom workflow 例外

电商 Skill 同时包含普通电商创作知识和 A+ 定制工作流。由于 A+ 需要 brief 表单、7 模块阶段状态、中间策划产物及固定的多模态翻译模型，它声明：

```yaml
executionMode: custom
customWorkflow: a-plus
```

它属于兼容 Skill 召回界面的应用工作流，即“伪 Skill”。A+ 的特殊能力可以继续维护，但不得被抽象成所有 Skill 的必备字段，也不得作为新增普通 Skill 的模板。

## 架构验收条件

以下条件必须持续成立：

1. 默认 Agent runtime 是 `deepseek/deepseek-v4-pro`。
2. planner 源码不直接导入 structured-output provider 客户端。
3. 除 A+ 外的现有 Skill 均为 `generic`，且没有 `customWorkflow`。
4. 页面只暴露公开 Agent 模型；内部 workflow 模型不能出现在用户选择器中。
5. 只有 custom Skill 的 runtime resource 可以覆盖用户所选 Agent provider/model。
6. 新增一个普通 Skill 只需要新增目录、`SKILL.md`、`examples.json` 和相应路由测试。
