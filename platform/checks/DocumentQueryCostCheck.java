package org.videoparse;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/** Run with the platform runtime classpath. Uses a counting embedder and a loopback Qdrant fixture. */
public class DocumentQueryCostCheck {
    public static void main(String[] args) throws Exception {
        var json = new ObjectMapper();
        var embeddings = new AtomicInteger();
        var searches = new AtomicInteger();
        var local = new LocalEmbeddings(json, "unused", Path.of("."), "fixture") {
            @Override float[][] embed(List<String> texts, boolean query) throws Exception {
                if (!query) throw new AssertionError("Expected a query embedding");
                if (embeddings.incrementAndGet() == 1) throw new IOException("fixture unavailable");
                return new float[][]{{0,1}};
            }
        };
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/", exchange -> {
            String result = "{\"payload_schema\":{\"owner\":{},\"document\":{},\"video\":{},\"revision\":{}}}";
            if (exchange.getRequestURI().getPath().endsWith("/points/query")) {
                searches.incrementAndGet();
                var filters = json.readTree(exchange.getRequestBody()).at("/filter/must");
                String document = filters.get(1).at("/match/any/0").asText();
                result = json.writeValueAsString(java.util.Map.of("points", List.of(java.util.Map.of(
                    "payload",java.util.Map.of("document",document,"ordinal",1)))));
            }
            byte[] bytes = ("{\"result\":" + result + "}").getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            try (var body = exchange.getResponseBody()) { body.write(bytes); }
        });
        server.start();
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var index = new VectorIndex(json,local,null,"http://127.0.0.1:"+server.getAddress().getPort(),"","","","fixture");
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
            index.documents("bob",List.of("three"),"topic");
            index.documents("alice",List.of("one"),"another topic");
            if (embeddings.get()!=4 || searches.get()!=11)
                throw new AssertionError("Unexpected embed/search counts: "+embeddings+"/"+searches);
            System.out.println("11 successful searches; 3 successful embedding calls; failed embedding retried");
        } finally {
            server.stop(0);
        }
    }
}
