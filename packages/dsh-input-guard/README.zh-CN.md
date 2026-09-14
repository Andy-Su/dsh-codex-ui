# @michengai/dsh-input-guard

在发送前拦截 DSH 输入框里的密钥与个人信息，并支持可配置的词条映射替换（例如输入 `喵喵` 自动改成 `茄子`）。

- 纯客户端插件：不注册 Host 服务、不改宿主 UI，只往输入框挂一个隐形扩展。
- 零运行时依赖：`react` / `react-dom` 由宿主模块表提供。
- 卸载即完全失效：不改动宿主与 Codex UI 的任何数据或配置。

> English: [README.md](README.md)

## 行为

| 情况 | 结果 |
| --- | --- |
| Enter 命中阻断类规则（私钥、云密钥、JWT…） | 拦下本次发送，提示命中的规则名 |
| Enter 命中脱敏类规则（手机号、邮箱、身份证…） | 就地打码后再发送（需你再确认一次），并给出提示 |
| Enter 命中词条映射 | 就地改写草稿，**全程静默**，需再按一次 Enter 才会发送 |
| 粘贴命中阻断类规则 | 取消本次粘贴并提示 |
| 粘贴命中脱敏类规则或词条映射 | 文本先落地，再按整篇草稿重算并改写 |

以下任一情况**完全放行**，不干预宿主：输入法组合中、`Shift`/`Ctrl`/`Meta`/`Alt` + Enter、宿主已处理该事件、相位非 `plain`、草稿含结构化引用或图片、触发菜单已打开。

> **请注意**：命中词条映射时，第一次 Enter 只做改写、不会发送，也不会弹任何提示（这是刻意的静默设计）。确认改写结果后**再按一次 Enter** 即可发送。

## 诊断

装好后想确认是否生效，看控制台输出：

- `[michengai-input-guard] 客户端半边已加载，开始注册输入拦截。` —— bundle 已被宿主加载。
- `… 当前会话输入状态未就绪，本次未挂载拦截。` —— 该会话的输入机未就绪（只提示一次）。
- `… 未找到输入框，本次未挂载拦截。` —— 未能在插槽祖先链上唯一定位输入框（只提示一次）。

没有第一条说明插件根本没被加载；有第一条但发送仍不拦截，先确认是否落在「完全放行」的六种情形里。

## 识别规则

| ruleId | 识别对象 | 默认动作 |
| --- | --- | --- |
| `pem-private-key` | `-----BEGIN … PRIVATE KEY-----` | 阻断 |
| `cloud-access-key` | `AKIA`/`ASIA` + 16 位 | 阻断 |
| `llm-api-key` | `sk-` / `sk-ant-` / `gsk_` | 阻断 |
| `vcs-token` | `ghp_` 系列 / `github_pat_` / `glpat-` | 阻断 |
| `slack-token` | `xox[baprs]-` | 阻断 |
| `google-api-key` | `AIza` + 35 位 | 阻断 |
| `jwt` | `eyJ…` 三段 Base64URL | 阻断 |
| `bearer-token` | `Bearer <20+>` | 阻断 |
| `basic-auth-url` | `scheme://user:pass@host` | 阻断 |
| `generic-secret-assignment` | `password=` / `api_key:` 等赋值 | 脱敏 |
| `cn-id-card` | 18 位身份证（含校验位） | 脱敏 |
| `bank-card` | 16–19 位卡号（过 Luhn） | 脱敏 |
| `cn-mobile` | 手机号（容忍 `+86`/`0086` 与空格、短横分组） | 脱敏 |
| `cn-landline` | 固定电话（要求分隔符，校验区号与位数） | 脱敏 |
| `cn-service-number` | 400/800 服务号与常见客服短号 | 脱敏 |
| `email` | 邮箱 | 脱敏 |
| `private-ip` | `10.` / `172.16-31.` / `192.168.` | 脱敏 |
| `custom-term` | 你配置的敏感词 | 可配置 |

脱敏形态：手机号 `138****8000`（分组写法归一为同一形态）、固定电话 `010****5678`、服务号 `400****8888`、身份证 `110105********002X`、银行卡 `****1111`、邮箱 `a***@example.com`、内网 IP `192.168.***.***`、赋值类与自定义词条整体替换为 `***`。

固话与 400 服务号要求带分隔符（`010-12345678` 会脱敏，`01012345678` 不会）——连续数字更可能是账号或订单号，交回给用户自查；五位短号只认公开客服号白名单。

