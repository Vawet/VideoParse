package org.videoparse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.springframework.http.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
class Conversations {
    private final JdbcClient db;
    private final StudyTools tools;
    private final Visitor visitor;
    private final ObjectMapper json;

    Conversations(JdbcClient db, StudyTools tools, Visitor visitor, ObjectMapper json) {
        this.db=db; this.tools=tools; this.visitor=visitor; this.json=json;
    }

    record Snapshot(int revision, String history) {}

    ResponseEntity<JsonNode> ask(Map<String,Object> body) throws Exception {
        String type = body.get("course_id") instanceof String c && !c.isBlank() ? "course" : "video";
        if (!(body.get(type+"_id") instanceof String scope) || scope.isBlank())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"缺少视频或课程编号");
        if (type.equals("course")) visitor.course(scope); else visitor.video(scope);
        if (!(body.get("question") instanceof String question) || question.isBlank() || question.length()>8000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"请输入 1 至 8000 字的问题");

        String owner=visitor.id();
        var thread=open(owner,type,scope,body.get("conversation_id"));
        var history=thread.history();
        var params=Map.of(type+"_id",scope,"question",question,"client_id",owner,"history",history);
        var response=tools.chat(params,visitor.workerToken());
        var reply=response.getBody();
        if (reply==null || !reply.path("success").asBoolean()) return response;

        var next=append(thread,question,reply.path("answer").asText());
        var result=(com.fasterxml.jackson.databind.node.ObjectNode)reply;
        result.put("conversation_id",thread.id());
        result.set("history",next);
        return response;
    }

    record ThreadState(String id,String owner,String type,String scope,int revision,JsonNode history) {}

    ThreadState open(String owner,String type,String scope,Object requestedId) throws Exception {
        String id=UUID.randomUUID().toString().replace("-","");
        var snapshot=new Snapshot(0,"[]");
        if (requestedId != null) {
            if (!(requestedId instanceof String requested) || !requested.matches("[a-f0-9]{32}"))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"无效的对话编号");
            id=requested;
            snapshot=db.sql("""
                SELECT revision,CAST(history AS CHAR CHARACTER SET utf8mb4) AS history FROM vp_conversation
                WHERE id=? AND owner_id=? AND scope_type=? AND scope_id=?
                """).params(id,owner,type,scope).query(Snapshot.class).optional()
                .orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"对话不存在"));
        }
        return new ThreadState(id,owner,type,scope,snapshot.revision(),json.readTree(snapshot.history()));
    }

    JsonNode append(ThreadState thread,String question,String answer) {
        var history=thread.history();
        var next=json.createArrayNode();
        for (int i=Math.max(0,history.size()-14); i<history.size(); i++) next.add(history.get(i));
        next.addObject().put("role","user").put("content",question);
        next.addObject().put("role","assistant").put("content",answer);
        if (thread.revision()==0) {
            db.sql("INSERT INTO vp_conversation(id,owner_id,scope_type,scope_id,revision,history) VALUES(?,?,?,?,1,?)")
                .params(thread.id(),thread.owner(),thread.type(),thread.scope(),next.toString()).update();
        } else if (db.sql("UPDATE vp_conversation SET history=?,revision=revision+1 WHERE id=? AND revision=? AND owner_id=?")
                    .params(next.toString(),thread.id(),thread.revision(),thread.owner()).update()!=1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,"对话已有新回复，请重新发送");
        }
        return next;
    }
}
