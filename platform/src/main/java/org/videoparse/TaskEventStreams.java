package org.videoparse;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.stereotype.Service;

/** Shares MySQL reads inside an instance. Each HTTP response owns its cursor and output stream. */
@Service
class TaskEventStreams {
    private static final long POLL = TimeUnit.MILLISECONDS.toNanos(400);
    private static final long HEARTBEAT = TimeUnit.SECONDS.toNanos(10);
    private static final byte[] KEEP_ALIVE = ": keep-alive\n\n".getBytes(StandardCharsets.UTF_8);
    private final ConcurrentHashMap<String, Feed> feeds = new ConcurrentHashMap<>();
    private final JobMapper jobs;

    TaskEventStreams(JobMapper jobs) { this.jobs = jobs; }

    void write(String id, long cursor, OutputStream out) throws IOException {
        var feed = feeds.compute(id, (key, current) -> {
            var active = current == null ? new Feed() : current;
            active.readers++;
            return active;
        });
        try {
            long after = Math.max(0, cursor);
            long heartbeatAt = System.nanoTime();
            while (true) {
                var batch = feed.read(id, after);
                if (batch.finished()) return;
                if (!batch.events().isEmpty()) {
                    for (var event : batch.events()) {
                        if (event.id() <= after) continue;
                        out.write(event.data());
                        after = event.id();
                    }
                    out.flush();
                    continue;
                }
                if (System.nanoTime() - heartbeatAt >= 0) {
                    out.write(KEEP_ALIVE);
                    out.flush();
                    heartbeatAt = System.nanoTime() + HEARTBEAT;
                }
                TimeUnit.NANOSECONDS.sleep(batch.checkAt() - System.nanoTime());
            }
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        } finally {
            feeds.compute(id, (key, active) -> --active.readers == 0 ? null : active);
        }
    }

    private record Frame(long id, byte[] data) {
        Frame(JobMapper.Event event) {
            this(event.id(), ("id: " + event.id() + "\ndata: " + event.payload() + "\n\n").getBytes(StandardCharsets.UTF_8));
        }
    }
    private record Batch(List<Frame> events, boolean finished, long checkAt) {}

    private final class Feed {
        private final ReentrantLock lock = new ReentrantLock();
        private int readers; // Only modified by feeds.compute.
        private JobMapper.Tail tail;
        private long checkAt;
        private long pageFrom;
        private List<Frame> page = List.of();

        Batch read(String id, long after) throws InterruptedException {
            lock.lockInterruptibly();
            try {
                if (!page.isEmpty() && after >= pageFrom && after < page.getLast().id())
                    return new Batch(page, false, 0);
                if (tail == null || (!tail.finished() && System.nanoTime() - checkAt >= 0)) {
                    tail = jobs.tail(id);
                    checkAt = System.nanoTime() + POLL;
                }
                if (tail == null || after >= tail.lastEvent())
                    return new Batch(List.of(), tail == null || tail.finished(), checkAt);

                var frames = jobs.events(id, after).stream().map(Frame::new).toList();
                // Replaying an old cursor must not evict the page being consumed by live readers.
                if (!frames.isEmpty() && (page.isEmpty() || frames.getLast().id() > page.getLast().id())) {
                    page = frames;
                    pageFrom = after;
                }
                return new Batch(frames, false, checkAt);
            } finally {
                lock.unlock();
            }
        }
    }
}
