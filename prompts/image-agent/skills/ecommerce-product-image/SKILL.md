---
id: ecommerce-product-image
name: 电商商品图 / Amazon A+ 图
version: 0.3.0
description: 用于电商主图、商品图、详情卖点图、场景图、材质细节图、包装图、组合图、Amazon A+ / Premium A+ 详情套图等商业图片创作；确认用户要生成 A+ 图后必须先弹出选填简报卡片收集产品名称、突出卖点、国家和销售平台，这些信息只用于第一步内部 A+ 指导模板，给用户展示时称为“电商图方案”；A+ 图随后按“产品图 + runtime A+ 指导模板提示词生成内部指导模板 → 已保存指导模板 + 产品图 + runtime 模块提示词生成单模块具体 prompt → 已保存模块 prompt + 产品图生成模块图片”的流程执行。
triggers:
  - 电商图
  - 商品图
  - 产品图
  - 主图
  - 白底图
  - 详情图
  - 详情页
  - 卖点图
  - 场景图
  - 材质图
  - 质感图
  - 包装图
  - 组合图
  - 套装图
  - A+
  - A+图
  - A+ 套图
  - Premium A+
  - Amazon
  - 亚马逊
  - listing
  - SKU
  - 3C
  - 快充
antiTriggers:
  - 角色设定
  - 世界观
  - 纯艺术插画
  - 只想聊绘画风格
  - 分析这张图
  - 对比这两张
  - 描述图片
  - 图里有什么
  - 写提示词
  - prompt 模板
defaultAction: clarify_or_generate
executionMode: custom
customWorkflow: a-plus
---

# 电商商品图 Skill

这个 Skill 负责把“电商图”从一句泛泛的审美需求，拆成可执行的商业图片任务。它优先服务商品可信度、转化目标、平台合规和详情页叙事，而不是单纯追求“好看”。

## 1. 使用边界

使用该 Skill：

- 用户明确说电商图、商品图、主图、白底图、详情图、A+、listing、Amazon、亚马逊、SKU、卖点、转化。
- 用户上传商品图，并要求做主图、场景图、详情卖点图、材质细节图、包装图、组合图、广告图或 A+ 图。
- 用户询问 3C、美妆、食品、家居等商品图参数、拍摄方式、详情页结构或 prompt 模板。

不要使用该 Skill：

- 用户主要在做角色、世界观、艺术插画、纯风格讨论。
- 用户只是局部修改已有图，且没有商业图片目标；这种情况更接近 local-image-edit。
- 用户只是要求借一张图的色调/构图另起一个非电商主体；这种情况更接近 reference-style-transfer。

如果用户要求“写一个商品图 / A+ 图 prompt 模板”，仍然可以选中本 Skill，但 `nextAction` 必须是 `discuss`，不要生成图片。

## 2. Agent 思考顺序

每次进入电商图场景，按这个顺序判断：

1. 这是普通单张商品图，还是 Amazon A+ / Premium A+ 套图工作流。若是 A+，必须走第 6 节三阶段流水线，不要直接套普通商品图 recipe。
2. 需要的 shot type 是什么：平台主图、场景图、详情卖点图、材质细节图、包装图、组合图、A+ 套图、A+ 单模块。
3. 是否有真实商品参考图。若有，优先保证商品身份不乱变；若没有，明确这是概念款。
4. 商品品类是什么。3C、美妆、食品、家居、宠物、运动、工具等品类的光线、文案和场景逻辑不同。
5. 用在哪个渠道：Amazon 主图、Amazon A+、独立站详情页、淘宝详情页、社媒广告等。
6. 是否需要文字上图。默认不乱加字；详情卖点图和 A+ 图可以预留文案区或渲染用户指定文案。
7. 是否存在合规风险：价格、折扣、排名词、外部链接、二维码、无依据认证、竞品品牌、错误变体、遮挡商品的促销元素。

## 3. 追问策略

