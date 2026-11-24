import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

function isPublishable(key: string) {
  if (key.startsWith('sb_publishable_')) return true
  try {
    const [, payload] = key.split('.')
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).role === 'anon'
  } catch {
    return false
  }
}

export default defineConfig(({ mode, command }) => {
  if (command === 'build' && process.env.VERCEL === '1') {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim()
    let validUrl = false
    try {
      const url = new URL(env.VITE_SUPABASE_URL?.trim())
      validUrl = url.protocol === 'https:' && url.origin === url.href.replace(/\/$/, '')
    } catch {
      // A missing or invalid URL is reported below.
    }
    if (!validUrl || !isPublishable(key)) {
      throw new Error('Vercel requiere VITE_SUPABASE_URL y una clave publicable de Supabase.')
    }
  }
  return { plugins: [react()] }
})
