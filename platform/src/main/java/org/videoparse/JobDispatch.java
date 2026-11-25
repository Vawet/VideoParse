package org.videoparse;

import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import org.apache.rocketmq.client.consumer.DefaultMQPushConsumer;
import org.apache.rocketmq.client.consumer.listener.*;
import org.apache.rocketmq.client.producer.*;
import org.apache.rocketmq.common.consumer.ConsumeFromWhere;
import org.apache.rocketmq.common.message.Message;
import org.slf4j.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** MySQL owns the stage transitions. A broker acknowledgement can race a retry or SQL recovery. */
@Component
@ConditionalOnProperty(name="vp.mq.enabled",havingValue="true")
class JobDispatch {
    private static final String PARSE_TOPIC = "VideoParseAnalysis";
    private static final String RESULT_TOPIC = "VideoParseResults";
    private final Logger log = LoggerFactory.getLogger(getClass());
    private final JdbcClient db;
    private final JobRunner runner;
    private final AnalysisGraph graph;
    private final String nameserver, prefix;
    private DefaultMQProducer producer;
    private DefaultMQPushConsumer parser, publisher;

    JobDispatch(JdbcClient db, JobRunner runner, AnalysisGraph graph,
                @Value("${ROCKETMQ_NAMESERVER}") String nameserver, @Value("${ROCKETMQ_PREFIX:}") String prefix) {
        this.db=db; this.runner=runner; this.graph=graph; this.nameserver=nameserver; this.prefix=prefix;
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

    record Dispatch(String jobId, String stage, int attempt) {}

    @Scheduled(fixedDelayString="${MQ_DISPATCH_MS:2000}")
    void send() {
        try {
            connect();
            var pending = db.sql("""
                SELECT d.job_id,d.stage,d.attempt FROM vp_dispatch d JOIN vp_job j ON j.id=d.job_id
                WHERE (d.stage='parse' AND j.status IN ('queued','running'))
                   OR (d.stage='graph' AND j.status='publishing' AND j.publish_after<=CURRENT_TIMESTAMP(3))
                ORDER BY d.created_at LIMIT 32
                """).query(Dispatch.class).list();
            for (var row : pending) {
                String topic = prefix + (row.stage().equals("parse") ? PARSE_TOPIC : RESULT_TOPIC);
                var message = new Message(topic,row.stage(),row.jobId(),row.jobId().getBytes(StandardCharsets.UTF_8));
                if (producer.send(message).getSendStatus() == SendStatus.SEND_OK) {
                    db.sql("DELETE FROM vp_dispatch WHERE job_id=? AND stage=? AND attempt=?")
                        .params(row.jobId(), row.stage(), row.attempt()).update();
                }
            }
        } catch (Exception e) { log.warn("消息服务暂不可用，任务已保存在 MySQL: {}", e.getMessage()); }
    }

    @PreDestroy synchronized void close() {
        if (publisher!=null) publisher.shutdown();
        if (parser!=null) parser.shutdown();
        if (producer!=null) producer.shutdown();
    }
}
