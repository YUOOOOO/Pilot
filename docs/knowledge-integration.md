# dsh-knowledge v0.5.2 集成契约

> 目的：让 Pilot 在自己的设置界面里**读写 dsh-knowledge 插件的配置**（全局 + 按库覆盖），并能做列表/统计/召回测试/重建索引。
> 审计对象：`D:\YU\Pilot\packages\dsh-knowledge`（开源插件 `dsh-knowledge@0.5.2`，`dsh-knowledge` 的 host 半 + client 半）。
> 约定：下文所有 `src/...` 路径均指 `packages/dsh-knowledge/src/...`；`node_modules/...` 指 `D:\YU\Pilot\node_modules\...`（官方 DSH 包）。
> 所有结论均来自源码/本机实测；无法从源码确定的写在「§11 未确认事项」。
> 本文档只做只读分析，没有改动插件源码，也没有安装依赖或运行构建。

---

## 0. TL;DR（给急着动手的人）

| 问题 | 结论 |
|---|---|
| 路由前缀 | 只有一个前缀路由 `/knowledge`（`kind: 'prefix'`），挂在宿主 `ctx.webServer` 上，**跟 DSH Web GUI 同源、同端口**。 |
| 全局配置读 | `GET /knowledge/config` → 完整解析后的 `KnowledgeConfig`（**包含明文 API Key**）。 |
| 全局配置写 | `PUT /knowledge/config`，body 是 `ConfigOverrides`（部分字段），**浅合并**，返回新的完整 `KnowledgeConfig`。 |
| 按库配置读 | 没有 `GET /knowledge/bases/:id`；必须 `GET /knowledge/bases` 然后读每条 `BaseSummary.config`（只含被覆盖的字段）。 |
| 按库配置写 | `PATCH /knowledge/bases/:id`，body `{ config: BaseConfig }`，**合并进已有覆盖**；字符串传 `''` 表示「删除该覆盖，回落到全局」。 |
| 认证 | 除 `/knowledge/processors/managed/*` 外**没有任何认证**：不校验 token、cookie、header。同源浏览器 `fetch('/knowledge/...')` 直接可用。 |
| 持久化 | 存储域 `knowledge`（version 0）的 global 槽；本机落在 `%APPDATA%\Pilot\dsh-home\storages\knowledge.json`（`single` 布局，一个 JSON 文件）。向量/分块在 `storages\knowledge-chunks.sqlite`。 |
| 最大坑 | **写配置时宿主不做 schema 校验**（只在下次进程启动装载时校验）。写入一个非法值（如 `topK: 0`）→ 本次运行「看起来成功」，**下次启动整个 knowledge 存储装载失败，所有 `/knowledge/*` 变 503**。见 §5.5。 |

---

## 1. 宿主装配：它是怎么被挂上去的

| 事实 | 位置 |
|---|---|
| host 入口是子路径 `dsh-knowledge/knowledge`（不是包根 `src/index.ts`）；包根的 `src/index.ts` 只有 4 行、`apply()` 为空，是「client 模块的宿主占位」 | `src/index.ts:1-4`；`dsh.plugin.json`；`package.json:26-29` |
| 真正的 host 服务是 `KnowledgeService extends Service`，`static inject = ['webServer']` | `src/knowledge/index.ts:278-280` |
| 构造函数里注册路由：`ctx.effect(() => ctx.webServer.register(knowledgeRoute(this)), 'knowledge: /knowledge route')` | `src/knowledge/index.ts:313-318` |
| 路由对象：`{ kind: 'prefix', path: '/knowledge', handler }` | `src/knowledge/http.ts:32-38` |
| 插件 bundle 补丁把三行插进 Loader 树：`knowledge` / `tool-knowledge` / `ui-knowledge` | `cordis.patch.yml:14-35` |
| 部署默认配置（进程级）写在补丁的 `config:` 块（`embeddingProvider: none`、`chunkSize: 800`、`topK: 4` 等） | `cordis.patch.yml:17-29` |
| `ctx.webServer` = `@deepseek-ai/dsh-host-webserver` 的 `WebServer`，`register(route)` 返回 disposer；`prefix` 的语义是「p 本身与 p/<任意>」 | `node_modules/@deepseek-ai/dsh-host-webserver/lib/types/index.d.ts:31-40, 167-174` |

**含义**：`/knowledge/*` 与 DSH Web GUI（本机 `http://127.0.0.1:62209`）**同一个 HTTP 监听器、同一个 origin**。Pilot 的设置界面只要跑在这个页面里（或同源 iframe 里），就能直接相对路径 fetch。

---

## 2. HTTP 通用契约

### 2.1 响应信封

统一信封（`src/knowledge/http.ts:1-7`、`81`、`586-589`）：

```jsonc
// 成功
{ "ok": true, "value": <任意 JSON> }
// 失败
{ "ok": false, "error": { "code": "<字符串枚举>", "message": "<人类可读>" } }
// 可选（仅 DirectorySourceError）
{ "ok": false, "error": { "code": "...", "message": "...", "details": { ... } } }
```

- 成功一律 HTTP 200 + `content-type: application/json`（没有 `cache-control`）。
- 路由函数返回 `undefined` 时**不是** `{ok:true}`，而是 HTTP 404 + `{ok:false,error:{code:'not-found'}}`（`http.ts:62-65`，注意这个是**连字符** `not-found`，与下面服务层的 `not_found` 不是一个字符串）。
- 二进制下载（`/documents/:id/raw`、`/documents/:id/artifacts/:assetId`）走另一条路：`200` + 原始字节 + `content-disposition` + `x-content-type-options: nosniff` + `content-security-policy: sandbox`（`http.ts:66-80`）。

### 2.2 错误码 → HTTP 状态（`http.ts:82-127`）

| 抛出类型 | HTTP | `error.code` | 来源 |
|---|---|---|---|
| `DeploymentError` | `error.status`（403/415 等） | `local_management_only` / `invalid_host` / `management_header_required` / `cross_origin_request` / `invalid_content_type` | `http.ts:83-86`；`mineru-management-security.ts:10-19` |
| `EvidenceRequestError` | 404（`not_found`）或 400 | 同 code | `http.ts:87-90` |
| `ConflictError`（同名冲突 `conflict:'detect'`） | 409 | `conflict` | `http.ts:93-96`；`index.ts:255-257` |
| `NotFoundError`（base/doc 不存在） | 404 | `not_found` | `http.ts:100-103`；`index.ts:262-264` |
| `DirectorySourceError` | 409 | `ambiguous_source` / `source_path_conflict` / `recursive_confirmation_required`（+`details`） | `http.ts:104-114`；`index.ts:268-276` |
| `StorageUnavailableError` | 503 | `storage_unavailable` | `http.ts:115-120`；`index.ts:4156-4167` |
| `InvalidRequestError` | 400 | `invalid_request` | `http.ts:121-124, 553-559` |
| 其它 `Error` | 500 | `error` | `http.ts:125-127` |

> 设置界面必读：**业务校验错误大多是 500 而不是 400**。例如 `PATCH /bases/:id` 改嵌入模型被拒绝、`probe-embedding-dimensions` 失败、`createBase` 之外的 service 层校验失败，都是 500 + `code:'error'`，只能靠 `message` 文案判断。400 只出现在 `http.ts` 显式抛 `InvalidRequestError` 的几处（body 非 JSON、content-type 不对、缺 `query`、`files` 不是数组、`POST /bases` 缺 name 等）。

### 2.3 请求体规则（`http.ts:561-584`）

| 规则 | 细节 |
|---|---|
| 只有 `GET` 不读 body；其它方法（含 `DELETE`、`PATCH`）都读 | `http.ts:60` |
| `content-type` 必须为空**或** `application/json`（允许 `application/json; charset=utf-8`） | `http.ts:562-564` |
| content-type 为空时 body 被**静默忽略**，视为 `{}`（例如 `DELETE` 带 body 却没设 header → body 丢失） | `http.ts:563` |
| 空 body / 纯空白 body → `{}` | `http.ts:566` |
| body 不是合法 JSON → 400 `invalid_request` | `http.ts:567-571` |
| 上限 32 MiB（超出 400 `invalid_request: request body too large`） | `http.ts:30, 574-584` |

### 2.4 路径与 id 解码（`http.ts:43-55`）

`/knowledge` 之后按 `/` 切段，每段单独 `decodeURIComponent`（失败则用原串）。因此 baseId / docId **必须** `encodeURIComponent`（官方客户端就是这么做的，`src/ui/client/api.ts:526` 等）。解码后的段只当存储 key 用，不当文件路径。

---

## 3. HTTP 路由清单（全量）

图例：**★** = 设置界面要用；**△** = 次要/可选；**⚙** = MinerU 受保护路由（需额外 header，见 §6）。

### 3.1 配置 / 开关（重点）

