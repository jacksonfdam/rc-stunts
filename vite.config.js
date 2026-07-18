import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Multipage build. The original arcade playground lives at index.html; the
// Stunts (1990) web port is a second, standalone entry at stunts.html. Both
// share the src/ engine (Vehicle.js, World.js) but have independent main
// scripts, so each needs its own HTML entry in the Rollup input map.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        stunts: resolve(__dirname, 'stunts.html'),
      },
    },
  },
})
