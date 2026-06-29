import tailwindcss from '@tailwindcss/vite'
import { mkdirSync, readFileSync } from 'node:fs'
import { defineConfig } from 'wxt'

const chromeProfile = '.wxt/chrome-data'
mkdirSync(chromeProfile, { recursive: true })

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  webExt: {
    chromiumProfile: chromeProfile,
    keepProfileChanges: true,
    chromiumArgs: ['--hide-crash-restore-bubble'],
  },
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      __VERSION__: JSON.stringify(pkg.version),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    build: {
      minify: false,
    },
  }),
  manifest: {
    name: 'Facebook Mod',
    description: 'Automated double-posting moderation assistant for Facebook groups',
    permissions: ['sidePanel', 'storage', 'activeTab', 'tabs', 'scripting'],
    host_permissions: [
      '*://*.facebook.com/*',
    ],
    icons: {
      128: 'assets/icon-128.png',
    },
    action: {
      default_title: 'Open Facebook Mod',
    },
    side_panel: {
      default_path: 'sidepanel/index.html',
    },
  },
})
