# v2.17.2 证据修复与审核路由

重跑已有任务时，插件继续复用来源哈希一致的 parsed、summary-map、summary、atom batch 和 atoms 检查点。工作流在原子生成之后执行本地合并/去重、证据协调、最终门禁和审核路由；这些步骤不会增加 provider 调用，也不要求重新上传 PDF 或重复 OCR。

证据协调先做逐字定位，再在可制卡 block/evidence index/Markdown 内做有界中日文词元、字符 n-gram、数字/单位和结构提示匹配。只有最高候选同时通过保守分数、数字完整性和候选间距才会采用；采用的 quote 必须是来源块中的逐字片段并带页、块和文本 span。无法唯一决定时保持未解析。

审核指标定义：

- `candidateCards`：合并和去噪后的候选卡；
- `autoApproved`：全部硬门禁通过且达到既有可信度门槛；
- `reviewPending`：真正等待人工操作，不等于拒绝；
- `hardRejected`：不可制卡噪声或无知识内容；
- `merged`：确定性合并的重复/同要求原子；
- `automaticallyRepaired`：本地修复出逐字证据和 locator 的候选。

人工覆核只能绕过软门禁。缺失证据、数字/日期/主体冲突、Schema 损坏、错误/危险目录、无支持内容和重复内容仍禁止批准。批准写入时间、理由和原始软门禁，旧审核产物在读取时迁移 UI 字段但保留原状态和决策。

要利用缓存重跑：在插件审核台对该任务选择“仅重做知识原子”，或把同一失败/待审核任务重新排队后运行“继续自动处理”。不要清空插件缓存，也不要重新导入源文件；诊断日志应出现 parsed/summary/atoms 的 `artifact.cacheHit`，随后出现 `review.routing` 的前后计数和脱敏原因直方图。
