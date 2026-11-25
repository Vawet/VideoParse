package org.videoparse;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import java.util.HashMap;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
class StudyController {
    private final StudyTools tools;
    private final Visitor visitor;
    private final Conversations conversations;

    StudyController(StudyTools tools, Visitor visitor, Conversations conversations) {
        this.tools=tools; this.visitor=visitor; this.conversations=conversations;
    }
    private Map<String,Object> personal(Map<String,?> body) {
        var params=new HashMap<String,Object>(body);
        params.put("client_id",visitor.id());
        return params;
    }
    private String identifier(Map<String,?> body,String name) {
        if (body.get(name) instanceof String value && !value.isBlank()) return value;
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"缺少 "+name);
    }

    @PostMapping("/chat") ResponseEntity<JsonNode> chat(@RequestBody Map<String,Object> b) throws Exception {
        return conversations.ask(b);
    }
    @PostMapping("/v2/demo/ask") ResponseEntity<?> demo(@RequestBody Map<String,String> b) throws Exception {
        visitor.id();
        String question=b.get("question");
        if (question==null || question.isBlank() || question.length()>8000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"请输入 1 至 8000 字的问题");
        var route=tools.invoke("search_if_requested",Map.of("question",question));
        if (route.getBody()!=null && "local".equals(route.getBody().path("source").asText()))
            return ResponseEntity.ok(Map.of("success",true,"source","demo"));
        return route;
    }
    @PostMapping("/verify") ResponseEntity<JsonNode> verify(@RequestBody Map<String,Object> b) throws Exception {
        visitor.video(identifier(b,"video_id")); return tools.invoke("verify",b);
    }
    @GetMapping("/keywords/{id}") ResponseEntity<JsonNode> keywords(@PathVariable String id,@RequestParam Map<String,String> q) throws Exception {
        visitor.video(id); return tools.invoke("get_keywords",q,id);
    }
    @PostMapping("/quiz/generate") ResponseEntity<JsonNode> generate(@RequestBody Map<String,Object> b) throws Exception {
        visitor.video(identifier(b,"video_id")); return tools.invoke("quiz_generate",b);
    }
    @GetMapping("/quiz/{id}") ResponseEntity<JsonNode> quiz(@PathVariable String id) throws Exception {
        visitor.quiz(id); return tools.invoke("quiz_get",Map.of(),id);
    }
    @PostMapping("/quiz/{id}/answer") ResponseEntity<JsonNode> grade(@PathVariable String id,@RequestBody Map<String,Object> b) throws Exception {
        visitor.quiz(id); return tools.invoke("quiz_answer",personal(b),id);
    }
    @GetMapping("/review/weak") ResponseEntity<JsonNode> weak(@RequestParam Map<String,String> q) throws Exception {
        if (q.containsKey("video_id")) visitor.video(identifier(q,"video_id"));
        if (q.containsKey("course_id")) visitor.course(identifier(q,"course_id"));
        return tools.invoke("review_weak",personal(q));
    }
    @PostMapping("/review/plan") ResponseEntity<JsonNode> plan(@RequestBody Map<String,Object> b) throws Exception {
        visitor.course(identifier(b,"course_id")); return tools.invoke("review_plan",personal(b));
    }
    @PostMapping("/review/done") ResponseEntity<JsonNode> done(@RequestBody Map<String,Object> b) throws Exception {
        visitor.course(identifier(b,"course_id")); return tools.invoke("review_done",personal(b));
    }
    @PostMapping("/teach/plan") ResponseEntity<JsonNode> teach(@RequestBody Map<String,Object> b) throws Exception {
        visitor.course(identifier(b,"course_id")); return tools.invoke("teach_plan",b);
    }
    @GetMapping("/teach/plan/{id}") ResponseEntity<JsonNode> lesson(@PathVariable String id) throws Exception {
        visitor.plan(id); return tools.invoke("teach_plan_get",Map.of(),id);
    }
    @PostMapping("/teach/plan/{id}/revise") ResponseEntity<JsonNode> revise(@PathVariable String id,@RequestBody Map<String,Object> b) throws Exception {
        visitor.plan(id); return tools.invoke("teach_plan_revise",b,id);
    }
}