| | method | path | 请求 | 成功响应 `value` | 源码 |
|---|---|---|---|---|---|
| ★ | GET | `/knowledge/config` | 无 | `KnowledgeConfig`（**全部字段 + 明文密钥**，见 §4.1） | `http.ts:179-180` → `index.ts:581-583` |
| ★ | PUT | `/knowledge/config` | `ConfigOverrides`（任意子集） | 合并后重新解析的 `KnowledgeConfig` | `http.ts:181` → `index.ts:640-650` |
| ★ | GET | `/knowledge/knowledge-toggle` | 无 | `{ enabled: boolean, enabledBaseIds: string[] }` | `http.ts:191-194` |
| ★ | PUT | `/knowledge/knowledge-toggle` | `{ enabled?: boolean, enabledBaseIds?: string[] }`（两字段都可缺；`enabledBaseIds` 会去重） | 同上 | `http.ts:195-201` → `index.ts:654-668` |
| ★ | GET | `/knowledge/model-suggestions` | 无 | `{ embedding: string[], local: string[], rerank: string[], ollamaEmbedding: string[], ollamaVision: string[] }` | `http.ts:312-314` → `index.ts:159-198, 586-588` |
| ★ | POST | `/knowledge/probe-embedding-dimensions` | `{ provider?, baseUrl?, model?, apiKey? }` | `number`（向量维度；`value` 本身是数字，不是对象） | `http.ts:231-238` → `index.ts:2784-2807` |
| △ | GET | `/knowledge/stats` | 无 | `BaseStats`（全库聚合，无 `baseId` 字段） | `http.ts:222` → `index.ts:3181-3216` |
| ★ | POST | `/knowledge/processors/check` | `{ baseId?: string }` | `ProcessorCapabilities`（探测本地 MinerU 服务） | `http.ts:185-188` → `index.ts:2732-2736` |

`PUT /knowledge/config` 细节（重要）：

- body 是**部分覆盖**，只写你关心的字段；未出现的字段保留旧覆盖（`store.ts:677-687` 的 `{...current.overrides, ...patch.overrides}`）。
- 返回的是 `resolveConfig(baseConfig, overrides)` 的结果，所以你会看到 clamp 后的值（`config.ts:154-213`）。
- **没有删除接口**：无法把某个 key 从覆盖里移除 → 只能写入一个新值覆盖它（`''` / 默认值），这会永久留下一条覆盖记录。
- 客户端官方实现：`KnowledgeApi.setConfig(overrides)`（`src/ui/client/api.ts:500-502`）。注意**插件自己的 UI 从不写全局 RAG 配置**（只有 `LocalModelsSection` 写 `hfEndpoint`/`localModelCacheDir`/`localWorkerIdleTimeoutMs`、`MineruDeploymentSection` 写 `mineruPythonIndexUrl`），全局 embedding provider 的编辑是 Pilot 要新增的能力。

### 3.2 知识库（bases）与分组

| | method | path | 请求 | 成功响应 | 源码 |
|---|---|---|---|---|---|
| ★ | GET | `/knowledge/bases` | 无 | `BaseSummary[]`（含 `config?: BaseConfig` ＝该库的覆盖） | `http.ts:346` → `index.ts:854-879` |
| ★ | POST | `/knowledge/bases` | `{ name: string（必填非空）, description?: string, group?: string, config?: BaseConfig }` | `KnowledgeBase`（`config` 已按「丢弃空串」压缩） | `http.ts:347-356` → `index.ts:695-715, 4540-4552` |
| ★ | PATCH | `/knowledge/bases/:id` | `{ name?, description?, group?, config?: BaseConfig }` | `KnowledgeBase` | `http.ts:360` → `index.ts:789-852` |
| ★ | DELETE | `/knowledge/bases/:id` | 无 | `{ deleted: true }` | `http.ts:361` → `index.ts:761-787` |
| ★ | GET | `/knowledge/bases/:id/stats` | 无 | `BaseStats`（含 `baseId`）；不存在 → 404 `not_found` | `http.ts:365` → `index.ts:3181-3216` |
| ★ | POST | `/knowledge/bases/:id/reindex` | 无 | `{ jobId: string, total: number, documentTotal: number }`（后台任务） | `http.ts:366` → `index.ts:2382-2402` |
| △ | POST | `/knowledge/bases/:id/files-batch` | `{ files: [{fileName, mimeType?, contentBase64?}], conflict?: 'detect'\|'rename'\|'replace', parentDirectoryId? }` | `AddFilesResult`（`{status:'conflicts'\|'clean'\|'added', ...}`） | `http.ts:367-389` |
| △ | POST | `/knowledge/bases/:id/restore` | `{ name: string, config?: BaseConfig }` | `KnowledgeBase`（用新模型重嵌入一份新库） | `http.ts:390-395` → `index.ts:720-759` |
| △ | POST | `/knowledge/bases/:id/import-directory` / `-tree` / `import-path` / `source-path` | `{ path }` / `{ sourceId, path }` | 见 `index.ts`；`-tree`、`import-path` 同步返回 `DirectoryImportResult`/`PathImportResult` | `http.ts:396-411` |
| △ | POST | `/knowledge/bases/:id/directories` | `{ title, parentDirectoryId? }` | `KnowledgeDocument` | `http.ts:412-418` |
| △ | GET | `/knowledge/groups` | 无 | `string[]`（已排序） | `http.ts:207` → `index.ts:883-885` |
| △ | POST | `/knowledge/groups` | `{ name }` | `string[]` | `http.ts:208` |
| △ | PATCH | `/knowledge/groups` | `{ from, to }`（**body，不是路径参数**） | `string[]` | `http.ts:209-213` |
| △ | DELETE | `/knowledge/groups` | `{ name }`（body） | `{ deleted: true }` | `http.ts:215-217` |

**没有 `GET /knowledge/bases/:id`**：`segments.length === 2` 只处理 `PATCH`/`DELETE`，其它方法落到「无路由」→ 404 `{code:'not-found'}`（`http.ts:359-363`）。要拿单个库的信息或它的 `config` 覆盖，只能 `GET /knowledge/bases` 后自行筛选。

`PATCH /knowledge/bases/:id` 的隐藏规则（`index.ts:817-849`）：

1. `config` patch 里若改动了 `embeddingProvider` 或 `embeddingModel`，且该库**已有文档**且**原来已配置过模型** → 直接 500 拒绝：`切换嵌入模型会使已有向量全部失效——请使用「重建知识库」以新模型重建（Cherry Studio 语义）`。
2. 若原来是「纯词法（provider=none 或空模型）」→ 允许原地启用，并后台回填向量；但有两种前置拒绝：有文档正在处理（500 `有文档正在处理中——…`）、存在无源文本的文档（500 `存在无源文本的文档，无法回填向量——…`）。
3. 设置界面的正确姿势：先 `GET /bases` 看该库 `documentCount`，再决定是「直接 patch」还是「走 restore/重建」。官方面板的 `RagConfigPanel` 就是在保存前算 `needsRebuild` 并提示（`src/ui/client/rag-config.tsx:166-174`）。

### 3.3 文档

| | method | path | 请求 | 成功响应 | 源码 |
|---|---|---|---|---|---|
| △ | GET | `/knowledge/bases/:id/documents` | 无 | `DocumentSummary[]` | `http.ts:420` → `index.ts:2600-2644` |
| △ | POST | `/knowledge/bases/:id/documents` | 三分支：`{url,...}` → URL 导入；`{contentBase64,...}` → 文件；否则 `{title, content}` → 纯文本 | `KnowledgeDocument` | `http.ts:421-451` |
| △ | GET | `/knowledge/documents/:id` | query `rawTextLimit?: int`、`includeChunks?: 'false'` | `DocumentDetail`（默认 `includeChunks=true`，**含所有 chunk 的 embedding**，很大） | `http.ts:473-480` → `index.ts:3047` |
| △ | PATCH | `/knowledge/documents/:id` | `{ title }` | `KnowledgeDocument` | `http.ts:481` |
| △ | DELETE | `/knowledge/documents/:id` | query `recursive=true` 或 body `{recursive:true}` | `{ deleted: true }` | `http.ts:482-485` |
| △ | DELETE | `/knowledge/documents` | `{ ids: string[], recursive?: boolean }` | `{ deleted: number, roots: number }` | `http.ts:460` → `index.ts:2491` |
| △ | POST | `/knowledge/documents/reindex` | `{ ids: string[] }` | `{ reindexed, skipped, failed, items }` | `http.ts:463-465` → `index.ts:2445-2482` |
| △ | GET | `/knowledge/documents/:id/chunks` | query `limit?`, `offset?`, `includeEmbeddings?='false'` | `KnowledgeChunk[]`（`includeEmbeddings=false` 时剥掉 `embedding`） | `http.ts:498-507` |
| △ | POST | `/knowledge/documents/:id/reindex` | `{ mode?: 'reparse'\|'rechunk' }` | `ReindexDocumentResult`（同步，可能很久） | `http.ts:508-511` |
| △ | POST | `/knowledge/documents/:id/cancel` | 无 | `{ cancelled: boolean }` | `http.ts:489` |
| △ | GET | `/knowledge/documents/:id/delete-impact` | 无 | `DeleteImpact` | `http.ts:512` |
| △ | POST | `/knowledge/documents/:id/refresh` | 无 | `{ changed, title, chunkCount }` | `http.ts:513` |
| △ | GET | `/knowledge/documents/:id/raw` | query `inline=1` | 二进制（否则 404） | `http.ts:514-520` |
| △ | GET | `/knowledge/documents/:id/evidence` | query `revision?`, `pageIndex?`, `blockId?`, `blockOffset?`, `maxTokens?`（`blockOffset` 必须配 `blockId`） | `DocumentEvidence` | `http.ts:490-497` |
| △ | GET | `/knowledge/documents/:id/artifacts/:assetId` | query `revision`（必填） | 二进制（inline） | `http.ts:467-471` |

