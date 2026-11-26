package org.videoparse;

import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.apache.rocketmq.client.consumer.DefaultMQPushConsumer;
import org.apache.rocketmq.client.consumer.listener.*;
import org.apache.rocketmq.client.producer.*;
import org.apache.rocketmq.common.consumer.ConsumeFromWhere;
import org.apache.rocketmq.common.message.Message;
import org.slf4j.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** MySQL owns the stage transitions. A broker acknowledgement can race a retry or SQL recovery. */
@Component
@ConditionalOnProperty(name="vp.mq.enabled",havingValue="true")
class JobDispatch {
    private static final String PARSE_TOPIC = "VideoParseAnalysis";
    private static final String RESULT_TOPIC = "VideoParseResults";
    private final Logger log = LoggerFactory.getLogger(getClass());
    private final DispatchOutbox outbox;
    private final JobRunner runner;
    private final AnalysisGraph graph;
    private final String nameserver, prefix;
    private DefaultMQProducer producer;
    private DefaultMQPushConsumer parser, publisher;

    JobDispatch(DispatchOutbox outbox, JobRunner runner, AnalysisGraph graph,
                @Value("${ROCKETMQ_NAMESERVER}") String nameserver, @Value("${ROCKETMQ_PREFIX:}") String prefix) {
        this.outbox=outbox; this.runner=runner; this.graph=graph; this.nameserver=nameserver; this.prefix=prefix;
    }

    private DefaultMQPushConsumer subscribe(String group, String topic) throws Exception {
        var consumer = new DefaultMQPushConsumer(prefix + group);
        consumer.setNamesrvAddr(nameserver);
        consumer.setConsumeThreadMin(1);
        consumer.setConsumeThreadMax(1);
        consumer.setConsumeFromWhere(ConsumeFromWhere.CONSUME_FROM_FIRST_OFFSET);
        consumer.setConsumeTimeout(180);
        consumer.setConsumeMessageBatchMaxSize(1);
        try {
            consumer.subscribe(prefix + topic, "*");
            consumer.registerMessageListener((MessageListenerConcurrently)(messages,ctx) -> {
                String id = new String(messages.getFirst().getBody(), StandardCharsets.UTF_8);
                if (!id.matches("[0-9a-f]{32}")) return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
                try {
                    boolean accepted = topic.equals(PARSE_TOPIC) ? runner.process(id) : runner.publish(id);
                    return accepted ? ConsumeConcurrentlyStatus.CONSUME_SUCCESS : ConsumeConcurrentlyStatus.RECONSUME_LATER;
                } catch (Exception e) {
                    log.warn("消费失败 {} {}", topic,id,e);
                    return ConsumeConcurrentlyStatus.RECONSUME_LATER;
                }
            });
            consumer.start();
            return consumer;
        } catch (Exception e) { consumer.shutdown(); throw e; }
    }

    private synchronized void connect() throws Exception {
        if (producer == null) {
            var p = new DefaultMQProducer(prefix + "vp-dispatch");
            p.setNamesrvAddr(nameserver);
            p.setSendMsgTimeout(3000);
            try { p.start(); producer=p; } catch (Exception e) { p.shutdown(); throw e; }
        }
        if (parser == null) parser = subscribe("vp-analysis", PARSE_TOPIC);
        if (graph.enabled() && publisher == null) publisher = subscribe("vp-results", RESULT_TOPIC);
    }

    @Scheduled(fixedDelayString="${MQ_DISPATCH_MS:2000}")
    void send() {
        try {
            connect();
            relay(producer);
        } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        catch (Exception e) { log.warn("消息服务暂不可用，任务已保存在 MySQL: {}", e.getMessage()); }
    }

    void relay(DefaultMQProducer sender) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        for (int i=0; i<32 && deadline-System.nanoTime()>0; i++) {
            String lease = UUID.randomUUID().toString();
            var row = outbox.claim(lease);
            if (row == null) return;
            String topic = prefix + (row.stage().equals("parse") ? PARSE_TOPIC : RESULT_TOPIC);
            var message = new Message(topic,row.stage(),row.jobId(),row.jobId().getBytes(StandardCharsets.UTF_8));
            SendStatus status;
            try { status = sender.send(message).getSendStatus(); }
            catch (InterruptedException e) { throw e; } // The lease will expire.
            catch (Exception e) {
                log.warn("发送失败 {} {}，将重试 ({})",row.stage(),row.jobId(),e.getClass().getSimpleName());
                outbox.defer(row,lease);
                continue;
            }
            if (status == SendStatus.SEND_OK) outbox.acknowledge(row,lease);
            else outbox.defer(row,lease);
        }
    }

    @PreDestroy synchronized void close() {
        if (publisher!=null) publisher.shutdown();
        if (parser!=null) parser.shutdown();
        if (producer!=null) producer.shutdown();
    }
}