只问最高价值缺口，不要列长清单。

- 用户只说“我想生成电商图”：问两个信息，产品是什么，以及主要做主图、详情页卖点图还是使用场景图。如果用户有商品图，邀请上传。
- 用户说了产品但没说用途：根据品类给一个建议用途，然后问确认。例如 3C 充电宝可建议先做主图或详情卖点图。
- 用户上传了商品图但没说要做什么：优先问“做主图、详情卖点图还是使用场景图”，不要再问产品是什么，除非图像看不清。
- 用户问“标准电商图有哪些参数”：`discuss`，解释主图、详情、场景、材质、文案区、比例、渠道差异，不生成。
- 用户要求 A+ 套图 / A+ 出图：先检查会话状态里是否已收集 `aPlusBriefCollected` 或已有内部【A+ 指导模板】。如果没有，先返回 `clarify` 并触发 A+ 简报卡片；卡片字段是选填的，包括产品名称、要强调突出的卖点、目标国家 / 地区、销售平台。用户填多少用多少，不要把未填写字段当成阻塞项。
- 用户提交 A+ 简报卡片后，才使用运行时资源 `a-plus-guidance-template` 输出第一步内部【A+ 指导模板】，`nextAction` 必须是 `discuss`，不要直接生成 7 张图。系统会把本轮完整指导模板保存为中间产物，后续模块 prompt 使用它；给用户只说“电商图方案”已经生成并做简要总结。
- 用户要求 A+ 单模块：若已有指导模板和模块编号，使用对应运行时资源 `a-plus-module-XX-translator` 生成该模块具体 prompt；若用户要出图，再把该具体 prompt 作为 `generation.prompt` 并带上产品参考图进入生成表单。系统会把单模块 prompt 保存为中间产物，后续模块出图优先复用。

## 4. 通用电商图 Prompt Recipe

生成普通电商图时，英文 prompt 按这个顺序写：

1. Product identity：品类、形态、颜色、材质、结构；有参考图时写 "the same product as the referenced image"。
2. Shot type：main listing image / lifestyle scene / benefit detail image / material macro / packaging shot / bundle layout / A+ module。
3. Commercial purpose：点击理解、展示卖点、说明使用场景、强化材质、降低误解。
4. Composition：centered hero, 45-degree angle, overhead flat lay, hand-held scene, macro close-up, left/right negative space for copy。
5. Lighting：white softbox, side light, rim light, cool tech lighting, warm window light。
6. Material rendering：brushed metal, glass highlight, matte plastic, fabric weave, leather grain, food freshness, liquid texture。
7. Background and props：背景干净，道具服务商品，不抢主体。
8. Copy policy：no text, reserved copy area, or exact user-provided text rendered clearly。
9. Compliance guard：no price, no discount badge, no fake logo, no watermark, no misleading variant, no border。

3C 子配方：

- 主体要清楚显示接口、屏幕/电量显示、边缘高光、金属/玻璃/磨砂塑料质感。
- “科技感”要翻译成冷调方向光、干净几何背景、细腻反射和少量功能视觉暗示，不要只写 blue glow。
- 详情卖点图要留出清楚的文案区，文字不要压住产品主体。

## 5. Amazon 主图内置 Prompt

当用户上传真实商品图并要求“先生成主图 / Amazon 主图 / 白底图 / listing 主图”时，以这个结构生成英文 prompt：

[Task] Restore the input product image into a professional Amazon-standard e-commerce hero shot. Fix physical and angular flaws while preserving the original product identity exactly.

[Subject] The same product as the input image. Preserve every original detail: pattern, motif placement, color palette, material texture, weave, print, stitching, hardware, finish, and craftsmanship. Do not invent new patterns. Do not alter colors. Do not simplify complex motifs.

[Fix - Physical State] Remove wrinkles, folds, creases, curled edges, bent corners, sagging, surface deformation, dust, stains, and amateur styling artifacts. The product must appear properly shaped, fully extended, and professionally styled in a studio.

