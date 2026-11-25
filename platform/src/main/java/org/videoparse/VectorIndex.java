package org.videoparse;

import com.fasterxml.jackson.databind.*;
import dev.langchain4j.model.openai.OpenAiEmbeddingModel;
import dev.langchain4j.data.segment.TextSegment;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.Semaphore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
class VectorIndex {
    private final ObjectMapper json;
    private final String endpoint,key,collection;
    private final LocalEmbeddings local;
    private final OpenAiEmbeddingModel model;
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private final Semaphore indexing=new Semaphore(1);
    VectorIndex(ObjectMapper json,LocalEmbeddings local,@Value("${QDRANT_URL:}") String endpoint,@Value("${QDRANT_API_KEY:}") String key,
                @Value("${EMBEDDING_API_KEY:}") String apiKey,@Value("${EMBEDDING_BASE_URL:https://api.siliconflow.cn/v1}") String base,
                @Value("${PLATFORM_EMBED_MODEL:BAAI/bge-m3}") String name) {
        this.json=json;this.endpoint=endpoint;this.key=key;this.local=local;
        String identity=apiKey.isBlank() ? "local|"+local.modelName() : base+"|"+name;
        this.collection="vp_"+UUID.nameUUIDFromBytes(identity.getBytes(StandardCharsets.UTF_8)).toString().replace("-","");
        this.model=apiKey.isBlank() || endpoint.isBlank()?null:OpenAiEmbeddingModel.builder()
            .baseUrl(base).modelName(name).apiKey(apiKey).timeout(Duration.ofSeconds(30)).maxRetries(0).build();
    }
    private HttpResponse<String> call(String verb,String path,Object body) throws Exception {
        var b=HttpRequest.newBuilder(URI.create(endpoint+"/collections/"+collection+path))
                .timeout(Duration.ofSeconds(10)).header("Content-Type","application/json");
        if(!key.isBlank()) b.header("api-key",key);
        return http.send(b.method(verb,body==null?HttpRequest.BodyPublishers.noBody():
                    HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofString());
    }
    private JsonNode require(HttpResponse<String> r) throws Exception {
        if(r.statusCode()/100!=2) throw new java.io.IOException("Qdrant HTTP "+r.statusCode());
        return json.readTree(r.body()).path("result");
    }
    private float[][] embed(List<String> texts,boolean query) throws Exception {
        if(model==null) return local.embed(texts,query);
        return model.embedAll(texts.stream().map(TextSegment::from).toList()).content().stream()
            .map(dev.langchain4j.data.embedding.Embedding::vector).toArray(float[][]::new);
    }
    List<Integer> ranked(String video,List<EvidenceCorpus.Passage> docs,String q) throws Exception {
        if(endpoint.isBlank() || docs.isEmpty()) return List.of();
        String rev=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(json.writeValueAsBytes(docs)));
        var match=List.of(condition("video",video),condition("revision",rev));
        var filter=Map.of("must",match);
        var info=call("GET","",null);
        if(info.statusCode()!=404) require(info);
        float[] query=embed(List.of(q),true)[0];
        if(info.statusCode()==404) {
            var created=call("PUT","",Map.of("vectors",Map.of("size",query.length,"distance","Cosine")));
            if(created.statusCode()!=409) require(created);
        }
        var count=require(call("POST","/points/count",Map.of("filter",filter,"exact",true))).path("count").asInt();
        if(count!=docs.size()) {
            if(!indexing.tryAcquire()) return List.of();
            try {
                for(int i=0;i<docs.size();i+=24) {
                    var batch=docs.subList(i,Math.min(i+24,docs.size()));
                    var embeddings=embed(batch.stream().map(d->d.text().substring(0,Math.min(d.text().length(),4000))).toList(),false);
                    var points=new ArrayList<Object>();
                    for(int n=0;n<batch.size();n++) {
                        var doc=batch.get(n);
                        var id=UUID.nameUUIDFromBytes((video+"/"+rev+"/"+doc.id()).getBytes(StandardCharsets.UTF_8));
                        points.add(Map.of("id",id.toString(),"vector",embeddings[n],"payload",
                                    Map.of("video",video,"revision",rev,"index",doc.id())));
                    }
                    require(call("PUT","/points?wait=true",Map.of("points",points)));
                }
            } finally {indexing.release();}
        }
        var found=require(call("POST","/points/query",Map.of("query",query,"filter",filter,"limit",16,"score_threshold",0.4,"with_payload",true)));
        var ids=new ArrayList<Integer>();
        for(var point:found.path("points")) {
            int i=point.path("payload").path("index").asInt(-1);
            if(i>=0 && i<docs.size()) ids.add(i);
        }
        return ids;
    }
    private Object condition(String name,String value){return Map.of("key",name,"match",Map.of("value",value));}
}
