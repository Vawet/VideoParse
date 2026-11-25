package org.videoparse;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
class LocalEmbeddings {
    private final String modelName;
    private final ProcessBuilder builder;
    private final ObjectMapper json;
    private final ReentrantLock lock = new ReentrantLock();
    private MediaToolSession session;
    private long retryAfter;

    LocalEmbeddings(ObjectMapper json, @Value("${videoparse.python}") String python,
                    @Value("${videoparse.worker-dir}") Path directory,
                    @Value("${EMBED_MODEL:BAAI/bge-small-zh-v1.5}") String modelName) {
        this.json = json;
        this.modelName = modelName;
        builder = new ProcessBuilder(python, "-m", "app.local_embeddings").directory(directory.toFile());
        builder.environment().put("EMBED_MODEL", modelName);
    }

    String modelName() { return modelName; }

    static final class Busy extends IOException {
        Busy() { super("本地向量模型繁忙"); }
    }

    float[][] embed(List<String> texts, boolean query) throws Exception {
        if (!lock.tryLock(1, TimeUnit.SECONDS)) throw new Busy();
        try {
            if (retryAfter != 0 && retryAfter - System.nanoTime() > 0) {
                throw new IOException("本地向量模型暂不可用");
            }
            try {
                if (session == null) session = new MediaToolSession(builder, json);
                var reply = session.call("embed", Map.of("texts", texts, "query", query), Duration.ofMinutes(1));
                var vectors = json.treeToValue(reply, float[][].class);
                if (vectors == null || vectors.length != texts.size()) throw new IOException("向量数量错误");
                return vectors;
            } catch (Exception ex) {
                if (session != null) session.close();
                session = null;
                retryAfter = System.nanoTime() + Duration.ofMinutes(1).toNanos();
                throw ex;
            }
        } finally {
            lock.unlock();
        }
    }

    @PreDestroy void shutdown() {
        lock.lock();
        try { if (session != null) session.close(); }
        finally { lock.unlock(); }
    }
}