### 3.4 检索（召回测试）

| | method | path | 源码 |
|---|---|---|---|
| ★ | POST | `/knowledge/search` | `http.ts:526-545` → `index.ts:3220-3246` |

请求体（`src/knowledge/types.ts:598-617`）：

```ts
{
  query: string            // 必填，trim 后非空；> 2000 字符 → 500
  queries?: string[]       // 多查询变体（去重后最多 4 条，RRF 融合）
  baseId?: string          // 单库
  baseIds?: string[]       // 多库；显式 [] = 不搜索任何库（返回空结果）
  topK?: number            // clamp 1..50，默认取该库解析配置的 topK
  mode?: 'auto'|'hybrid'|'vector'|'lexical'
  threshold?: number       // 默认取配置 similarityThreshold
  mmr?: boolean
  filter?: {               // 只校验两个字段必须是 string[]
    docIds?: string[], excludeDocIds?: string[], titleIncludes?: string,
    titleExcludes?: string[], sourceTypes?: ('text'|'file'|'url'|'directory')[],
    updatedAfter?: number, updatedBefore?: number
  }
}
```

响应 `SearchResult`（`types.ts:619-634`）：`{ query, mode, scoreKind?, retrieval?: {requestedMode, effectiveMode, lexical:{attempted,succeeded,returnedCount,errorCode?}, vector:{...}}, total, reranked, rerank?: RerankStatus, elapsedMs, hits: SearchHit[] }`。
`SearchHit`（`types.ts:387-408`）：`{ chunkId, docId, baseId, documentTitle, heading?, index, text, contextWindow?, siblingContext?(deprecated), score, vectorScore?, lexicalScore?, sourceSpans?, processingRevision? }`。

行为要点：
- 空 query → 400 `invalid_request`（`http.ts:529-531`）；`filter` 不是对象 / `excludeDocIds`、`titleExcludes` 不是字符串数组 → 400。
- **baseId 不存在不报错**，返回空结果（`index.ts:3270-3272`）。
- `mode:'auto'` → 有向量走 hybrid，否则 lexical。

### 3.5 索引状态 / 后台任务

| | method | path | 请求 | 成功响应 | 源码 |
|---|---|---|---|---|---|
| ★ | GET | `/knowledge/indexing-status` | 无 | 数组，元素 `{docId, baseId, title, phase:'parsing'\|'embedding', progress, status?:'running'\|'failed', processingProgress?, error?:{code,message}}` | `http.ts:317-319` → `index.ts:2682-2719` |
| ★ | GET | `/knowledge/reindex/:jobId` | 无 | `{ baseId, kind:'reindex', cancelled, imported, skipped, total, current, errors:[{file,error}], done }`；未知 jobId → 404 `not-found` | `http.ts:333-335` → `index.ts:2405-2407`、`231-242` |
| ★ | POST | `/knowledge/reindex/:jobId/cancel` | 无 | `{ cancelled: true }` | `http.ts:336-339` |
| △ | GET | `/knowledge/import-directory/:jobId` | 无 | 同上结构（`DirectoryImportStatus`） | `http.ts:322-324` |
| △ | POST | `/knowledge/import-directory/:jobId/cancel` | 无 | `{ cancelled: true }` | `http.ts:325-328` |

轮询建议：官方面板对 `indexing-status` 与 job 都是轮询（无 SSE/WebSocket）。`indexing-status` 的终态条目有 TTL：成功态保留 60s、失败态保留 10min（`index.ts:217-222`）。

### 3.6 本地模型 / OCR / Ollama

| | method | path | 请求 | 响应 | 源码 |
|---|---|---|---|---|---|
| ★ | GET | `/knowledge/local-models` | 无 | `LocalModelSummary[]` | `http.ts:246` |
| ★ | GET | `/knowledge/local-model-status?model=` | query `model?` | `{ model, status:'idle'\|'downloading'\|'ready'\|'error', progress, message }` | `http.ts:225-227`；`embed.ts:142-148` |
| △ | POST | `/knowledge/local-models/download?model=` | query | `LocalModelSummary` | `http.ts:253-255` |
| △ | POST | `/knowledge/local-models/cancel?model=` | query | `LocalModelSummary` | `http.ts:256-258` |
| △ | DELETE | `/knowledge/local-models/remove?model=` | query | `LocalModelSummary` | `http.ts:259-261` |
| △ | POST | `/knowledge/local-models/custom` | `{ id }` | `LocalModelSummary` | `http.ts:247-249` |
| △ | POST | `/knowledge/local-models/self-test` | `{ id }` | `LocalModelSummary` | `http.ts:250-252` |
| △ | POST | `/knowledge/local-models/migrate` | `{ to: string }` | `{ moved, from, to }` | `http.ts:262-264` |
| △ | POST | `/knowledge/local-models/cache-directory` | `{ path?: string }` | `{ path }`（只准备目录，不保存配置） | `http.ts:242-245` |
| △ | GET | `/knowledge/local-ocr` | 无 | `{ status, progress, message }` | `http.ts:270` |
| △ | POST | `/knowledge/local-ocr/download` | 无 | 同上 | `http.ts:271` |
| △ | DELETE | `/knowledge/local-ocr/remove` | 无 | `{ deleted: true }` | `http.ts:272` |
| △ | GET | `/knowledge/local-ollama/tags?baseUrl=` | query | `{ models: [{name, size?}] }` | `http.ts:278-280` |
| △ | POST | `/knowledge/local-ollama/pull` | `{ model, baseUrl }` | `{ started: true }`（异步） | `http.ts:281-288` |
| △ | DELETE | `/knowledge/local-ollama/pull?model=` | query | `{ cancelled: true }` | `http.ts:289-294` |
| △ | DELETE | `/knowledge/local-ollama/delete` | `{ model, baseUrl }`（body） | `{ deleted: true }` | `http.ts:295-301` |
| △ | GET | `/knowledge/local-ollama/status?model=` | query | `{ status, progress, message }` | `http.ts:302-304` |
| △ | GET | `/knowledge/local-ollama/pulls` | 无 | `{ pulls: [{model,status,progress,message}] }` | `http.ts:305-307` |

### 3.7 MinerU 处理器（受保护，⚙）

全部路径都以 `processors/managed` 开头 → 在路由分发**之前**执行 `requireLocalManagement`（`http.ts:58`）。

| method | path | 请求 | 响应 |
|---|---|---|---|
| ⚙ GET | `/knowledge/processors/managed/status` | 无 | `MineruDeploymentStatus` |
| ⚙ POST | `/knowledge/processors/managed/plan` | `{ root: string, existingModels?: string, pythonExecutable?: string }` | `MineruDeploymentPlan`（超时预算 ~310s） |
| ⚙ POST | `/knowledge/processors/managed/python` | `{ executable?: string }` | `MineruPythonDiscovery` |
| ⚙ POST | `/knowledge/processors/managed/prepare` | `{ planId: string, confirm: true }`（**必须显式 `confirm:true`**） | `MineruDeploymentStatus` |
| ⚙ POST | `/knowledge/processors/managed/start` / `stop` / `cancel` | `{}` | `MineruDeploymentStatus` |
| ⚙ POST | `/knowledge/processors/managed/use` | `{}` | `{ applied: true }`（内部会调 `setConfig({...connection(), documentProcessorProvider:'mineru-local', mineruTier:'basic'})`，见 `http.ts:167-170`） |

源码：`http.ts:152-178`。

---

## 4. 配置 schema

三层配置，优先级从低到高：

```
cordis.yml 的 config 块（schemastery，进程级部署默认，只读）
  → storage domain global.overrides（zod，运行期覆盖，GET/PUT /config）
    → base.config（zod，按库覆盖，PATCH /bases/:id）
```

解析函数：`resolveConfig`（全局，`src/knowledge/config.ts:154-213`）与 `resolveConfigFor`（叠加库级，`src/knowledge/config.ts:220-269`）。

### 4.1 字段全表

列含义：
- **默认**：schemastery 默认值（`config.ts:105-151`）——即「部署未配置时」的值。注意本机部署补丁覆盖了 `chunkSize=800 / chunkOverlap=100 / topK=4`（`cordis.patch.yml:24-26`）。
- **全局可覆盖**：字段是否在 `configOverridesSchema` 里（`src/knowledge/domain.ts:120-165`）。
- **库级可覆盖**：字段是否在 `baseConfigSchema` 里（`domain.ts:19-65`）。
- **归一化**：`resolveConfig` 里的 clamp 范围（`config.ts:161-210`）。**注意 zod 的写入门槛与 clamp 范围不同**，见 §4.4。

