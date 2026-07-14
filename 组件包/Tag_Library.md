---
title: 工程全生命周期标签库
status: authoritative
version: 1.1
date: 2026-07-10
tags:
  - obsidian
  - taxonomy
  - engineering-slicer
---

# 工程全生命周期标签库

> [!important] 权威标签契约
> 本文件即组件包的 `Tag_Library.md`。AI 只能从本文件选择标签，不得自造。`Category / TagL1 / TagL2` 用于 MOC 索引与筛选；物理输出目录只由 `library + folder_type` 和 `folder-map.json` 决定。

本标签库覆盖工程项目从营业机会、招投标、设计、采购、施工、调试、移交到运维复盘的全生命周期知识管理。

## 1. 设计原则

- 使用多轴标签，不把所有信息塞进 `Category / TagL1 / TagL2`。
- 保留 `Category / TagL1 / TagL2` 作为主 MOC 索引三元组，用于决定卡片进入哪个知识地图和 Dataview 索引。
- 标签保持英文 slug，中文解释用于人读和 AI 判断。
- AI 只能从本库选择标签，不能自造标签。
- 无法判断时使用未分类或待确认状态，不强行归类。
- 标签用于检索和治理，正文中的实体关系优先用 `[[wikilink]]`。

## 2. 推荐字段

建议卡片 frontmatter 使用以下字段：

```yaml
Project:
Map_Index:
Card_Type:
Category:
TagL1:
TagL2:
Lifecycle_Phase:
Domain:
Discipline:
Doc_Type:
Event_Type:
Info_Type:
Management_Topic:
Process_Topic:
Contract_Topic:
Risk_Level:
Priority:
Status:
Action_Status:
Source_Type:
Confidentiality:
Tags:
```

### 2.1 主 MOC 索引三元组

字段 `Category / TagL1 / TagL2` 不再作为全部信息的容器，而是作为“导航主轴”。每张卡片必须有且只有一组主索引三元组，用于 Obsidian MOC 页面、Dataview 表格和未来插件路由。

| 字段 | 职责 | 示例 |
| --- | --- | --- |
| `Category` | 一级 MOC，大领域或管理域 | `#cat/design`、`#cat/construction`、`#cat/commercial` |
| `TagL1` | 二级 MOC，专业或管理子域 | `#l1/hvac`、`#l1/procurement`、`#l1/quality` |
| `TagL2` | 三级 MOC，知识主题或任务类型 | `#l2/value-engineering`、`#l2/rfi`、`#l2/nonconformance` |

选择原则：

1. `Category / TagL1 / TagL2` 用于回答“这张卡片主要应该出现在 Obsidian 哪个 MOC 下面”。
2. 如果一张卡片跨多个专业，只选择主归属，其它专业用 `Domain`、`Discipline` 或正文 `[[wikilink]]` 表达。
3. `Lifecycle_Phase`、`Doc_Type`、`Event_Type`、`Info_Type`、`Risk_Level` 等不替代主三元组，只做筛选维度。
4. `Map_Index` 可以由三元组自动推导，也可以人工覆盖。
5. AI 不确定主三元组时，应标记 `#status/needs_fix`，不能随意选一个。

### 2.2 与多轴字段的关系

| 现有字段 | 建议演进 |
| --- | --- |
| `Category` | 保留，作为一级 MOC 索引 |
| `TagL1` | 保留，作为二级 MOC 索引 |
| `TagL2` | 保留，作为三级 MOC 索引 |
| `Domain` | 用于补充领域过滤，可与 `Category` 不完全等价 |
| `Discipline` | 用于补充专业过滤，可与 `TagL1` 不完全等价 |
| `Event_Type` / `Info_Type` | 用于判断卡片形态，不承担 MOC 主路由 |

## 3. Category / TagL1 / TagL2 主索引库

### 3.1 Category 一级 MOC

