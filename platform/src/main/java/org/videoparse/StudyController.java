package org.videoparse;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
class StudyController {
    private final StudyTools tools;
    StudyController(StudyTools tools){this.tools=tools;}
    @PostMapping("/chat") ResponseEntity<JsonNode> chat(@RequestBody Map<String,Object> b) throws Exception{return tools.invoke("chat",b);}
    @PostMapping("/verify") ResponseEntity<JsonNode> verify(@RequestBody Map<String,Object> b) throws Exception{return tools.invoke("verify",b);}
    @GetMapping("/keywords/{id}") ResponseEntity<JsonNode> keywords(@PathVariable String id,@RequestParam Map<String,String> q) throws Exception{return tools.invoke("get_keywords",q,id);}
    @PostMapping("/quiz/generate") ResponseEntity<JsonNode> generate(@RequestBody Map<String,Object> b) throws Exception{return tools.invoke("quiz_generate",b);}
    @GetMapping("/quiz/{id}") ResponseEntity<JsonNode> quiz(@PathVariable String id) throws Exception{return tools.invoke("quiz_get",Map.of(),id);}
    @PostMapping("/quiz/{id}/answer") ResponseEntity<JsonNode> grade(@PathVariable String id,@RequestBody Map<String,Object> b) throws Exception{return tools.invoke("quiz_answer",b,id);}
    @GetMapping("/review/weak") ResponseEntity<JsonNode> weak(@RequestParam Map<String,String> q) throws Exception{return tools.invoke("review_weak",q);}
    @PostMapping("/review/plan") ResponseEntity<JsonNode> plan(@RequestBody Map<String,Object> b) throws Exception{return tools.invoke("review_plan",b);}
    @PostMapping("/review/done") ResponseEntity<JsonNode> done(@RequestBody Map<String,Object> b) throws Exception{return tools.invoke("review_done",b);}
    @PostMapping("/teach/plan") ResponseEntity<JsonNode> teach(@RequestBody Map<String,Object> b) throws Exception{return tools.invoke("teach_plan",b);}
    @GetMapping("/teach/plan/{id}") ResponseEntity<JsonNode> lesson(@PathVariable String id) throws Exception{return tools.invoke("teach_plan_get",Map.of(),id);}
    @PostMapping("/teach/plan/{id}/revise") ResponseEntity<JsonNode> revise(@PathVariable String id,@RequestBody Map<String,Object> b) throws Exception{return tools.invoke("teach_plan_revise",b,id);}
}
