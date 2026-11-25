package org.videoparse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
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
        return db.sql("SELECT job_id FROM vp_graph_head WHERE video_id=?").param(video).query(String.class).optional();
    }

    JsonNode result(String video) throws IOException {
        var file = resultFile(video);
        var head = published(video);
        if (head.isPresent() && graph.enabled()) return graph.result(head.get());
        return Files.isRegularFile(file) ? json.readTree(file.toFile()) : null;
    }

    List<EvidenceCorpus.Passage> evidence(String video) throws IOException {
        resultFile(video);
        var head = published(video);
        if (head.isPresent() && graph.enabled()) return graph.passages(head.get());
        return workspace.load(video);
    }

    void publish(String job, String video) throws IOException {
        var result = json.readTree(resultFile(video).toFile());
        if (result == null || !result.isObject()) throw new IOException("解析结果格式无效");
        graph.store(job,video,result,workspace.load(video));
    }
}
