---
id: local-image-edit
name: 局部图像编辑
version: 0.1.0
description: 用于在已有图上替换、添加、删除或调整局部元素，强调编辑目标、遮罩范围、主体稳定和画面其余区域像素级保持。
triggers:
  - 只改局部
  - 把这张里的
  - 去掉图里的
  - 背景换成
  - 颜色改成
  - 增加一个
  - 保持其他不变
antiTriggers:
  - 只借风格
  - 另起一张
  - 分析图片
defaultAction: clarify_or_generate
---

# 局部图像编辑

## 适用与不适用

用于对一张明确存在的上传图或生成图做局部替换、删除、添加、颜色修改、背景替换或小范围材质调整。编辑目标必须落到真实资产。用户要借风格画新图时使用 `reference-style-transfer`；用户只想描述图像时使用 `image-critique`；没有可用图片时不能盲生成，应请用户上传、选择历史图或明确“上一张”。

## 专业 brief

提取 `targetAssetId`、`editScope`、`targetRegion`、`requestedChange`、`preserveSubjectIdentity`、`preserveComposition`、`preserveLighting`、`preserveBackground`、`edgeIntegration`、`openQuestions`。先判断 local edit 还是 global adjustment。局部编辑只改被点名区域；全局色调/氛围调整可以影响整画面，但仍要保持主体身份、姿态、构图和镜头。

## 信息充分度与追问

有明确图片、目标区域和变化内容即可编辑。图片存在但“这里改一下”指向不清时，问具体区域；变化清楚但图片不存在时，问要改哪张图。不要因为用户口语不标准就死路，结合资产时间线解析“上一版、刚那张、原图”。如果多个相似资产都可能匹配且风险高，再让用户确认。

## assistantReply 风格

简短说明会改哪里、怎样融合，以及哪些关键内容保持不动。不要声称绝对像素一致，但必须把稳定约束传给生成模型。对大范围背景替换要说明会保留主体边缘、姿态和镜头，而光线交界会做必要匹配。

## generation.prompt 模板

局部编辑必须以 `Modify ONLY [具体区域]` 开始，随后写清目标变化、大小、位置、材质、受光和边缘融合。再列稳定约束：same composition, same camera angle, same subject identity, same pose, facial features, body proportions, outfit, unchanged background regions, and same lighting direction outside the edited area。全局调整使用 `Apply a global tonal/atmospheric adjustment while preserving...`，不得伪装成局部遮罩。

## 正例、反例与质量检查

正例：“把上一张桌面换成深色木纹，产品和角度别动”应 edit 最新图。“去掉左下角杯子，其他像素保持”是明确局部删除。反例：“参考这张的木纹做一个新桌面场景”属于参考另起；“颜色改成蓝色”但没有图片时必须 clarify。

检查 targetAssetId 是否真实；编辑区域是否唯一明确；prompt 是否含 `Modify ONLY`；主体身份、构图、镜头、未编辑背景和外部光线是否被保护；新增元素是否匹配透视、尺度、阴影与噪点。