| 字段 | 类型 | 默认 | 全局可覆盖 | 库级可覆盖 | 归一化 clamp | 说明 |
|---|---|---|---|---|---|---|
| `embeddingProvider` | `'openai'\|'ollama'\|'local'\|'none'` | `'none'` | ✅ | ✅ | — | `none` = 纯词法 |
| `embeddingBaseUrl` | string | `''` | ✅ | ✅ | — | OpenAI 兼容根地址 / Ollama 地址 |
| `embeddingModel` | string | `''` | ✅ | ✅ | — | 空 = 未配置 |
| `embeddingApiKey` | string | `''` | ✅ | ✅ | — | 全局还会回落 `process.env.KNOWLEDGE_API_KEY`（`config.ts:155-157`） |
| `rerankModel` | string | `''` | ✅ | ✅ | — | 空 = 不重排；`local:` 前缀走本地 cross-encoder |
| `rerankBaseUrl` | string | `''` | ✅ | ✅ | — | |
| `rerankApiKey` | string | `''` | ✅ | ✅ | — | 回落 `KNOWLEDGE_RERANK_API_KEY` |
| `localRerankTimeoutMs` | number(int) | `60000` | ✅ | ✅ | 10000–300000 | zod 同范围 |
| `smartChunk` | boolean | `true` | ✅ | ✅ | — | 关闭 = 仅按分隔符 |
| `chunkSeparator` | string | `'\n\n'` | ✅ | ✅ | — | |
| `chunkSize` | number | `1024` | ✅ | ✅ | 64–100000（默认 1024；**库级 fallback 是 800**，`config.ts:223`） | zod 只要求 `int>0` |
| `chunkOverlap` | number | `200` | ✅ | ✅ | 0 – (chunkSize-1) | |
| `topK` | number | `6` | ✅ | ✅ | 1–50 | |
| `searchMode` | `'auto'\|'hybrid'\|'vector'\|'lexical'` | `'auto'` | ✅ | ✅ | — | |
| `similarityThreshold` | number | `0` | ✅ | ✅ | 0–1 | |
| `mmrDiversity` | number | `0` | ✅ | ✅ | 0–1 | |
| `rrfVectorWeight` | number | `1` | ✅ | ✅ | 0.1–5 | hybrid RRF 中向量通道权重 |
| `embeddingBatchSize` | number | `32` | ✅ | ✅ | 1–512 | |
| `siblingChunks` | number | `1` | ✅ | ✅ | 0–3 | 命中点前后附带的邻居块数 |
| `localModelCacheDir` | string | `''` | ✅ | ❌ | — | 空 = `<DSH_HOME>/cache/dsh-knowledge/local-models` |
| `hfEndpoint` | string | `''` | ✅ | ❌ | — | HF 镜像；空 = 官方 hub / `HF_ENDPOINT` |
| `mineruPythonIndexUrl` | string | `'https://pypi.org/simple'` | ✅ | ❌ | — | 托管 MinerU 的 pip index |
| `chunkStorePath` | string | `''` | ❌ | ❌ | — | **只能改 cordis config**；空 = `<DSH_HOME>/storages/knowledge-chunks.sqlite` |
| `documentProcessorProvider` | `'builtin'\|'mineru'\|'mineru-local'` | `'builtin'` | ✅ | ✅ | — | |
| `mineruApiKey` | string | `''` | ✅ | ✅ | — | |
| `mineruApiHost` | string | `''` | ✅ | ✅ | — | 空 = `https://mineru.net` |
| `mineruLocalUrl` | string | `'http://127.0.0.1:8000'` | ✅ | ✅ | — | |
| `mineruLocalApiKey` | string | `''` | ✅ | ✅ | — | |
| `mineruTier` | `'flash'\|'basic'\|'standard'\|'advanced'` | `'basic'` | ✅ | ✅ | — | |
| `documentProcessingTimeoutMs` | number | `1800000` | ✅ | ✅ | 10000–7200000 | |
| `structuredChunking` | boolean | `true` | ✅ | ✅ | — | |
| `semanticChunk` | boolean | `false` | ✅ | ✅ | — | |
| `semanticChunkThreshold` | number | `0.75` | ✅ | ✅ | 0–1 | |
| `chunkTokenLimit` | number | `0` | ✅ | ✅ | 0–1000000 | 0 = 不限 |
| `conflictStrategy` | `'keep'\|'replace'\|'rename'` | `'rename'` | ✅ | ✅ | — | 同名冲突策略 |
| `urlRefreshHours` | number | `0` | ✅ | ✅ | 0–8760 | 0 = 不自动刷新 |
| `imageCaptionProvider` | `'off'\|'openai'\|'ollama'` | `'off'` | ✅ | ✅ | — | |
| `imageCaptionModel` | string | `''` | ✅ | ✅ | — | |
| `imageCaptionBaseUrl` | string | `''` | ✅ | ✅ | — | |
| `imageCaptionApiKey` | string | `''` | ✅ | ✅ | — | |
| `resumeInterruptedOnStartup` | boolean | `true` | ✅ | ✅ | — | 启动时是否自动续跑被打断的导入 |
| `autoRetrieve` | boolean | `true` | ✅ | ✅ | — | 每条用户消息自动检索注入 |
| `injectUsagePrompt` | boolean | `true` | ✅ | ✅ | — | 系统提示里是否带可用库列表 |
| `autoRetrieveWeight` | number | `3` | ✅ | ✅ | 0–5 | 每库注入席位；0 = 排除该库 |
| `localWorkerIdleTimeoutMs` | number | `60000` | ✅ | ❌ | 0–86400000 | 0 = 模型常驻 |

`GET /knowledge/config` 返回的正是这张表的解析结果（`KnowledgeConfig`，`src/knowledge/types.ts:262-332`），**不含 `chunkStorePath`**（`KnowledgeConfig` 里没有该字段）。

### 4.2 全局覆盖（`ConfigOverrides`）zod 精确门槛

`src/knowledge/domain.ts:120-165`。与 clamp 范围不一致的几处（**写库门槛更宽松**）：

| 字段 | zod 写入/装载校验 | resolveConfig clamp |
|---|---|---|
| `chunkSize` | `z.number().int().gt(0)` | 64–100000 |
| `chunkOverlap` | `z.number().int().gte(0)` | 0–(chunkSize-1) |
| `topK` | `z.number().int().gt(0)` | 1–50 |
| `embeddingBatchSize` | `z.number().int().gt(0)` | 1–512 |
| `chunkTokenLimit` | `z.number().int().gte(0)` | 0–1000000 |
| `urlRefreshHours` | `z.number().int().gte(0)` | 0–8760 |
| `similarityThreshold` / `mmrDiversity` / `semanticChunkThreshold` | `z.number().gte(0).lte(1)` | 0–1 |
| `rrfVectorWeight` | `z.number().gte(0.1).lte(5)` | 0.1–5 |
| `siblingChunks` | `z.number().int().gte(0).lte(3)` | 0–3 |
| `autoRetrieveWeight` | `z.number().int().gte(0).lte(5)` | 0–5 |
| `localRerankTimeoutMs` | `z.number().int().gte(10000).lte(300000)` | 同 |
| `documentProcessingTimeoutMs` | `z.number().int().gte(10000).lte(7200000)` | 同 |
| `localWorkerIdleTimeoutMs` | `z.number().int().gte(0)` | 0–86400000 |
| 所有 string 字段 | `z.string()`（**无 trim、无长度限制**） | 原样 |
| 所有 enum 字段 | `z.enum([...])` 精确匹配 | 原样 |

未声明的 key：装载时会被 zod **静默剥离**（`z.object` 默认行为），但**写入时会先落盘**（见 §5.5）。

### 4.3 按库覆盖（`BaseConfig`）

`src/knowledge/domain.ts:19-65` + `src/knowledge/types.ts:40-92`。= 全局覆盖的子集：**去掉** `localModelCacheDir`、`hfEndpoint`、`mineruPythonIndexUrl`、`localWorkerIdleTimeoutMs`，其余同 §4.2。（`chunkStorePath` 两层覆盖里都没有，只能改 cordis config。）

写入/清空语义（官方 UI 的约定，`src/ui/client/rag-config.tsx:243-252`）：

- `PATCH /bases/:id` 的 `config` 是**合并**：`mergeBaseConfig` 逐个 key 覆盖，**字符串值为 `''`（trim 后为空）时 `delete` 该 key**（`index.ts:4554-4565`）。
- 因此「恢复默认」= 对该字段传 `''`（字符串）或传与全局相同的值（官方 UI 对字符串字段传 `''`；数值字段传全局值 → 这实际上会留下一条与全局同值的覆盖，功能等价）。
- `POST /bases` 创建时用 `compactBaseConfig`：丢弃空字符串、保留 boolean、保留有限数值（`index.ts:4539-4552`）。
- 数值**不要传 `''`**（不是字符串字段，会变成非数值 → 装载校验失败）。官方 UI 的空输入框策略是「忽略，不改值」（`rag-config.tsx:203-205`）。
- 布尔字段传 `false` 是有效覆盖，不会被丢弃。