[Fix - Angle and Framing] Reshoot from a corrected commercial camera angle. Show the complete product clearly, centered, with enough margins for an Amazon listing image. Avoid extreme perspective distortion.

[Lighting and Background] Clean white or very light neutral background, softbox studio lighting, natural contact shadow, crisp product edges, no props unless the product category requires scale context.

[Compliance] No price, no discount badge, no promotional sticker, no extra logo, no watermark, no border, no misleading variant, no text overlay unless the user explicitly asked for it.

## 6. Amazon Premium A+ 套图三阶段流水线

A+ 套图不是搜索结果页主图，它是详情页里的长图文叙事区。它的目标是品牌情绪建立、深度卖点解释、使用场景沉浸、信任背书和行动收束。默认使用 7 个模块，按详情页从上到下排列。

如果用户只说“做 A+ 图 / A+ 套图 / 直接生成 7 张 A+ 图”，不要跳到图片生成，也不要立刻跑指导模板。必须先弹出 A+ 简报卡片，收集产品名称、要强调突出的卖点、目标国家 / 地区、销售平台。弹出卡片时，如果本轮文字、历史 brief 或产品图观察里已经识别出这些字段，要作为候选项展示给用户选择或修改，不要强制当成最终值。四项都是选填字段，用户填多少用多少；没有填写的字段不阻塞指导模板生成，后续可以基于产品图、上下文和可调整假设处理。需要至少有产品图或清晰产品信息；有真实商品图时优先使用它，保持产品身份一致。核心卖点、目标市场、品牌调性缺失时，可以基于产品图合理推测，但必须说明推测是可调整假设，不能捏造认证、专利、临床结论、销量排名等可验证事实。

### 6.1 强制状态机

按下面阶段推进，不要跳步：

0. `aPlusStage: brief_form`：确认用户要生成 A+ 图后，先弹出 A+ 简报卡片。卡片字段选填：产品名称、要强调突出的卖点、目标国家 / 地区、销售平台。若系统已从本轮需求、历史 brief 或产品图观察识别到候选值，要随卡片展示候选项，用户可点选或修改；不要把候选项直接当成用户确认值。该卡片只服务于阶段 1 的内部指导模板，不直接生成模块 prompt 或图片；用户未填写的字段不阻塞下一步。给用户展示时，把这一步称为“电商图方案”。
1. `aPlusStage: guidance_template`：根据产品图 / 商品信息 / 已提交的 A+ 简报 + 运行时资源 `a-plus-guidance-template`，输出一份固定的【A+ 指导模板】作为内部工作稿。给用户只展示“电商图方案”已生成和简要总结，不展开完整模板。本阶段只产出文本，`nextAction` 必须是 `discuss`，`shouldGenerate` 必须是 `false`。完整指导模板会保存到会话 `aPlusArtifacts.guidanceTemplate`。
2. `aPlusStage: module_prompt`：根据已保存或已确认的【A+ 指导模板】+ 产品图 + 对应运行时模块资源（`a-plus-module-01-translator` 到 `a-plus-module-07-translator`），生成某个模块的具体英文生图 prompt。用户只要 prompt 时，`nextAction` 是 `discuss`；用户明确要生成该模块图片时，可以把这个具体 prompt 直接放入 `generation.prompt`。完整模块 prompt 会保存到会话 `aPlusArtifacts.modulePrompts[XX]`。
3. `aPlusStage: module_image`：根据阶段 2 的具体 prompt（优先使用已保存模块 prompt，没有则现场根据指导模板生成）+ 产品参考图生成对应 A+ 模块图片。模式优先用 `reference_generate`，`referenceAssetIds` 必须包含真实产品图或已生成的 Amazon 白底主图。可以一次生成多个模块，但必须使用 `generation.tasks` 为每个模块准备独立 prompt；不要用一个泛化 `generation.prompt` 承载 7 个不同模块图。

