package org.videoparse;

import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@RestController
class TaskController {
    private final Visitor visitor;
    private final JobMapper jobs;
    private final JobService service;
    private final Path uploads;
    private final AnalysisResults results;
    TaskController(JobMapper jobs, JobService service, AnalysisResults results, Visitor visitor, @Value("${videoparse.data}") Path root) {
        this.visitor=visitor;this.jobs = jobs; this.service = service; this.uploads = root.resolve("uploads");
        this.results=results;
    }

    @GetMapping("/health")
    Map<String,Object> health() { return Map.of("service","videoparse","success",true); }

    @PostMapping("/analyze/start")
    Map<String,Object> submit(@RequestBody Map<String,String> body) {
        String filename = body.getOrDefault("filepath","");
        if (!filename.matches("[a-zA-Z0-9_-]{1,64}\\.(?i:mp4|mov|avi|mkv|flv|webm|m4v)"))
            return Map.of("success",false,"error","无效视频文件名");
        String id = filename.substring(0,filename.lastIndexOf('.'));
        visitor.video(id);
        if (!id.equals(body.getOrDefault("video_id",id)) || !Files.isRegularFile(uploads.resolve(filename)))
            return Map.of("success",false,"error","视频文件不存在");
        return Map.of("success",true,"task_id",service.submit(id),"video_id",id);
    }

    @GetMapping("/result/{video}")
    Map<String,Object> result(@PathVariable String video) throws java.io.IOException {
        visitor.video(video);
        var result=results.result(video);
        if(result==null) return Map.of("success",false,"error","解析结果不存在");
        return Map.of("success",true,"result",result,"video_id",video);
    }

    @PostMapping("/analyze")
    Map<String,Object> analyze(@RequestBody Map<String,Object> body) throws Exception {
        var args=new HashMap<String,String>();
        for(var k:List.of("filepath","video_id")) if(body.get(k) instanceof String value) args.put(k,value);
        var submitted=submit(args);
        if(!Boolean.TRUE.equals(submitted.get("success")) || Boolean.TRUE.equals(body.get("async"))) return submitted;
        var id=(String)submitted.get("task_id");
        for(;;) {
            var job=require(id);
            if(job.status().equals("done")) return result(job.videoId());
            if(job.status().equals("error")) return Map.of("success",false,"error",job.error());
            Thread.sleep(500);
        }
    }

    private JobMapper.Job require(String id) {
        var job = jobs.get(id);
        if (job == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"任务不存在");
        visitor.video(job.videoId());
        return job;
    }

    @GetMapping("/tasks/{id}")
    Map<String,Object> status(@PathVariable String id) {
        var j=require(id);
        var data=new LinkedHashMap<String,Object>();
        data.put("success",true); data.put("video_id",j.videoId()); data.put("status",j.status());
        data.put("error",j.error()); data.put("events",jobs.count(id)); return data;
    }

    @GetMapping(value="/tasks/{id}/events",produces=MediaType.TEXT_EVENT_STREAM_VALUE)
    ResponseEntity<StreamingResponseBody> events(@PathVariable String id,
        @RequestHeader(value="Last-Event-ID",defaultValue="0") long cursor) {
        require(id);
        return ResponseEntity.ok().contentType(MediaType.TEXT_EVENT_STREAM).cacheControl(CacheControl.noStore()).header("X-Accel-Buffering","no").body(out -> {
            long after=Math.max(0,cursor), heartbeat=0;
            for (;;) {
                var job=jobs.get(id);
                var batch=jobs.events(id,after);
                for (var e:batch) {
                    out.write(("id: "+e.id()+"\ndata: "+e.payload()+"\n\n").getBytes(StandardCharsets.UTF_8));
                    after=e.id();
                }
                if (!batch.isEmpty()) { out.flush(); continue; }
                if (job.status().equals("done") || job.status().equals("error")) return;
                if (System.nanoTime()-heartbeat>10_000_000_000L || heartbeat==0) {
                    out.write(": keep-alive\n\n".getBytes(StandardCharsets.UTF_8)); out.flush();
                    heartbeat=System.nanoTime();
                }
                try { Thread.sleep(400); } catch (InterruptedException ex) { Thread.currentThread().interrupt(); return; }
            }
        });
    }
}
