package org.videoparse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/v2/documents/interview")
class DocumentInterviewController {
    record Next(String documentId,String previousId) {}
    record Attempt(int revision,String answer,boolean supplement) {}
    record Candidate(String doc,int ordinal,String heading,String body,String exercise) {}
    record Exercise(String id,String doc,String name,int firstLine,int lastLine,String question,String points,
                    int revision,String answer,String feedback) {}
    private final Visitor visitor;
    private final DocumentLibrary library;
    private final JdbcClient db;
    private final StudyTools tools;
    private final ObjectMapper json;
    DocumentInterviewController(Visitor visitor,DocumentLibrary library,JdbcClient db,StudyTools tools,ObjectMapper json) {
        this.visitor=visitor; this.library=library; this.db=db; this.tools=tools; this.json=json;
    }

    private JsonNode model(Map<String,?> params) throws InterruptedException {
        var res=tools.invoke("document_interview",params);
        if (!res.getStatusCode().is2xxSuccessful() || res.getBody()==null)
            throw new ResponseStatusException(res.getStatusCode().is2xxSuccessful()?HttpStatus.BAD_GATEWAY:res.getStatusCode(),
                res.getBody()==null?"面试模型暂不可用":res.getBody().path("error").asText("评分失败"));
        return res.getBody();
    }

    private Exercise require(String id) {
        return db.sql("""
            SELECT i.id,d.id AS doc,d.name,c.first_line,c.last_line,i.question,i.points,i.revision,i.answer,i.feedback
            FROM vp_doc_interview i JOIN vp_document d ON d.id=i.doc_id
            JOIN vp_doc_chunk c ON c.doc_id=i.doc_id AND c.ordinal_no=i.ordinal_no
            WHERE d.owner_id=? AND i.id=? AND i.question<>''
            """).params(visitor.id(),id).query(Exercise.class).optional().orElseThrow(
                ()->new ResponseStatusException(HttpStatus.NOT_FOUND,"面试题不存在"));
    }

    private Map<String,Object> view(Exercise e, boolean showFeedback) throws Exception {
        var question=new LinkedHashMap<String,Object>();
        question.put("id",e.id()); question.put("question",e.question()); question.put("revision",e.revision());
        question.put("doc",e.doc()); question.put("name",e.name());
        question.put("firstLine",e.firstLine()); question.put("lastLine",e.lastLine());
        if (showFeedback && e.feedback()!=null) {
            question.put("answer",e.answer()); question.put("feedback",json.readTree(e.feedback()));
        }
        return Map.of("success",true,"exercise",question);
    }

    @GetMapping("/current")
    Map<String,Object> current(@RequestParam(required=false) String documentId) throws Exception {
        if (documentId!=null) library.require(documentId);
        var args=new ArrayList<Object>(); args.add(visitor.id());
        if (documentId!=null) args.add(documentId);
        var id=db.sql("""
            SELECT i.id FROM vp_doc_interview i JOIN vp_document d ON d.id=i.doc_id
            WHERE d.owner_id=? AND i.question<>''
            """+(documentId==null?"":" AND d.id=?")+" ORDER BY i.practiced_at DESC,i.id LIMIT 1")
            .params(args).query(String.class).optional();
        return id.isEmpty()? Map.of("success",true) : view(require(id.get()),true);
    }

    @PostMapping("/next")
    Map<String,Object> next(@RequestBody Next request) throws Exception {
        String owner=visitor.id();
        if (request.documentId()!=null) library.require(request.documentId());
        var args=new ArrayList<Object>(); args.add(owner);
        if (request.documentId()!=null) args.add(request.documentId());
        args.add(Objects.toString(request.previousId(),""));
        var candidates=db.sql("""
            SELECT c.doc_id AS doc,c.ordinal_no AS ordinal,c.heading,c.body,i.id AS exercise
            FROM vp_document d JOIN vp_doc_chunk c ON c.doc_id=d.id
            LEFT JOIN vp_doc_interview i ON i.doc_id=c.doc_id AND i.ordinal_no=c.ordinal_no
            WHERE d.owner_id=? AND (i.id IS NULL OR i.question<>'')
              AND CHAR_LENGTH(TRIM(c.body))>=6
              AND NOT (TRIM(c.body) REGEXP '^#{1,6}[[:blank:]]+[^\n]*$')
            """+(request.documentId()==null?"":" AND d.id=?")+"""
             ORDER BY CASE WHEN i.id=? THEN 2 WHEN i.id IS NULL THEN 0 ELSE 1 END,
                      i.practiced_at,d.created_at,d.id,c.ordinal_no LIMIT 3
            """).params(args).query(Candidate.class).list();
        for (var c:candidates) {
            String id=c.exercise();
            if (id==null) {
                var generated=model(Map.of("heading",c.heading(),"body",c.body())).path("exercise");
                String prompt=generated.path("question").asText("");
                String proposed=DocumentLibrary.id();
                // Document content is immutable. Keep one rubric per passage, including passages with no answer.
                db.sql("""
                    INSERT INTO vp_doc_interview(id,doc_id,ordinal_no,question,points)
                    SELECT ?,d.id,?,?,? FROM vp_document d WHERE d.id=? AND d.owner_id=?
                    ON DUPLICATE KEY UPDATE id=vp_doc_interview.id
                    """).params(proposed,c.ordinal(),prompt,prompt.isEmpty()?"[]":generated.path("points").toString(),
                                c.doc(),owner).update();
                id=db.sql("""
                    SELECT i.id FROM vp_doc_interview i JOIN vp_document d ON d.id=i.doc_id
                    WHERE d.owner_id=? AND i.doc_id=? AND i.ordinal_no=? AND i.question<>''
                    """).params(owner,c.doc(),c.ordinal()).query(String.class).optional().orElse(null);
                if (id==null) continue;
            }
            db.sql("UPDATE vp_doc_interview SET practiced_at=UTC_TIMESTAMP(3) WHERE id=?").param(id).update();
            return view(require(id),false);
        }
        throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,candidates.isEmpty()
            ?"当前范围没有含答案依据的片段，请添加包含解答的笔记。":"本批片段没有答案依据，可继续查找下一批。");
    }

    @PostMapping("/{id}/answer")
    Map<String,Object> grade(@PathVariable String id,@RequestBody Attempt attempt) throws Exception {
        var e=require(id);
        if (e.revision()!=attempt.revision()) throw stale();
        if (attempt.answer()==null || attempt.answer().isBlank())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"请先写下回答");
        String answer=attempt.answer().strip();
        if (attempt.supplement() && e.answer()!=null) answer=e.answer()+"\n"+answer;
        if (answer.length()>6000) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"完整回答最多 6000 字");
        var feedback=model(Map.of("question",e.question(),"points",json.readTree(e.points()),"answer",answer));
        if (db.sql("""
            UPDATE vp_doc_interview i JOIN vp_document d ON d.id=i.doc_id
            SET i.answer=?,i.feedback=?,i.revision=i.revision+1,i.practiced_at=UTC_TIMESTAMP(3)
            WHERE i.id=? AND i.revision=? AND d.owner_id=?
            """).params(answer,feedback.toString(),id,e.revision(),visitor.id()).update()!=1) throw stale();
        return view(require(id),true);
    }

    private static ResponseStatusException stale() {
        return new ResponseStatusException(HttpStatus.CONFLICT,"本题已有新的回答，请刷新后继续");
    }
}
