package org.videoparse;

import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.apache.rocketmq.client.consumer.DefaultMQPushConsumer;
import org.apache.rocketmq.client.consumer.listener.*;
import org.apache.rocketmq.client.producer.*;
import org.apache.rocketmq.common.message.Message;
import org.slf4j.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** The SQL transaction owns job identity; MQ is allowed to deliver a job more than once. */
@Component
@ConditionalOnProperty(name="vp.mq.enabled",havingValue="true")
class JobDispatch {
    private static final String TOPIC="VideoParseAnalysis";
    private final Logger log=LoggerFactory.getLogger(getClass());
    private final JdbcClient db;
    private final JobRunner runner;
    private final String nameserver;
    private DefaultMQProducer producer;
    private DefaultMQPushConsumer consumer;
    JobDispatch(JdbcClient db, JobRunner runner, @Value("${ROCKETMQ_NAMESERVER}") String nameserver) {
        this.db=db;this.runner=runner;this.nameserver=nameserver;
    }
    private synchronized void connect() throws Exception {
        if(producer==null) {
            var p=new DefaultMQProducer("vp-dispatch");
            p.setNamesrvAddr(nameserver); p.setSendMsgTimeout(3000);
            try {p.start();producer=p;} catch(Exception e){p.shutdown();throw e;}
        }
        if(consumer==null) {
            var c=new DefaultMQPushConsumer("vp-analysis");
            c.setNamesrvAddr(nameserver);c.setConsumeThreadMin(1);c.setConsumeThreadMax(1);
            c.setConsumeTimeout(180);c.setConsumeMessageBatchMaxSize(1);
            try {
                c.subscribe(TOPIC,"*");
                c.registerMessageListener((MessageListenerConcurrently)(messages,ctx)-> {
                    String id=new String(messages.getFirst().getBody(),StandardCharsets.UTF_8);
                    if(!id.matches("[0-9a-f]{32}")) return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
                    try {return runner.process(id)?ConsumeConcurrentlyStatus.CONSUME_SUCCESS:ConsumeConcurrentlyStatus.RECONSUME_LATER;}
                    catch(Exception e){log.warn("消费失败 {}",id,e);return ConsumeConcurrentlyStatus.RECONSUME_LATER;}
                });
                c.start(); consumer=c;
            } catch(Exception e){c.shutdown();throw e;}
        }
    }
    @Scheduled(fixedDelayString="${MQ_DISPATCH_MS:2000}")
    void send() {
        try {
            connect();
            for(String id:db.sql("SELECT job_id FROM vp_dispatch ORDER BY created_at LIMIT 32").query(String.class).list()) {
                var result=producer.send(new Message(TOPIC,"parse",id,id.getBytes(StandardCharsets.UTF_8)));
                if(result.getSendStatus()!=SendStatus.SEND_OK) break;
                db.sql("DELETE FROM vp_dispatch WHERE job_id=?").param(id).update();
            }
        } catch(Exception e){log.warn("消息服务暂不可用，任务已保存在 MySQL: {}",e.getMessage());}
    }
    @PreDestroy synchronized void close() {
        if(consumer!=null) consumer.shutdown();
        if(producer!=null) producer.shutdown();
    }
}
