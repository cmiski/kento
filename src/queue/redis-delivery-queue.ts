import type Redis from "ioredis";

const SCHEDULED_QUEUE_KEY = "notifications:delivery:scheduled";
const DEAD_LETTER_QUEUE_KEY = "notifications:delivery:dead-letter";

export class RedisDeliveryQueue {
  constructor(private readonly redis: Redis) {}

  async enqueue(jobId: string, runAt: Date): Promise<void> {
    await this.redis.zadd(SCHEDULED_QUEUE_KEY, runAt.getTime(), jobId);
  }

  async dequeueDue(now = new Date()): Promise<string | null> {
    const result = (await this.redis.eval(
      `local item = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
       if #item == 0 or tonumber(item[2]) > tonumber(ARGV[1]) then return nil end
       if redis.call('ZREM', KEYS[1], item[1]) == 1 then return item[1] end
       return nil`,
      1,
      SCHEDULED_QUEUE_KEY,
      now.getTime()
    )) as string | null;

    return result;
  }

  async remove(jobId: string): Promise<void> {
    await this.redis.zrem(SCHEDULED_QUEUE_KEY, jobId);
  }

  async size(): Promise<number> {
    return this.redis.zcard(SCHEDULED_QUEUE_KEY);
  }

  async deadLetter(jobId: string, failedAt = new Date()): Promise<void> {
    await this.redis.zadd(DEAD_LETTER_QUEUE_KEY, failedAt.getTime(), jobId);
  }
}
