# 秋风完整防护、Issues 与 Muse/Meta AI 审查

日期：2026-11-11。当前交付文件为 `Egern-2.22.0-全自动远程订阅版.yaml`。本轮Muse出口及MITM排除改变主配置，手机需要重新导入最终文件；导入后远程规则和模块继续定时更新。

新保护模块使用 `priority-guard-ai-regions-muse.yaml`；两个旧保护地址保持各自原字节和旧组名兼容，避免旧配置自动更新时引用新增 Muse 组。兼容性回归独立验证旧文件哈希与其全部策略引用。

来源：`TG-Twilight/AWAvenue-Ads-Rule`，固定提交 `72dd30fb6d5e2ff7b5bcdbecf164d288f41d9dfa`，Filters/AWAvenue-Ads-Rule-Surge-RULE-SET.list；许可证GPL-3.0，原列表和许可均随公开审计快照保留。固定版本审阅后更新，不声称未经审阅的远端最新内容已生效。

| 上游版本 | 源选择器 | 原配置已拒绝 | 已有保护/未导入关键词 | 待审字面差异 |
|---|---:|---:|---:|---:|
| 纯广告 | 665 | 649 | 10 | 6 |
| 广告＋隐私 | 879 | 855 | 12 | 12 |
| 完整防护 | 976 | 947 | 14 | 15 |

表为加入本轮增量前的独立对照，精确域名按实际模块优先链检查，后缀另测子域；不是广告拦截率。四条源关键词列入不直接导入项，未冒充精确域名。

本次从完整防护新增 5 条精确域名：

- `g-staic.ganjingworld.com`
- `heads-fa.spotify.com`
- `click.googleanalytics.com`
- `mobile.events.data.microsoft.com`
- `uedas.qidian.com`

这些条目通过原补充库加入，使用固定REJECT，复用已有远程地址。重复范围、金融/业务保护与原生响应接口均扣除；没有新开一个与现有库重复的大集合。
当前补充集合共 337686 个选择器，以生成YAML复算。

| 问题 | 审查结果与本次动作 |
|---|---|
| #38 小米云备份 | 作者明确选择保留可能影响备份的a0拦截。本配置未新增该拒绝，保留a0现有分流并加入正常业务反例。 |
| #197 大量放行建议 | 含个人使用反馈和未被作者逐条证实的建议；不批量放行统计、推送和HTTPDNS。保留明确业务例外，未把“社区建议”当兼容保证。 |
| #219 api.ad.xiaomi.com | 尚无作者确认的修复。原生模块仍拒绝该广告API；没有加入全域放行，因此不能声称Android小米云备份已修复。 |
| #193 校园App广告建议 | 候选清单混有共享媒体/CDN、支付域、IP和Android包名，关联仓库自述方案可用性很差。不整体导入其列表；原有独立广告域及应用改写继续使用。 |
| #220 微信公交小程序 | 作者在群内处理，公开评论未给出可复算的域名修正，不虚构白名单。 |

来源链接：
- https://github.com/TG-Twilight/AWAvenue-Ads-Rule/issues/38
- https://github.com/TG-Twilight/AWAvenue-Ads-Rule/issues/197
- https://github.com/TG-Twilight/AWAvenue-Ads-Rule/issues/219
- https://github.com/TG-Twilight/AWAvenue-Ads-Rule/issues/193
- https://github.com/TG-Twilight/AWAvenue-Ads-Rule/issues/220

两条爱奇艺视频分发候选和pay.sboot.cn用途尚未确认，保持现有正常分流；三条tnc配置连接命中原“广告平台拦截器”的DIRECT逻辑，保留作者处理顺序，不在更早位置添加拒绝。
完整防护含隐私和“不受欢迎”类别，部分条目针对更新、云控或推送，不能将类别名称等同于纯广告。域名库不能处理所有共接口信息流、横幅或倒计时；原生模块的正文和脚本处理仍保留。

| 用户补充域名 | 当前独立归属 | 自动出口 |
|---|---|---|
| muse.ai 及子域 | Muse | 通用AI美国池，自动测速/换节点 |
| meta.ai、metaaivm.com 及子域 | Meta AI | Meta美国池，自动测速/换节点 |
| meta.com、facebook.com | Facebook | Meta美国池 |
| cdninstagram.com | Instagram | Meta美国池 |
| fbcdn.net | Meta共享 | Meta美国池 |

Muse按用户给出的官网解决原同名产品待确认项；metaaivm.com记录为用户补充，并不声称有独立官方归属证明。服务地区候选取美国节点，不把节点测速成功写成账号或服务已解锁。新增Muse/Meta关键主机排除MITM，金融和国内直连规则保持。

此前用户提供的28条AppleAI文本逐项对照时，各列明域名默认均走代理。OpenAI/ChatGPT、公共功能开关、App Store、iCloud保留各自独立归属；不把统计公共域、iCloud内容或系统更新整个并入Apple AI。Apple截图补充保持22个选择器，17.248.152.0/24和apple-relay关键词保留。

最终：96 个原模块；总模块 98，启用 92、禁用 6；原JavaScript修改：False。服务回归 1048 项通过，AI组 32、地区池 24。这些是离线模型和结构验证，不是iOS广告效果或登录验收。

个人文件SHA-256：`ff4c08a5bacfc26bf70335f1c1a9d72daa48aa1215629601438f63a16922008b`。原始订阅、节点和CA未纳入公开仓库。
