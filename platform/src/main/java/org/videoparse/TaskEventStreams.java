package org.videoparse;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.stereotype.Service;

/** Shares MySQL reads inside an instance. Each HTTP response owns its cursor and output stream. */
@Service
class TaskEventStreams {
    private static final long POLL = TimeUnit.MILLISECONDS.toNanos(400);
    private static final long HEARTBEAT = TimeUnit.SECONDS.toNanos(10);
    private static final int POLL_BATCH = 128;
    private static final byte[] KEEP_ALIVE = ": keep-alive\n\n".getBytes(StandardCharsets.UTF_8);
    private final ConcurrentHashMap<String, Feed> feeds = new ConcurrentHashMap<>();
    private final JobMapper jobs;
    private final ReentrantLock pollLock = new ReentrantLock();
    private volatile long checkAt = System.nanoTime();

    TaskEventStreams(JobMapper jobs) { this.jobs = jobs; }

    void write(JobMapper.Tail initial, long cursor, OutputStream out) throws IOException {
        String id = initial.id();
        var feed = feeds.compute(id, (key, current) -> {
            var active = current == null ? new Feed(initial) : current;
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

    // The first idle reader at each deadline checks all watched jobs. No timer or SQL work
    // remains when the last reader disconnects. Only tail metadata crosses feed boundaries.
    private void refreshTails() throws InterruptedException {
        if (System.nanoTime() - checkAt < 0) return;
        pollLock.lockInterruptibly();
        try {
            if (System.nanoTime() - checkAt < 0) return;
            try {
                var pending = new HashMap<String, Feed>();
                for (var entry : feeds.entrySet()) {
                    var tail = entry.getValue().tail;
                    if (tail == null || tail.finished()) continue;
                    pending.put(entry.getKey(), entry.getValue());
                    if (pending.size() == POLL_BATCH) {
                        refreshBatch(pending);
                        pending.clear();
                    }
                }
                if (!pending.isEmpty()) refreshBatch(pending);
            } finally {
                checkAt = System.nanoTime() + POLL;
            }
        } finally {
            pollLock.unlock();
        }
    }

    private void refreshBatch(Map<String, Feed> pending) {
        var snapshots = jobs.tails(List.copyOf(pending.keySet()));
        pending.forEach((id, feed) -> feed.tail = snapshots.get(id));
    }

    private final class Feed {
        private final ReentrantLock lock = new ReentrantLock();
        private int readers; // Only modified by feeds.compute.
        private volatile JobMapper.Tail tail;
        private long pageFrom;
        private List<Frame> page = List.of();

        Feed(JobMapper.Tail initial) { tail = initial; }

        Batch read(String id, long after) throws InterruptedException {
            lock.lockInterruptibly();
            try {
                if (!page.isEmpty() && after >= pageFrom && after < page.getLast().id())
                    return new Batch(page, false, 0);
                var snapshot = tail;
                if (snapshot != null && !snapshot.finished() && after >= snapshot.lastEvent()) {
                    refreshTails();
                    snapshot = tail;
                }
                if (snapshot == null || after >= snapshot.lastEvent())
                    return new Batch(List.of(), snapshot == null || snapshot.finished(), checkAt);

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
