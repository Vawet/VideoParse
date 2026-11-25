package org.videoparse;

import com.fasterxml.jackson.databind.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;

final class MediaToolSession implements AutoCloseable {
    private final Process child;
    private final ObjectMapper json;
    private final BufferedWriter request;
    private final BufferedReader response;
    private final ExecutorService io=Executors.newVirtualThreadPerTaskExecutor();
    MediaToolSession(ProcessBuilder builder,ObjectMapper json) throws IOException {
        this.json=json;
        child=builder.redirectError(ProcessBuilder.Redirect.INHERIT).start();
        request=child.outputWriter(StandardCharsets.UTF_8); response=child.inputReader(StandardCharsets.UTF_8);
    }
    JsonNode call(String name,Map<String,Object> args,Duration timeout) throws Exception {
        return call(Map.of("tool",name,"args",args),timeout);
    }
    JsonNode call(Map<String,?> message,Duration timeout) throws Exception {
        var exchange=io.submit(()->{
            request.write(json.writeValueAsString(message));
            request.newLine();
            request.flush();
            for(String line;(line=response.readLine())!=null;)
                if(line.startsWith("VP_RESULT ")) return json.readTree(line.substring(10));
            throw new EOFException("媒体进程退出");
        });
        try {return exchange.get(timeout.toNanos(),TimeUnit.NANOSECONDS);}
        catch(Exception ex){child.destroyForcibly();exchange.cancel(true);throw ex;}
    }
    @Override public void close() {
        try {request.close();} catch(IOException ignored){}
        if(child.isAlive()) child.destroy();
        try {if(!child.waitFor(3,TimeUnit.SECONDS)) child.destroyForcibly();}
        catch(InterruptedException ex){child.destroyForcibly();Thread.currentThread().interrupt();}
        io.shutdownNow();
    }
}
