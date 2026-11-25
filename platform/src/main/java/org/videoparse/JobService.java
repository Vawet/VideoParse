package org.videoparse;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class JobService {
    private final JobMapper jobs;
    private final ObjectMapper json;
    private final boolean mq;
    private final AnalysisGraph graph;
    JobService(JobMapper jobs, ObjectMapper json, AnalysisGraph graph, @Value("${vp.mq.enabled:false}") boolean mq) {
        this.jobs = jobs; this.json = json; this.mq = mq; this.graph = graph;
    }

    @Transactional
    public String submit(String video) {
        String proposed=UUID.randomUUID().toString().replace("-", "");
        jobs.submit(proposed, video);
        String active=jobs.active(video);
        if(mq && proposed.equals(active)) jobs.enqueue(active,"parse",0);
        return active;
    }

    @Transactional
    public void mediaReady(String id) {
        if (!graph.enabled()) {
            finish(id, "running", null);
        } else if (jobs.mediaReady(id) == 1) {
            if (mq) jobs.enqueue(id, "graph", 0);
            jobs.event(id, json.createObjectNode().put("type","progress").put("stage","publishing")
                .put("text","解析产物已保存，等待写入图数据库").toString());
        }
    }

    @Transactional
    public void publicationFailed(String id, int attempt) {
        int delay = 1 << attempt;
        if (jobs.recordFailure(id, attempt, delay) == 0) return;
        if (attempt >= 5) {
            finish(id, "publishing", "解析产物已保存，图发布连续失败 5 次，可从工作区重新发布");
        } else {
            if (mq) jobs.enqueue(id, "graph", attempt);
            jobs.event(id, json.createObjectNode().put("type","progress").put("stage","publishing")
                .put("attempt",attempt).put("retry_in_seconds",delay).put("text","图发布失败，等待重试").toString());
        }
    }

    @Transactional
    public void finish(String id, String expected, String error) {
        String status = error == null ? "done" : "error";
        if (jobs.finish(id, expected, status, error) == 1) {
            jobs.clearDispatch(id);
            if (error == null) {
                var video = jobs.get(id).videoId();
                if (expected.equals("publishing")) jobs.publishHead(video,id);
                else jobs.clearHead(video);
            }
            var event = json.createObjectNode().put("type", "end").put("status", status);
            if (error != null) event.put("error", error);
            jobs.event(id, event.toString());
        }
    }
}
