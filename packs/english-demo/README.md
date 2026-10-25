# English Demo · 工作里的小句子

自编的 ezlearn 功能演示学习包，内容为项目开发过程中创作的教学示例；不引用真题，不代表大学英语四级、六级或任何官方考试考纲，也不是完整备考课程。适合能阅读简单英文的开发者，用熟悉的接口、缓存和发布情境练习四组表达。

`pack.json` 是完整可安装文件，包含 4 个知识点、16 道原创题（12 道单选、4 道简答）、一份讲义和 4 份组卷蓝图。材料也在 `materials/developer-english.md` 保存可直接阅读副本；安装时使用 JSON 内的不可变文本。

项目与演示内容的正式许可证尚待作者确认；本包 `manifest.license` 明确记录该状态，不构成对外再许可声明。

从仓库根目录安装：

```powershell
pnpm ezlearn pack validate ./packs/english-demo --json
pnpm ezlearn pack install ./packs/english-demo --json
```
