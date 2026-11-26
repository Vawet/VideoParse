package org.videoparse;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
class LibrarySearch {
    record Hit(String docId,String videoId,String name,int ordinal,String passageKey,String origin,
               String heading,int firstLine,int lastLine,Double start,Double end,String frame,String body) {
        static Hit document(DocumentSearch.Passage p) {
            return new Hit(p.docId(),null,p.name(),p.ordinal(),null,"document",p.heading(),
                p.firstLine(),p.lastLine(),null,null,null,p.body());
        }
        String label() {
            String type=switch(origin) {
                case "document" -> "文档原文"; case "ocr" -> "画面文字"; case "speech" -> "字幕";
                case "frame_note" -> "AI 画面描述"; case "mindmap" -> "AI 思维导图";
                case "notes" -> "AI 讲义"; case "chapter" -> "AI 章节概述"; default -> "AI 摘要";
            };
            return name+" · "+type+(heading.isBlank()?"":" · "+heading);
        }
    }
    record Result(List<Hit> hits,boolean usedVectors) {}
    private static final String VIDEO_ROWS="""
        SELECT NULL AS doc_id,v.id AS video_id,v.title AS name,0 AS ordinal,p.passage_key,p.origin,
               p.heading,0 AS first_line,0 AS last_line,p.start_sec AS start,p.end_sec AS end,p.frame_name AS frame,p.body
        FROM vp_video_passage p JOIN videos v ON v.id=p.video_id
        WHERE v.owner_id=:owner AND v.folder_id='videos' AND v.library_state IN ('ready','derived')
        """;
    private static final Pattern DERIVED=Pattern.compile("摘要|讲义|笔记|概述|概览|脑图|导图|章节|总结|概括|讲了什么|主要内容|要点|关键概念|适合.*复习|summary|overview",Pattern.CASE_INSENSITIVE);
    private final JdbcClient db;
    private final DocumentSearch docs;
    LibrarySearch(JdbcClient db,DocumentSearch docs) { this.db=db; this.docs=docs; }

    void requireVideo(String owner,String video) {
        if(db.sql("SELECT 1 FROM videos WHERE owner_id=? AND id=? AND folder_id='videos'")
                .params(owner,video).query(Integer.class).optional().isEmpty())
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"视频已移出资料库或不存在");
    }

    Hit requireHit(String owner,String video,String key) {
        return db.sql(VIDEO_ROWS+" AND v.id=:video AND p.passage_key=:key")
            .param("owner",owner).param("video",video).param("key",key).query(Hit.class).optional()
            .orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"该视频出处已更新或移出资料库"));
    }

    Result search(String owner,String kind,String id,String question,boolean mixedLibrary) {
        var candidates=new ArrayList<Hit>();
        boolean usedVectors=false;
        boolean overview=mixedLibrary && DERIVED.matcher(question).find();
        if(!kind.equals("video")) {
            var result=docs.search(owner,id,question);
            usedVectors=result.usedVectors();
            var documents=result.hits();
            if(documents.isEmpty() && (id!=null || overview)) documents=docs.opening(owner,id);
            documents.stream().map(Hit::document).forEach(candidates::add);
        }
        if(kind.equals("document")) return new Result(candidates,usedVectors);
        String scope=VIDEO_ROWS+(id==null?"":" AND v.id=:video");
        if(!overview) scope+=" AND (v.library_state='derived' OR p.origin IN ('speech','ocr'))";
        String match="MATCH(p.heading,p.body) AGAINST(:q IN NATURAL LANGUAGE MODE)";
        var query=db.sql(scope+" AND "+match+" ORDER BY "+match+" DESC,p.video_id,p.start_sec,p.passage_key LIMIT 18")
            .param("owner",owner).param("q",question);
        if(id!=null) query.param("video",id);
        var videos=query.query(Hit.class).list();
        if(videos.isEmpty() && !overview) videos=primaryEvidenceFromNotes(owner,id,question);
        if(videos.isEmpty() && overview) {
            var opening=db.sql(scope+" ORDER BY (p.origin='summary') DESC,v.created_at DESC,v.id,p.start_sec,p.passage_key LIMIT 6")
                .param("owner",owner);
            if(id!=null) opening.param("video",id);
            videos=opening.query(Hit.class).list();
        }
        if(videos.isEmpty()) return new Result(candidates,usedVectors);
        candidates.addAll(videos);
        // Re-rank the bounded candidate pool with common term statistics.
        var passages=new ArrayList<EvidenceCorpus.Passage>();
        for(var h:candidates) passages.add(new EvidenceCorpus.Passage(passages.size(),h.origin(),0,0,
                h.name()+" "+h.heading()+" "+h.body(),""));
        var order=new LinkedHashSet<>(new EvidenceCorpus.Index(passages).lexical(question));
        for(int i=0;i<candidates.size();i++) order.add(i);
        var selected=new ArrayList<Hit>();
        var seen=new HashMap<String,Integer>();
        for(int i:order) {
            var hit=candidates.get(i);
            String source=hit.videoId()!=null?"v/"+hit.videoId():"d/"+hit.docId();
            boolean duplicate=hit.videoId()!=null && selected.stream().anyMatch(prior ->
                hit.videoId().equals(prior.videoId()) && hit.origin().equals(prior.origin()) &&
                hit.start()!=null && prior.start()!=null && hit.start()<=prior.end() && prior.start()<=hit.end() &&
                (prior.body().contains(hit.body()) || hit.body().contains(prior.body())));
            if(duplicate || (id==null && seen.merge(source,1,Integer::sum)>3)) continue;
            selected.add(hit);
            if(selected.size()==6) break;
        }
        return new Result(selected,usedVectors);
    }

    // A term in a generated note can point to primary evidence from the same interval.
    private List<Hit> primaryEvidenceFromNotes(String owner,String video,String question) {
        String match="MATCH(p.heading,p.body) AGAINST(:q IN NATURAL LANGUAGE MODE)";
        var hints=db.sql(VIDEO_ROWS+(video==null?"":" AND v.id=:video")+
            " AND v.library_state='ready' AND p.origin IN ('chapter','notes') AND p.start_sec IS NOT NULL AND "+
            match+" ORDER BY "+match+" DESC,v.id,p.start_sec LIMIT 3").param("owner",owner).param("q",question);
        if(video!=null) hints.param("video",video);
        var passages=new LinkedHashSet<Hit>();
        for(var hint:hints.query(Hit.class).list()) {
            passages.addAll(db.sql(VIDEO_ROWS+"""
                 AND v.id=:video AND p.origin IN ('speech','ocr') AND p.start_sec<=:last AND p.end_sec>=:first
                 ORDER BY p.start_sec,p.passage_key LIMIT 2
                """).param("owner",owner).param("video",hint.videoId()).param("first",hint.start())
                .param("last",hint.end()).query(Hit.class).list());
        }
        return List.copyOf(passages);
    }

    static List<DocumentAskController.Claim> verify(JsonNode raw,List<Hit> hits) {
        var verified=new ArrayList<DocumentAskController.Claim>();
        for(var c:CitedClaim.verify(raw,id->id>0 && id<=hits.size()?hits.get(id-1).body():null,4)) {
            var hit=hits.get(c.id()-1);
            int first=0,last=0;
            if(hit.docId()!=null) {
                first=hit.firstLine()+(int)hit.body().substring(0,c.offset()).chars().filter(ch->ch=='\n').count();
                last=first+(int)c.quote().chars().filter(ch->ch=='\n').count();
            }
            verified.add(new DocumentAskController.Claim(c.id(),c.answer(),c.quote(),first,last));
        }
        return verified;
    }
}