| 标签 | 说明 | 默认 MOC |
| --- | --- | --- |
| `#cat/opportunity-bid` | 商机、资格预审、投标 | `[[MOC_商机投标]]` |
| `#cat/contract-commercial` | 合同、商务、成本、索赔 | `[[MOC_合同商务成本]]` |
| `#cat/project-management` | 项目管理、组织、沟通、进度 | `[[MOC_项目管理]]` |
| `#cat/design` | 设计、深化、设计协调 | `[[MOC_设计管理]]` |
| `#cat/procurement` | 采购、供应商、设备材料 | `[[MOC_采购供应链]]` |
| `#cat/construction` | 现场施工、施工组织、工法 | `[[MOC_施工管理]]` |
| `#cat/quality` | 质量、验收、不符合项 | `[[MOC_质量管理]]` |
| `#cat/safety-environment` | 安全、环境、文明施工 | `[[MOC_安全环境]]` |
| `#cat/commissioning-handover` | 调试、试运行、移交 | `[[MOC_调试移交]]` |
| `#cat/operation-review` | 运维、保修、复盘经验 | `[[MOC_运维复盘]]` |
| `#cat/digital-bim` | BIM、数字化、数据自动化 | `[[MOC_BIM数字化]]` |
| `#cat/authority-compliance` | 报批报建、法规合规 | `[[MOC_报批合规]]` |
| `#cat/general-knowledge` | 通用知识、模板、方法论 | `[[MOC_通用知识库]]` |

### 3.2 TagL1 二级 MOC

| 标签 | 说明 |
| --- | --- |
| `#l1/client-stakeholder` | 业主、客户、干系人 |
| `#l1/tender-document` | 招标文件、投标文件 |
| `#l1/technical-proposal` | 技术标、技术方案 |
| `#l1/commercial-proposal` | 商务标、报价 |
| `#l1/contract-clause` | 合同条款 |
| `#l1/cost-estimate` | 概算、预算、成本 |
| `#l1/claim-variation` | 变更、索赔 |
| `#l1/schedule-control` | 进度计划与控制 |
| `#l1/interface-management` | 接口管理 |
| `#l1/document-control` | 文控资料 |
| `#l1/arch` | 建筑 |
| `#l1/struct` | 结构 |
| `#l1/civil-site` | 场地、道路、室外工程 |
| `#l1/hvac` | 暖通 |
| `#l1/cleanroom` | 洁净室 |
| `#l1/process` | 工艺 |
| `#l1/process-piping` | 工艺管道 |
| `#l1/elec` | 电气 |
| `#l1/elv-automation` | 弱电、自控、仪表 |
| `#l1/plumb-fire` | 给排水、消防 |
| `#l1/equipment` | 设备 |
| `#l1/procurement-package` | 采购包 |
| `#l1/supplier` | 供应商 |
| `#l1/site-logistics` | 总平、物流、临设 |
| `#l1/method-statement` | 施工方案、工法 |
| `#l1/inspection-test` | 检查、试验、验收 |
| `#l1/ncr-defect` | 不符合项、缺陷 |
| `#l1/hse` | 安全环境 |
| `#l1/commissioning` | 调试 |
| `#l1/handover-docs` | 竣工移交资料 |
| `#l1/bim-model` | BIM 模型 |
| `#l1/data-automation` | 数据、脚本、自动化 |
| `#l1/lesson-learned` | 经验复盘 |

### 3.3 TagL2 三级 MOC/主题

| 标签 | 说明 |
| --- | --- |
| `#l2/requirement` | 需求、要求 |
| `#l2/decision` | 决策、结论 |
| `#l2/action-item` | 待办事项 |
| `#l2/rfi` | 问询、澄清 |
| `#l2/design-review` | 设计审查 |
| `#l2/design-change` | 设计变更 |
| `#l2/value-engineering` | VE/CD 优化 |
| `#l2/specification` | 技术规格 |
| `#l2/standard-code` | 标准规范 |
| `#l2/calculation` | 计算、分析 |
| `#l2/drawing-issue` | 图纸问题 |
| `#l2/clash` | 碰撞、冲突 |
| `#l2/interface` | 接口 |
| `#l2/material-approval` | 材料报审 |
| `#l2/equipment-selection` | 设备选型 |
| `#l2/procurement-delay` | 采购延迟 |
| `#l2/quality-risk` | 质量风险 |
| `#l2/safety-risk` | 安全风险 |
| `#l2/schedule-risk` | 进度风险 |
| `#l2/cost-impact` | 成本影响 |
| `#l2/schedule-impact` | 工期影响 |
| `#l2/nonconformance` | 不符合项 |
| `#l2/corrective-action` | 整改措施 |
| `#l2/punch-list` | 消缺清单 |
| `#l2/commissioning-issue` | 调试问题 |
| `#l2/as-built` | 竣工图、竣工资料 |
| `#l2/operation-maintenance` | 运维维护 |
| `#l2/template` | 模板 |
| `#l2/checklist` | 检查清单 |
| `#l2/methodology` | 方法论 |
| `#l2/lesson` | 经验教训 |

## 4. Lifecycle_Phase 项目阶段

