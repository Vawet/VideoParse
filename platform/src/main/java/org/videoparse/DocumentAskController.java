package org.videoparse;

import java.util.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/v2/documents")
class DocumentAskController {
    private final DocumentLibrary library;
    private final DocumentSearch search;
    private final StudyTools tools;
    private final Visitor visitor;
    DocumentAskController(DocumentLibrary library,DocumentSearch search,StudyTools tools,Visitor visitor) {
        this.library=library; this.search=search; this.tools=tools; this.visitor=visitor;
    }
    record Ask(String question,String documentId,boolean documentsOnly) {}
    @PostMapping("/ask") ResponseEntity<?> ask(@RequestBody Ask body) throws Exception {
        String owner=visitor.id(),doc=body.documentId(),q=body.question();
        if (q==null || q.isBlank() || q.length()>1000) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"请输入 1 至 1000 字的问题");
        if (doc!=null) library.require(doc);
        if (!body.documentsOnly()) {
            var route=tools.invoke("search_if_requested",Map.of("question",q));
            if (!route.getStatusCode().is2xxSuccessful() || route.getBody()==null || "web".equals(route.getBody().path("source").asText())) return route;
        }
        var results=search.search(owner,doc,q);
        var hits=results.hits();
        String answer=hits.isEmpty()?"文档中未找到相关依据。":hits.getFirst().body()+" [1]";
        boolean generated=false;
        if (!hits.isEmpty()) {
            var result=tools.invoke("document_answer",Map.of("question",q,"excerpts",hits.stream().map(DocumentSearch.Passage::body).toList()));
            var text=new StringJoiner("\n");
            if (result.getBody()!=null) for(var claim:result.getBody().path("claims"))
                text.add(claim.path("answer").asText()+" ["+claim.path("id").asInt()+"]");
            if (text.length()>0) { answer=text.toString(); generated=true; }
        }
        return ResponseEntity.ok(Map.of("success",true,"source","document","answer",answer,
            "generated",generated,"hits",hits,"used_vectors",results.usedVectors()));
    }
}
