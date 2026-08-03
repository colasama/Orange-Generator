# 安心院小姐的酸橙味照片生成器（Orange Generator）

一个使用 React、Rsbuild、Konva 和 Animal Island UI 构建的纯前端图片贴纸编辑器。

## 本地运行

```bash
pnpm install
pnpm dev
```

生产构建：

```bash
pnpm typecheck
pnpm build
```

更新裁切字体：

```bash
pnpm font:subset
```

脚本默认读取 `C:/Users/colan/Downloads/乐米沐和圆体.ttf`（WSL 下会自动使用对应的 `/mnt/c/...` 路径），扫描 `src` 与 `index.html` 中的界面字符，并通过 Node.js 与 HarfBuzz WebAssembly 更新 WOFF2、WOFF 和 TTF 三种字体文件。原始字体位于其他位置时可运行：

```bash
pnpm font:subset --source /path/to/font.ttf
```

## 已实现

- 上传或拖放 PNG、JPG、WebP、SVG 图片
- 添加系统预置的 PNG 与 SVG 贴纸
- 拖动、等比缩放、旋转、复制和删除贴纸
- 单独调整每张贴纸的饱和度、明度和白平衡
- 撤销、重做、清空确认和与导入图片相同尺寸的 PNG 导出
- PC 与移动端响应式布局
- 本地处理图片，不上传到服务器

## 素材与许可

占位 PNG 贴纸通过内置图像生成工具生成，源提示描述了 6 个蓝橙黄配色的扁平 3D 动漫贴纸，并要求独立排布、白色刀模边框及纯色色键背景。`spark.svg` 是用于验证 SVG 贴纸链路的项目内几何占位素材。

页面字体使用用户提供的“乐米沐和圆体”。`src/assets/fonts/le-mi-mu-he-yuan-subset.*` 仅保留当前界面文案、数字、拉丁字符和常用符号，并按 WOFF2、WOFF、TTF 的顺序降级加载。新增界面文案后运行 `pnpm font:subset` 即可同步更新字体子集；未收录字符会回退到系统字体。先前的字体子集仍保留在源码中，方便随时切回，但不会进入当前生产构建。

[Animal Island UI](https://github.com/guokaigdg/animal-island-ui) 使用 CC BY-NC 4.0，仅允许非商业用途。本项目已在页面中保留归属与许可信息。
