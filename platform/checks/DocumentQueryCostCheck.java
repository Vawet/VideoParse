package org.videoparse;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.hash.Hashing;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;

/** Pass a disposable localhost Redis port to additionally check shared hits across cold services. */
public class DocumentQueryCostCheck {
    public static void main(String[] args) throws Exception {
        var connections = new LettuceConnectionFactory("127.0.0.1", args.length == 0 ? 1 : Integer.parseInt(args[0]));
        connections.afterPropertiesSet();
        try {
            var redis = new ReactiveStringRedisTemplate(connections);
            if (args.length != 0) redis.hasKey("vp:fixture-probe").block();
            check(redis, args.length != 0);
        } finally {
            connections.destroy();
        }
    }

    private static void check(ReactiveStringRedisTemplate redis, boolean shared) throws Exception {
        var json = new ObjectMapper();
        var embeddings = new AtomicInteger();
        var searches = new AtomicInteger();
        var local = new LocalEmbeddings(json, "unused", Path.of("."), "fixture-" + UUID.randomUUID()) {
            @Override float[][] embed(List<String> texts, boolean query) throws Exception {
                if (!query) throw new AssertionError("Expected a query embedding");
                if (embeddings.incrementAndGet() == 1) throw new IOException("fixture unavailable");
                return new float[][]{{0,1}};
            }
        };
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/", exchange -> {
            String result = "{\"payload_schema\":{\"owner\":{},\"document\":{},\"video\":{},\"revision\":{}}}";
            if (exchange.getRequestURI().getPath().endsWith("/points/count")) result="{\"count\":1}";
            if (exchange.getRequestURI().getPath().endsWith("/points/query")) {
                searches.incrementAndGet();
                var request = json.readTree(exchange.getRequestBody());
                if (!request.path("query").toString().equals("[0.0,1.0]")) throw new AssertionError(request);
                var filters = request.at("/filter/must");
                String document = filters.get(1).at("/match/any/0").asText();
                result = json.writeValueAsString(java.util.Map.of("points", List.of(java.util.Map.of(
                    "payload",java.util.Map.of("document",document,"ordinal",1)))));
                if ("video".equals(filters.get(0).path("key").asText()) && "revision".equals(filters.get(1).path("key").asText()))
                    result="{\"points\":[{\"payload\":{\"index\":0}}]}";
            }
            byte[] bytes = ("{\"result\":" + result + "}").getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            try (var body = exchange.getResponseBody()) { body.write(bytes); }
        });
        server.start();
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            String endpoint = "http://127.0.0.1:"+server.getAddress().getPort();
            var index = new VectorIndex(json,local,null,null,new QueryEmbeddingCache(redis),endpoint,"","","","fixture");
            try {
                index.documents("alice",List.of("one"),"topic");
                throw new AssertionError("Expected fixture failure");
            } catch (java.util.concurrent.ExecutionException expected) {
                if (!(expected.getCause() instanceof IOException)) throw expected;
            }
            Callable<List<VectorIndex.DocHit>> first = () -> index.documents("alice", List.of("one"), "topic");
            for (var result : pool.invokeAll(java.util.Collections.nCopies(8, first)))
                if (!result.get().equals(List.of(new VectorIndex.DocHit("one",1)))) throw new AssertionError();
            if (!index.documents("alice",List.of("two"),"topic").equals(List.of(new VectorIndex.DocHit("two",1))))
                throw new AssertionError("A scope change must query the new document");
            if (embeddings.get()!=2 || searches.get()!=9)
                throw new AssertionError("Unexpected embed/search counts: "+embeddings+"/"+searches);

            var passages = new EvidenceCorpus.Index(List.of(new EvidenceCorpus.Passage(0,"speech",0,1,"topic","")));
            var cold = new VectorIndex(json,local,null,null,new QueryEmbeddingCache(redis),endpoint,"","","","fixture");
            if (!cold.ranked("alice","video-id",passages,"topic").equals(List.of(0))) throw new AssertionError("Video filter");
            if (!cold.documents("alice",List.of("changed"),"topic").equals(List.of(new VectorIndex.DocHit("changed",1))))
                throw new AssertionError("Document filter");
            index.documents("bob",List.of("three"),"topic");
            index.documents("alice",List.of("one"),"another topic");
            if (searches.get()!=13 || embeddings.get()!=(shared ? 4 : 5))
                throw new AssertionError("Cold instance embed/search counts: "+embeddings+"/"+searches);
            if (shared) {
                var otherModel = new QueryEmbeddingCache(redis).get(index.space()+"-other","alice","topic",() -> new float[]{9});
                if (otherModel.length!=1 || otherModel[0]!=9) throw new AssertionError("Model isolation");
                checkSharedEntry(redis,index.space());
            }
            System.out.printf("13 filtered searches; %d successful embeddings; shared Redis %s%n",embeddings.get()-1,shared);
        } finally {
            server.stop(0);
        }
    }

    private static void checkSharedEntry(ReactiveStringRedisTemplate redis, String space) throws Exception {
        String question = "private cache check";
        String digest = Hashing.sha256().hashString(space+"\0alice\0"+question,StandardCharsets.UTF_8).toString();
        String key = "vp:query-vector:v1:"+digest.substring(0,3);
        var calls = new AtomicInteger();
        Callable<float[]> loader = () -> new float[]{calls.incrementAndGet()};
        new QueryEmbeddingCache(redis).get(space,"alice",question,loader);
        var ttl = redis.getExpire(key).block();
        if (ttl == null || ttl.isNegative() || ttl.isZero() || ttl.compareTo(Duration.ofMinutes(10))>0)
            throw new AssertionError("Redis TTL: "+ttl);
        // Both a colliding slot containing a valid vector and a matching slot with NaN must miss.
        for (String bad : List.of("x".repeat(64)+":P4AAAA==",digest+":f8AAAA==")) {
            redis.opsForValue().set(key,bad,Duration.ofMinutes(1)).block();
            int before = calls.get();
            new QueryEmbeddingCache(redis).get(space,"alice",question,loader);
            if (calls.get()!=before+1) throw new AssertionError("Invalid shared hit");
        }
        redis.expire(key,Duration.ofMillis(1)).block();
        Thread.sleep(10);
        new QueryEmbeddingCache(redis).get(space,"alice",question,loader);
        if (calls.get()!=4) throw new AssertionError("Expired entry retained");
    }
}