如果用户要求“一次生成整套 A+ 图”，但还没有收集 A+ 简报，先弹简报卡片；如果已收集简报但还没有内部指导模板，先生成电商图方案并只展示简要总结。如果已有指导模板，可以按模块01-07分别生成具体 prompt，并通过 `generation.tasks` 一次提交 7 个模块图任务。不要用一个泛化 prompt 同时生成 7 张不同模块图。

### 6.2 阶段 1：A+ 指导模板（来自运行时资源 a-plus-guidance-template）

当用户要求生成 A+ 策划、A+ 结构、A+ 图提示词指导模板，或首次请求 A+ 出图但缺少指导模板时，按下面逻辑生成完整内部指导模板。用户端只展示“电商图方案”已生成和简要总结，不直接展开完整模板：

- 先输出【产品判断】：品类、推测用户画像、推测核心卖点、推测依据。
- 再输出【字体系统卡】：模板代号、微调说明、Headline 字体描述、Body 字体描述、徽章/标注线字体描述、主色、辅色、点缀色、情绪关键词。
- 再输出【类目视觉策略】：类目判断、判定依据、摄影类型、风格调性、主视觉场景倾向、文案语气、辅助小图形态、色彩与光影偏好。摄影类型必须传递到后续每个模块 prompt 的 [Style] 段。
- 再输出【整体叙事逻辑】：说明 7 个模块从品牌情绪到卖点解释再到信任收尾的认知递进。
- 然后按 7 个模块逐个输出：模块任务、核心卖点、选定版式、选择理由、主视觉描述、文案、子图说明、alt text、推荐尺寸、版式说明。
- 最后输出【7 模块节奏自查】：版式分布、相邻模块是否雷同、场景/信息/细节/对比是否交错、字体是否一致。

指导模板产出纪律：

- 7 个模块严格按固定分工执行，不得调换顺序、合并模块或自创模块。
- 每个模块只能从该模块的版式变体里选一种，不得自创版式。
- 7 个模块必须使用同一套字体系统卡，不得在模块间切换字体、颜色或情绪关键词。
- 所有视觉描述必须落到具体场景、动作、灯光、材质、画面层次、文字原文，禁止只写“高级感 / 科技感 / 有质感”。
- 所有文案可直接交付使用，禁止占位符：`xxx`、`TBD`、`插入标题`、`待补充`。
- 每个 Headline 为 4-9 个英文单词，Body Text 为 1-3 句，每段不超过约 140 字符。

7 个固定模块：

1. 模块01【品牌情绪 Hero Banner】1464 x 600 px。建立第一印象与品牌调性，承载情绪化主张，不堆功能点。版式 A1/A2/A3。
2. 模块02【核心价值主张】1464 x 600 px。用一句强主张回答为什么值得买。版式 B1/B2/B3。
3. 模块03【关键功能可视化】1464 x 600 px。用 3-4 个功能点、图标、拆解或标注解释核心功能。版式 C1/C2/C3。
4. 模块04【场景沉浸图】1464 x 600 px。让用户代入真实使用场景。版式 D1/D2/D3。
5. 模块05【技术 / 工艺细节】1464 x 600 px。展示工艺、材质、结构差异化。版式 E1/E2/E3。
6. 模块06【适用人群与场景矩阵】1464 x 600 px。覆盖不同人群和使用情境。版式 F1/F2/F3。
7. 模块07【信任收尾与行动召唤】1464 x 600 px。用品牌承诺、使用建议或产品矩阵收束。版式 G1/G2/G3。

版式节奏硬规则：

- 模块03 和模块06 不能同时使用 1x4 横排卡片，必须有一个换版式。
- 模块01 和模块04 不能同时是无信息层的满屏场景图。
- 相邻两个模块不能视觉结构高度相似。
- 7 个模块不能全部偏场景大图，也不能全部偏信息密度图。

### 6.3 字体系统模板库

策划 A+ 图时必须先选一套字体系统，7 个模块保持一致：

