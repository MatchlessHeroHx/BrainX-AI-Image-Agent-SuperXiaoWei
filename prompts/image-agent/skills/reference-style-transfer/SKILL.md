---
id: reference-style-transfer
name: 参考风格另起新图
version: 0.1.0
description: 用于借参考图的配色、光线、构图、材质或氛围创作新主体，明确借用维度并避免误判为原图编辑。
triggers:
  - 参考这张的风格
  - 借这个配色
  - 按这张的光线
  - 参考构图
  - 只借氛围
  - 同样的感觉
  - 风格另起
antiTriggers:
  - 在原图上改
  - 只改局部
  - 描述这张图
defaultAction: generate
---

# 参考风格另起新图

## 适用与不适用

当用户要把参考图当作风格证据，但输出是新的主体或场景时使用。常见借用维度包括配色、光线方向、构图骨架、镜头距离、材质语言、笔触、节奏或整体氛围。用户要改同一张画布时应使用 `local-image-edit`；用户只想分析参考图时使用 `image-critique`；没有任何图片资产却说“参考这张”时必须追问上传或选择具体图片。

## 专业 brief

提取 `referenceAssetIds`、`borrowDimensions`、`newSubject`、`newScene`、`mustNotCopy`、`compositionAdaptation`、`paletteAdaptation`、`identityPolicy`、`copyPolicy`。必须区分“借什么”和“换什么”。不要仅写“same style as reference”，也不要复制参考图中的品牌、文字、独特人物身份或不相关主体。

## 信息充分度与追问

参考图存在、用户说清新主体，并至少暗示一个借用维度，就足以生成。只说“照这个做一张”时，问想保留配色/光线/构图中的哪一层，以及新图主体是什么，最多两个问题。用户明确说“只借配色”时，不要顺便沿用原构图和主体。多张参考图时，为每张分配清楚职责，例如 A 借配色、B 借镜头、C 借材质。

## assistantReply 风格

回复要用平实语言说清楚“会借哪几层、不会复制什么、新图会换成什么”。不要模糊承诺完全复刻风格。涉及可识别艺术家或受保护角色时，遵守系统边界，并把描述落到可见特征而非只写名字。

## generation.prompt 模板

英文 prompt 开头明确：`Create a new image, not an edit of the reference.` 接着逐项写 `Borrow only ... from reference asset ...`，再完整描述新主体、新场景、构图适配、光线、材质和色彩。最后写不复制的内容：`Do not copy the original subject, text, logo, or branded elements.` referenceAssetIds 只放真实且相关的图片，按贡献度排序。

## 正例、反例与质量检查

正例：“借这张的琥珀配色和侧逆光，做一张咖啡店海报”应新建海报并只借两层。“A 借构图、B 借材质，做一台概念音箱”应明确多参考职责。反例：“把这张海报的杯子换成茶壶”是原图编辑；“这张是什么风格”是图片分析。

检查借用维度是否具体；新主体是否完整描述；有没有误带参考主体、文字或 logo；是否错误使用 edit；多参考是否职责清晰；prompt 是否能脱离“same style”仍然被模型执行。
