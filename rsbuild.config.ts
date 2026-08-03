import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

interface PostCssAtRule {
  remove: () => void;
  toString: () => string;
}

const removeUnusedAnimalFonts = {
  postcssPlugin: 'remove-unused-animal-fonts',
  AtRule: {
    'font-face': (rule: PostCssAtRule) => {
      if (/font-family:\s*(?:Nunito|Noto Sans SC)/.test(rule.toString())) {
        rule.remove();
      }
    },
  },
};

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: {
      index: './src/index.tsx',
    },
  },
  html: {
    template: './index.html',
    title: '贴贴岛 - 图片贴纸编辑器',
  },
  output: {
    distPath: {
      root: 'dist',
    },
    cleanDistPath: true,
  },
  tools: {
    postcss(_, { addPlugins }) {
      addPlugins(removeUnusedAnimalFonts, { order: 'post' });
    },
  },
  server: {
    port: 3000,
  },
});
