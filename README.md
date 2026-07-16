# Key 归属查询

一个独立的 MaaS 内网小工具：运营人员输入 API Key（`pk-...`）或 Key ID（`key-...`），工具查询 `api_key` 表并返回对应的 `user_id`（PIN）。

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

工具会先通过 `/db-configs` 自动找到“国内”连接，再调用 `/query/execute` 查询。访问权限与生成 Token 的 JoyBuilder Ops 用户一致。

如果存在多个同名连接，可额外配置：

```dotenv
OPS_DB_CONFIG_ID=数据库连接ID
```

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

工具执行参数化精确查询：

```sql
SELECT user_id, api_key_id
FROM api_key
WHERE api_key = ?
LIMIT 2;
```

或：

```sql
SELECT user_id, api_key_id
FROM api_key
WHERE api_key_id = ?
LIMIT 2;
```

建议确认 `api_key` 和 `api_key_id` 已建立索引。生产环境不要开启 `MOCK_MODE`。

## 构建和运行

```bash
pnpm build
pnpm start
```

默认监听 `8787` 端口。生产环境建议放在公司统一登录网关或反向代理之后，并限制为 MaaS 运营角色访问。

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
