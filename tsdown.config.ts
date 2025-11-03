import { defineConfig } from 'tsdown'

export default defineConfig({
  external: ['@opentelemetry/api'],
  format: ['cjs', 'esm'],
})
