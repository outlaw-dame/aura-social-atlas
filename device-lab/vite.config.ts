/**
 * The Device Lab's build: Atlas's real phone app (src/components/f7/AtlasMobileApp.tsx) as a static page, on sample
 * data. Nothing in src/ changes for it. Three things are swapped at build time, and only here:
 *  - every src/lib/*.functions.ts module (Atlas's server functions) becomes a module with the same exports that answer
 *    from device-lab/src/server (sample data, in the shapes the real functions return, type-checked against them);
 *  - @tanstack/react-start (useServerFn) and the Supabase client become small stand-ins (a signed-in sample account);
 *  - the page simulates the device the Lab picked (device-lab/src/sim.ts) before the app reads it.
 * Build: `bun run lab:build` → device-lab/dist (app.html and app-assets/), published inside the Device Lab artifact.
 */
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename, resolve } from 'node:path';

const root = resolve(__dirname, '..');
const lab = resolve(__dirname);

/** Server-function modules → the Lab's answers. Exports are read from the real module so the names always match. */
function labServer(): Plugin {
  const PREFIX = '\0lab-fn:';
  return {
    name: 'atlas-lab-server',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source.startsWith(PREFIX)) return source;
      if (!importer || !/\.functions(\.ts)?$/.test(source)) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (r && /[\\/]src[\\/]lib[\\/][\w-]+\.functions\.ts$/.test(r.id)) return PREFIX + r.id;
      return null;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const file = id.slice(PREFIX.length);
      const mod = basename(file).replace(/\.functions\.ts$/, '');
      const src = readFileSync(file, 'utf8');
      const out = [`import { labFn, labExtra } from ${JSON.stringify(resolve(lab, 'src/server/index.ts'))};`];
      const declared = new Set<string>();
      for (const m of src.matchAll(/^export const (\w+)\s*=\s*createServerFn\b/gm)) { declared.add(m[1]); out.push(`export const ${m[1]} = labFn(${JSON.stringify(`${mod}.${m[1]}`)});`); }
      // Anything else a functions module exports at run time (a plain function or constant) gets a stand-in.
      for (const m of src.matchAll(/^export (?:const|let|(?:async )?function) (\w+)/gm)) {
        if (declared.has(m[1])) continue;
        declared.add(m[1]);
        out.push(`export const ${m[1]} = labExtra(${JSON.stringify(`${mod}.${m[1]}`)});`);
      }
      return out.join('\n');
    },
  };
}

/** build.json beside the page: the commit the Lab was built from, shown on the bench. */
function buildInfo(): Plugin {
  return {
    name: 'atlas-lab-build-info',
    apply: 'build',
    generateBundle() {
      const git = (cmd: string) => { try { return execSync(cmd, { cwd: root }).toString().trim(); } catch { return 'unknown'; } };
      const f7 = JSON.parse(readFileSync(resolve(root, 'node_modules/framework7/package.json'), 'utf8')).version as string;
      const info = { commit: git('git rev-parse --short HEAD'), branch: git('git rev-parse --abbrev-ref HEAD'), date: new Date().toISOString().slice(0, 10), framework7: f7 };
      this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify(info) });
    },
  };
}

export default defineConfig({
  root: lab,
  base: './',
  plugins: [labServer(), react(), tailwindcss(), buildInfo()],
  resolve: {
    alias: [
      { find: '@tanstack/react-start', replacement: resolve(lab, 'src/stubs/start.ts') },
      { find: '@/integrations/supabase/client', replacement: resolve(lab, 'src/stubs/supabase.ts') },
      { find: '@/lib/register-sw', replacement: resolve(lab, 'src/stubs/register-sw.ts') },
      { find: '@', replacement: resolve(root, 'src') },
    ],
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router'],
  },
  define: {
    'import.meta.env.VITE_DISCOVERY_GATEWAY_URL': JSON.stringify(''),
  },
  build: {
    outDir: resolve(lab, 'dist'),
    emptyOutDir: true,
    assetsDir: 'app-assets',
    // The artifact host serves files as published: keep names stable enough to read, hashed for caching.
    rollupOptions: { input: { app: resolve(lab, 'app.html') } },
    chunkSizeWarningLimit: 4000,
  },
});