| 标签 | 说明 |
| --- | --- |
| `#phase/opportunity` | 项目信息获取、商机、客户需求初探 |
| `#phase/pre-bid` | 资格预审、招标准备、现场踏勘 |
| `#phase/bid` | 投标、技术标、商务标、澄清答疑 |
| `#phase/contract` | 合同谈判、合同签订、责任边界确认 |
| `#phase/kickoff` | 项目启动、组织架构、管理策划 |
| `#phase/concept-design` | 概念方案、总体规划 |
| `#phase/basic-design` | 初步设计、基础设计 |
| `#phase/detail-design` | 施工图、深化设计、综合协调 |
| `#phase/procurement` | 采购、招采、供应商管理 |
| `#phase/fabrication` | 工厂加工、预制、设备制造 |
| `#phase/construction-prep` | 开工准备、临设、施工策划 |
| `#phase/construction` | 现场施工 |
| `#phase/inspection` | 检查、验收、整改 |
| `#phase/commissioning` | 单机调试、联动调试、试运行 |
| `#phase/handover` | 竣工、移交、资料归档 |
| `#phase/operation` | 运维、保修、缺陷责任期 |
| `#phase/review` | 项目复盘、经验总结 |

## 5. Domain 领域大类

| 标签 | 说明 |
| --- | --- |
| `#domain/project-management` | 项目管理 |
| `#domain/design-management` | 设计管理 |
| `#domain/construction-management` | 施工管理 |
| `#domain/procurement` | 采购与供应链 |
| `#domain/commercial` | 商务、成本、合同 |
| `#domain/quality` | 质量管理 |
| `#domain/safety` | 安全管理 |
| `#domain/environment` | 环境与文明施工 |
| `#domain/schedule` | 进度计划 |
| `#domain/cost` | 成本与 VE/CD 优化 |
| `#domain/bim-digital` | BIM、数字化、数据 |
| `#domain/authority` | 政府审批、报批报建 |
| `#domain/client` | 业主与干系人 |
| `#domain/arch` | 建筑 |
| `#domain/struct` | 结构 |
| `#domain/process` | 工艺生产线 |
| `#domain/hvac` | 暖通空调 |
| `#domain/elec` | 电气 |
| `#domain/plumb` | 给排水 |
| `#domain/fire` | 消防 |
| `#domain/automation` | 自控、弱电、仪表 |
| `#domain/civil` | 土建、场地、道路 |
| `#domain/interior` | 内装、洁净、装修 |
| `#domain/utility` | 公用工程 |
| `#domain/logistics` | 物流、AGV、仓储 |

## 6. Discipline 专业/工种

| 标签 | 说明 |
| --- | --- |
| `#disc/planning` | 规划、总图 |
| `#disc/architecture` | 建筑专业 |
| `#disc/structure` | 结构专业 |
| `#disc/geotechnical` | 地勘、基坑、地基基础 |
| `#disc/civil-site` | 场地、道路、管网 |
| `#disc/hvac` | 暖通 |
| `#disc/cleanroom` | 洁净室 |
| `#disc/process-piping` | 工艺管道 |
| `#disc/process-equipment` | 工艺设备 |
| `#disc/electrical-power` | 强电、配电 |
| `#disc/lighting` | 照明 |
| `#disc/elv` | 弱电、安防、通信 |
| `#disc/automation-controls` | 自控、仪表 |
| `#disc/plumbing` | 给排水 |
| `#disc/fire-protection` | 消防 |
| `#disc/sprinkler` | 喷淋 |
| `#disc/interior-fitout` | 内装 |
| `#disc/equipment-installation` | 设备安装 |
| `#disc/steel-structure` | 钢结构 |
| `#disc/facade` | 幕墙、外立面 |
| `#disc/landscape` | 景观 |
| `#disc/bim` | BIM |
| `#disc/qa-qc` | 质量检查 |
| `#disc/hse` | 安全环境 |

## 7. Doc_Type 资料类型

| 标签 | 说明 |
| --- | --- |
| `#doc/email` | 邮件 |
| `#doc/email-thread` | 邮件链 |
| `#doc/meeting-minutes` | 会议纪要 |
| `#doc/transcript` | 录音转写 |
| `#doc/report` | 报告 |
| `#doc/specification` | 技术规格书 |
| `#doc/drawing` | 图纸 |
| `#doc/calculation` | 计算书 |
| `#doc/schedule` | 进度计划 |
| `#doc/boq` | 工程量清单 |
| `#doc/estimate` | 概算、预算、估算 |
| `#doc/contract` | 合同 |
| `#doc/tender` | 招标文件 |
| `#doc/bid` | 投标文件 |
| `#doc/rfi` | RFI、技术问询 |
| `#doc/submittal` | 报审资料 |
| `#doc/method-statement` | 施工方案 |
| `#doc/inspection-record` | 检查记录 |
| `#doc/ncr` | 不符合项 |
| `#doc/change-order` | 变更单 |
| `#doc/claim` | 索赔资料 |
| `#doc/photo` | 照片 |
| `#doc/video` | 视频 |
| `#doc/audio` | 音频 |
| `#doc/scan` | 扫描件 |
| `#doc/manual` | 设备手册 |
| `#doc/certificate` | 证书、合格证 |
| `#doc/as-built` | 竣工资料 |
| `#doc/lesson-learned` | 经验复盘 |

