package org.videoparse;

import com.fasterxml.jackson.databind.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

final class MediaToolSession implements AutoCloseable {
    private final Process child;
    private final ObjectMapper json;
    private final BufferedWriter request;
    private final BufferedReader response;
    private final ExecutorService reader=Executors.newVirtualThreadPerTaskExecutor();
    MediaToolSession(ProcessBuilder builder,ObjectMapper json) throws IOException {
        this.json=json;
        child=builder.redirectError(ProcessBuilder.Redirect.INHERIT).start();
        request=child.outputWriter(StandardCharsets.UTF_8); response=child.inputReader(StandardCharsets.UTF_8);
    }
    JsonNode call(String name,Map<String,Object> args) throws Exception {
        request.write(json.writeValueAsString(Map.of("tool",name,"args",args)));request.newLine();request.flush();
        var read=reader.submit(()->{
            for(String line;(line=response.readLine())!=null;)
                if(line.startsWith("VP_RESULT ")) return json.readTree(line.substring(10));
            throw new EOFException("媒体进程退出");
        });
        try {return read.get(45,TimeUnit.MINUTES);}
        catch(Exception ex){child.destroyForcibly();read.cancel(true);throw ex;}
    }
    @Override public void close() {
        try {request.close();} catch(IOException ignored){}
        if(child.isAlive()) child.destroy();
        try {if(!child.waitFor(3,TimeUnit.SECONDS)) child.destroyForcibly();}
        catch(InterruptedException ex){child.destroyForcibly();Thread.currentThread().interrupt();}
        reader.shutdownNow();
    }
}
