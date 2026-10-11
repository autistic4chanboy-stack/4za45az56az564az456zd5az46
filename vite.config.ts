/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';

/**
 * Inline le JS et le CSS générés dans index.html : le build produit un unique
 * fichier HTML autonome, jouable hors-ligne (double-clic, file://) et sans backend.
 */
function inlineSingleFile(): Plugin {
  return {
    name: 'rdc-inline-single-file',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find((f) => f.type === 'asset' && f.fileName.endsWith('.html'));
      if (!html || html.type !== 'asset') return;
      let source = typeof html.source === 'string' ? html.source : new TextDecoder().decode(html.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === 'chunk' && name.endsWith('.js')) {
          const code = file.code.replace(/<\/script/gi, '<\\/script');
          const tag = new RegExp(`<script[^>]*src="[^"]*${escapeRe(name)}"[^>]*></script>`);
          if (tag.test(source)) {
            source = source.replace(tag, () => `<script type="module">${code}</script>`);
            delete bundle[name];
          }
        } else if (file.type === 'asset' && name.endsWith('.css')) {
          const css = typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source);
          const tag = new RegExp(`<link[^>]*href="[^"]*${escapeRe(name)}"[^>]*>`);
          if (tag.test(source)) {
            source = source.replace(tag, () => `<style>${css}</style>`);
            delete bundle[name];
          }
        }
      }
      html.source = source;
    },
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default defineConfig({
  base: './',
  plugins: [inlineSingleFile()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
