package org.videoparse;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import reactor.util.retry.Retry;

@Component
class TaskEventHints {
    record Appended(String job) {}
    static final String CHANNEL = "vp:task-events:v1";
    private static final Logger log = LoggerFactory.getLogger(TaskEventHints.class);
    private final ReactiveStringRedisTemplate redis;
    private final TaskEventStreams streams;
    private Disposable listener;

    TaskEventHints(ReactiveStringRedisTemplate redis, TaskEventStreams streams) {
        this.redis = redis;
        this.streams = streams;
    }

    @PostConstruct void subscribe() {
        listener = Flux.defer(() -> redis.listenToChannel(CHANNEL))
            .subscribeOn(Schedulers.boundedElastic())
            .retryWhen(Retry.backoff(Long.MAX_VALUE, Duration.ofSeconds(1)).maxBackoff(Duration.ofSeconds(30)))
            .subscribe(message -> streams.hint(message.getMessage()));
    }

    @PreDestroy void close() { listener.dispose(); }

    // Worker progress outside a Spring transaction is already committed by the mapper.
    @TransactionalEventListener(fallbackExecution = true)
    public void committed(Appended event) {
        Mono.defer(() -> redis.convertAndSend(CHANNEL, event.job())).subscribeOn(Schedulers.boundedElastic())
            .timeout(Duration.ofMillis(500))
            .subscribe(ignored -> {}, error -> log.debug("SSE wake-up unavailable; readers poll MySQL", error));
    }
}
