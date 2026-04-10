const { CONFIG } = require("./config");

const rateLimitBuckets = new Map();

function pruneExpiredBuckets(now) {
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
}

function getBucketKey({ endpoint, callId, ipAddress }) {
  if (callId) {
    return `${endpoint}:call:${callId}`;
  }

  return `${endpoint}:ip:${ipAddress || "unknown"}`;
}

function consumeManageCodeRateLimit({ endpoint, callId, ipAddress }) {
  const now = Date.now();
  pruneExpiredBuckets(now);

  const key = getBucketKey({ endpoint, callId, ipAddress });
  const existing = rateLimitBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + CONFIG.manageCodeRateLimitWindowMs
    });

    return {
      ok: true
    };
  }

  if (existing.count >= CONFIG.manageCodeRateLimitMax) {
    return {
      ok: false,
      retry_after_seconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
    };
  }

  existing.count += 1;

  return {
    ok: true
  };
}

module.exports = {
  consumeManageCodeRateLimit
};
