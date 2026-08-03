#!/usr/bin/env node

import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as fontkit from 'fontkit';
import subsetFont from 'subset-font';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'src', 'assets', 'fonts');
const OUTPUT_STEM = 'le-mi-mu-he-yuan-subset';
const SOURCE_EXTENSIONS = new Set(['.css', '.html', '.ts', '.tsx']);
const EXTRA_CHARACTERS = '，。？！、：；（）《》“”‘’…×·';
const PRESERVED_NAME_IDS = Array.from({ length: 26 }, (_, index) => index);

function showHelp() {
  console.log(`用法：pnpm font:subset [选项]

选项：
  --source <path>  指定原始 TTF 字体
  --help           显示帮助

也可以通过 ORANGE_FONT_SOURCE 环境变量指定原始字体。`);
}

async function pathExists(candidate) {
  if (!candidate) return false;
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function resolveSource(explicitSource) {
  const candidates = [
    explicitSource,
    process.env.ORANGE_FONT_SOURCE,
    path.join(OUTPUT_DIR, 'le-mi-mu-he-yuan.ttf'),
    process.platform === 'win32'
      ? 'C:/Users/colan/Downloads/乐米沐和圆体.ttf'
      : '/mnt/c/Users/colan/Downloads/乐米沐和圆体.ttf',
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return path.resolve(candidate);
  }

  if (explicitSource) throw new Error(`找不到原始字体：${explicitSource}`);
  throw new Error(
    '找不到乐米沐和圆体原始 TTF。请使用 --source /path/to/font.ttf，或设置 ORANGE_FONT_SOURCE。',
  );
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(entryPath)));
    else paths.push(entryPath);
  }
  return paths;
}

function addRange(characterSet, start, end) {
  for (let codePoint = start; codePoint <= end; codePoint += 1) {
    characterSet.add(String.fromCodePoint(codePoint));
  }
}

async function collectCharacters() {
  const sourcePaths = [path.join(PROJECT_ROOT, 'index.html'), ...(await walk(path.join(PROJECT_ROOT, 'src')))]
    .filter((sourcePath) => SOURCE_EXTENSIONS.has(path.extname(sourcePath)));

  const characters = new Set(EXTRA_CHARACTERS);
  addRange(characters, 0x20, 0x7e);
  addRange(characters, 0x3001, 0x3002);
  addRange(characters, 0x3008, 0x3011);
  addRange(characters, 0xff08, 0xff09);
  for (const codePoint of [
    0x00a0, 0x00b7, 0x00d7, 0x2013, 0x2014, 0x2026, 0xff01, 0xff0c, 0xff1a, 0xff1b,
    0xff1f,
  ]) {
    characters.add(String.fromCodePoint(codePoint));
  }

  for (const sourcePath of sourcePaths) {
    const content = await readFile(sourcePath, 'utf8');
    for (const character of content) {
      if (/\p{Script=Han}/u.test(character) || EXTRA_CHARACTERS.includes(character)) {
        characters.add(character);
      }
    }
  }

  return [...characters]
    .sort((left, right) => left.codePointAt(0) - right.codePointAt(0))
    .join('');
}

async function writeAtomically(outputPath, contents) {
  const extension = path.extname(outputPath);
  const temporaryPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath, extension)}.tmp${extension}`,
  );

  await rm(temporaryPath, { force: true });
  try {
    await writeFile(temporaryPath, contents);
    await rm(outputPath, { force: true });
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function generateSubsets(sourcePath, characters) {
  const sourceBuffer = await readFile(sourcePath);
  const sourceFont = fontkit.create(sourceBuffer);
  const sourceCodePoints = new Set(sourceFont.characterSet);
  const supportedCharacters = [...characters]
    .filter((character) => sourceCodePoints.has(character.codePointAt(0)))
    .join('');
  const unsupportedCharacters = [...characters]
    .filter((character) => !sourceCodePoints.has(character.codePointAt(0)))
    .join('');
  const formats = [
    ['woff2', 'woff2'],
    ['woff', 'woff'],
    ['ttf', 'sfnt'],
  ];
  const outputs = [];

  await mkdir(OUTPUT_DIR, { recursive: true });
  for (const [extension, targetFormat] of formats) {
    const subsetBuffer = await subsetFont(sourceBuffer, characters, {
      targetFormat,
      preserveNameIds: PRESERVED_NAME_IDS,
    });
    const outputPath = path.join(OUTPUT_DIR, `${OUTPUT_STEM}.${extension}`);
    verifySubset(subsetBuffer, supportedCharacters, path.basename(outputPath));
    await writeAtomically(outputPath, subsetBuffer);
    outputs.push(outputPath);
  }

  return { outputs, unsupportedCharacters };
}

function verifySubset(contents, characters, filename) {
  const font = fontkit.create(contents);
  const availableCodePoints = new Set(font.characterSet);
  const missingCodePoints = [...characters]
    .map((character) => character.codePointAt(0))
    .filter((codePoint) => !availableCodePoints.has(codePoint));

  if (missingCodePoints.length) {
    const labels = missingCodePoints.map((codePoint) => `U+${codePoint.toString(16).toUpperCase()}`);
    throw new Error(`${filename} 缺少字形：${labels.join(', ')}`);
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((argument) => argument !== '--'),
    options: {
      help: { type: 'boolean', short: 'h' },
      source: { type: 'string' },
    },
  });

  if (values.help) {
    showHelp();
    return;
  }

  const sourcePath = await resolveSource(values.source);
  const characters = await collectCharacters();
  const { outputs, unsupportedCharacters } = await generateSubsets(sourcePath, characters);

  console.log(`字体裁切完成：${sourcePath}`);
  console.log(`保留字符：${[...characters].length} 个`);
  if (unsupportedCharacters) {
    console.log(`原字体未提供、将使用系统回退：${unsupportedCharacters}`);
  }
  for (const outputPath of outputs) {
    const outputStat = await stat(outputPath);
    console.log(`- ${path.relative(PROJECT_ROOT, outputPath)} (${(outputStat.size / 1024).toFixed(1)} KB)`);
  }
}

main().catch((error) => {
  console.error(`字体裁切失败：${error.message}`);
  process.exitCode = 1;
});
