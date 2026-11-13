# 安装到另一台电脑上的 pi

## 要求

- pi 已安装并能正常启动（本扩展在 pi **1.5.2** 上验证；用到 `create*ToolDefinition`、`getAgentDir`
  和 `UserMessageComponent` / `AssistantMessageComponent` / `ToolExecutionComponent` 三个导出组件，
  太旧的版本没有这些）
- 目标机器上**不要同时启用其它工具行扩展**，例如 `pi-compact-tools` 会重注册同一批内置工具，
  后加载的会覆盖本扩展。如果装了它，先关掉：

  ```json
  // <agent-dir>/compact-tools.json
  { "style": "off" }
  ```

## 安装

```bash
unzip pi-copilot-style-0.2.0.zip
cd pi-copilot-style
bash install.sh          # 或手动复制：见下方「手动安装」
```

`install.sh` 只做两件事：

1. 把 `*.ts` + `package.json` + `README.md` 复制到 `<agent-dir>/extensions/pi-copilot-style/`
   （`<agent-dir>` 默认 `~/.pi/agent`，可用 `PI_AGENT_DIR` 覆盖）
2. 把 `themes/copilot-*.json` 复制到 `<agent-dir>/themes/`

> 主题必须放在 `<agent-dir>/themes/`：pi 在**启动时**就解析已保存的主题，扩展运行时注册来不及，
> 否则会看到 `Failed to load theme "copilot-light": Theme not found` 并回退到 system 主题。
> 扩展加载时也会自动同步一遍这两份主题，所以升级后只要重启即可。

### 手动安装

```bash
dest="$HOME/.pi/agent/extensions/pi-copilot-style"
mkdir -p "$dest" "$HOME/.pi/agent/themes"
cp *.ts package.json README.md "$dest"/
cp themes/*.json "$HOME/.pi/agent/themes/"
```

## 启用与验证

1. 重启 pi（或 `/reload`）—— 工具行在加载时重注册，改了文件必须重载
2. `/copilot-style` —— 打印当前配置
3. `/copilot-style theme` —— 按终端明暗自动选 `copilot-light` / `copilot-dark`
4. `/copilot-style preview` —— 用当前主题渲染样例行（`esc` 关闭）

正常效果：

```
❯ 只做三件事：用 read 读取 …
❯ Thinking…
MD Read AGENTS.md  L1:3 (3 lines read)
{} Read nsh.json  L1:3 (3 lines read)
/ Search "MIGRATION" in *.md  3 files found
  List directory nsh-app/native/src  2 entries
❯ Thought for 1s

$ Shell  Read README.md  6 lines
  cd repo && sed -n '1,4p' README.md; echo '---'; sed -n '1,3p' pyproject.toml

✗ Shell  Run sh script  2 lines
  sh -c 'echo boom; exit 3'
    boom
    Command exited with code 3
● 三件事都完成了…
```

## 配置（全部可选）

`<agent-dir>/settings.json` 或 `<project>/.pi/settings.json`（项目优先）：

```json
{
  "copilotStyle": {
    "enabled": true,
    "messageChrome": true,
    "compactToolRows": true,
    "failedOutputLines": 6,
    "thinkingLabel": "Thought",
    "thinkingActiveLabel": "Thinking…"
  }
}
```

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；关掉等于没装 |
| `messageChrome` | `true` | `❯` 用户行（去背景框）、`●` 助手行、`❯ Thinking…/Thought` |
| `compactToolRows` | `true` | 去掉 pi 在每条工具行前留的空行 |
| `failedOutputLines` | `6` | 失败行折叠时显示的输出行数（`ctrl+o` 展开全文） |
| `thinkingLabel` | `"Thought"` | 思考结束后的文案，≥1s 自动加 `for Ns` |
| `thinkingActiveLabel` | `"Thinking…"` | 思考进行中的文案 |

## 已知边界

- **`Shell` 后面的摘要由命令启发式生成**（`npm test` → `Run tests`，`sed -n … rust.md` → `Read rust.md`）。
  Copilot 那句是模型给的 `intentionSummary`，pi 的工具调用没有这个字段，所以命令本体保留在下一行兜底。
- **没有聚合行**（`2 reads · 1 search · 1 command`）：pi 一次调用一行，合并需要 patch 转录容器。
- **MCP / 第三方工具**仍是 pi 默认样式；覆盖 `read` `bash` `powershell` `grep` `find` `ls` `edit` `write`，以及 `codemode`（通过 `registerToolRenderer` 挂上去，不改它自己的工具定义）。
- 输入框上方 `Working` 左侧的动画保持 pi 原样，未改动。

## 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| 行首标题几乎看不见（白字） | 主题和终端明暗不匹配：跑 `/copilot-style theme` |
| 徽标全是灰的 | 同上；也可以 `/settings` 里手动选 `copilot-light` / `copilot-dark` |
| `Failed to load theme "copilot-*"` | 主题没进 `<agent-dir>/themes/`，重跑 `install.sh` |
| 工具行还是 pi 默认样式 | 没有 `/reload`/重启；或另一工具行扩展覆盖了（见上方 `compact-tools.json`） |
| `[Theme conflicts]` | 主题在两处重复注册，删掉 `<agent-dir>/themes/copilot-*.json` 里的重复来源 |

## 卸载

```bash
rm -rf "$HOME/.pi/agent/extensions/pi-copilot-style"
rm -f  "$HOME/.pi/agent/themes/copilot-dark.json" "$HOME/.pi/agent/themes/copilot-light.json"
# 然后把 /settings 里的主题换回 system，并 /reload
```

