package org.videoparse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
class BilibiliController {
    record Import(String url,String token) {}
    record Source(long aid,String bvid,int pageNo,String analysis) {}
    private final Path incoming;
    private final StudyTools tools;
    private final Visitor visitor;
    private final UploadGate gate;
    private final UploadService uploads;
    private final JobService jobs;
    private final JdbcClient db;
    private final TransactionTemplate tx;
    private final ObjectMapper json;

    BilibiliController(@Value("${videoparse.data}") Path root, StudyTools tools, Visitor visitor, UploadGate gate,
                       UploadService uploads, JobService jobs, JdbcClient db, TransactionTemplate tx, ObjectMapper json) {
        incoming=root.resolve("incoming"); this.tools=tools; this.visitor=visitor; this.gate=gate;
        this.uploads=uploads; this.jobs=jobs; this.db=db; this.tx=tx; this.json=json;
    }

    private JsonNode invoke(String operation, Map<String,?> params) throws InterruptedException {
        var reply=tools.invoke(operation,params);
        var body=reply.getBody();
        if (!reply.getStatusCode().is2xxSuccessful() || body==null || !body.path("success").asBoolean())
            throw new ResponseStatusException(body==null?HttpStatus.BAD_GATEWAY:reply.getStatusCode(),
                body==null?"B 站服务暂不可用":body.path("error").asText("B 站服务暂不可用"));
        return body;
    }

    @PostMapping("/v2/bilibili/import")
    Map<String,Object> importVideo(@RequestBody Import input) throws Exception {
        visitor.id();
        if (input.url()==null || input.url().isBlank() || input.url().length()>2048)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"请输入 B 站视频链接");
        gate.check(input.token());
        Files.createDirectories(incoming);
        Path media=Files.createTempFile(incoming,"bili-",".part");
        try {
            var source=invoke("bilibili_import",Map.of("url",input.url(),"target",media.getFileName().toString()));
            String title=source.path("title").asText().replaceAll("[/\\\\\\p{Cntrl}]"," ").strip();
            if (title.isEmpty()) title=source.path("bvid").asText();
            String name=title.substring(0,Math.min(200,title.length()))+"."+source.path("extension").asText();
            var hashes=new ArrayList<String>();
            var hash=MessageDigest.getInstance("SHA-256");
            try (var in=Files.newInputStream(media)) {
                for (byte[] part;(part=in.readNBytes(UploadService.CHUNK)).length!=0;)
                    hashes.add(HexFormat.of().formatHex(hash.digest(part)));
            }
            UUID upload=UUID.fromString(uploads.begin(new UploadService.Manifest(name,Files.size(media),hashes,input.token())));
            try (var in=Files.newInputStream(media)) {
                for (int i=0;i<hashes.size();i++) uploads.put(upload,i,in.readNBytes(UploadService.CHUNK));
            }
            return tx.execute(status -> {
                Map<String,Object> stored;
                try { stored=uploads.finish(upload); }
                catch (Exception e) { throw new IllegalStateException("导入媒体写入失败",e); }
                String id=(String)stored.get("video_id");
                db.sql("INSERT INTO vp_bilibili_source(video_id,aid,bvid,page_no) VALUES(?,?,?,?)")
                    .params(id,source.path("aid").longValue(),source.path("bvid").asText(),source.path("page").intValue()).update();
                return Map.of("success",true,"videoId",id,"filepath",stored.get("filepath"),"name",name,"taskId",jobs.submit(id));
            });
        } finally { Files.deleteIfExists(media); }
    }

    private Optional<Source> source(String id) {
        visitor.video(id);
        return db.sql("""
            SELECT s.aid,s.bvid,s.page_no,CAST(s.analysis AS CHAR CHARACTER SET utf8mb4) AS analysis
            FROM vp_bilibili_source s JOIN videos v ON v.id=s.video_id WHERE v.id=? AND v.owner_id=?
            """).params(id,visitor.id()).query(Source.class).optional();
    }

    @GetMapping("/v2/videos/{id}/bilibili")
    Map<String,Object> sourceInfo(@PathVariable String id) throws Exception {
        var source=source(id);
        if (source.isEmpty()) return Map.of("success",true,"available",false);
        var s=source.get();
        return Map.of("success",true,"available",true,"url","https://www.bilibili.com/video/"+s.bvid()+"/?p="+s.pageNo(),
            "analysis",s.analysis()==null?json.nullNode():json.readTree(s.analysis()));
    }

    @PostMapping("/v2/videos/{id}/bilibili/comments")
    JsonNode comments(@PathVariable String id) throws Exception {
        var s=source(id).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"视频没有 B 站来源"));
        if (s.analysis()!=null) return json.readTree(s.analysis());
        var result=invoke("bilibili_comments",Map.of("aid",s.aid()));
        if (!result.path("claims").isEmpty()) db.sql("UPDATE vp_bilibili_source SET analysis=? WHERE video_id=? AND analysis IS NULL")
            .params(result.toString(),id).update();
        return result;
    }
}
