import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Multipage build. The Stunts (1990) web port is the landing page at index.html
// (served at / on rcstunts.vercel.app); the original arcade RC playground is a
// second, standalone entry at play.html. Both share the src/ engine
// (Vehicle.js, World.js) but have independent main scripts, so each needs its
// own HTML entry in the Rollup input map.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        play: resolve(__dirname, 'play.html'),
      },
    },
  },
})
