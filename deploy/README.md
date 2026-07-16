# 内网部署说明

## 推荐拓扑

```text
运营同学 → 公司统一登录网关 → Key 归属查询服务 → JoyBuilder Ops API → MaaS 数据库
```

不要将服务直接暴露到公网。公司网关需要完成以下动作：

1. 校验运营人员登录状态和权限。
2. 删除客户端自行提交的 `X-ERP-User` 请求头。
3. 将已认证账号写入 `X-ERP-User` 请求头后再转发。
4. 只允许网关访问应用容器端口。

服务端配置：

```dotenv
AUTH_MODE=proxy
AUTH_USER_HEADER=x-erp-user
AUTH_ALLOWED_USERS=
AUDIT_LOG=true
TRUST_PROXY=true
```

`AUTH_ALLOWED_USERS` 留空时信任网关授权；如需应用内二次限制，可填逗号分隔账号。

## Token

正式共享建议使用运营服务账号生成 JoyBuilder Ops Token，不要长期使用个人 Token。Token 必须通过容器平台 Secret 或服务器环境变量注入，不能写入镜像、Git、发布脚本或聊天消息。

## Docker

将 `.env.example` 复制为服务器本地 `.env` 并填写 Token，然后运行：

```bash
docker compose -f docker-compose.example.yml up -d --build
```

示例仅监听服务器本机的 `127.0.0.1:8787`，应由同机的统一登录网关或反向代理转发。

## Kubernetes

1. 构建并推送 `Dockerfile` 生成的镜像。
2. 在集群 Secret `key-pin-lookup-secrets` 中创建键 `ops-access-token`。
3. 替换 `kubernetes.yaml` 中的镜像地址和版本。
4. 应用 Deployment 和 Service。
5. 使用集团统一登录网关/Ingress 暴露 Service；Ingress 配置由内部平台规范决定，本模板不会创建无认证入口。

## 验证

- `GET /healthz` 返回 `{ "status": "ok" }`。
- 未经网关注入用户头访问应用时返回 `401`。
- 使用有效 Key ID 查询时返回对应 PIN。
- 日志仅记录操作账号、Key 类型、末四位和结果，不记录完整 Key。
