package org.videoparse;

import com.fasterxml.jackson.databind.*;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.nio.file.Path;
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
    private final String python,base;
    private final Path dir,data;
    StudyTools(ObjectMapper json,@Value("${videoparse.python}") String python,@Value("${videoparse.worker-dir}") Path dir,
              @Value("${videoparse.data}") Path data,@Value("${videoparse.public-base}") String base,
              @Value("${STUDY_WORKERS:2}") int workers) {
        if(workers<1 || workers>16) throw new IllegalArgumentException("STUDY_WORKERS 需为 1 至 16");
        this.json=json;this.python=python;this.dir=dir;this.data=data;this.base=base;
        idle=new ArrayBlockingQueue<>(workers);slots=new Semaphore(workers,true);
    }
    ResponseEntity<JsonNode> invoke(String operation,Map<String,?> params,String...path) throws InterruptedException {
        if(!slots.tryAcquire(3,TimeUnit.SECONDS)) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"学习服务繁忙，请稍后重试");
        MediaToolSession session=idle.poll();
        try {
            if(session==null) {
                var pb=new ProcessBuilder(python,"-m","app.study_worker").directory(dir.toFile());
                pb.environment().put("DATA_ROOT",data.toAbsolutePath().normalize().toString());
                pb.environment().put("PUBLIC_BASE_URL",base);
                session=new MediaToolSession(pb,json);
            }
            var answer=session.call(operation,Map.of("params",params==null?Map.of():params,"path",List.of(path)),3);
            if(!answer.has("status") || !answer.has("body")) throw new IOException("响应格式错误");
            idle.add(session);session=null;
            return ResponseEntity.status(answer.get("status").asInt()).body(answer.get("body"));
        } catch(InterruptedException ex){throw ex;}
          catch(Exception ex){log.warn("学习服务执行失败 {}",operation,ex);
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"无法取得学习结果，请稍后重试");}
        finally {if(session!=null)session.close();slots.release();}
    }
    @PreDestroy void shutdown(){MediaToolSession s;while((s=idle.poll())!=null)s.close();}
}
