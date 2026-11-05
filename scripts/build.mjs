import { build, transform } from 'esbuild';
import { mkdir, writeFile, cp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
const at = p => path.join(root, p);

// dsh-knowledge 的源码用 `./theme.js` 这种 ESM 写法指向 `.ts/.tsx` 文件；esbuild
// 默认不会把 `.js` 回退到 TypeScript 源，这里补一层解析，别的包不受影响。
const tsSourceFallback = {
  name: 'ts-source-fallback',
  setup(build) {
    build.onResolve({ filter: /\.js$/ }, args => {
      if (args.namespace === 'pilot-css') return undefined;
      const resolved = path.resolve(args.resolveDir, args.path);
      if (existsSync(resolved)) return undefined;
      const stem = resolved.slice(0, -3);
      for (const ext of ['.ts', '.tsx', '.mts']) {
        if (existsSync(stem + ext)) return { path: stem + ext };
      }
      return undefined;
    });
  },
};

// Client stylesheets become plugin-owned injectors, the way the official DSH client
// preset does it: each `.css` import compiles to one tagged <style> that is appended
// once per document, so the module graph can share styles without duplicating tags.
const pilotCss = {
  name: 'pilot-css',
  setup(build) {
    build.onResolve({ filter: /\.css$/ }, args => {
      if (args.namespace === 'pilot-css') return undefined;
      return { path: path.resolve(args.resolveDir, args.path), namespace: 'pilot-css' };
    });
    build.onLoad({ filter: /.*/, namespace: 'pilot-css' }, async args => {
      const source = await readFile(args.path, 'utf8');
      const { code } = await transform(source, { loader: 'css', minify: true, target: 'chrome140' });
      const tagId = `dsh-pilot/${path.basename(args.path)}`;
      const contents = [
        `const css = ${JSON.stringify(code)};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {`,
        `  const tag = document.createElement('style');`,
        `  tag.dataset.plugin = 'dsh-pilot';`,
        `  tag.dataset.pluginCss = tagId;`,
        `  tag.textContent = css;`,
        `  document.head.appendChild(tag);`,
        `}`,
        `export default css;`,
      ].join('\n');
      return { contents, loader: 'js', resolveDir: path.dirname(args.path), watchFiles: [args.path] };
    });
  },
};

await mkdir(at('packages/dsh-pilot/lib'), { recursive: true });
await build({ entryPoints: [at('packages/dsh-pilot/src/index.ts')], outfile: at('packages/dsh-pilot/lib/index.js'), platform: 'node', format: 'esm', bundle: true, packages: 'external', target: 'node24' });
const client = await build({ entryPoints: [at('packages/dsh-pilot/src/client.tsx')], platform: 'browser', format: 'cjs', bundle: true, packages: 'external', target: 'chrome140', write: false, jsx: 'automatic', plugins: [pilotCss, tsSourceFallback] });
await writeFile(at('packages/dsh-pilot/lib/client.js'), `window.__ModuleLoader__.load({id:"dsh-pilot",factory:(require)=>{const module={exports:{}};const exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`);
if (!process.argv.includes('--bundle-only')) {
  await build({ entryPoints: [at('apps/desktop/src/main.mjs')], outfile: at('apps/desktop/dist/main.cjs'), platform: 'node', format: 'cjs', bundle: true, external: ['electron'], target: 'node22' });
  await build({ entryPoints: [at('apps/desktop/src/preload.cjs')], outfile: at('apps/desktop/dist/preload.cjs'), platform: 'node', format: 'cjs', bundle: true, external: ['electron'], target: 'node22' });
  await cp(at('apps/desktop/src/lifecycle.mjs'), at('apps/desktop/dist/lifecycle.mjs'));
}
console.log('Pilot build complete');