- WARM-01：母婴、家居、宠物、礼品、轻食。圆润/人文无衬线，温暖、友好、手作感。主色奶油、暖橙、莫兰迪粉。
- TECH-02：数码、家电、智能硬件、户外科技。工业感粗体无衬线 + 几何无衬线，精确、现代、工程感。主色深蓝、炭黑、银灰、电光蓝。
- EDIT-03：美妆、香氛、轻奢配饰、护肤、高端食品。高对比细衬线 + 极细无衬线，精致、感性、轻奢。主色哑光黑、米白、香槟金、暗酒红。
- BOLD-04：户外、运动、工具、汽配、男士用品。粗壮 condensed 无衬线，硬朗、力量、性能。主色哑光黑、橙红、橄榄绿、警示黄。
- MINI-05：文具、家居小物、极简日用。中等字重几何无衬线，克制、安静、干净。主色纯白、浅灰、墨蓝、极简黑。
- PLAY-06：玩具、零食、潮玩、儿童用品、节庆礼品。圆润粗体或装饰字体，活泼、有趣、节日感。主色高饱和糖果色。

### 6.4 类目视觉策略库

按品类选择 1 条策略；跨品类可融合 2 条并说明融合方式。

- 数码 / 3C / 科技：Cinematic commercial photography, dramatic studio lighting。科技、工业设计、未来感；都市/办公/通勤/虚拟空间；产品悬浮、45 度展示、工艺特写；参数化文案；结构爆炸图、接口特写、性能数据；深色 + 蓝/紫/青点缀，侧逆位硬光，冷调，可轻微暗角。
- 家居 / 厨房 / 收纳 / 生活用品：Bright commercial lifestyle photography, natural daylight, evenly lit。真实家庭场景、温馨秩序；生活化文案；使用步骤、收纳前后、容量尺寸；暖白/自然光，木色、米白、浅灰，禁止暗角。
- 美妆 / 护肤 / 个护：Soft beauty product photography, high-key lighting, evenly lit。精致、清透、皮肤通透感；成分/效果/感官文案；成分图、质地特写、皮肤示意；柔光、高光占比大，粉米白/香槟金/品牌主色，禁止暗角。
- 服饰 / 鞋包 / 配饰：Editorial fashion photography, natural street light or studio。街拍、动态、社交媒体风；面料特写、版型、尺码、搭配；自然光或棚拍硬光，强对比，允许轻度边缘衰减。
- 运动 / 户外：Dynamic action photography, high-contrast outdoor lighting。动态、耐用、真实环境；防水/防滑/耐磨测试、人体工学、场景适配；高对比功能色，允许暗角。
- 宠物用品：Warm lifestyle photography, soft natural light, evenly lit。人与宠物互动、温暖真实；安全和舒适；材质安全、尺寸适配、清洁示意；暖调通透，禁止暗角。
- 母婴 / 儿童：Soft warm family photography, even lighting, bright and airy。亲子、安全、柔和；月龄/年龄、安全材质；奶油色、浅粉/浅蓝/浅绿，禁止强阴影和暗角。
- 食品 / 饮料：Bright food photography, overhead or 45-degree natural light。新鲜、食欲、原料真实；风味和健康；原料、营养、步骤、产地；自然暖光，食材色饱和，禁止暗角。
- 工具 / 五金 / 户外作业：Industrial product photography, hard directional lighting。硬朗、可靠、工业感；参数、效率、耐用；扭矩/功率、配件、应用场景、测试；黑黄/黑红警示色，高对比，可暗角。
- 玩具 / 趣味 / 礼品：Bright playful product photography, even colorful lighting。活泼、惊喜、节日感；玩法步骤、配件、安全、年龄适配；糖果色，明亮均匀光，禁止暗角。

### 6.5 阶段 2：A+ 单模块 Prompt Translator（来自运行时模块固定提示词）

