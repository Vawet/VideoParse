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
    record Claim(int id, String answer, String quote, int firstLine, int lastLine) {}
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
        List<Claim> claims = hits.isEmpty() ? List.of() : generate(q, hits);
        if (!claims.isEmpty()) {
            var text = new StringJoiner("\n");
            for (var claim : claims) text.add(claim.answer() + " [" + claim.id() + "]");
            answer = text.toString();
        }
        return ResponseEntity.ok(Map.of("success",true,"source","document","answer",answer,
            "generated",!claims.isEmpty(),"claims",claims,"hits",hits,"used_vectors",results.usedVectors()));
    }

    private List<Claim> generate(String question, List<DocumentSearch.Passage> hits) throws InterruptedException {
        try {
            var result = tools.invoke("document_answer", Map.of("question", question,
                "excerpts", hits.stream().map(DocumentSearch.Passage::body).toList()));
            var body = result.getBody();
            if (!result.getStatusCode().is2xxSuccessful() || body == null || !body.path("claims").isArray())
                return List.of();
            var verified = new ArrayList<Claim>();
            for (var claim : body.path("claims")) {
                var id = claim.path("id");
                var text = claim.path("answer");
                if (!id.isIntegralNumber() || !id.canConvertToInt() || id.intValue() < 1 || id.intValue() > hits.size()
                        || !text.isTextual() || text.textValue().isBlank()) continue;
                var quoted = claim.path("quote");
                if (!quoted.isTextual()) continue;
                String quote = quoted.textValue().strip();
                if (quote.codePointCount(0, quote.length()) < 4) continue;
                var hit = hits.get(id.intValue() - 1);
                int offset = hit.body().indexOf(quote);
                if (offset < 0) continue;
                int first = hit.firstLine() + newlines(hit.body().substring(0, offset));
                verified.add(new Claim(id.intValue(), text.textValue().strip(), quote, first, first + newlines(quote)));
                if (verified.size() == 4) break;
            }
            return verified;
        } catch (ResponseStatusException ex) {
            // The evidence was already retrieved. A busy or unavailable synthesis worker is optional.
            if (ex.getStatusCode().value() == 429 || ex.getStatusCode().is5xxServerError()) return List.of();
            throw ex;
        }
    }

    private static int newlines(String text) {
        return (int) text.chars().filter(c -> c == '\n').count();
    }
}
