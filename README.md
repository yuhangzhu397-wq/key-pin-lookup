# Key 归属查询

一个独立的 MaaS 内网运营工具，包含：

- Key 归属查询：输入 API Key（`pk-...`）或 Key ID（`key-...`），返回对应的 `user_id`（PIN）。
- TPM 总水位：按模型服务汇总全部 Key、全部 PIN 最近 60 秒的 Token 使用量，并除以 `model_service.tpm`，每 10 秒刷新。

## 本地预览

```bash
cp .env.example .env
```

将 `.env` 中的 `MOCK_MODE` 改为 `true`，然后运行：

```bash
pnpm install
pnpm dev
```

打开 <http://127.0.0.1:5173>，可使用以下演示值：

```text
key-demo-zjpt888
pk-demo-zjpt888
```

## 接入真实数据（推荐）

工具可以复用 JoyBuilder Ops 的查询接口，不需要数据库密码。

1. 打开 JoyBuilder Ops。
2. 点击右上角用户名 → **我的 Token** → **生成 Token**。
3. Token 只显示一次，请在服务器本地 `.env` 中配置，不要写进前端或发到聊天中：

```dotenv
MOCK_MODE=false
DATA_SOURCE=joybuilder_ops
OPS_API_BASE=http://joybuilder-ops.jdcloud.com/api/v1
OPS_ACCESS_TOKEN=本地填写生成的Token
OPS_DB_CONFIG_NAME=国内
OPS_DATABASE=maas
OPS_TABLE=api_key
```

如果部署平台占用了 `DATA_SOURCE` 或 `OPS_API_BASE` 这类通用变量名，可以改用应用专用变量：

```dotenv
JOYMAAS_DATA_SOURCE=joybuilder_ops
JOYBUILDER_OPS_API_BASE=http://joybuilder-ops.jdcloud.com/api/v1
```

工具会先通过 `/db-configs` 自动找到“国内”连接，再调用 `/query/execute` 查询。访问权限与生成 Token 的 JoyBuilder Ops 用户一致。

如果存在多个同名连接，可额外配置：

```dotenv
OPS_DB_CONFIG_ID=数据库连接ID
```

### 下游配额持久缓存

“下游配额”需要聚合 14 天分钟数据，首次分析可能较慢。JoyBuilder Ops 模式会按 24 小时分片读取记录，再在服务端合并 14 天峰值，避免单条聚合 SQL 压垮查询连接。只有全部分片成功才会发布新结果。服务会把每次成功结果写入本机缓存；以后即使服务重启，页面也会先立即展示上一次结果，再在后台更新：

安全限制：下游监控不再读取 `api_key_rate_limit` 全量 Key 限额表；Key 侧只保留实际调用用量，PIN 侧仍读取 `user_rate_limit`。旧版缓存会因缓存版本升级自动失效。

```dotenv
USAGE_MONITOR_REFRESH_MINUTES=360
USAGE_MONITOR_CACHE_FILE=.data/usage-monitor-cache.json
```

缓存默认每 6 小时更新，也可点击页面“重新分析”触发后台更新。同一时间只执行一份分析任务；首次分析失败且尚无缓存时，服务会每 5 分钟自动重试。缓存文件仅包含监控结果，不包含 JoyBuilder Ops Token 或完整 API Key，并已通过 `.gitignore` 排除。

该机制只读取数据库，不会执行 `INSERT`、`UPDATE` 或 `DELETE`。如需清空本机缓存，可停止服务后删除 `.data/usage-monitor-cache.json`。

## 直接连接 MySQL（备选）

使用一个只允许查询目标表的 MySQL 只读账号，在 `.env` 中配置：

```dotenv
MOCK_MODE=false
DATA_SOURCE=mysql
DB_HOST=数据库地址
DB_PORT=3306
DB_USER=只读账号
DB_PASSWORD=数据库密码
DB_NAME=maas
DB_TABLE=api_key
```

工具执行参数化前缀查询。调用方会将输入末尾追加 `%`，并转义 `_` 等 `LIKE` 通配符：

```sql
SELECT user_id, api_key_id
FROM api_key
WHERE api_key LIKE ? ESCAPE '='
LIMIT 2;
```

或：

```sql
SELECT user_id, api_key_id
FROM api_key
WHERE api_key_id LIKE ? ESCAPE '='
LIMIT 2;
```

为避免短前缀扫描过多数据，`pk-` 或 `key-` 后至少需要输入 4 位。查询最多读取两行：唯一匹配时返回 PIN，匹配多条时提示继续输入更多字符。建议确认 `api_key` 和 `api_key_id` 已建立索引。生产环境不要开启 `MOCK_MODE`。

## 构建和运行

```bash
pnpm build
pnpm start
```

默认监听 `8080` 端口。生产环境建议放在公司统一登录网关或反向代理之后，并限制为 MaaS 运营角色访问。

## 给运营团队部署

内网部署文件已经准备好：

- `Dockerfile`：生产镜像，多阶段构建、非 root 运行和健康检查。
- `docker-compose.example.yml`：单机内网部署示例，仅绑定服务器本机端口。
- `deploy/kubernetes.yaml`：Kubernetes Deployment 与 ClusterIP Service 模板。
- `deploy/README.md`：统一登录网关、Token Secret 和发布检查说明。

正式共享建议使用运营服务账号的 JoyBuilder Ops Token，并由公司统一登录网关校验运营权限。不要把个人 Token 烘焙进镜像。

## 安全约束

- Key 通过 POST 请求体提交，不进入 URL。
- 前端不使用 localStorage、sessionStorage 或最近查询记录。
- 本工具服务端不记录请求体或完整 Key；JoyBuilder Ops 或数据库仍可能保留查询审计记录。
- JoyBuilder Ops Token 仅保存在服务端环境变量中，不下发浏览器。
- 查询接口设置 `Cache-Control: no-store`。
- 数据库账号必须是只读账号。
- 重复映射不会自动取第一条，而是返回冲突错误。
