package org.videoparse;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.TimeoutException;

/** Offline contract check for the line-based Spring/Python worker protocol. */
public class WorkerSessionCheck {
    private static final String WORKER = """
        import json, sys, time
        for line in sys.stdin:
            message = json.loads(line)
            print('VP_RESULT ' + json.dumps(message['tool']), flush=True)
            time.sleep(message['args'].get('pause', 0))
        """;

    public static void main(String[] args) throws Exception {
        var worker = new ProcessBuilder("python3", "-u", "-c", WORKER);
        try (var session = new MediaToolSession(worker, new ObjectMapper())) {
            var ready = session.call("ready", Map.of(), Duration.ofSeconds(5));
            var busy = session.call("pause", Map.of("pause", 2), Duration.ofSeconds(5));
            if (!ready.asText().equals("ready") || !busy.asText().equals("pause"))
                throw new AssertionError("Responses must match their requests on a reused worker");
            try {
                session.call("embed", Map.of("text", "x".repeat(2 * 1024 * 1024)), Duration.ofMillis(250));
                throw new AssertionError("Time spent delivering the request must count toward its deadline");
            } catch (TimeoutException expected) {
                System.out.println("Worker reuse and end-to-end timeout passed");
            }
        }
    }
}