### 4.4 优先级与回落细节

- `embeddingApiKey` / `rerankApiKey` 的全局解析顺序：`overrides.X ?? process.env.KNOWLEDGE_API_KEY ?? config.X`（`config.ts:155-160`）。注意 `??` 只在 `undefined/null` 时回落，所以**覆盖里写 `''` 会压掉环境变量**。
- 密钥优先级链在库级只有两级：`baseConfig.X ?? resolved.X`（`config.ts:231, 234`）。
- `resolveConfigFor(baseId)` 对不存在的 base 直接回落到全局（`index.ts:591-600`）。

---

## 5. 持久化

### 5.1 存储域与 key

| 项 | 值 |
|---|---|
| 存储域名字 | `knowledge`（`domain.ts:216`） |
| 域版本 | `0`（`domain.ts:217`） |
| 布局 | 未声明 `layout` → 后端默认 `single`（`domain.ts:215-231`；`node_modules/@deepseek-ai/dsh-storage-domain/lib/types/spec.d.ts:36-43`） |
| 表 | `bases`、`documents`（`domain.ts:227-230`、`234-238`） |
| global 槽 | `{ overrides: ConfigOverrides, groups?: string[], enabled?: boolean, enabledBaseIds?: string[] }`（`domain.ts:218-226`），初始值 `{ overrides:{}, enabled:true, enabledBaseIds:[] }`（`domain.ts:225`） |

**没有单独的「配置 key」**：全局配置就是 `domain.global.overrides` 这一个对象；读路径 `store.getConfigOverrides()` → `domain.global.get().overrides`（`store.ts:628-630, 660-668`）。

### 5.2 实际文件（本机实测）

本机 `DSH_HOME`（Pilot 自己的 home）为 `C:\Users\HONOR\AppData\Roaming\Pilot\dsh-home`，后端路由到 `json`（`single` 布局），因此：

| 内容 | 路径（实测存在） | 来源 |
|---|---|---|
| 全局配置覆盖 + 分组 + 开关 + bases/documents 元数据 | `<DSH_HOME>\storages\knowledge.json` | `node_modules/@deepseek-ai/dsh-storage-json/lib/index.js:178-190`（`<root>/<name>.json`） |
| 分块与向量（SQLite，WAL） | `<DSH_HOME>\storages\knowledge-chunks.sqlite`（+`-wal`/`-shm`） | `src/knowledge/chunkdb.ts:29-34`；`store.ts:272-273` |
| 原始文件副本 | `<DSH_HOME>\storages\knowledge-raw\<baseId>\<docId><ext>` | `store.ts:59-87, 277` |
| 解析产物（artifact） | `<DSH_HOME>\storages\knowledge-artifacts` | `index.ts:346-348` |
| MinerU 托管部署状态 | `<chunkStoreDir>\mineru-management.json` | `index.ts:2725` |

实测 `knowledge.json` 顶层结构（`global: null` 表示从未写过覆盖）：

```json
{
  "unit": { "name": "knowledge", "version": 0 },
  "global": null,
  "tables": { "bases": { "<baseId>": { ... } }, "documents": { "<docId>": { ... } } }
}
```

序列化格式：`JSON.stringify(doc, null, 2)` + 结尾换行（`node_modules/@deepseek-ai/dsh-storage-json/lib/index.js:83`）。

> 换 profile / 换 `storage-domain` 后端（如 sqlite）时路径会变——由 profile 的 `@deepseek-ai/dsh-storage-domain` 配置 `backend` / `routes` 决定（`node_modules/@deepseek-ai/dsh-storage-domain/lib/index.js:359-362`）。**具体到 SQLite 后端的文件名未确认**（§11）。

### 5.3 分块 SQLite 表结构

`src/knowledge/chunkdb.ts:314-398, 472`：

| 表 | 用途 |
|---|---|
| `chunk` | 分块本体（`doc_id`、`base_id`、`index`、`text`、`heading`、`context`、`embedding`、`embedding_model`、`embedding_text_hash`…），索引 `chunk_doc_idx`、`chunk_base_idx`、`chunk_emb_hash_idx` |
| `chunk_fts` | FTS5 外部内容表（`tokenize='trigram'`），用于词法检索 |
| `chunk_meta` | `key/value` 元信息 |
| `document_generation_stage` / `document_generation_chunk` / `document_generation_commit` | 增量/可恢复的「代（generation）」写入：先 stage、再 commit，崩溃可恢复 |

### 5.4 并发 / 冲突处理

| 机制 | 位置 | 行为 |
|---|---|---|
| global 单槽写入串行链 | `store.ts:670-687` | 每次写都在链上串行：读当前 → `{...current, ...patch, overrides:{...current.overrides, ...patch.overrides}}` → `global.set`。**避免两次并发设置互相覆盖对方的字段** |
| 写失败不污染链 | `store.ts:683-686` | `.catch(() => {})` 让链继续 |
| 元数据写入重试 + 串行 | `metadata-write.ts:2-4, 29-47` | 单队列；命中 `EPERM/EBUSY/EACCES`（Windows 文件锁）按 20/50/100/200/400ms 重试；其它 IO 错直接抛 `MetadataWriteError`；`isMetadataWriteFailure` 供上层降级为警告 |
| 文件原子替换 | `node_modules/@deepseek-ai/dsh-storage-json/lib/index.js:26-36, 265-270` | 先写同目录 `.uuid.tmp`，fsync，再 rename 覆盖；`single` 布局每次写**重写整个知识库文件** |
| bases 写并发 | 领域表 `put` 本身无逐记录锁（`node_modules/@deepseek-ai/dsh-storage-domain/lib/index.js:257-262`）；同一 base 的并发导入由上层 `withBaseWriteLock` 串行（`index.ts:305, 958`） |
| 进程级互斥 | `dsh-storage-domain` | 同一 domain 名字在同一进程只能 open 一次（`already-open`）；跨进程无锁 → **不要在 DSH 运行时同时用另一个进程写 `knowledge.json`** |

### 5.5 ⚠ 写坏数据的后果（最大的坑）

事实链：

1. 写覆盖**不做 schema 校验**：`setConfig` → `store.setConfigOverrides` → `writeGlobal` → `domain.global.set(value)`，而 `DomainImpl.global.set` 直接 `unit.setGlobal(value)`（`node_modules/@deepseek-ai/dsh-storage-domain/lib/index.js:157-173`）。zod 校验只发生在 domain **open** 时（同文件 `382-383`：`globalSpec.schema.parse(snapshot.global)`）。
2. open 失败 → `openStore` 在 `try` 之外抛出（`store.ts:269` 在 `try` 之前）→ `KnowledgeService.init` 捕获并记 `storageError`（`index.ts:324-333`）→ 之后每个 `/knowledge/*` 请求经 `whenReady()` 后调 `requireStore()` → 抛 `StorageUnavailableError` → **HTTP 503**（`index.ts:4156-4163`，`http.ts:115-120`）。
3. 因此：`PUT /config {"topK":0}` 或 `{}` 里混入 `embeddingProvider:"foo"`、`chunkSize:"800"`、`siblingChunks:9` 等 → **本次运行返回 200 且被 clamp 掩盖，重启后整个知识库 503，直到人工修 `knowledge.json`**。
4. 同样适用于 `PATCH /bases/:id` 的 `config`：`bases` 表的记录也是写入不校验、装载校验（`domain.ts:67-75`），且该域**没有** `invalidRecords:'backup-and-skip'`，一条坏记录会拒绝整个域。

**Pilot 设置界面的强制要求**：提交前按 §4.2 的 zod 门槛（而不是 clamp 范围）自行校验/夹取；只发送白名单字段；数值必须是 finite integer（除非该字段允许小数）；枚举必须精确匹配；字符串不要传非字符串。参考官方 UI 的 `NUMBER_RANGES` + clamp 实现（`src/ui/client/rag-config.tsx:177-214`，注释里明确写了这两类事故）。

---

## 6. 认证与同源

### 6.1 `/knowledge/*` 无认证

- 路由 handler 只看路径/方法，**不检查 token / cookie / Authorization / Origin / Referer**（`http.ts:40-61`；全文没有相关读取；`host-webserver` 包也没有鉴权中间件，见 `node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js` 无 `access-control`、无 401/403 逻辑）。
- DSH 前端的登录态是「`?token=` 换 cookie」仅用于 **index.html** 的放行（`node_modules/@deepseek-ai/dsh-client-connection/lib/index.js:446-477, 806-810`，由 static fallback 调用 `ctx.connection.authorizeIndex`，见 `dsh-host-frontend-static/lib/index.js:95`）。`/knowledge` 前缀路由绕开了这道门。
- 结论：**同源浏览器 `fetch('/knowledge/config')` 直接可用，不需要任何 header/cookie**。插件自己的客户端就是这么写的：`fetch(`/knowledge${path}`)`（`src/ui/client/api.ts:380`）。

