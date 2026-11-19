# ProductLink 来源约定

此服务管理实物限定路由、解析站声明及用途资料接收。
当前常规业务使用一个选定来源上下文处理直接列出的记录。目录请求为 `GET /resolver/products`，返回 `resolver` 与 `links`。每个目录成员以 `id`、`href` 提供来源身份与原文位置，原文中的 `link` 和 `resolver` 必须与目录一致。

## 记录与实物限定

```json
{
  "link": "LINK1",
  "resolver": "R1",
  "product": "G100",
  "qualifiers": { "lot": "L1", "serial": "S9" },
  "purpose": "composition",
  "language": "zh",
  "resource": "https://supplier.invalid/G100",
  "general": true
}
```

这里的字段是来源提供的原始声明，数值文本必须符合十进制规则，不能把空白或未知值转换成零。领域解释保留解析站入口身份、实物限定、通用产品声明、用途与语言。

- `qualifiers` 可含 `lot`（批次）与 `serial`（序列），缺省表示商品级记录。粒度由限定推导：`product < lot < serial`。
- 收件范围同样以商品号加限定表示。限定指向不同批次或序列的记录属于另一件实物，归入 `outside`，不得并入当前范围。
- 比收件范围更具体的资料不能归并到较粗范围，保留为 `review`。
- 到达一个网页不等于找到了该实物的资料：后续解析站若只保留商品号、丢掉已知批次或序列，结论为 `review`，依据中保留完整路由与各站保留的限定级别。

## 关联资料：路由、限定解释与复用声明

同一来源可发布关联资料，约定位置为 `/resolver/products/relations/{id}`：

```json
{
  "qualifiers": { "lot": "L1", "serial": "S9" },
  "routes": [
    { "resolver": "R2", "preserves": ["product", "lot"], "qualifiers": { "lot": "L1" } }
  ],
  "generalizable": ["composition"]
}
```

- `routes` 按跳转顺序列出合作解析站。`preserves` 声明该站保留的限定级别；链路中再次出现已访问的解析站即循环跳转，结论为 `loop`，`basis.stoppedAt` 标明停在哪一站。
- 路由条目可携带该站自己的 `qualifiers` 解释。两个解析站对同一限定给出不同值时结论为 `conflict`，并在 `interpretations` 中保留各自解释，仓储人员可据此判断停点与依据。
- `generalizable` 是来源的明确声明：该用途的商品级资料允许服务于具体批次。商品级记录要被批次范围接受，必须同时满足：记录声明 `general`、链路各站保留了范围所需限定、用途列入 `generalizable`。接受后 `facts.sharing.kind` 为 `declared-generalizable`；批次专用资料始终是 `item-specific`，即使网址相似也不与其他批次合并。
- 没有声明支持时不能共用：一个语言入口没有某用途资料，只能说明该入口未提供，不能据此说实物没有该资料，也不能用通用宣传页顶替。

关联原文与记录原文分别按 SHA-256 留存，收据通过 `relations_digest` 关联两份依据。

## 用途、语言与缺口

收件事实 `facts` 必须说明：语言（`language`）、用途（`purpose`）、资料自身粒度（`granularity`、`qualifiers`）、适用的实物范围（`appliesTo`）以及共用依据（`sharing`）。

调用方可在领取时声明该实物需要的 `needs`（用途、语言、必要时粒度）。没有任何已接受资料覆盖的需求生成 `gap` 结果，缺口与领取结果一起汇总，`complete` 不为真；缺的是来源对应的请求，而不是实物属性。

## 重访与重新确认

重新领取时，同一入口若资源地址变化，维持 `conflict`；若资源未变但用途、语言或限定解释变化，既有接受结果进入 `reconfirm`，列出变化字段与旧值。旧原文与旧收据不覆盖、不删除，重新确认后再形成新结论。

## 本地合作源

`fixtures/source.json` 的 `resources` 是本地来源的 URL 路径到响应正文的映射；只绑定回环地址，不连接真实监管、银行或合作方。原文可通过目录声明的位置取得。`fixtureSource` 支持独立实例、指定路径返回码、一次性来源故障、响应延迟与 `replace` 更新资源；访问记录保留实际请求路径，不凭空生成未收到的响应。测试在进程内操作夹具，不提供对外开放的管理接口。目录不承诺所有关联资料与当前目录同时发布；关联资料的 HTTP 404、403 记录为 `relationsNotice`，不能自行解释为业务删除，503 等瞬时故障按来源客户端规则重试。

## 原文和收件

原文字节按 SHA-256 寻址，SQLite 保存来源位置、观察时间、收件范围、业务身份、领域记录、决策与关联原文摘要。收到原文不等于领域接收成功；重复的同一内容不新增收据，同一身份的不同内容不会覆盖原件。业务键包含入口、限定、用途与语言，批次专用资料因此按批次分别落库。`.data/` 仅用于本机数据，演示使用临时目录，运行结束关闭服务并清理临时状态。
