package org.videoparse;

import com.fasterxml.jackson.databind.*;
import dev.langchain4j.model.openai.OpenAiEmbeddingModel;
import dev.langchain4j.data.segment.TextSegment;
import java.io.IOException;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.Semaphore;
import java.util.concurrent.locks.ReentrantLock;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
class VectorIndex {
    private static final Logger log = LoggerFactory.getLogger(VectorIndex.class);
    private static final List<String> FILTER_FIELDS = List.of("owner", "document", "video", "revision");
    private final ObjectMapper json;
    private final DataSource db;
    private final String endpoint,key,collection;
    private final LocalEmbeddings local;
    private final ApiUsage usage;
    private final boolean hostedQdrant;
    private final OpenAiEmbeddingModel model;
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private final Semaphore indexing=new Semaphore(1);
    private final ReentrantLock schemaLock = new ReentrantLock();
    private final QueryEmbeddingCache queryEmbeddings;
    private volatile long nextSchemaCheck = System.nanoTime();
    VectorIndex(ObjectMapper json,LocalEmbeddings local,DataSource db,ApiUsage usage,QueryEmbeddingCache queryEmbeddings,@Value("${QDRANT_URL:}") String endpoint,@Value("${QDRANT_API_KEY:}") String key,
                @Value("${EMBEDDING_API_KEY:}") String apiKey,@Value("${EMBEDDING_BASE_URL:https://api.siliconflow.cn/v1}") String base,
                @Value("${PLATFORM_EMBED_MODEL:BAAI/bge-m3}") String name) {
        this.usage=usage;
        this.queryEmbeddings=queryEmbeddings;
        String host=endpoint.isBlank() ? "" : URI.create(endpoint).getHost();
        this.hostedQdrant=!key.isBlank() && host!=null && host.endsWith(".cloud.qdrant.io");
        this.json=json;this.endpoint=endpoint;this.key=key;this.local=local;this.db=db;
        String identity=apiKey.isBlank() ? "local|"+local.modelName() : base+"|"+name;
        this.collection="vp_"+UUID.nameUUIDFromBytes(identity.getBytes(StandardCharsets.UTF_8)).toString().replace("-","");
        this.model=apiKey.isBlank() || endpoint.isBlank()?null:OpenAiEmbeddingModel.builder()
            .httpClientBuilder(new UsageHttpClient(usage,json,name)).baseUrl(base).modelName(name).apiKey(apiKey).timeout(Duration.ofSeconds(30)).maxRetries(0).build();
    }
    private HttpResponse<String> call(String verb,String path,Object body) throws IOException, InterruptedException {
        var b=HttpRequest.newBuilder(URI.create(endpoint+"/collections/"+collection+path))
                .timeout(Duration.ofSeconds(10)).header("Content-Type","application/json");
        if(!key.isBlank()) b.header("api-key",key);
        var request=b.method(verb,body==null ? HttpRequest.BodyPublishers.noBody() :
            HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
        if (!hostedQdrant) return http.send(request,HttpResponse.BodyHandlers.ofString());
        long id=usage.begin(endpoint,"Qdrant Cloud");
        try {
            var result=http.send(request,HttpResponse.BodyHandlers.ofString());
            ApiUsage.recordResult(usage,id,result.statusCode()/100==2 ? "unreported" : "failed",null);
            return result;
        } catch (IOException | InterruptedException | RuntimeException e) {
            ApiUsage.recordResult(usage,id,"failed",null);
            throw e;
        }
    }
    private JsonNode require(HttpResponse<String> r) throws IOException {
        if(r.statusCode()/100!=2) throw new java.io.IOException("Qdrant HTTP "+r.statusCode());
        return json.readTree(r.body()).path("result");
    }
    private float[][] embed(List<String> texts,boolean query) throws Exception {
        if(model==null) return local.embed(texts,query);
        return model.embedAll(texts.stream().map(TextSegment::from).toList()).content().stream()
            .map(dev.langchain4j.data.embedding.Embedding::vector).toArray(float[][]::new);
    }
    boolean configured() { return !endpoint.isBlank(); }
    String space() { return collection; }
    private float[] queryVector(String owner,String question) throws Exception {
        return queryEmbeddings.get(collection,owner,question,() -> embed(List.of(question),true)[0]);
    }

    private void prepareFilterIndexes() throws InterruptedException {
        if (System.nanoTime() - nextSchemaCheck < 0) return;
        schemaLock.lockInterruptibly();
        try {
            if (System.nanoTime() - nextSchemaCheck < 0) return;
            var info = call("GET", "", null);
            if (info.statusCode() == 404) return;
            var schema = require(info).path("payload_schema");
            if (!schema.isObject()) throw new IOException("Qdrant 未返回过滤索引信息");
            for (String field : FILTER_FIELDS) {
                if (!schema.has(field)) require(call("PUT", "/index?wait=true",
                    Map.of("field_name",field, "field_schema","keyword")));
            }
            nextSchemaCheck = System.nanoTime() + Duration.ofMinutes(10).toNanos();
        } catch (IOException ex) {
            // Read-only deployments can still query when their filtering policy permits it.
            nextSchemaCheck = System.nanoTime() + Duration.ofSeconds(30).toNanos();
            log.warn("Qdrant 过滤索引准备失败：{}", ex.getMessage());
        } finally {
            schemaLock.unlock();
        }
    }

    private void createCollection(int dimension) throws Exception {
        var created=call("PUT","",Map.of("vectors",Map.of("size",dimension,"distance","Cosine")));
        if(created.statusCode()!=409) require(created);
        nextSchemaCheck = System.nanoTime();
        prepareFilterIndexes();
    }

    private Optional<JsonNode> storedPoints(Set<String> ids, List<String> fields) throws IOException, InterruptedException {
        var response = call("POST", "/points", Map.of("ids",ids, "with_payload",fields, "with_vector",false));
        if (response.statusCode() == 404) return Optional.empty();
        var points = require(response);
        if (!points.isArray()) throw new IOException("Qdrant 未返回已写入的证据编号");
        return Optional.of(points);
    }

    void indexDocument(String owner,String doc,List<MarkdownSections.Chunk> chunks) throws Exception {
        try (var scope=ApiUsage.scope(owner,"document_index")) {
            if (!configured()) throw new IOException("未配置向量库");
            var missing = new LinkedHashMap<String,MarkdownSections.Chunk>();
            for (var chunk : chunks) {
                String key = "markdown/" + doc + "/" + chunk.ordinal();
                missing.put(UUID.nameUUIDFromBytes(key.getBytes(StandardCharsets.UTF_8)).toString(), chunk);
            }
            var stored = storedPoints(missing.keySet(), List.of("owner","document","ordinal"));
            if (stored.isPresent()) {
                for (var point : stored.get()) {
                    String id = point.path("id").textValue();
                    var chunk = missing.get(id);
                    var payload = point.path("payload");
                    var ordinal = payload.path("ordinal");
                    if (chunk != null && owner.equals(payload.path("owner").textValue())
                        && doc.equals(payload.path("document").textValue()) && ordinal.isIntegralNumber()
                        && ordinal.longValue() == chunk.ordinal()) missing.remove(id);
                }
            }
            if (missing.isEmpty()) return;
            var texts = missing.values().stream().map(c -> c.heading()+"\n"+c.body()).toList();
            var embeddings = embed(texts, false);
            if (stored.isEmpty()) createCollection(embeddings[0].length);
            var points = new ArrayList<Object>();
            for (var entry : missing.entrySet()) {
                points.add(Map.of("id",entry.getKey(), "vector",embeddings[points.size()],
                    "payload",Map.of("owner",owner, "document",doc, "ordinal",entry.getValue().ordinal())));
            }
            require(call("PUT","/points?wait=true",Map.of("points",points)));
        }
    }

    void removeDocument(String owner,String doc) {
        try (var scope=ApiUsage.scope(owner,"document_remove")) {
            if (!configured()) return;
            try {
                var filter=Map.of("must",List.of(condition("owner",owner),condition("document",doc)));
                var response=call("POST","/points/delete?wait=true",Map.of("filter",filter));
                if (response.statusCode()!=404) require(response);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            } catch (IOException ex) {
                // Searches already exclude document IDs removed from the library.
                log.warn("无法清理已删除文档的向量 {} ({})",doc,ex.getClass().getSimpleName());
            }
        }
    }

    record DocHit(String doc,int ordinal) {}
    List<DocHit> documents(String owner,List<String> documents,String question) throws Exception {
        try (var scope=ApiUsage.scope(owner,"document_search")) {
            prepareFilterIndexes();
            var conditions=new ArrayList<Object>();
            conditions.add(condition("owner",owner));
            conditions.add(Map.of("key","document","match",Map.of("any",documents)));
            // Only the embedding is independent of document scope. Always search the current permitted corpus.
            var query = queryVector(owner,question);
            var found=require(call("POST","/points/query",Map.of("query",query,
                "filter",Map.of("must",conditions),"with_payload",true,"limit",24,"score_threshold",0.4)));
            var hits=new ArrayList<DocHit>();
            for (var point:found.path("points")) {
                var payload=point.path("payload");
                hits.add(new DocHit(payload.path("document").asText(),payload.path("ordinal").asInt(-1)));
            }
            return hits;
        }
    }

    private void indexVideoBatch(String video, String revision, List<EvidenceCorpus.Passage> batch,
                                boolean partiallyIndexed, boolean createSpace) throws Exception {
        var missing = new LinkedHashMap<String,EvidenceCorpus.Passage>();
        for (var doc : batch) {
            String key = video + "/" + revision + "/" + doc.id();
            missing.put(UUID.nameUUIDFromBytes(key.getBytes(StandardCharsets.UTF_8)).toString(), doc);
        }
        if (partiallyIndexed) {
            var existing = storedPoints(missing.keySet(), List.of())
                .orElseThrow(() -> new IOException("Qdrant 向量集合不存在"));
            for (var point : existing) missing.remove(point.path("id").textValue());
        }
        if (missing.isEmpty()) return;
        var texts = missing.values().stream().map(EvidenceCorpus.Passage::text)
            .map(s -> s.substring(0, Math.min(s.length(), 4000))).toList();
        var embeddings = embed(texts, false);
        if (createSpace) createCollection(embeddings[0].length);
        var points = new ArrayList<Object>();
        for (var entry : missing.entrySet()) {
            points.add(Map.of("id",entry.getKey(), "vector",embeddings[points.size()], "payload",
                Map.of("video",video, "revision",revision, "index",entry.getValue().id())));
        }
        require(call("PUT", "/points?wait=true", Map.of("points",points)));
    }

    private long videoPointCount(Map<String,?> filter) throws Exception {
        var response = call("POST","/points/count",Map.of("filter",filter,"exact",true));
        if (response.statusCode() == 404) return -1;
        var count = require(response).path("count");
        if (!count.isIntegralNumber() || count.asLong() < 0) throw new java.io.IOException("Qdrant 证据计数无效");
        return count.asLong();
    }

    private boolean ensureVideoIndexed(String video, String rev, List<EvidenceCorpus.Passage> docs,
                                      Map<String,?> filter) throws Exception {
        if (videoPointCount(filter) == docs.size()) return true;
        if (!indexing.tryAcquire()) return false;
        String lockName = "vp:vector:" + UUID.nameUUIDFromBytes((collection+"/"+video+"/"+rev).getBytes(StandardCharsets.UTF_8));
        try (var connection = db.getConnection(); var lock = MySqlLock.tryAcquire(connection, lockName)) {
            if (lock == null) return false;
            long count = videoPointCount(filter); // Another instance may have finished before this claim.
            if (count == docs.size()) return true;
            for (int i = 0; i < docs.size(); i += 24) {
                if (!connection.isValid(3)) throw new java.io.IOException("向量索引会话已断开");
                indexVideoBatch(video, rev, docs.subList(i, Math.min(i+24, docs.size())), count>0, i==0 && count<0);
            }
            return true;
        } finally {
            indexing.release();
        }
    }

    List<Integer> ranked(String owner,String video,EvidenceCorpus.Index index,String q) throws Exception {
        try (var scope=ApiUsage.scope(owner,"evidence_search")) {
            var docs=index.passages();
            if(endpoint.isBlank() || docs.isEmpty()) return List.of();
            prepareFilterIndexes();
            String rev=index.vectorRevision(json);
            var match=List.of(condition("video",video),condition("revision",rev));
            var filter=Map.of("must",match);
            if (!ensureVideoIndexed(video,rev,docs,filter)) return List.of();
            float[] query=queryVector(owner,q);
            var found=require(call("POST","/points/query",Map.of("query",query,"filter",filter,"limit",16,"score_threshold",0.4,"with_payload",true)));
            var ids=new ArrayList<Integer>();
            for(var point:found.path("points")) {
                int i=point.path("payload").path("index").asInt(-1);
                if(i>=0 && i<docs.size()) ids.add(i);
            }
            return ids;
        }
    }
    private Object condition(String name,String value){return Map.of("key",name,"match",Map.of("value",value));}
}
