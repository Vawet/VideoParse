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
    JobService(JobMapper jobs, ObjectMapper json) { this.jobs = jobs; this.json = json; }

    @Transactional
    public String submit(String video) {
        jobs.submit(UUID.randomUUID().toString().replace("-", ""), video);
        return jobs.active(video);
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
