package org.videoparse;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** Each publication is one immutable snapshot. Cypher parameters also carry all model-generated text. */
@Service
class AnalysisGraph {
    private static final String WRITE = """
        MERGE (a:VPAnalysis {id: $job})
        ON CREATE SET a.newSnapshot = true
        WITH a WHERE a.newSnapshot = true
        REMOVE a.newSnapshot
        SET a.result = $result
        MERGE (v:VPVideo {id: $video})
        CREATE (v)-[:HAS_ANALYSIS]->(a)
        WITH a UNWIND $passages AS row
        CREATE (a)-[:HAS_EVIDENCE]->(e:VPEvidence)
        SET e = row
        """;
    private final ObjectMapper json;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private final URI endpoint;
    private final String authorization;
    private boolean constraintsReady;

    AnalysisGraph(ObjectMapper json, @Value("${NEO4J_URL:}") String url,
                  @Value("${NEO4J_USER:neo4j}") String user, @Value("${NEO4J_PASSWORD:}") String password) {
        this.json = json;
        endpoint = url.isBlank() ? null : URI.create(url.replaceFirst("/+$", "") + "/db/neo4j/tx/commit");
        authorization = "Basic " + Base64.getEncoder().encodeToString((user + ":" + password).getBytes(StandardCharsets.UTF_8));
    }

    boolean enabled() { return endpoint != null; }

    private JsonNode query(String cypher, Map<String,?> params) throws IOException {
        var body = Map.of("statements", List.of(Map.of("statement", cypher, "parameters", params)));
        var request = HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(45))
            .header("Authorization", authorization).header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
        HttpResponse<String> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IOException("Neo4j 请求被中断", ex);
        }
        if (response.statusCode() / 100 != 2) throw new IOException("Neo4j HTTP " + response.statusCode());
        var reply = json.readTree(response.body());
        var errors = reply.path("errors");
        if (!errors.isArray() || !errors.isEmpty()) throw new IOException("Neo4j 事务失败 " + errors.path(0).path("code").asText());
        var data = reply.path("results").path(0).path("data");
        if (!data.isArray()) throw new IOException("Neo4j 返回了无效的结果集");
        return data;
    }

    private synchronized void ensureConstraints() throws IOException {
        if (constraintsReady) return;
        query("CREATE CONSTRAINT vp_video_id IF NOT EXISTS FOR (n:VPVideo) REQUIRE n.id IS UNIQUE", Map.of());
        query("CREATE CONSTRAINT vp_analysis_id IF NOT EXISTS FOR (n:VPAnalysis) REQUIRE n.id IS UNIQUE", Map.of());
        constraintsReady = true;
    }

    boolean hasSnapshot(String job, String video) throws IOException {
        var rows = query("""
            MATCH (a:VPAnalysis {id:$job})
            RETURN CASE WHEN EXISTS {
                MATCH (:VPVideo {id:$video})-[:HAS_ANALYSIS]->(a)
            } THEN a.result ELSE null END
            """, Map.of("job",job, "video",video));
        if (rows.isEmpty()) return false;
        readResult(rows);
        return true;
    }

    void store(String job, String video, JsonNode result, List<EvidenceCorpus.Passage> passages) throws IOException {
        ensureConstraints();
        query(WRITE, Map.of("job",job, "video",video, "result",json.writeValueAsString(result), "passages",passages));
    }

    JsonNode result(String job) throws IOException {
        return readResult(query("MATCH (a:VPAnalysis {id:$job}) RETURN a.result", Map.of("job",job)));
    }

    private JsonNode readResult(JsonNode rows) throws IOException {
        var value = rows.path(0).path("row").path(0);
        if (rows.size() != 1 || !value.isTextual()) throw new IOException("图库中的解析结果缺失或格式无效");
        var result = json.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(value.textValue());
        if (result == null || !result.isObject()) throw new IOException("图库中的解析结果需要是 JSON 对象");
        return result;
    }

    List<EvidenceCorpus.Passage> passages(String job) throws IOException {
        var rows = query("""
            MATCH (a:VPAnalysis {id:$job})
            OPTIONAL MATCH (a)-[:HAS_EVIDENCE]->(e:VPEvidence)
            RETURN properties(e) ORDER BY e.id
            """, Map.of("job",job));
        if (rows.isEmpty()) throw new IOException("已发布的 Neo4j 解析结果缺失");
        // OPTIONAL MATCH returns one null property map for a valid snapshot with no evidence.
        if (rows.size() == 1 && rows.path(0).path("row").path(0).isNull()) return List.of();
        var passages = new ArrayList<EvidenceCorpus.Passage>();
        for (var row : rows) {
            var node = row.path("row").path(0);
            var id = node.path("id");
            var text = node.path("text");
            // Vector hits use these IDs as offsets into this same list.
            if (!id.isIntegralNumber() || !id.canConvertToInt() || id.intValue() != passages.size()
                    || !text.isTextual() || text.textValue().isBlank()) {
                throw new IOException("图库证据编号或正文无效");
            }
            passages.add(json.treeToValue(node, EvidenceCorpus.Passage.class));
        }
        return passages;
    }
}
