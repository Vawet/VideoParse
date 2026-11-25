package org.videoparse;

import com.fasterxml.jackson.databind.*;
import dev.langchain4j.model.openai.OpenAiChatModel;
import dev.langchain4j.data.message.*;
import java.time.Duration;
import java.util.*;
import java.util.function.Consumer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
class AnalysisFlow {
    private final ObjectMapper json;
    private final OpenAiChatModel planner;
    private static final Set<String> REPAIRABLE=Set.of("transcribe","correct_transcript","extract_keyframes",
        "analyze_structure","generate_summary","generate_mindmap","extract_heavy_frames","write_frame_notes","build_visual_transcript");

    AnalysisFlow(ObjectMapper json,@Value("${PLATFORM_AI_KEY:}") String key,
                 @Value("${PLATFORM_AI_URL:https://dashscope.aliyuncs.com/compatible-mode/v1}") String base,
                 @Value("${PLATFORM_AI_MODEL:qwen-plus}") String name) {
        this.json=json;
        planner=key.isBlank()?null:OpenAiChatModel.builder().baseUrl(base).apiKey(key).modelName(name)
            .maxRetries(0).timeout(Duration.ofSeconds(40)).build();
    }
    private class Run {
        final MediaToolSession session;
        final Consumer<String> emit;
        final LinkedHashSet<String> issues=new LinkedHashSet<>();
        int step=0;
        Run(MediaToolSession session,Consumer<String> emit){this.session=session;this.emit=emit;}
        JsonNode tool(String name,Map<String,Object> args) throws Exception {
            emit.accept(json.writeValueAsString(Map.of("type","tool_start","step",++step,"tool",name,"args",args)));
            var obs=session.call(name,args);
            boolean ok=!obs.has("error") && obs.path("ok").asBoolean(true);
            if(!ok) issues.add(name);
            emit.accept(json.writeValueAsString(Map.of("type","tool_end","step",step,"tool",name,"ok",ok,"observation",obs)));
            return obs;
        }
        JsonNode tool(String name) throws Exception {return tool(name,Map.of());}
        void materials() throws Exception {
            for(String name:List.of("analyze_structure","generate_summary","generate_mindmap")) tool(name);
        }
    }

    void run(ProcessBuilder pb,Consumer<String> emit) throws Exception {
        try(var session=new MediaToolSession(pb,json)) {
            var run=new Run(session,emit);
            var info=run.tool("get_video_info");
            if(info.has("error")) throw new IllegalStateException("视频无法解码");
            boolean speech=info.path("has_audio").asBoolean() && run.tool("transcribe").path("segments").asInt()>0;
            if(speech) {run.tool("correct_transcript");run.materials();}
            var frameArgs=Map.<String,Object>of("strategy",info.path("duration_seconds").asDouble()>1800?"interval":"slides","max_frames",30);
            run.tool("extract_keyframes",frameArgs);run.tool("read_frame_text");
            if(!speech) {
                run.tool("write_frame_notes",Map.of("max_frames",30));
                if(run.tool("build_visual_transcript").path("segments").asInt()>0) run.materials();
            }
            // Validation identifies whether highlight frames are actually required.
            var check=run.tool("validate_result");
            if(check.path("issues").toString().contains("extract_heavy_frames")) run.tool("extract_heavy_frames");
            if(speech) run.tool("write_frame_notes",Map.of("max_frames",30));
            check=run.tool("validate_result");
            var attempted=new HashSet<String>();
            for(int round=0;round<2 && planner!=null && !check.path("issues").isEmpty();round++) {
                String action;
                try {
                    action=planner.chat(SystemMessage.from("依据校验问题只选择一个修复工具，返回工具名称或 stop。可选："+new TreeSet<>(REPAIRABLE)),
                        UserMessage.from(check.path("issues").toString())).aiMessage().text().strip();
                } catch(Exception unavailable){break;}
                if(!REPAIRABLE.contains(action) || !attempted.add(action)) break;
                run.tool(action,action.equals("extract_keyframes")?frameArgs:Map.of());
                check=run.tool("validate_result");
            }
            String note=check.has("error") || !check.path("issues").isEmpty()
                ?"部分步骤未通过校验："+check.toString():"解析完成";
            if(run.tool("finish",Map.of("note",note)).has("error")) throw new IllegalStateException("解析结果写入失败");
        }
    }
}
