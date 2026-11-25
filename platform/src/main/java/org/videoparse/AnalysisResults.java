package org.videoparse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ExecutionException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
class AnalysisResults {
    private final Path outputs;
    private final ObjectMapper json;
    private final EvidenceCorpus workspace;
    private final AnalysisGraph graph;
    private final JdbcClient db;
    private final Cache<String,EvidenceCorpus.Index> evidenceByJob = CacheBuilder.newBuilder()
        .concurrencyLevel(1).maximumWeight(16L * 1024 * 1024)
        .weigher((String job, EvidenceCorpus.Index index) -> index.estimatedBytes())
        .expireAfterAccess(Duration.ofMinutes(10)).build();

    AnalysisResults(@Value("${videoparse.data}") Path root, ObjectMapper json, EvidenceCorpus workspace,
                    AnalysisGraph graph, JdbcClient db) {
        this.outputs = root.resolve("outputs");
        this.json = json;
        this.workspace = workspace;
        this.graph = graph;
        this.db = db;
    }

    private Path resultFile(String video) {
        if (!video.matches("[a-zA-Z0-9_-]{1,64}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"非法视频编号");
        return outputs.resolve(video + "_result.json");
    }

    private Optional<String> published(String video) {
        var head = db.sql("SELECT job_id FROM vp_graph_head WHERE video_id=?").param(video).query(String.class).optional();
        if (head.isPresent() && !graph.enabled())
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"此实例尚未配置已发布结果所需的图库");
        return head;
    }

    JsonNode result(String video) throws IOException {
        var file = resultFile(video);
        var head = published(video);
        if (head.isPresent()) {
            try { return graph.result(head.get()); }
            catch (IOException ex) { throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"暂时无法读取已发布结果",ex); }
        }
        return Files.isRegularFile(file) ? json.readTree(file.toFile()) : null;
    }

    EvidenceCorpus.Index evidence(String video) throws IOException {
        resultFile(video);
        var head = published(video);
        if (head.isPresent()) {
            String job = head.get();
            try { return evidenceByJob.get(job, () -> new EvidenceCorpus.Index(graph.passages(job))); }
            catch (ExecutionException ex) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"暂时无法读取已发布证据",ex.getCause());
            }
        }
        return new EvidenceCorpus.Index(workspace.load(video));
    }

    void publish(String job, String video) throws IOException {
        // The graph transaction may have committed before the publisher received its reply.
        if (graph.hasSnapshot(job, video)) return;
        var result = json.readTree(resultFile(video).toFile());
        if (result == null || !result.isObject()) throw new IOException("解析结果格式无效");
        var dir = outputs.resolve(video + "_work");
        List<EvidenceCorpus.Passage> passages = List.of();
        if (!Files.notExists(dir)) {
            if (!Files.isDirectory(dir)) throw new IOException("无法读取证据工作目录");
            passages = workspace.load(video);
        }
        graph.store(job,video,result,passages);
    }
}