当用户已确认某个 A+ 模块，或要求“输出模块 01/02/... 的生图 prompt”，把阶段 1 的指导模板翻译成该模块的英文 prompt。必须同时使用：指导模板、产品图、该模块固定提示词。模块映射如下：

- `a-plus-module-01-translator`：只处理模块01【品牌情绪 Hero Banner】。
- `a-plus-module-02-translator`：只处理模块02【核心价值主张】。
- `a-plus-module-03-translator`：只处理模块03【关键功能可视化】。
- `a-plus-module-04-translator`：只处理模块04【场景沉浸图】。
- `a-plus-module-05-translator`：只处理模块05【技术 / 工艺细节】。
- `a-plus-module-06-translator`：只处理模块06【适用人群与场景矩阵】。
- `a-plus-module-07-translator`：只处理模块07【信任收尾与行动召唤】。

硬性规则：

- 只翻译所选模块，不得混入其他模块内容。
- 若指导模板缺少该模块的版式、文案或主视觉，先补齐该模块具体策划；不要编造可验证事实。
- [Typography System] 必须逐字复制指导模板里的字体系统卡字段，7 个模块保持 100% 一致。
- [Text Overlay] 必须包含指导模板里该模块所有 Headline、Body Text、数据徽章、标注线、子图标签和子图文案；不得改写、省略或翻成中文。
- [Feature Cards] 只在模块03 使用 C1/C2 或模块06 使用 F1/F2 时出现；其他模块和其他版式必须省略整段。
- 画面中的产品形态、颜色、材质、结构必须与上传产品图一致。不得添加产品图中不存在的部件、认证、奖项或竞品元素。

最终 prompt 必须严格按以下段落输出给用户或图像模型：

[Module] Amazon Premium A+ Content - Module XX (<module name>). Aspect ratio approximately 2.44:1, 1464 x 600 px. Selected layout variant: <variant code and name>.

[Layout] Copy the exact layout description for the selected variant. Do not invent or mix layouts.

[Hero Visual] Translate only this module's visual plan into English. Include product, scene, composition, lighting, camera, style, and category strategy.

[Typography System] Copy the font system exactly from the A+ plan: Headline font, Body font, Badge / annotation font, Primary color, Secondary color, Accent color, Mood keywords. All text must use this exact typography system.

[Text Overlay] Include every planned Headline, Body Text, data badge, annotation label, feature-card label, and caption exactly. Text must be clean, sharp, correctly spelled English. Do not add fake text.

[Feature Cards] Include this section only for Module03 C1/C2 or Module06 F1/F2. Describe each card with image, label, and caption.

[Style] Use the category photography type, photographic realism for product, colors strictly from the typography palette, lighting matched to mood keywords, consistent with the full A+ set.

[Negative] no garbled text, no misspelled words, no fake typography, no font substitution, no Chinese characters unless explicitly requested, no watermark, no competitor brand logos, no price tags, no discount badges, no promotional words such as "sale" "best" "#1", no warranty text, no external URLs, no QR codes, no third-party media logos, no unauthorized celebrity faces, no AI distortions on product, no cluttered layout, no fabricated product parts not present in the uploaded reference image, no colors outside the defined typography palette.

Layout library:

- A1: Full-bleed cinematic scene, headline centered or left-aligned, generous negative space, no information layer except the headline.
- A2: Full-bleed product-in-environment shot, headline at bottom-right, large empty space on the left.
- A3: Full-bleed abstract color/material/background, product as visual focus center, headline at top.
- B1: Full-width scene, headline at top, body text below headline, optional badge at bottom-left.
- B2: Image occupies left 60% of canvas, text block occupies right 40%. Headline at top of text block, body below, optional badge at bottom.
- B3: Center large product shot, headline above, body text split into two columns below.
- C1: Top headline strip 25% + bottom row of 4 feature cards 75%.
- C2: Top headline strip 25% + bottom row of 3 larger feature cards 75%.
- C3: Center product shot with 4 annotation lines radiating to corners.
- D1: Full-bleed lifestyle scene with text overlay at bottom-left or bottom-right.
- D2: Top 1/3 text zone, bottom 2/3 visual zone.
- D3: Two-scene split with unified headline at top center.
- E1: Center large product detail close-up with annotation lines.
- E2: Image-left text-right split, exploded view or cross-section 60%, craft copy 40%.
- E3: Three-panel horizontal craft details.
- F1: Top headline strip 25% + bottom row of 4 persona/scenario cards 75%.
- F2: Top headline strip 25% + bottom 2x2 persona/scenario grid 75%.
- F3: Left headline/body + right 1x3 vertical scenario cards.
- G1: Full-width scene with brand promise headline and body.
- G2: Center product family lineup with unified headline.
- G3: Top 1/2 visual hero, bottom 1/2 three brand-promise columns.

### 6.6 阶段 3：根据具体 prompt 生成模块图片

当用户明确要生成某个 A+ 模块图片，且阶段 2 已能得到该模块具体 prompt：

- `nextAction` 使用 `reference_generate`，除非用户明确是在编辑上一张模块图。
- `generation.prompt` 必须是阶段 2 生成的完整英文 prompt，而不是普通电商图 prompt。
- 当用户要求多个模块一次生成时，`generation.tasks` 必须包含每个模块的独立 prompt、模块标签和同一组产品参考图；父级 `generation.prompt` 只保留第一项 prompt 作为兼容字段。
- `referenceAssetIds` 必须带产品图；如果会话里已有由产品图生成的 Amazon 白底主图，优先把它作为参考图之一。
- `outputCount` 默认 1，表示每个模块抽几张。不要因为用户说“一套 A+”就用同一个 prompt 生成多张。
- `assistantReply` 简短说明正在按哪个模块生成，不要把内部文件名、skill id 或状态机字段暴露给用户。
- 若用户要求整套 7 张都生成且已有电商图方案，逐模块准备 7 个不同 prompt 后一次提交；若缺少电商图方案，先补方案，不要跳步。

## 7. 质量自检

生成前检查：

- 是否明确 shot type。
- 是否说明真实商品图要保持外观，或说明无图时只是概念款。
- 是否把“高级感/科技感/质感”等抽象词翻译成材质、光线、构图、背景、留白。
- 是否处理了文字策略。
- 是否避开价格、折扣、排名、二维码、外链、竞品品牌、无依据认证、遮挡商品的元素。
- A+ 图是否先完成指导模板，再生成单模块具体 prompt，最后才进入图片生成。
- A+ 图是否有统一字体系统、模块尺寸、版式选择、类目视觉策略和节奏检查。

`skillBrief` 建议字段：

- `productCategory`
- `shotType`
- `referenceMode`
- `targetChannel`
- `sellingPoints`
- `copyPolicy`
- `aPlusStage`
- `aPlusBriefCollected`
- `productName`
- `targetCountry`
- `salesPlatform`
- `aPlusGuidanceSummary`
- `aPlusModulePromptStatus`
- `selectedModule`
- `openQuestions`

运行时资源说明：

- docs/A+图Skill功能&流程指导 里的文档只作为人读和开发参考。
- 业务运行时必须使用本 Skill 目录下 `runtime-resources.json` 指向的 `runtime-prompts/*.prompt.md`。
- A+ 指导模板和单模块 prompt 的 planner LLM 调用固定使用 `google-ai-studio/gemini-3.5-flash`，不跟随用户选择的全局 Agent 模型。
- 如果 active creative brief / saved artifacts 里已有 `aPlusArtifacts.guidanceTemplate`，生成模块 prompt 时必须优先使用该已保存指导模板。
- 如果 active creative brief / saved artifacts 里已有 `aPlusArtifacts.modulePrompts[XX]`，生成模块图片时必须优先使用该已保存模块 prompt，除非用户明确要求重新改写。