### 6.2 唯一的例外：MinerU 托管路由

`requireLocalManagement`（`src/knowledge/mineru-management-security.ts:7-20`）逐条要求：

| 条件 | 失败码（403/415） |
|---|---|
| 宿主绑定地址必须是 `127.0.0.1`（`ctx.webServer.host === '127.0.0.1'`，`index.ts:2730`） | `local_management_only` |
| 连接的 `socket.remoteAddress` ∈ `127.0.0.1 / ::1 / ::ffff:127.0.0.1` | 同上 |
| `Host` 头匹配 `^(localhost\|127\.0\.0\.1\|\[::1\])(:\d+)?$` | `invalid_host` |
| 请求头 `x-dsh-mineru-management: 1`，且 `sec-fetch-site !== 'cross-site'` | `management_header_required` |
| 若有 `Origin`，必须是 `http(s)://<同一个 Host>` | `cross_origin_request` |
| 非 GET 请求的 `content-type` 必须是 `application/json` | `invalid_content_type`（415） |

官方客户端只对 `processors/managed/` 前缀加这个 header（`src/ui/client/api.ts:382`）。Pilot 若要用这几条，记得带 header；若 DSH 绑的是 `::1` 或局域网地址，这些接口**必然 403**。

### 6.3 从 Electron 其它渲染进程调用？

- `dsh-host-webserver` 不发任何 CORS 响应头（已确认 `access-control` 零命中）→ **跨 origin 的浏览器 fetch 会被浏览器拦掉**，且预检 OPTIONS 无人处理。
- 同源 iframe / 同源页面（DSH Web GUI 内的设置面板、DSH 注入的 slot）没问题。
- 若必须在别的渲染进程/主进程调用：走主进程 `net`/`http.request`（相当于原生客户端），此时无 CORS 限制、也不需要 token；或者加一个自己的同源代理端点。

### 6.4 安全备注

`GET /knowledge/config` 会返回**明文 `embeddingApiKey` / `rerankApiKey` / `mineruApiKey` / `mineruLocalApiKey` / `imageCaptionApiKey`**（`types.ts:262-332`，值直接来自 resolveConfig）。因为接口无鉴权，任何能访问该端口的本机进程/同源页面都能读到密钥。Pilot 在界面上要按「密码框 + 只在保存时提交」处理，且不要把这些值写进日志。

---

## 7. 客户端半（client bundle）

### 7.1 构建

| 事实 | 位置 |
|---|---|
| 客户端单入口：`src/ui/client/index.tsx` → `lib/client.js` | `build.mjs:140-161` |
| 构建器：**esbuild**（`format: 'cjs'`，`platform: 'browser'`，`target: ['es2020']`，`jsx: 'automatic'`，sourcemap on） | `build.mjs:140-153` |
| 产物是「工厂形式经典脚本」，不是 ESM：外层包 `window.__ModuleLoader__.load({ id:'dsh-knowledge', factory:(require)=>{...} })` | `build.mjs:154-159` |
| externals（运行时由宿主模块表注入）：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`dsh-client-ui-slots`、`dsh-client-web-react`、`dsh-client-ui-primitives`、`dsh-client-ui-attachment`、`dsh-client-schema-form` | `build.mjs:127-138` |
| `define`：`process.env.NODE_ENV`、`import.meta.env` | `build.mjs:150-153` |
| `dsh.client` 元数据（模块系统据此注入依赖）：`platform:'web'`，`inject: ['@deepseek-ai/dsh-client-runtime','.../dsh-client-ui-slots','.../dsh-client-locale','.../dsh-client-ui-settings']` | `package.json:41-54` |
| 类型声明由 `tsc -p tsconfig.build.json` 单独 emit 到 `lib/types` | `build.mjs:165-169`；`tsconfig.build.json` |
| 已安装副本验证：`profiles/web/node_modules/dsh-knowledge@0.5.2`，`lib/client.js` 397,460 B（工厂包装，首行即 `window.__ModuleLoader__.load(...)`） | 本机实测 |

> 注意 `build.mjs` 的 externals 列表比 `package.json` 的 `dsh.client.inject` 更宽（多了 `dsh-client-web-react`/`ui-primitives`/`ui-attachment`/`schema-form`），但**源码实际没有 import 这些包**（见 §8），属于历史预留。

### 7.2 源码目录

| 路径 | 内容 | 行数量级 |
|---|---|---|
| `src/ui/client/index.tsx` | 唯一入口：注册 3 个 slot + `apply()` | 84 行 |
| `src/ui/client/KnowledgeSection.tsx` | 主面板（侧栏按钮 + 全屏浮层：资料/召回测试/设置） | 2723 行 |
| `src/ui/client/rag-config.tsx` | **按库 RAG 设置表单**（文档处理 / 嵌入 / 重排 / TopK / 高级） | 868 行 |
| `src/ui/client/LocalModelsSection.tsx` | 「本地模型」设置区（含 MinerU 部署子区），导出 `LocalModelsSection` 与 `LocalModelsSectionProps` | 37.7 KB |
| `src/ui/client/MineruDeploymentSection.tsx` | 托管 MinerU 部署 UI | 22.7 KB |
| `src/ui/client/api.ts` | **浏览器 fetch 客户端 + 全部类型镜像** | 764 行 |
| `src/ui/client/locales.ts` | zh/en 字典（`KnowledgeKey`、`Translate`） | 62 KB |
| `src/ui/client/theme.ts` | 颜色令牌 `C`、`PANEL_CSS`、`style` 内联样式表 | 424 行 |
| `src/ui/client/dialogs.tsx` / `popover.tsx` / `icons.tsx` / `processing-evidence.tsx` | 对话框 / 菜单 / 图标 / 证据视图 | — |
| `src/ui/client/panel-store.ts` / `titlebar-safe-area.ts` / `chunk-expansion.ts` / `popover-placement.ts` / `directory-actions.ts` | 无 React 的小工具 | — |

可复用导出（都不是默认导出）：

| 文件 | 导出 |
|---|---|
| `KnowledgeSection.tsx` | `SidebarKnowledgeAction`(:101)、`KnowledgePanel`(:128)、`type Translate`(:79) |
| `rag-config.tsx` | `RagConfigPanel`(:26)，props `{ base, globalConfig, api, t, busy, onSaved }` |
| `LocalModelsSection.tsx` | `LocalModelsSection` |
| `dialogs.tsx` | `Toasts`、`Modal`、`ConfirmDialog`、`PromptDialog`、`TextDocumentDialog`、`RestoreBaseDialog`、`CreateBaseDialog`、`readFileAsBase64`、`FILE_ACCEPT`、`MAX_FILES`、`MAX_UPLOAD_BYTES`、`SUPPORTED_IMPORT_EXTENSIONS` |
| `popover.tsx` | `ContextMenu`、`PopoverMenu`、`type MenuEntry` |
| `api.ts` | `class KnowledgeApi` + 全部 TS 类型 |
| `theme.ts` | `C`、`accentSoft`、`PANEL_CSS`、`style`、`avatarColor`、`formatRelativeTime`、`formatSize` |
| `icons.tsx` | 各 `Icon*` 组件 + `docIconStyle`、`fileVisual` |
| `locales.ts` | `zh`、`en`、`type KnowledgeKey`、`type Translate` |

**没有 hooks 库**：状态逻辑都内联在组件里（`useState`/`useEffect`），唯一可复用的「hook-ish」是一个外部 store `createKnowledgePanelStore()`（`panel-store.ts`，配合 `useSyncExternalStore`）。

### 7.3 样式怎么打进去

- **没有 `.css` 文件**（`src` 下 `*.css|*.scss|*.less` 零命中）。
- 全部走**内联 style 对象**：`theme.ts` 的 `style`（`theme.ts:114+`）+ `C` 颜色令牌（用 DSH 的 CSS 变量 `--dsw-alias-*` 并给 fallback，见 `theme.ts:9-31`）。
- 少量 hover/动画/滚动条样式靠**运行时注入一段 `<style>`**：模块加载即执行（不是 React 生命周期）
  - `KnowledgeSection.tsx:81-88`：`if (document.getElementById('kb-panel-styles') === null) { ... el.textContent = PANEL_CSS ... }`
  - `PANEL_CSS` 定义在 `theme.ts:34-112`（`@keyframes kb-spin`、`.kb-row`、`.kb-sash`、`.kb-scroll::-webkit-scrollbar`、container query 等，全部 `.kb-*` 前缀，class 名与内联样式配合）
- 面板定位用了 `env(titlebar-area-*)`（`theme.ts:117`）与 `navigator.windowControlsOverlay`（`titlebar-safe-area.ts`）来做 Electron 标题栏安全区。

### 7.4 想直接 import 它的源码组件，需要什么

