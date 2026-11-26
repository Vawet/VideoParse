package org.videoparse;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Types;
import java.util.*;
import org.slf4j.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

@Service
class VideoLibraryIndex {
    record Work(String id,long generation,int attempts) {}
    record Piece(String key,String origin,Double start,Double end,String frame,String heading,String body) {}
    record Chapter(Double start,Double end,String title,String summary) {}
    private final JdbcClient db;
    private final JdbcTemplate batch;
    private final AnalysisResults results;
    private final TransactionTemplate tx;
    private final Logger log=LoggerFactory.getLogger(getClass());

    VideoLibraryIndex(JdbcClient db,JdbcTemplate batch,AnalysisResults results,TransactionTemplate tx) {
        this.db=db; this.batch=batch; this.results=results; this.tx=tx;
    }

    @Scheduled(fixedDelayString="${LIBRARY_VIDEO_INDEX_DELAY_MS:1500}")
    void indexNext() {
        Work work=tx.execute(status -> {
            var next=db.sql("""
                SELECT id,library_generation AS generation,library_attempts AS attempts FROM videos
                WHERE folder_id='videos' AND library_state='pending' AND library_after<=CURRENT_TIMESTAMP(3)
                ORDER BY library_after,id LIMIT 1 FOR UPDATE SKIP LOCKED
                """).query(Work.class).optional();
            next.ifPresent(w -> db.sql("UPDATE videos SET library_after=TIMESTAMPADD(MINUTE,3,CURRENT_TIMESTAMP(3)) WHERE id=?")
                    .param(w.id()).update());
            return next.orElse(null);
        });
        if(work==null) return;
        try {
            var result=results.result(work.id());
            if(result==null) throw new java.io.IOException("解析结果缺失");
            List<EvidenceCorpus.Passage> evidence;
            try { evidence=results.evidence(work.id()).passages(); }
            catch(ResponseStatusException e) {
                if(e.getStatusCode()!=HttpStatus.NOT_FOUND) throw e;
                evidence=List.of(); // A legacy import may only contain result.json.
            }
            var pieces=extract(result,evidence);
            boolean primary=pieces.stream().anyMatch(p->p.origin().equals("speech") || p.origin().equals("ocr"));
            String state=pieces.isEmpty()?"empty":primary?"ready":"derived";
            tx.executeWithoutResult(s -> {
                if(db.sql("""
                    UPDATE videos SET library_state=?,library_attempts=0
                    WHERE id=? AND library_generation=? AND folder_id='videos' AND library_state='pending'
                    """).params(state,work.id(),work.generation()).update()==0) return;
                db.sql("DELETE FROM vp_video_passage WHERE video_id=?").param(work.id()).update();
                batch.batchUpdate("""
                    INSERT INTO vp_video_passage(video_id,passage_key,origin,start_sec,end_sec,frame_name,heading,body)
                    VALUES(?,?,?,?,?,?,?,?)
                    """,pieces,128,(stmt,p)->{
                    stmt.setString(1,work.id()); stmt.setString(2,p.key()); stmt.setString(3,p.origin());
                    stmt.setObject(4,p.start(),Types.DOUBLE); stmt.setObject(5,p.end(),Types.DOUBLE);
                    stmt.setString(6,p.frame()); stmt.setString(7,p.heading()); stmt.setString(8,p.body());
                });
            });
        } catch(Exception e) {
            log.warn("视频资料索引失败 {} ({})",work.id(),e.getClass().getSimpleName());
            db.sql("""
                UPDATE videos SET library_state=?,library_attempts=library_attempts+1,
                    library_after=TIMESTAMPADD(SECOND,?,CURRENT_TIMESTAMP(3))
                WHERE id=? AND library_generation=? AND library_state='pending' AND library_attempts=?
                """).params(work.attempts()>=4?"error":"pending",5 << work.attempts(),work.id(),work.generation(),work.attempts()).update();
        }
    }

