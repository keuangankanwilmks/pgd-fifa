interface RateEntry {
  count: number;
  resetAt: number;
}

const entries = new Map<string, RateEntry>();

export const getRequestIp = (req: any) =>
  String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();

export const enforceRateLimit = (
  key: string,
  limit = 8,
  windowMs = 15 * 60 * 1000,
) => {
  const now = Date.now();
  const current = entries.get(key);
  if (!current || current.resetAt <= now) {
    entries.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) {
    throw Object.assign(new Error('Terlalu banyak percobaan. Silakan coba kembali beberapa saat lagi.'), { statusCode: 429 });
  }
};

