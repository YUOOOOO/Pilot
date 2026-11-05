// 首次启动的插件预置：把随产品分发的 bundle 写进用户 profile。
//
// 三类来源，优先走不需要网络的：
//  1. 本地 vendored 包（随安装包带着）→ 直接拷进 profile 的 node_modules 并登记，离线、秒级；
//  2. 包已经放在 runtime 的 node_modules 里（打进了安装包）→ 只补写 profile 的 package.json；
//  3. 都不在 → 用 dsh CLI 走 `plugin add` 安装（知识库首次约 300 MB，需联网）。
// 任何失败都不阻塞启动：该插件不可用，其余功能照常。
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

/** 知识库：来自 npm registry（体积大，允许联网安装） */
export const KNOWLEDGE_PACKAGE = 'dsh-knowledge';

/** 费用计量：工作台「费用概览」读它的本机账本，来自 npm registry */
export const COST_METER_PACKAGE = 'dsh-cost-meter';

/** 多角色群聊：仓库未发布到 npm，随项目 vendored（离线拷入 profile） */
export const GROUPCHAT_PACKAGE = '@zhdzh-good/multi-role-groupchat';

/** 预置项：name 同时用作 profile bundle 名与包名 */
const PRESETS = [
  { name: KNOWLEDGE_PACKAGE, source: 'registry' },
  { name: COST_METER_PACKAGE, source: 'registry' },
  { name: GROUPCHAT_PACKAGE, source: 'vendored', relative: 'vendor/multi-role-groupchat/multi-role-groupchat' },
];

/** 这些依赖带安装期构建脚本；pnpm 10+ 默认拒绝执行，要先授权 */
const ALLOW_BUILDS = {
  esbuild: true,
  'onnxruntime-node': true,
  protobufjs: true,
  sharp: true,
  'tesseract.js': false,
};

function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** 合并 allowBuilds 到 profile 的 pnpm-workspace.yaml；已有同名字段时不重复添加 */
export function ensureAllowBuilds(profileDir) {
  const file = path.join(profileDir, 'pnpm-workspace.yaml');
  const base = existsSync(file)
    ? readFileSync(file, 'utf8')
    : 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n';
  if (/^allowBuilds:\s*$/m.test(base)) {
    const lines = base.split('\n');
    const start = lines.findIndex(line => /^allowBuilds:\s*$/.test(line));
    let end = start + 1;
    while (end < lines.length && (/^\s+/.test(lines[end]) || lines[end].trim() === '')) end += 1;
    const block = lines.slice(start + 1, end);
    const missing = Object.keys(ALLOW_BUILDS).filter(key => !new RegExp(`^\\s+['"]?${key.replace('.', '\\.')}['"]?\\s*:`, 'm').test(block.join('\n')));
    if (missing.length === 0) return false;
    lines.splice(end, 0, ...missing.map(key => `  ${key}: ${ALLOW_BUILDS[key]}`));
    writeFileSync(file, lines.join('\n'));
    return true;
  }
  const suffix = Object.entries(ALLOW_BUILDS).map(([key, value]) => `  ${key}: ${value}`).join('\n');
  writeFileSync(file, `${base.replace(/\n*$/, '\n')}\nallowBuilds:\n${suffix}\n`);
  return true;
}

/** 已安装包的版本，未安装返回 undefined */
function installedVersion(dir) {
  const manifest = readJson(path.join(dir, 'package.json'));
  return typeof manifest?.version === 'string' ? manifest.version : undefined;
}

/** 把 bundle 写进 profile 清单（离线路径：包已在本地，无需 pnpm） */
export function registerBundle(profileDir, name, version, spec) {
  mkdirSync(profileDir, { recursive: true });
  const file = path.join(profileDir, 'package.json');
  const manifest = readJson(file, { name: 'dsh-profile-web', private: true });
  const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
  const next = {
    ...manifest,
    dsh: { ...(manifest.dsh ?? {}), profile: { ...(manifest.dsh?.profile ?? {}), bundles: bundles.includes(name) ? bundles : [...bundles, name] } },
    dependencies: { ...(manifest.dependencies ?? {}), [name]: spec ?? (version === undefined ? 'latest' : `^${version}`) },
  };
  writeFileSync(file, `${JSON.stringify(next, undefined, 2)}\n`);
  return !bundles.includes(name);
}

