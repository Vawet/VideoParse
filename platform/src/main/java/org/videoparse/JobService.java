package org.videoparse;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
class JobService {
    private final JobMapper jobs;
    private final ObjectMapper json;
    private final boolean mq;
    JobService(JobMapper jobs, ObjectMapper json, @org.springframework.beans.factory.annotation.Value("${vp.mq.enabled:false}") boolean mq) {
        this.jobs = jobs; this.json = json; this.mq = mq;
    }

    @Transactional
    public String submit(String video) {
        String proposed=UUID.randomUUID().toString().replace("-", "");
        jobs.submit(proposed, video);
        String active=jobs.active(video);
        if(mq && proposed.equals(active)) jobs.enqueue(active);
        return active;
    }

    @Transactional
    public void finish(String id, String error) {
        String status = error == null ? "done" : "error";
        if (jobs.finish(id, status, error) == 1) {
            var event = json.createObjectNode().put("type", "end").put("status", status);
            if (error != null) event.put("error", error);
            jobs.event(id, event.toString());
        }
    }
}
