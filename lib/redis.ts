// Server-only Redis connection (REDIS_URL comes from the Vercel Redis integration).
// One client per function instance, reused across invocations.

import { createClient } from "redis"

type Client = ReturnType<typeof createClient>

let client: Promise<Client> | null = null

export function redisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL)
}

export function redis(): Promise<Client> {
  if (!client) {
    const c = createClient({
      url: process.env.REDIS_URL,
      // Fail fast instead of retrying forever, so a Redis outage can't hang a page render.
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => (retries > 3 ? new Error("Redis unreachable") : Math.min(retries * 200, 1000)),
      },
    })
    // A dropped connection reconnects by itself; log instead of crashing the function.
    c.on("error", (e) => console.error("[redis]", e.message))
    client = c.connect().catch((e) => {
      client = null
      throw e
    })
  }
  return client
}