| 条件 | 说明 | 依据 |
|---|---|---|
| React 18 + `react/jsx-runtime` | 源码用 **automatic JSX**；用了 `useSyncExternalStore`（React 18 起）。`package.json` devDeps `@types/react ~18.3.1` | `build.mjs:148`；`KnowledgeSection.tsx:11`；`package.json:134` |
| `react-dom` 的 `createPortal` | `popover.tsx:9` 直接 `import { createPortal } from 'react-dom'`。仓库里没有装 `@types/react-dom`，靠手写 shim `src/ui/client/react-dom.d.ts` 声明 | `popover.tsx:8-12`；`react-dom.d.ts:1-11` |
| 解析 `.js` → `.tsx`/`.ts` 的模块解析 | 源码内部一律写 `./theme.js`、`../../knowledge/context.js` 这类**带 `.js` 后缀**的导入，实际文件是 `.ts/.tsx`。`tsconfig.json` 用 `moduleResolution: "Bundler"` + `allowImportingTsExtensions`（`tsconfig.json:5, 16`）。esbuild 官方文档称会对 TS importer 尝试 `.ts/.tsx`（**本项目未实测**，因为不允许跑构建）；**Pilot 若用 Vite/webpack 必须自备 alias/plugin** | `rag-config.tsx:11-15`；`KnowledgeSection.tsx:13` |
| 接受它把 host 侧纯函数拖进 client 包 | `KnowledgeSection.tsx:13` 从 `../../knowledge/context.js` 导入 `serializeContextWindow`，会连带编译 `context.ts` / `context-protocol.ts` / `source-spans.ts` / `text-safety.ts`（都是纯 TS，无 node 内置依赖，浏览器安全） | 同左；`context.ts:1-9` |
| 样式不会自动生效于全局 | `theme.ts` 的 `C` 依赖 DSH 的 `--dsw-alias-*` 变量；离开 DSH 主题会全用 fallback 色，观感会变。`.kb-*` 样式是**全局注入**（还会改 `body` 上的 `--kb-hover` 变量） | `theme.ts:9-31, 46-49` |
| 组件依赖 `Translate` | `KnowledgePanel`/`RagConfigPanel` 都要传 `t`；可以直接用它的 `zh`/`en`（`locales.ts:361, 737`） | `KnowledgeSection.tsx:128-132`；`rag-config.tsx:17-27` |
| 不能指望 slot 注册 | `index.tsx` 的 `inject = ['slots','locale']` 和 `slots.register(...)` 是 DSH 专属；直接复用组件时**跳过 index.tsx**，自己渲染 `KnowledgePanel`（需要一个 store 实例） | `index.tsx:32, 45-83` |

最小可用组合（直接复用）+ 伪代码：

```tsx
import { KnowledgeApi } from '.../ui/client/api'
import { createKnowledgePanelStore } from '.../ui/client/panel-store'
import { KnowledgePanel } from '.../ui/client/KnowledgeSection'
import { zh } from '.../ui/client/locales'

const api = new KnowledgeApi()
const store = createKnowledgePanelStore()
const t = (k: keyof typeof zh) => zh[k]
// <KnowledgePanel store={store} api={api} t={t} />
```

---

## 8. 依赖风险

### 8.1 client 半到底 import 了哪些 `@deepseek-ai/*`

源码 grep 结果（`src/ui/client/**` 全部 `^import ... from '...'`）：**只有一处**，且是**类型导入**：

| 文件 | 导入 | 运行时是否需要 |
|---|---|---|
| `src/ui/client/index.tsx:9` | `import type { Context } from '@deepseek-ai/cordis'` | ❌ 纯类型，esbuild 擦除 |

其余 import 全是 `react` / `react-dom` / 相对路径（`src/ui/client/*` 与 `src/knowledge/*`）。

**实测佐证**（构建产物，本机 `profiles/web/node_modules/dsh-knowledge/lib/client.js`，与源码同版本 0.5.2）：全文件里 `require("...")` 只出现三种——`require("react")`、`require("react/jsx-runtime")`、`require("react-dom")`，**没有一个 `require("@deepseek-ai/...")`**。即：**client 半的真实运行时依赖只有 `react` + `react/jsx-runtime` + `react-dom`**。

但**声明层**还挂了四个客户端包（由宿主模块系统在加载 `lib/client.js` 时预先注入，`index.tsx` 的 slot/locale/settings 集成需要它们；我们的源码复用路径不用）：

| 位置 | 声明 |
|---|---|
| `package.json:45-53` | `dsh.client.inject = ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-settings']` |
| `build.mjs:127-138` | externals 里额外还有 `@deepseek-ai/dsh-client-web-react`、`.../dsh-client-ui-primitives`、`.../dsh-client-ui-attachment`、`.../dsh-client-schema-form`、`@deepseek-ai/cordis` |

> 若把 `lib/client.js` 原样塞进 DSH 的模块系统，这些 external 由宿主的冻结模块表解析（`window.__ModuleLoader__`）。**若在 Pilot 自己的 bundle 里编译源码组件，这些都不需要**——只有 `index.tsx` 的 slot 注册路径需要 `slots`/`locale` 服务，而那是我们不复用的部分。真正会缺的只有：`react`、`react-dom` 的版本与 types，以及 `.js`→`.tsx` 的解析规则。

### 8.2 host 半的依赖（与设置界面无关，但影响“能不能跑起来”）

`package.json:106-121`：`@firecrawl/anydoc`、`@huggingface/transformers@4.3.1`、`@napi-rs/canvas`、`jszip`、`mammoth`、`mupdf`、`onnxruntime-node@1.21.0`、`pdf-parse`、`pdfjs-dist`、`ppu-ocv`、`ppu-paddle-ocr`、`tesseract.js`、`turndown`、`undici`、`word-extractor`（另有 optional `@napi-rs/canvas-win32-x64-msvc`，`package.json:123-125`）。host 构建把这些都 external（`build.mjs:62-84`），运行时从 profile 的 node_modules 解析。Pilot 不要试图把它们打进自己的 bundle。

### 8.3 版本耦合

| 依赖 | 版本/事实 | 风险 |
|---|---|---|
| `@deepseek-ai/dsh-host-webserver` | peer/dev `link:../dsh/packages/host/webserver`（`package.json:128`） | `WebRoute` 形状（`kind/path/handler`）与 `webServer.register` 是私有契约；升级 DSH 时要复核 |
| `@deepseek-ai/dsh-storage-domain` | 域 API（`defineDomain`/`domainTable`/`global`） | 同上 |
| `@deepseek-ai/schemastery` | 打包进 host（`build.mjs:60-61` 注释） | Loader 用它校验 `Config`；版本错配会加载失败 |
| React | 源码按 18 写；DSH 前端注入 React | 复用时若宿主是 React 17 → `useSyncExternalStore` 不存在 |

---

## 9. 写一个自己的设置界面：推荐流程

### 9.1 需要的端点（最小集）

| 用途 | 调用 |
|---|---|
| 读全局配置（含密钥） | `GET /knowledge/config` |
| 写全局配置 | `PUT /knowledge/config`（只发改动字段，先本地按 zod 门槛校验） |
| 读所有库 + 每个库的覆盖 | `GET /knowledge/bases` |
| 写某个库的覆盖 | `PATCH /knowledge/bases/:id` `{ config }`（清空某字段传 `''`） |
| 存储是否健康 | 任一 503 `storage_unavailable` 即表示存储装载失败 |
| 总览数字 | `GET /knowledge/stats`、`GET /knowledge/bases/:id/stats` |
| 召回测试 | `POST /knowledge/search` |
| 重建索引 | `POST /knowledge/bases/:id/reindex` → 轮询 `GET /knowledge/reindex/:jobId`，可 `POST .../cancel` |
| 模型候选 | `GET /knowledge/model-suggestions`、`GET /knowledge/local-models` |
| 保存前探测维度 | `POST /knowledge/probe-embedding-dimensions` |
| 工具/检索总开关 | `GET|PUT /knowledge/knowledge-toggle` |

### 9.2 一个够用的 fetch 封装（照抄官方语义）

