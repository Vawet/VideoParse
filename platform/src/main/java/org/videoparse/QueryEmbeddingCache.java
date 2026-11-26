package org.videoparse;

import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;
import com.google.common.hash.Hashing;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;

@Component
class QueryEmbeddingCache {
    private static final Logger log = LoggerFactory.getLogger(QueryEmbeddingCache.class);
    private static final Duration TTL = Duration.ofMinutes(10);
    private static final int MAX_SHARED_DIMENSIONS = 4096;
    private final Cache<String, float[]> local = CacheBuilder.newBuilder()
        .maximumSize(512).expireAfterWrite(TTL).build();
    private final ReactiveStringRedisTemplate redis;
    private volatile long retryAt = System.nanoTime();

    QueryEmbeddingCache(ReactiveStringRedisTemplate redis) { this.redis = redis; }

    float[] get(String space, String owner, String question, Callable<float[]> embed) throws ExecutionException {
        // Space and owner are internal identifiers. The question occupies the final, unbounded field.
        String digest = Hashing.sha256().hashString(space + "\0" + owner + "\0" + question, StandardCharsets.UTF_8).toString();
        return local.get(digest, () -> {
            // Fixed slots bound cache growth on the Redis instance also used for login and grants.
            // Comparing the full digest turns a slot collision into a miss.
            String key = "vp:query-vector:v1:" + digest.substring(0, 3);
            String stored = optional(redis.opsForValue().get(key));
            float[] hit = decode(stored, digest);
            if (hit != null) return hit;

            float[] result = embed.call();
            if (!valid(result)) throw new IOException("查询向量为空或包含非有限值");
            if (result.length <= MAX_SHARED_DIMENSIONS) {
                var bytes = ByteBuffer.allocate(result.length * Float.BYTES);
                bytes.asFloatBuffer().put(result);
                optional(redis.opsForValue().set(key, digest + ":" + Base64.getEncoder().encodeToString(bytes.array()), TTL));
            }
            return result;
        });
    }

    private <T> T optional(Mono<T> command) {
        if (System.nanoTime() - retryAt < 0) return null;
        return command.timeout(Duration.ofMillis(250)).onErrorResume(error -> {
            retryAt = System.nanoTime() + Duration.ofSeconds(5).toNanos();
            log.debug("Shared embedding cache unavailable; using local cache and embedder ({})", error.getClass().getSimpleName());
            return Mono.empty();
        }).block();
    }

    private static boolean valid(float[] vector) {
        if (vector == null || vector.length == 0) return false;
        for (float value : vector) if (!Float.isFinite(value)) return false;
        return true;
    }

    private static float[] decode(String value, String digest) {
        if (value == null || !value.startsWith(digest + ":") ||
            value.length() > digest.length() + 1 + 4 * ((MAX_SHARED_DIMENSIONS * Float.BYTES + 2) / 3)) return null;
        byte[] bytes;
        try { bytes = Base64.getDecoder().decode(value.substring(digest.length() + 1)); }
        catch (IllegalArgumentException corrupt) { return null; }
        if (bytes.length == 0 || bytes.length % Float.BYTES != 0 || bytes.length > MAX_SHARED_DIMENSIONS * Float.BYTES) return null;
        var vector = new float[bytes.length / Float.BYTES];
        ByteBuffer.wrap(bytes).asFloatBuffer().get(vector);
        return valid(vector) ? vector : null;
    }
}