**非目标**：Base64 编码后的密钥、拆分多次输入的片段、图片中的文字都不在识别范围内。

## 配置

配置存在浏览器本地（`localStorage`），键为 `michengai.codex-ui.input-guard.v1`：

```json
{
  "version": 1,
  "rules": { "email": { "enabled": true, "action": "mask" } },
  "terms": ["客户编号"],
  "termAction": "mask",
  "mappings": [{ "from": "喵喵", "to": "茄子", "enabled": true }],
  "maskOnSubmit": true,
  "maskOnPaste": true,
  "remoteUrl": "https://rules.example.com/input-guard.json"
}
```

- 只写你关心的字段即可，其余回落默认值；版本不符会整体回落默认值。
- `rules` 里未知 ruleId 会被丢弃，损坏的单条只影响该条。
- `terms` 最多 200 条，单条 ≤ 64 字符；`mappings` 最多 200 条，`from` ≤ 64 字符、`to` ≤ 256 字符，`from` 为空、`from === to`、重复 `from` 一律拒绝。
- `mappings[].to` 允许空字符串，等价于「删除命中的词条」。
- `maskOnSubmit: false` 只提示、不改写草稿；`maskOnPaste: false` 关闭粘贴路径的改写（Enter 兜底仍会处理映射）。
- `remoteUrl` 只接受 `https`，留空或非法等同于未配置。
- `mappings` 不是整体替换：内置默认清单**始终打底**，同名 `from` 以你配置的为准（可改目标或用 `enabled: false` 禁用），新增条目追加在后。

### 内置默认映射

包内自带 41 条默认词条映射（事实源：`src/default-mappings.ts`），把内部产品名映射为水果/动物代号，
装完即生效，无需任何配置。例如 `喵喵记账` → `兰花`、`心水收纳` → `芹菜`、`Feel+` → `葡萄`。

- 命中后 Enter 会被拦下并**静默**改写草稿，需再按一次 Enter 才会发出（与自定义映射同一路径）；
- 默认清单**始终打底**：本机配置与远程规则里的同名 `from` 覆盖它，新增条目追加在后，总数仍受 200 条上限约束；
- 存在包含关系时按最长优先匹配（`心水收纳` 不会变成 `洋葱收纳`）；
- ASCII 词条忽略大小写并匹配词边界，含中文的词条按子串匹配。

### 远程规则

配置 `remoteUrl` 后，插件在注册完成后**后台**拉取该地址，远程内容优先覆盖本地：

| 字段 | 覆盖方式 |
| --- | --- |
| `rules` | 逐条覆盖，远程未提及的规则保留本地设置 |
| `terms` / `termAction` / `mappings` | 整体替换 |

远程载荷与本机配置的规则部分同构，必须带 `"version": 1`：

```json
{
  "version": 1,
  "rules": { "cn-landline": { "enabled": false, "action": "mask" } },
  "terms": ["客户编号"],
  "termAction": "block",
  "mappings": [{ "from": "喵喵", "to": "茄子" }]
}
```

远程越不过的边界：

- `maskOnSubmit` / `maskOnPaste` / `remoteUrl` **始终以本地为准**，载荷里的同名字段被直接忽略；
- 不允许关停全部阻断规则：合并后若不存在启用的阻断规则，拒绝远程 `rules` 并保留本地规则，同时在控制台说明；
- 只接受 `https`；超时 1.5 秒、响应体上限 64 KiB，非 2xx / 非 JSON / 版本不符 / 体积超限一律视为拉取失败。

拉取失败不影响拦截：插件先用本地与缓存配置注册，失败时沿用当前配置，只留一行控制台记录
（`远程规则不可用，继续使用本地与缓存配置：<url>`）；成功时输出 `已应用远程规则（<url>）`，
并把远程原文缓存到独立键 `michengai.codex-ui.input-guard.remote-cache.v1`，离线时继续生效。
缓存在生效时立即应用，无需重启宿主。

## 开发

```bash
pnpm --filter @michengai/dsh-input-guard test   # typecheck → vitest → tsdown → bundle 契约断言
```

本包自带 `tsconfig.json` / `tsdown.config.ts` / `vitest.config.ts`，不依赖仓库根构建配置。

## 许可

Apache-2.0。识别规则的**模式约定**参照 [gitleaks](https://github.com/gitleaks/gitleaks)（MIT）与 [detect-secrets](https://github.com/Yelp/detect-secrets)（Apache-2.0）的公开规则重写，未复制其代码；详见 `NOTICE`。