```ts
class KnowledgeHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 60_000): Promise<T> {
  const res = await fetch(`/knowledge${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      // 只有 /processors/managed/* 需要：
      ...(path.startsWith('/processors/managed/') ? { 'x-dsh-mineru-management': '1' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  })
  let env: { ok?: boolean; value?: T; error?: { code: string; message: string } }
  try { env = await res.json() } catch { throw new KnowledgeHttpError(res.status, 'non_json', `HTTP ${res.status}`) }
  if (!res.ok || env.ok !== true) throw new KnowledgeHttpError(res.status, env.error?.code ?? 'error', env.error?.message ?? `HTTP ${res.status}`)
  return env.value as T
}
```

要点（全部来自 `src/ui/client/api.ts:378-401`）：
- 成功判定不只是 `res.ok`，还要 `ok === true`。
- 官方实现额外要求 `value !== undefined`——**`value` 是数字 0 时没问题，但 `value` 为 `undefined` 的 200 会被它当错误**；我们自己也应只在语义上需要 value 时检查。
- 长任务的超时预算要放大：整库重建 `2h+30s`、`import-path` 30min、`managed/plan` 310s（`api.ts:408, 659, 700`）。

### 9.3 全局配置表单的写入模板

```ts
// 1) 读
const cfg = await call<KnowledgeConfig>('GET', '/config')
// 2) 只提交用户真正改过的、且通过门槛校验的字段
const patch: ConfigOverrides = {}
if (dirty.embeddingProvider) patch.embeddingProvider = pick(cfg.embeddingProvider, ['openai','ollama','local','none'])
if (dirty.chunkSize) patch.chunkSize = clampInt(cfg.chunkSize, 64, 100_000)   // 必须 > 0
if (dirty.topK) patch.topK = clampInt(cfg.topK, 1, 50)                        // 必须 > 0
if (dirty.siblingChunks) patch.siblingChunks = clampInt(cfg.siblingChunks, 0, 3)
if (dirty.similarityThreshold) patch.similarityThreshold = clampNum(cfg.similarityThreshold, 0, 1)
// 字符串字段：'' 是合法值（清空），但不要传 undefined 之外的怪类型
// 3) 写；返回的是合并后的完整配置
const next = await call<KnowledgeConfig>('PUT', '/config', patch)
```

不要：`PUT /config` 整个 `KnowledgeConfig` 对象（会把「哪些是覆盖」的语义搅乱；而且 `chunkStorePath` 之类不在覆盖 schema 里的 key **不会生效**——会先写进文件、装载时被 zod 剥离，变成脏数据）；不要发 `null`（zod 的 `.optional()` 不接受 null，`null` 会让装载校验失败）。

### 9.4 按库覆盖表单的写入模板

```ts
// 读：从列表里拿该库现有覆盖
const bases = await call<BaseSummary[]>('GET', '/bases')
const base = bases.find(b => b.id === baseId)!
const currentOverride = base.config ?? {}

// 写：diff + 空串清空（与官方 RagConfigPanel 一致）
const patch: Record<string, unknown> = {}
for (const [k, v] of Object.entries(formValues)) {
  const wasOverridden = currentOverride[k] !== undefined
  if (v !== globalConfig[k] || wasOverridden) {
    patch[k] = (v === globalConfig[k] && typeof v === 'string') ? '' : v
  }
}
await call('PATCH', `/bases/${encodeURIComponent(baseId)}`, { config: patch })
```

在 `PATCH` 之前**自己**判断是否需要走「重建」而不是直接改（§3.2 的三条拒绝规则），否则用户会得到一个 500 中文文案。

---

## 10. 坑清单（按踩到概率排序）

1. **写入不校验、装载才校验 → 一条非法值可让整库长期 503**（§5.5）。数字 0 / 负值 / 字符串化数字 / 拼错枚举都危险。禁止把表单原始字符串直接塞进 JSON。
2. **`PUT /config` 是浅合并、且无法删除 key**。想“恢复默认”只能写值，无法回到「没有覆盖」的状态。
3. **`PATCH /bases/:id` 的 `config` 里字符串 `''` 表示删除该覆盖**，而对数值字段传 `''` 会写坏数据（官方 UI 用「空输入框则忽略」规避）。
4. **没有 `GET /bases/:id`**：这个路由根本没实现，无论 id 是否存在都返回 404 `code:'not-found'`（带连字符）；拿单库信息/覆盖只能 `GET /bases` 拉全表。注意同一 id 的 `GET /bases/:id/stats` 未知时是 404 `code:'not_found'`（下划线）——两个不同字符串。
5. **改嵌入模型被拒是 500 不是 4xx**，且只有中文 message。要提前用 `documentCount` + 现有 provider 判断。
6. **`GET /config` 泄露明文 API Key**，接口无鉴权。
7. **30 秒默认超时会打断慢操作**（整库重建同步阶段 / `import-path` / `managed/plan`）；请按端点放宽 `AbortSignal.timeout`。
8. **`/processors/managed/*` 需要 `x-dsh-mineru-management: 1`，且宿主必须绑 `127.0.0.1`**；否则 403。
9. **跨 origin 无 CORS**：设置界面必须与 `/knowledge` 同源（DSH GUI 内），或在主进程直接发 HTTP。
10. **`DELETE` 带 body 必须设 `content-type: application/json`**，否则 body 被静默丢弃（`/documents` 批量删除、`/groups` 删除会变成空操作/报错）。
11. **`documents/:id` 默认返回全部 chunk+embedding**（默认 `includeChunks !== 'false'`），大文档可达数 MB；面板预览应加 `includeChunks=false`。
12. **`GET /knowledge/reindex/:jobId` 的 job 只存在内存**（`index.ts:289`），进程重启后 jobId 失效 → 404，前端要能优雅处理。

---

## 11. 未确认事项

| 项 | 状态 |
|---|---|
| `storage-domain` 若被路由到 SQLite 后端时的具体文件名/表名 | **未确认**（本机实测是 json 后端；sqlite 后端代码未审计） |
| `PUT /config` 写入非法值后「重启即 503」 | **源码高置信推断**，本机没有实际复现（未运行构建/重启） |
| esbuild / Vite 对 `import './x.js'` → `x.tsx` 的解析行为在 Pilot 侧构建链中的实际表现 | **未确认**（取决于 Pilot 选用的打包器与配置） |
| DSH 客户端模块系统注入 `react`/`react-dom` 的确切 React 版本 | **未确认**（未读前端模块表实现） |
| `MineruDeploymentStatus` / `MineruDeploymentPlan` / `MineruPythonDiscovery` 的完整字段 | 未逐字段展开（在 `src/knowledge/mineru-deployment-types.ts`，使用者请直接读该文件） |
| 本机实际生效的 `knowledge` 部署 config（`embeddingProvider` 等） | 未确认：`knowledge.json` 的 `global` 为 `null`，说明运行期从未写过覆盖；部署层的值来自 `cordis.patch.yml` 默认（`none`）并可能被上层 patch 覆盖，未逐层追踪 |

---

## 12. 附录：源码索引

| 主题 | 文件:行 |
|---|---|
| 路由注册 | `src/knowledge/index.ts:313-318`；`src/knowledge/http.ts:32-38` |
| 路由分发 | `src/knowledge/http.ts:144-548` |
| 信封 / 错误映射 | `src/knowledge/http.ts:40-128, 553-589` |
| body 规则 | `src/knowledge/http.ts:30, 561-584` |
| 服务：配置 | `src/knowledge/index.ts:581-650` |
| 服务：开关/作用域 | `src/knowledge/index.ts:654-691` |
| 服务：bases | `src/knowledge/index.ts:695-879`；`4540-4565` |
| 服务：分组 | `src/knowledge/index.ts:883-921` |
| 服务：文档列表/详情 | `src/knowledge/index.ts:2600-2644, 3047` |
| 服务：统计 | `src/knowledge/index.ts:3181-3216` |
| 服务：检索 | `src/knowledge/index.ts:3220-3246` |
| 服务：重建 | `src/knowledge/index.ts:2382-2412, 2445-2482` |
| 服务：索引状态 | `src/knowledge/index.ts:2682-2719` |
| 服务：存储就绪 | `src/knowledge/index.ts:575-577, 4156-4167` |
| 配置 schema（进程级） | `src/knowledge/config.ts:105-151` |
| 配置解析/归一化 | `src/knowledge/config.ts:154-269` |
| 域（zod/global/表） | `src/knowledge/domain.ts:19-231` |
| store（合并/串行写） | `src/knowledge/store.ts:628-696`；`src/knowledge/metadata-write.ts:29-50` |
| 存储路径 | `src/knowledge/chunkdb.ts:29-43`；`src/knowledge/store.ts:264-313` |
| 分块 SQLite 表 | `src/knowledge/chunkdb.ts:314-398, 472` |
| 类型词汇 | `src/knowledge/types.ts`（`BaseSummary:459`、`BaseStats:478`、`SearchRequest:599`、`SearchResult:620`、`KnowledgeConfig:262`、`BaseConfig:40`） |
| 客户端入口/槽位 | `src/ui/client/index.tsx:32-84` |
| 客户端 API | `src/ui/client/api.ts:378-764` |
| 主面板 | `src/ui/client/KnowledgeSection.tsx:81-136` |
| 按库设置面板 | `src/ui/client/rag-config.tsx:26, 177-261` |
| 主题/CSS 注入 | `src/ui/client/theme.ts:9-112`；`KnowledgeSection.tsx:81-88` |
| 客户端构建 | `build.mjs:126-169`；`package.json:41-54` |
| 宿主 webserver 契约 | `node_modules/@deepseek-ai/dsh-host-webserver/lib/types/index.d.ts:31-40, 167-190` |
| 存储域后端/JSON 布局 | `node_modules/@deepseek-ai/dsh-storage-domain/lib/index.js:355-398`；`node_modules/@deepseek-ai/dsh-storage-json/lib/index.js:178-271` |
| MinerU 本地管理守卫 | `src/knowledge/mineru-management-security.ts:1-20` |
