import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dirName = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(dirName, '..', 'src', 'storage', 'migrations')

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    SMEM_MIGRATIONS_DIR: migrationsDir,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
}

export default nextConfig
