# 文档

- [图文使用指南（PDF）](使用指南.pdf)：上传数据、准备素材、封榜与奖项、预览、主持控制和观众同步。
- [使用指南源文档](使用指南.md)：便于在 GitHub 直接阅读、检索和维护。
- [测试与验收记录](TESTING.md)：自动化回归、Browser 实测、部署及榜单保护检查。
- [UI 设计说明](DESIGN.md)：参考来源、设计规范与界面校对。
- [部署教程](部署说明.md)：Node.js、Docker Compose、Nginx / 1Panel、升级和备份。
- [示例榜单](../examples/README.md)：五种场景及直接下载链接。

`images/` 为本版本使用 Browser 插件实测时保存的应用截图。PDF 的内容源文件和生成脚本也随仓库提供。

## 重建 PDF

安装 Python 的 `reportlab`，并准备允许嵌入的中文 TrueType 字体，然后运行：

```bash
python3 scripts/build-manual.py --font /path/to/CJK-font.ttf
```

脚本从 `doc/使用指南.md` 读取内容，保留原始截图像素并生成 `doc/使用指南.pdf`。更新后请重新渲染检查所有页面。