    static List<Piece> extract(JsonNode result,List<EvidenceCorpus.Passage> evidence) {
        var pieces=new LinkedHashMap<String,Piece>();
        var chapters=new ArrayList<Chapter>();
        for(var row:result.path("division")) {
            var time=row.path("time_range");
            var chapter=new Chapter(clock(time.path("start_time").asText()),clock(time.path("end_time").asText()),
                row.path("title").asText(),content(row.path("summary")));
            chapters.add(chapter);
            add(pieces,"chapter",chapter.start(),chapter.end(),null,chapter.title(),String.join("\n",chapter.title(),chapter.summary()).strip());
        }
        var chapterAt=new TreeMap<Double,Chapter>();
        for(var c:chapters) if(c.start()!=null) chapterAt.put(c.start(),c);
        for(var p:evidence) {
            var entry=chapterAt.floorEntry(p.start());
            var c=entry==null?null:entry.getValue();
            String heading=c!=null && (c.end()==null || p.start()<=c.end())?c.title():"";
            String frame=p.frame()!=null && p.frame().matches("[a-zA-Z0-9_-]{1,235}\\.png")?p.frame():null;
            add(pieces,p.source(),p.start(),p.end(),frame,heading,p.text());
        }
        add(pieces,"summary",null,null,null,"视频摘要",result.path("summary").asText());
        add(pieces,"summary",null,null,null,"要点",content(result.path("highlights")));
        boolean hasTranscript=evidence.stream().anyMatch(p -> p.source().equals("speech") || p.source().equals("frame_note"));
        String captionOrigin="visual".equals(result.path("transcript_source").asText())?"frame_note":"speech";
        for(var s:result.path("segments")) {
            var range=s.path("time_range").asText().split("\\s*-\\s*",2);
            var start=clock(range[0]);
            var end=range.length>1?clock(range[1]):start;
            String captions=s.path("captions").asText("").strip();
            if(!hasTranscript && !captions.equals("无语音内容"))
                add(pieces,captionOrigin,start,end,null,"片段字幕",captions);
            add(pieces,"notes",start,end,null,"AI 讲义",s.path("notes").path("content").asText());
        }
        var nodes=new ArrayList<String>();
        mindmap(result.path("mind_map").path("mind_map").path("data"),"",nodes);
        add(pieces,"mindmap",null,null,null,"思维导图",String.join("\n",nodes));
        return List.copyOf(pieces.values());
    }

    private static void mindmap(JsonNode node,String parent,List<String> out) {
        String name=node.path("name").asText("").strip();
        if(name.isEmpty()) return;
        String path=parent.isEmpty()?name:parent+" › "+name;
        if(node.path("children").isEmpty()) out.add(path);
        else for(var child:node.path("children")) mindmap(child,path,out);
    }

    private static String content(JsonNode value) {
        if(!value.isArray()) return value.asText("");
        var lines=new ArrayList<String>();
        for(var v:value) if(v.isTextual()) lines.add(v.asText());
        return String.join("\n",lines);
    }

    private static Double clock(String text) {
        if(!text.matches("\\d+(?::\\d+){0,2}(?:\\.\\d+)?")) return null;
        double time=0;
        for(String part:text.split(":")) time=time*60+Double.parseDouble(part);
        return Double.isFinite(time)?time:null;
    }

    private static void add(Map<String,Piece> out,String origin,Double start,Double end,String frame,String heading,String body) {
        body=body.strip();
        if(body.isEmpty()) return;
        if(start==null || !Double.isFinite(start) || start<0) start=null;
        if(start==null || end==null || !Double.isFinite(end) || end<start) end=start;
        heading=heading.substring(0,heading.offsetByCodePoints(0,Math.min(500,heading.codePointCount(0,heading.length()))));
        for(int offset=0;offset<body.length();) {
            int limit=Math.min(offset+1100,body.length());
            if(limit<body.length() && Character.isHighSurrogate(body.charAt(limit-1))) limit--;
            String text=body.substring(offset,limit);
            offset=limit;
            String anchor=origin+"\n"+start+"\n"+end+"\n"+text;
            String key;
            try { key=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(anchor.getBytes(StandardCharsets.UTF_8))); }
            catch(NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
            out.putIfAbsent(key,new Piece(key,origin,start,end,frame,heading,text));
        }
    }
}
