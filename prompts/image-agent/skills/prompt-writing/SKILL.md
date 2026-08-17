---
id: prompt-writing
name: 图片提示词写作
version: 0.1.0
description: 用于为用户编写、改写、拆解或教学图片 prompt、关键词和模板，把专业视觉判断以可复制文本交付，不直接生图。
triggers:
  - 写提示词
  - prompt 模板
  - 图片 prompt
  - 改写 prompt
  - 提示词教学
  - 关键词模板
  - 生图提示词
antiTriggers:
  - 直接出图
  - 按这个生成
  - 立刻画一张
defaultAction: discuss
---

# 图片提示词写作

## 适用与不适用

用于用户要拿走一段 prompt、关键词模板、变量化模板、提示词改写或写作方法。交付物必须出现在 `assistantReply` 中，默认不触发生图。“图片提示词”里的“图片”描述用途，并不等于要求生成。若用户同一轮明确说“写完直接按它出图”，可以把最终 prompt 同时用于 generation；否则 `generation` 必须为 null。

## 专业 brief

提取 `targetModelOrUse`、`subject`、`scene`、`styleAnchor`、`composition`、`camera`、`lighting`、`palette`、`materials`、`textRendering`、`referencePolicy`、`negativeConstraints`、`templateVariables`。用户没指定模型时写通用自然语言 prompt，不虚构某个平台专属参数。若基于图片写 prompt，要读取图像可见事实并说明哪些是观察、哪些是用户新要求。

## 信息充分度与追问

有主体和一个视觉方向即可写完整基线。只有“给我一个提示词”时问想画什么，不列模型参数清单。用户给出一段旧 prompt 时先保留所有有效约束，再去除关键词堆砌、互相冲突画风、无意义质量词和冗长负面词。用户想要模板时用清楚占位符，并给一个填好的示例。

## assistantReply 风格

先用一两句解释写法重点，再给可复制的 prompt。根据用户语言可附中文拆解，但实际生图 prompt 默认用自然英文；需要画面内中文时精确引用。不要把内部 JSON、skill 或模型调用细节交给用户，也不要只回几个散乱 tag。

## prompt recipe

按：核心主体与动作 → 场景和叙事 → 构图与镜头 → 光线 → 色彩 → 材质和微细节 → 风格锚点 → 文字要求 → 简短禁止项。通常 60-150 个英文词，复杂多主体可适当更长。把“高级感、科技感、治愈、电影感”等词翻译成可视化材料、光线、颜色、空间和镜头。禁止堆 `8k, masterpiece, best quality, trending on artstation`，禁止互相冲突的风格列表。

## 正例、反例与质量检查

正例：“写一个金属充电宝详情图 prompt，不要出图”应给完整英文文本并讨论。“把这段 tag 改成自然语言 prompt”应去噪保约束。反例：“按下面 prompt 直接画一张”是生成请求；“分析这张图是什么风格”是图片分析。

检查 prompt 是否可直接复制；主体、构图、光线、材质和颜色是否具体；用户约束是否无遗漏；是否没有冲突风格和空质量词；是否把文字策略说清；在没有明确出图指令时是否完全不生成。