## 8. Event_Type 动态事件类型

| 标签 | 说明 |
| --- | --- |
| `#event/meeting` | 会议、协调会、交底 |
| `#event/decision` | 决策、定论 |
| `#event/action-item` | 待办事项 |
| `#event/issue` | 问题、障碍 |
| `#event/risk` | 风险 |
| `#event/change` | 设计变更、范围变更 |
| `#event/claim` | 索赔、反索赔 |
| `#event/rfi` | 技术问询 |
| `#event/approval` | 审批、确认 |
| `#event/review` | 审查、评审 |
| `#event/inspection` | 检查、验收 |
| `#event/nonconformance` | 不符合项 |
| `#event/correction` | 整改、纠偏 |
| `#event/progress-delay` | 进度延误 |
| `#event/interface-conflict` | 接口冲突 |
| `#event/design-conflict` | 设计冲突 |
| `#event/safety-incident` | 安全事件 |
| `#event/quality-incident` | 质量事件 |
| `#event/cost-impact` | 成本影响事件 |
| `#event/schedule-impact` | 工期影响事件 |
| `#event/procurement-delay` | 采购延迟 |
| `#event/site-condition` | 现场条件变化 |
| `#event/client-request` | 业主要求 |
| `#event/authority-comment` | 政府或审查意见 |
| `#event/lesson-learned` | 经验教训 |

## 9. Info_Type 静态信息类型

| 标签 | 说明 |
| --- | --- |
| `#info/spec` | 技术规格、标准要求 |
| `#info/parameter` | 参数、指标 |
| `#info/constraint` | 约束条件 |
| `#info/requirement` | 需求、要求 |
| `#info/design-basis` | 设计依据 |
| `#info/calculation-basis` | 计算依据 |
| `#info/code-standard` | 规范、标准 |
| `#info/process-knowledge` | 工艺知识 |
| `#info/method` | 方法、做法 |
| `#info/checklist` | 检查清单 |
| `#info/template` | 模板 |
| `#info/entity` | 干系人、供应商、组织实体 |
| `#info/asset` | 资产、设备、区域 |
| `#info/interface` | 接口关系 |
| `#info/responsibility` | 责任边界 |
| `#info/compliance` | 合规要求 |
| `#info/cost-data` | 成本数据 |
| `#info/schedule-data` | 进度数据 |
| `#info/procurement-data` | 采购数据 |
| `#info/lesson` | 经验知识 |

## 10. Management_Topic 管理主题

| 标签 | 说明 |
| --- | --- |
| `#mgmt/scope` | 范围管理 |
| `#mgmt/schedule` | 进度管理 |
| `#mgmt/cost` | 成本管理 |
| `#mgmt/quality` | 质量管理 |
| `#mgmt/safety` | 安全管理 |
| `#mgmt/environment` | 环境管理 |
| `#mgmt/risk` | 风险管理 |
| `#mgmt/change` | 变更管理 |
| `#mgmt/contract` | 合同管理 |
| `#mgmt/procurement` | 采购管理 |
| `#mgmt/stakeholder` | 干系人管理 |
| `#mgmt/communication` | 沟通管理 |
| `#mgmt/document-control` | 文控、资料管理 |
| `#mgmt/interface` | 接口管理 |
| `#mgmt/approval` | 审批管理 |
| `#mgmt/commissioning` | 调试管理 |
| `#mgmt/handover` | 移交管理 |
| `#mgmt/knowledge` | 知识管理 |

## 11. Process_Topic 工程过程主题