function run(command, args, { cwd, env, log, timeoutMs }) {
  return new Promise(resolve => {
    let settled = false;
    const finish = code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      log(`[provision] 超时，终止安装（${Math.round(timeoutMs / 1000)}s）`);
      try { child.kill(); } catch { /* 已退出 */ }
      finish(-1);
    }, timeoutMs);
    const forward = chunk => {
      const text = String(chunk).trim();
      if (text) log(`[provision] ${text.slice(0, 2000)}`);
    };
    child.stdout?.on('data', forward);
    child.stderr?.on('data', forward);
    child.once('error', error => {
      log(`[provision] 启动失败：${error.message}`);
      finish(-1);
    });
    child.once('exit', code => finish(code ?? -1));
  });
}

/** vendored 包：从安装目录拷进 profile 的 node_modules，并登记 bundle */
function installVendored(profileDir, preset, runtime) {
  const source = path.join(runtime, preset.relative);
  const version = installedVersion(source);
  if (version === undefined) return { status: 'failed', detail: `vendored source missing: ${source}` };
  const target = path.join(profileDir, 'node_modules', ...preset.name.split('/'));
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, force: true, filter: from => !from.includes(`${path.sep}node_modules${path.sep}`) });
  registerBundle(profileDir, preset.name, version, `file:${source.replaceAll('\\', '/')}`);
  return { status: 'installed', detail: `${version} (vendored)` };
}

/**
 * 确保预置插件出现在 profile 的 bundle 清单里。
 * @returns {Array<{ name: string, status: 'present'|'registered'|'installed'|'failed', detail?: string }>}
 */
export async function ensurePresets({ runtime, node, entry, home, log = () => {}, status = () => {}, timeoutMs = 15 * 60_000 }) {
  const results = [];
  if (process.env.PILOT_SKIP_PROVISION === '1') return [{ name: 'all', status: 'present', detail: 'PILOT_SKIP_PROVISION' }];
  const profileDir = path.join(home, 'profiles', 'web');
  const manifest = readJson(path.join(profileDir, 'package.json'));
  const bundles = manifest?.dsh?.profile?.bundles ?? [];
  const env = { ...process.env, DSH_HOME: home, NO_COLOR: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;

  for (const preset of PRESETS) {
    const installed = installedVersion(path.join(profileDir, 'node_modules', ...preset.name.split('/')));
    if (bundles.includes(preset.name) && installed !== undefined) {
      results.push({ name: preset.name, status: 'present' });
      continue;
    }
    // 包在、但不在 bundle 清单里 = 用户在插件管理里手动禁用了它。保持禁用状态：
    // 预置逻辑只负责「让它可用」，不替用户把它重新打开。
    if (installed !== undefined) {
      log(`[provision] ${preset.name}: 已安装但被禁用，保持禁用`);
      results.push({ name: preset.name, status: 'disabled', detail: installed });
      continue;
    }
    if (preset.source === 'vendored') {
      const result = installVendored(profileDir, preset, runtime);
      log(`[provision] ${preset.name}: ${result.status} ${result.detail ?? ''}`);
      results.push({ name: preset.name, ...result });
      continue;
    }
    // registry 包：优先用安装包内自带的副本（离线），否则走 CLI 联网安装
    const shipped = installedVersion(path.join(runtime, 'node_modules', ...preset.name.split('/')));
    if (shipped !== undefined) {
      if (!bundles.includes(preset.name)) registerBundle(profileDir, preset.name, shipped);
      log(`[provision] ${preset.name}: 已随安装包提供 ${shipped}，直接登记`);
      results.push({ name: preset.name, status: 'registered', detail: shipped });
      continue;
    }
    status(`正在准备组件 ${preset.name}，首次启动需要几分钟…`);
    const allowBuildsChanged = ensureAllowBuilds(profileDir);
    log(`[provision] ${preset.name}: allowBuilds ${allowBuildsChanged ? '已更新' : '无需改动'}，开始安装`);
    const code = await run(node, [entry, 'plugin', '--profile', 'web', 'add', preset.name], { cwd: profileDir, env, log, timeoutMs });
    if (code === 0) {
      results.push({ name: preset.name, status: 'installed' });
    } else {
      log(`[provision] ${preset.name}: 安装失败（退出码 ${code}），其余功能继续启动`);
      results.push({ name: preset.name, status: 'failed', detail: String(code) });
    }
  }
  return results;
}
