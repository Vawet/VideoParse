package org.videoparse;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.OutputStream;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/v2/documents")
class DocumentChatController {
    private static final Logger log = LoggerFactory.getLogger(DocumentChatController.class);
    record Ask(String question, String documentId, boolean documentsOnly, String conversationId) {}
    private final Visitor visitor;
    private final DocumentLibrary library;
    private final DocumentSearch search;
    private final StudyTools tools;
    private final Conversations conversations;
    private final ObjectMapper json;

    DocumentChatController(Visitor visitor, DocumentLibrary library, DocumentSearch search, StudyTools tools,
                           Conversations conversations, ObjectMapper json) {
        this.visitor=visitor; this.library=library; this.search=search; this.tools=tools;
        this.conversations=conversations; this.json=json;
    }

    private record Events(ObjectMapper json, OutputStream out, long started) {
        void emit(String type, Object data) throws IOException {
            out.write(json.writeValueAsBytes(Map.of("type",type,"data",data)));
            out.write('\n');
            out.flush();
        }
        void step(String stage, String message) throws IOException {
            emit("step",Map.of("stage",stage,"message",message,"elapsedMs",(System.nanoTime()-started)/1_000_000));
        }
    }

    @PostMapping(value="/chat", produces="application/x-ndjson")
    void chat(@RequestBody Ask ask, HttpServletResponse response) throws Exception {
        String owner=visitor.id();
        if (ask.question()==null || ask.question().isBlank() || ask.question().length()>1000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"请输入 1 至 1000 字的问题");
        if (ask.documentId()!=null) library.require(ask.documentId());
        var thread=conversations.open(owner,ask.documentsOnly()?"doconly":"doc",
            Objects.requireNonNullElse(ask.documentId(),"all"),ask.conversationId());
        response.setContentType("application/x-ndjson;charset=UTF-8");
        response.setHeader("X-Accel-Buffering","no");
        var events=new Events(json,response.getOutputStream(),System.nanoTime());
        try {
            answer(ask,thread,events);
        } catch (ResponseStatusException e) {
            events.emit("error",Objects.requireNonNullElse(e.getReason(),"请求失败"));
        } catch (RuntimeException e) {
            log.warn("资料对话执行失败 ({})",e.getClass().getSimpleName());
            events.emit("error","资料问答暂时不可用，请重试。");
        }
    }

    private JsonNode invoke(String tool, Map<String,?> params) throws InterruptedException {
        var reply=tools.invoke(tool,params);
        var body=reply.getBody();
        if (!reply.getStatusCode().is2xxSuccessful() || body==null || !body.path("success").asBoolean())
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    body==null?"学习服务不可用":body.path("error").asText("学习服务不可用"));
        return body;
    }

    private void answer(Ask ask, Conversations.ThreadState thread, Events events) throws IOException,InterruptedException {
        String q=ask.question().strip();
        boolean strict=ask.documentsOnly(), web=false;
        events.step("scope",strict?"仅使用选定文档":"正在判断资料来源");
        if (!strict) {
            var route=invoke("document_route",Map.of("question",q));
            web=route.path("web").asBoolean();
            strict=route.path("strict").asBoolean();
        }
        List<DocumentSearch.Passage> hits=List.of();
        JsonNode sources=json.createArrayNode();
        List<String> excerpts=new ArrayList<>();
        if (web) {
            events.step("retrieve","正在搜索公开网页");
            sources=invoke("document_web_sources",Map.of("question",q)).path("sources");
            for (var source:sources) excerpts.add(source.path("snippet").asText());
            events.step("retrieve","找到 "+excerpts.size()+" 条网页摘要");
        } else {
            events.step("retrieve",ask.documentId()==null?"正在检索我的全部文档":"正在检索当前文档");
            var history=thread.history();
            String query=q;
            if (history.size()>=2 && q.matches("(?is).*(这个|那个|它|刚才|上面|上述|上一|详细点|再举|举个例|继续|展开|再解释|举例|第二点|第一点|elaborate|example|explain that).*"))
                query=history.get(history.size()-2).path("content").asText()+"\n"+q;
            var result=search.search(thread.owner(),ask.documentId(),query);
            hits=result.hits();
            events.step("retrieve",(result.usedVectors()?"全文与向量检索":"全文检索")+" · "+hits.size()+" 个段落");
            if (hits.isEmpty() && ask.documentId()!=null) {
                hits=search.opening(thread.owner(),ask.documentId());
                events.step("retrieve","补充读取文档开头 "+hits.size()+" 个段落");
            }
            excerpts=hits.stream().map(DocumentSearch.Passage::body).toList();
        }

        boolean supplement=!strict && !web;
        var model=json.createObjectNode();
        if (supplement || !excerpts.isEmpty()) {
            events.step("generate","正在请求回答生成服务");
            try {
                var output=invoke("document_answer",Map.of("question",q,"history",thread.history(),
                        "excerpts",excerpts,"allow_explanation",supplement));
                for (String field:List.of("claims","explanation","model","model_status"))
                    if (output.has(field)) model.set(field,output.get(field));
            } catch (ResponseStatusException e) { model.put("model_status","unavailable"); }
        }
        String status=model.path("model_status").asText("skipped");
        String modelName=model.path("model").asText();
        events.step("generate",switch(status) {
            case "completed" -> "模型已返回 · "+modelName;
            case "unconfigured" -> "尚未配置文本模型 API";
            case "skipped" -> "未找到可引用资料，跳过生成";
            case "invalid" -> "模型返回格式无效";
            default -> "模型服务暂不可用";
        });

        var claims=DocumentAskController.verify(model.path("claims"),hits);
        var lines=new ArrayList<String>();
        for (var c:claims) lines.add(c.answer()+" ["+c.id()+"]");
        if (web) {
            var quotes=excerpts;
            for (var c:CitedClaim.verify(model.path("claims"),id->id>0 && id<=quotes.size()?quotes.get(id-1):null,4))
                lines.add(c.answer()+" ["+c.id()+"]");
        }
        if ("completed".equals(status))
            events.step("verify","逐字校验通过 "+lines.size()+" 条引用");
        String explanation=supplement?model.path("explanation").asText(""):"";
        String fallback=excerpts.isEmpty()?"没有找到可引用的资料。":"相关原文见下方出处。";
        String answer=lines.isEmpty()?(explanation.isBlank()?fallback:""):String.join("\n\n",lines);
        if (!"completed".equals(status) && !"skipped".equals(status))
            answer=("unconfigured".equals(status)?"尚未配置文本模型 API。":"模型暂未生成可用回答。")+answer;
        conversations.append(thread,q,(answer+"\n"+explanation).strip());
        events.emit("answer",Map.of("source",web?"web":"document","answer",answer,"explanation",explanation,
                "claims",claims,"web_sources",sources,"hits",hits,"conversation_id",thread.id()));
    }
}
