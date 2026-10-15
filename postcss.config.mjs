import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}

export default config
