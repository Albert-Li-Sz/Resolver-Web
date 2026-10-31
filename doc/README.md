# 文档

- [操作说明书（在线）](使用指南.md) · [PDF 下载](使用指南.pdf)：DOMjudge 与 Hydro + CCS API 接入、共享赛事、Live、OBS、多屏模板、节目单、Resolver、现场应急及故障排查。
- [简明部署与开发说明](PLATFORM.md)：完整 Compose、媒体网关与开发测试。
- [部署补充](部署说明.md)：原 Resolver 发布镜像、Nginx / 1Panel、升级和备份。
- [现场保护与中文化验收](ONSITE-VALIDATION.md)：自动化页面、画面、真实媒体与重启验证，及未完成的现场门槛。
- [共享赛事与 UI 验收](OLLAMA-VALIDATION.md) · [平台基础验收](PLATFORM-VALIDATION.md)：前期验证与历史限制。
- [示例榜单](../examples/README.md)：可下载的练习事件流。

说明书对应 `main` 主分支的四模块平台，不是原 v1.3.0 稳定发布镜像。截图来自 Browser 插件，赛事为合成练习数据；DOMjudge、Hydro 的示例连接表单未连接真实赛事。

## 重建 PDF

安装 Python 依赖后执行：

```bash
python3 -m pip install reportlab fonttools
python3 scripts/build-manual.py
```

脚本读取 `doc/使用指南.md`，使用仓库随附的 Noto Sans SC 字体生成 `doc/使用指南.pdf`，含可点击目录、书签、代码块与原始截图。字体许可证见 [Noto Sans SC OFL](../public/licenses/noto-sans-sc.txt)。可用 `--font` 指定其他中文 TrueType 字体，`--source`、`--output`、`--ref` 分别指定来源、输出与 PDF 内相对链接所用的 GitHub 分支。

更新后用 `pdftoppm -png doc/使用指南.pdf tmp/pdfs/manual` 渲染并检查所有页面，确认表格、代码、中文和截图无裁切。