| 标签 | 说明 |
| --- | --- |
| `#process/site-survey` | 现场踏勘、现况调查 |
| `#process/design-coordination` | 设计协调 |
| `#process/clash-detection` | 碰撞检查 |
| `#process/constructability` | 可施工性 |
| `#process/value-engineering` | VE/CD 优化 |
| `#process/material-approval` | 材料报审 |
| `#process/shop-drawing` | 深化图、加工图 |
| `#process/mockup` | 样板、Mockup |
| `#process/method-statement` | 施工方案 |
| `#process/work-permit` | 作业许可 |
| `#process/inspection-test` | 检验试验 |
| `#process/punch-list` | 消缺清单 |
| `#process/testing-adjusting-balancing` | TAB 测试调整 |
| `#process/commissioning` | 调试 |
| `#process/training` | 培训 |
| `#process/as-built` | 竣工图与竣工资料 |
| `#process/operation-maintenance` | 运维维护 |

## 12. Contract_Topic 合同商务主题

| 标签 | 说明 |
| --- | --- |
| `#contract/scope-boundary` | 范围边界 |
| `#contract/exclusion` | 除外项 |
| `#contract/payment` | 付款 |
| `#contract/variation` | 变更 |
| `#contract/claim` | 索赔 |
| `#contract/ld` | 违约金、工期罚款 |
| `#contract/warranty` | 保修 |
| `#contract/liability` | 责任 |
| `#contract/insurance` | 保险 |
| `#contract/bond` | 保函 |
| `#contract/tax` | 税务 |
| `#contract/currency` | 汇率、币种 |
| `#contract/provisional-sum` | 暂列金 |
| `#contract/unit-rate` | 单价 |
| `#contract/procurement-scope` | 采购范围 |

## 13. Status 与 Action_Status

### Status 卡片状态

| 标签 | 说明 |
| --- | --- |
| `#status/pending_review` | 待审核 |
| `#status/approved` | 已确认 |
| `#status/needs_fix` | 需要修正 |
| `#status/rejected` | 已拒绝 |
| `#status/superseded` | 已被替代 |
| `#status/archived` | 已归档 |
| `#status/uncategorized` | 未分类 |
| `#status/needs_ocr` | 需要 OCR |
| `#status/unsupported_media` | 暂不支持的媒体 |

### Action_Status 待办状态

| 标签 | 说明 |
| --- | --- |
| `#action/open` | 未开始 |
| `#action/in-progress` | 处理中 |
| `#action/waiting` | 等待外部输入 |
| `#action/blocked` | 阻塞 |
| `#action/done` | 已完成 |
| `#action/cancelled` | 已取消 |
| `#action/overdue` | 已逾期 |

## 14. Risk_Level 与 Priority

### Risk_Level

| 标签 | 说明 |
| --- | --- |
| `#risk/low` | 低风险 |
| `#risk/medium` | 中风险 |
| `#risk/high` | 高风险 |
| `#risk/critical` | 严重风险 |

### Priority

| 标签 | 说明 |
| --- | --- |
| `#priority/p0` | 立即处理 |
| `#priority/p1` | 高优先级 |
| `#priority/p2` | 普通优先级 |
| `#priority/p3` | 低优先级 |

## 15. Source_Type 来源类型

| 标签 | 说明 |
| --- | --- |
| `#source/md` | Markdown |
| `#source/txt` | 纯文本 |
| `#source/pdf-text` | 文本型 PDF |
| `#source/pdf-scan` | 扫描型 PDF |
| `#source/docx` | Word |
| `#source/email` | 邮件 |
| `#source/email-attachment` | 邮件附件 |
| `#source/image` | 图片 |
| `#source/audio` | 音频 |
| `#source/video` | 视频 |
| `#source/web` | 网页 |
| `#source/manual-input` | 手工录入 |

## 16. Confidentiality 保密级别

| 标签 | 说明 |
| --- | --- |
| `#conf/public` | 可公开 |
| `#conf/internal` | 内部资料 |
| `#conf/confidential` | 保密资料 |
| `#conf/restricted` | 严格限制 |
| `#conf/client-confidential` | 业主保密 |
| `#conf/bid-confidential` | 投标保密 |

## 17. AI 选标规则

AI 生成卡片时必须遵循：

1. 每张卡片必须选择一个 `Card_Type`。
2. 每张卡片必须选择一组 `Category / TagL1 / TagL2` 主索引三元组。
3. 每张卡片必须选择一个 `Lifecycle_Phase`，无法判断时留空并标记 `#status/needs_fix`。
4. 每张卡片必须选择一个 `Domain`。
5. 专业明确时选择一个 `Discipline`，跨专业时优先用正文 wikilink 表达关系。
6. 动态事件选择 `Event_Type`，静态信息选择 `Info_Type`，不要同时强行填写。
7. `Status` 初始值默认为 `#status/pending_review`。
8. 所有标签必须来自本库。
9. 不确定时降低 `Confidence`，不要编造标签。
