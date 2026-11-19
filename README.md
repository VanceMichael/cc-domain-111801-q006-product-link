# ProductLink

ProductLink 为业务资料员提供实物限定路由与原文保管，已支持来源目录预览、直接记录领取、解析站入口身份、实物限定（批次/序列）保留、通用产品声明、用途与语言保留以及按业务范围形成收件记录。合作解析站的跳转路由、限定解释与复用声明通过关联资料领取；循环跳转、限定解释冲突、入口解释变化和用途/语言缺口都会在领取结果中显式标出停点与依据。原文与领域收件结论分开保存，便于复查来源内容。

## 环境与运行

使用 Node.js 22.23.4，依赖版本由 `package-lock.json` 固定。仅使用 Node.js 内置模块，无需外部数据库进程或第三方运行服务。

```sh
npm ci
npm run build
npm test
npm run demo
```

`npm run demo` 在本机启动合作源，用独立临时目录完成真实领取、原文保存和领域接收，输出实际结果后清理；不要求外网资料。`npm start` 可单独启动本地来源供交互查看，终端会打印实际回环地址，Ctrl-C 关闭。通过 `PORT` 指定监听端口，省略或设置为 `0` 时自动分配；仅监听回环地址。根路径返回可用资源目录与运行状态。

## 容器

```sh
docker build -t product-link:local .
docker run --rm --network none product-link:local
```

镜像构建时准备依赖，容器运行时不联网，演示只使用回环通信。可改用 `docker run --rm --network none product-link:local npm test` 运行回归。存储通过 `Archive` 传入本机目录，不包含生产账号、真实业务资料或凭据。

## 代码与来源约定

`src/source.mjs` 负责来源目录、记录原文与关联资料的身份，`src/relations.mjs` 解释实物限定、解析站路由与复用声明，`src/interpret.mjs` 解释当前领域记录，`src/receiving.mjs` 决定选定范围与用途需求下的收件结果（接受、待核、冲突、循环、重新确认、缺口）。`src/archive.mjs` 提供原文保管及收据落库，`src/app.mjs` 连接日常业务，`fixtures/` 与 `src/fixture-source.mjs` 提供可独立复查的本地合作源。详细字段与来源声明见 `docs/source-contract.md`。
