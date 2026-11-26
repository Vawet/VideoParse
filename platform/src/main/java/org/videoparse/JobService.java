package org.videoparse;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.transaction.annotation.Transactional;

@Service
class JobService {
    private final JobMapper jobs;
    private final ObjectMapper json;
    private final boolean mq;
    private final AnalysisGraph graph;
    private final ApplicationEventPublisher notifications;
    JobService(JobMapper jobs, ObjectMapper json, AnalysisGraph graph, ApplicationEventPublisher notifications, @Value("${vp.mq.enabled:false}") boolean mq) {
        this.jobs = jobs; this.json = json; this.mq = mq; this.graph = graph;
        this.notifications = notifications;
    }

    void appendEvent(String id, String payload) {
        jobs.event(id, payload);
        notifications.publishEvent(new TaskEventHints.Appended(id));
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
    public String control(String id, String owner, boolean pause) {
        String state = jobs.lockOwnedState(id, owner);
        if (state == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "任务不存在");
        String next;
        if (pause) {
            next = switch (state) {
                case "queued", "paused" -> "paused";
                case "running", "pausing" -> "pausing";
                default -> throw new ResponseStatusException(HttpStatus.CONFLICT, "当前任务已结束解析");
            };
        } else {
            next = switch (state) {
                case "paused", "queued" -> "queued";
                case "running" -> "running";
                case "pausing" -> throw new ResponseStatusException(HttpStatus.CONFLICT, "请等待当前步骤保存后继续");
                default -> throw new ResponseStatusException(HttpStatus.CONFLICT, "当前任务已结束解析");
            };
        }
        if (!state.equals(next)) {
            jobs.transition(id, state, next);
            stateEvent(id, next);
            if (pause) jobs.clearDispatch(id);
            else if (mq) jobs.enqueue(id, "parse", 0);
        }
        return next;
    }

    private void stateEvent(String id, String state) {
        appendEvent(id, json.createObjectNode().put("type","task_state").put("status",state).toString());
    }

    @Transactional
    public boolean parkIfRequested(String id) {
        if (jobs.transition(id, "pausing", "paused") == 0) return false;
        stateEvent(id, "paused");
        return true;
    }

    @Transactional
    public void mediaReady(String id) {
        if (!graph.enabled()) {
            finish(id, "running", null);
        } else if (jobs.mediaReady(id) == 1) {
            jobs.clearDispatch(id);
            if (mq) jobs.enqueue(id, "graph", 0);
            appendEvent(id, json.createObjectNode().put("type","progress").put("stage","publishing")
                .put("text","解析产物已保存，等待写入图数据库").toString());
        } else {
            parkIfRequested(id);
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
            appendEvent(id, json.createObjectNode().put("type","progress").put("stage","publishing")
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
                jobs.archiveVideo(video);
                if (expected.equals("publishing")) jobs.publishHead(video,id);
                else jobs.clearHead(video);
            }
            var event = json.createObjectNode().put("type", "end").put("status", status);
            if (error != null) event.put("error", error);
            appendEvent(id, event.toString());
        } else if (expected.equals("running")) {
            parkIfRequested(id);
        }
    }
}
