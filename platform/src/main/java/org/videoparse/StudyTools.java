package org.videoparse;

import com.fasterxml.jackson.databind.*;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import org.slf4j.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
class StudyTools {
    private final Logger log=LoggerFactory.getLogger(getClass());
    private final ObjectMapper json;
    private final ArrayBlockingQueue<MediaToolSession> idle;
    private final Semaphore slots;
    private final Semaphore waiters;
    private final Semaphore downloads;
    private final String python,base;
    private final Path dir,data;
    private final Visitor visitor;
    StudyTools(ObjectMapper json,Visitor visitor,@Value("${videoparse.python}") String python,@Value("${videoparse.worker-dir}") Path dir,
              @Value("${videoparse.data}") Path data,@Value("${videoparse.public-base}") String base,
              @Value("${STUDY_WORKERS:2}") int workers) {
        if(workers<1 || workers>16) throw new IllegalArgumentException("STUDY_WORKERS 需为 1 至 16");
        this.visitor=visitor;this.json=json;this.python=python;this.dir=dir;this.data=data;this.base=base;
        idle=new ArrayBlockingQueue<>(workers);slots=new Semaphore(workers,true);
        waiters=new Semaphore(workers);
        downloads=new Semaphore(Math.max(1,workers-1));
    }
    ResponseEntity<JsonNode> invoke(String operation,Map<String,?> params,String...path) throws InterruptedException {
        return invokeWorker(operation,Map.of("params",params,"path",List.of(path)));
    }
    ResponseEntity<JsonNode> chat(Map<String,?> params,String visitorToken) throws InterruptedException {
        return invokeWorker("chat",Map.of("params",params,"path",List.of(),"session_token",visitorToken));
    }
    private ResponseEntity<JsonNode> invokeWorker(String operation,Map<String,Object> args) throws InterruptedException {
        boolean download = operation.equals("bilibili_import");
        if (download && !downloads.tryAcquire())
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"视频下载繁忙，请稍后重试");
        try {
            acquireWorker();
            try { return runWorker(operation,args); }
            finally { slots.release(); }
        } finally {
            if (download) downloads.release();
        }
    }

    private void acquireWorker() throws InterruptedException {
        // The timed, zero-wait form respects the fair semaphore's existing waiters.
        if (slots.tryAcquire(0,TimeUnit.SECONDS)) return;
        if (waiters.tryAcquire()) {
            try {
                if (slots.tryAcquire(3,TimeUnit.SECONDS)) return;
            } finally { waiters.release(); }
        }
        throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"学习服务繁忙，请稍后重试");
    }

    private ResponseEntity<JsonNode> runWorker(String operation,Map<String,Object> args) throws InterruptedException {
        MediaToolSession session=idle.poll();
        try {
            if(session==null) {
                var pb=new ProcessBuilder(python,"-m","app.study_worker").directory(dir.toFile());
                pb.environment().put("DATA_ROOT",data.toAbsolutePath().normalize().toString());
                pb.environment().put("PUBLIC_BASE_URL",base);
                session=new MediaToolSession(pb,json);
            }
            var input=new HashMap<>(args);
            input.put("usage_owner",visitor.id());
            var answer=session.call(operation,input,Duration.ofMinutes(3));
            if(!answer.has("status") || !answer.has("body")) throw new IOException("响应格式错误");
            idle.add(session);session=null;
            return ResponseEntity.status(answer.get("status").asInt()).body(answer.get("body"));
        } catch(InterruptedException ex){throw ex;}
          catch(Exception ex){log.warn("学习服务执行失败 {}",operation,ex);
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"无法取得学习结果，请稍后重试");}
        finally {if(session!=null)session.close();}
    }
    @PreDestroy void shutdown(){MediaToolSession s;while((s=idle.poll())!=null)s.close();}
}
