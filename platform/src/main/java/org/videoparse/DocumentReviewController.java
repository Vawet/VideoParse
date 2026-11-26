package org.videoparse;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/v2")
class DocumentReviewController {
    private final JdbcClient db;
    private final Visitor visitor;
    private final LibrarySearch search;
    DocumentReviewController(JdbcClient db,Visitor visitor,LibrarySearch search) {
        this.db=db; this.visitor=visitor; this.search=search;
    }

    record Add(String question,String quote) {}
    record Rating(Integer revision,String rating) {}
    record Card(String id,String docId,String videoId,String passageKey,String origin,String name,
                Double start,Double end,boolean available,int firstLine,int lastLine,String body,
                String question,int revision,long dueEpoch,int dueCount,int total) {}
    record Queue(boolean success,Card next) {}
    private static final String SOURCES="""
        FROM vp_doc_review r LEFT JOIN vp_document d ON d.id=r.doc_id
        LEFT JOIN videos v ON v.id=r.video_id AND v.folder_id='videos'
        """;
    private static final String VISIBLE=" (d.owner_id=:owner OR v.owner_id=:owner) ";

    @GetMapping("/documents/review")
    Queue documents(@RequestParam(required=false) String documentId) { return queue(documentId,true); }
    @GetMapping("/library/review")
    Queue library(@RequestParam(required=false) String documentId) { return queue(documentId,false); }

    private Queue queue(String doc,boolean documentsOnly) {
        String query="""
            SELECT r.id,r.doc_id,r.video_id,r.passage_key,COALESCE(p.origin,'document') AS origin,
                COALESCE(d.name,v.title) AS name,p.start_sec AS start,p.end_sec AS end,
                (d.id IS NOT NULL OR p.passage_key IS NOT NULL) AS available,
                COALESCE(r.quote_first_line,c.first_line,0) AS first_line,COALESCE(r.quote_last_line,c.last_line,0) AS last_line,
                COALESCE(r.saved_quote,c.body,'') AS body,r.question,r.revision,
                UNIX_TIMESTAMP(r.due_at) AS due_epoch,
                q.due_count,q.total FROM (
                SELECT r.id,SUM(r.due_at<=CURRENT_TIMESTAMP(3)) OVER () AS due_count,COUNT(*) OVER () AS total
            """+SOURCES+" WHERE "+VISIBLE+(documentsOnly?" AND r.doc_id IS NOT NULL":"")+
            (doc==null?"":" AND r.doc_id=:doc")+"""
                ORDER BY r.due_at,r.id LIMIT 1
            ) q JOIN vp_doc_review r ON r.id=q.id
            LEFT JOIN vp_document d ON d.id=r.doc_id
            LEFT JOIN videos v ON v.id=r.video_id
            LEFT JOIN vp_doc_chunk c ON c.doc_id=r.doc_id AND c.ordinal_no=r.ordinal_no
            LEFT JOIN vp_video_passage p ON p.video_id=v.id AND p.passage_key=r.passage_key
                  AND v.library_state IN ('ready','derived')
            """;
        var statement=db.sql(query).param("owner",visitor.id());
        if(doc!=null) statement.param("doc",doc);
        return new Queue(true,statement.query(Card.class).optional().orElse(null));
    }

    private static void validate(Add body) {
        if(body.question()==null || body.question().isBlank() || body.question().length()>1000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"复习问题需要 1 至 1000 字");
    }
    private static String quote(Add request,String current) {
        if(request.quote()==null) return current;
        if(request.quote().isBlank() || !current.contains(request.quote()))
            throw new ResponseStatusException(HttpStatus.CONFLICT,"出处已更新，请重新打开");
        return request.quote();
    }

    @PostMapping("/documents/{doc}/chunks/{ordinal}/review")
    Map<String,Object> add(@PathVariable String doc,@PathVariable int ordinal,@RequestBody Add body) {
        validate(body);
        record Chunk(int firstLine,String body) {}
        var chunk=db.sql("""
            SELECT c.first_line,c.body FROM vp_doc_chunk c JOIN vp_document d ON d.id=c.doc_id
            WHERE d.owner_id=? AND c.doc_id=? AND c.ordinal_no=?
            """).params(visitor.id(),doc,ordinal).query(Chunk.class).optional().orElseThrow(DocumentLibrary::missing);
        String saved=quote(body,chunk.body());
        int first=chunk.firstLine()+(int)chunk.body().substring(0,chunk.body().indexOf(saved)).chars().filter(c->c=='\n').count();
        int last=first+(int)saved.chars().filter(c->c=='\n').count();
        db.sql("""
            INSERT INTO vp_doc_review(id,doc_id,ordinal_no,question,saved_quote,quote_first_line,quote_last_line) VALUES(?,?,?,?,?,?,?)
            ON DUPLICATE KEY UPDATE id=id
            """).params(DocumentLibrary.id(),doc,ordinal,body.question().strip(),saved,first,last).update();
        return Map.of("success",true);
    }

    @PostMapping("/library/videos/{video}/passages/{key}/review")
    @Transactional
    public Map<String,Object> addVideo(@PathVariable String video,@PathVariable String key,@RequestBody Add body) {
        validate(body);
        var hit=search.requireHit(visitor.id(),video,key);
        db.sql("""
            INSERT INTO vp_doc_review(id,video_id,passage_key,ordinal_no,question,saved_quote) VALUES(?,?,?,0,?,?)
            ON DUPLICATE KEY UPDATE id=id
            """).params(DocumentLibrary.id(),video,key,body.question().strip(),quote(body,hit.body())).update();
        return Map.of("success",true);
    }

    private static final int[] RECALL_DAYS={1,3,7,14,30};
    record Progress(int revision,int streak,boolean due) {}
    @Transactional
    @PostMapping({"/documents/review/{id}/rate","/library/review/{id}/rate"})
    public Map<String,Object> rate(@PathVariable String id,@RequestBody Rating body) {
        if(body.revision()==null || body.revision()<0 ||
                !("again".equals(body.rating()) || "remembered".equals(body.rating())))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"复习反馈无效");
        var progress=db.sql("SELECT r.revision,r.streak,r.due_at<=CURRENT_TIMESTAMP(3) AS due "+
                SOURCES+" WHERE r.id=:id AND "+VISIBLE+" FOR UPDATE")
            .param("owner",visitor.id()).param("id",id).query(Progress.class).optional().orElseThrow(DocumentLibrary::missing);
        if(progress.revision()!=body.revision() || !progress.due())
            throw new ResponseStatusException(HttpStatus.CONFLICT,"这张卡片的复习时间已更新");
        int streak="remembered".equals(body.rating())?Math.min(progress.streak()+1,RECALL_DAYS.length):0;
        int minutes=streak==0?10:1440*RECALL_DAYS[streak-1];
        db.sql("UPDATE vp_doc_review SET due_at=TIMESTAMPADD(MINUTE,?,CURRENT_TIMESTAMP(3)),streak=?,revision=revision+1 WHERE id=?")
            .params(minutes,streak,id).update();
        return Map.of("success",true);
    }
    @DeleteMapping({"/documents/review/{id}","/library/review/{id}"})
    Map<String,Object> remove(@PathVariable String id) {
        db.sql("DELETE r "+SOURCES+" WHERE r.id=:id AND "+VISIBLE)
            .param("owner",visitor.id()).param("id",id).update();
        return Map.of("success",true);
    }
}
