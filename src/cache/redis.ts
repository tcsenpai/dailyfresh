import { Redis } from "ioredis";
import { env } from "../config/env";
import { log } from "../lib/logger";

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
});

redis.on("error", (err) => log.warn("redis error", { err: String(err) }));

let connected = false;
export async function ensureRedis(): Promise<boolean> {
  if (connected) return true;
  try {
    await redis.connect();
    connected = true;
    log.info("redis connected");
    return true;
  } catch (err) {
    log.warn("redis unavailable, continuing without hot cache", { err: String(err) });
    return false;
  }
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  if (!connected) return null;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    log.warn("cacheGetJson failed", { key, err: String(err) });
    return null;
  }
}

export async function cacheSetJson(key: string, value: unknown, ttlSec: number): Promise<void> {
  if (!connected) return;
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSec);
  } catch (err) {
    log.warn("cacheSetJson failed", { key, err: String(err) });
  }
}

export async function cacheIncr(key: string, ttlSec?: number): Promise<number> {
  if (!connected) return 0;
  try {
    const n = await redis.incr(key);
    if (ttlSec && n === 1) await redis.expire(key, ttlSec);
    return n;
  } catch (err) {
    log.warn("cacheIncr failed", { key, err: String(err) });
    return 0;
  }
}
