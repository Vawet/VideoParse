package org.videoparse;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.apache.rocketmq.client.producer.*;
import org.apache.rocketmq.common.message.Message;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.annotation.EnableTransactionManagement;

/** Run against a disposable, migrated MySQL database with no other relay or worker. */
public class DispatchOutboxCheck {
    private final JdbcClient db;
    private final DispatchOutbox queue;
    private final List<String> jobs = new ArrayList<>();
    DispatchOutboxCheck(JdbcClient db, DispatchOutbox queue) { this.db=db; this.queue=queue; }

    private String seed() {
        String id=UUID.randomUUID().toString().replace("-","");
        db.sql("INSERT INTO vp_job(id,video_id,status) VALUES (?,?,'queued')").params(id,id).update();
        jobs.add(id);
        db.sql("INSERT INTO vp_dispatch(job_id) VALUES (?)").param(id).update();
        return id;
    }
    private int pending(String id) {
        return db.sql("SELECT COUNT(*) FROM vp_dispatch WHERE job_id=?").param(id).query(Integer.class).single();
    }
    private static SendResult result(SendStatus status) {
        var result=new SendResult(); result.setSendStatus(status); return result;
    }
    private JobDispatch relay() { return new JobDispatch(queue,null,null,"",""); }

    private void concurrentRelays() throws Exception {
        var expected=new HashSet<String>();
        for(int i=0;i<8;i++) expected.add(seed());
        var sends=new ConcurrentHashMap<String,AtomicInteger>();
        var bothSending=new CountDownLatch(2);
        var broker=new DefaultMQProducer() {
            @Override public SendResult send(Message m) throws InterruptedException {
                sends.computeIfAbsent(m.getKeys(), ignored->new AtomicInteger()).incrementAndGet();
                bothSending.countDown();
                if (!bothSending.await(5,TimeUnit.SECONDS)) throw new AssertionError("Relays blocked each other during broker I/O");
                return result(SendStatus.SEND_OK);
            }
        };
        try (var pool=Executors.newVirtualThreadPerTaskExecutor()) {
            var left=pool.submit(()->{relay().relay(broker);return null;});
            var right=pool.submit(()->{relay().relay(broker);return null;});
            left.get(10,TimeUnit.SECONDS); right.get(10,TimeUnit.SECONDS);
        }
        if (!sends.keySet().equals(expected) || sends.values().stream().anyMatch(n->n.get()!=1))
            throw new AssertionError("Duplicate or missing delivery "+sends);
        if (expected.stream().anyMatch(id->pending(id)!=0)) throw new AssertionError("Acknowledged intent retained");
        System.out.println("8 intents; 2 concurrent relays; 8 broker sends");
    }

    private void recovery() {
        String id=seed();
        var abandoned=queue.claim("abandoned");
        if (abandoned==null || queue.claim("early")!=null) throw new AssertionError("Live lease was bypassed");
        db.sql("UPDATE vp_dispatch SET available_at=NOW(3)-INTERVAL 1 SECOND WHERE job_id=?").param(id).update();
        var reclaimed=queue.claim("current");
        if (reclaimed==null || !id.equals(reclaimed.jobId())) throw new AssertionError("Lost crashed sender's intent");
        queue.acknowledge(abandoned,"abandoned");
        queue.defer(abandoned,"abandoned");
        if (queue.claim("stale-release")!=null || pending(id)!=1) throw new AssertionError("Expired sender changed the newer claim");
        // Pause and resume can recreate the very same job/stage/attempt.
        db.sql("DELETE FROM vp_dispatch WHERE job_id=?").param(id).update();
        db.sql("INSERT INTO vp_dispatch(job_id) VALUES (?)").param(id).update();
        queue.acknowledge(reclaimed,"current");
        var resumed=queue.claim("resumed");
        if(resumed==null || !id.equals(resumed.jobId())) throw new AssertionError("Late ACK deleted recreated intent");
        queue.acknowledge(resumed,"resumed");
    }

    private void lockedHead(DriverManagerDataSource source) throws Exception {
        String first = seed(), second = seed();
        db.sql("UPDATE vp_dispatch SET available_at=NOW(3)-INTERVAL 1 DAY WHERE job_id=?").param(first).update();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor();
             var connection = source.getConnection()) {
            connection.setAutoCommit(false);
            try (var lock = connection.prepareStatement("SELECT job_id FROM vp_dispatch WHERE job_id=? FOR UPDATE")) {
                lock.setString(1, first);
                try (var rows = lock.executeQuery()) {
                    if (!rows.next()) throw new AssertionError("Missing fixture row");
                    var available = executor.submit(() -> queue.claim("skip-locked")).get(5, TimeUnit.SECONDS);
                    if (available == null || !second.equals(available.jobId()))
                        throw new AssertionError("A locked queue head blocked a ready notification");
                    queue.acknowledge(available, "skip-locked");
                }
            } finally {
                connection.rollback();
            }
        }
        var released = queue.claim("after-unlock");
        if (released == null || !first.equals(released.jobId())) throw new AssertionError("Lost the skipped row");
        queue.acknowledge(released, "after-unlock");
    }

    private void failures() throws Exception {
        String broken=seed(), uncertain=seed(), healthy=seed();
        db.sql("UPDATE vp_dispatch SET available_at=NOW(3)-INTERVAL 1 DAY WHERE job_id=?").param(broken).update();
        relay().relay(new DefaultMQProducer() {
            @Override public SendResult send(Message m) {
                if (m.getKeys().equals(broken)) throw new IllegalStateException("injected send failure");
                return result(m.getKeys().equals(uncertain) ? SendStatus.FLUSH_DISK_TIMEOUT : SendStatus.SEND_OK);
            }
        });
        int deferred=db.sql("""
            SELECT COUNT(*) FROM vp_dispatch WHERE job_id IN (?,?) AND send_failures=1
            AND available_at>CURRENT_TIMESTAMP(3) AND send_lease IS NULL AND attempt=0
            """).params(broken,uncertain).query(Integer.class).single();
        if (deferred!=2 || pending(healthy)!=0) throw new AssertionError("Failure stalled or lost work");
        for(String id:List.of(broken,uncertain)) db.sql("UPDATE vp_dispatch SET available_at=NOW(3) WHERE job_id=?").param(id).update();
        relay().relay(new DefaultMQProducer() {
            @Override public SendResult send(Message m) {return result(SendStatus.SEND_OK);}
        });
        if (pending(broken)+pending(uncertain)!=0) throw new AssertionError("Failed intents did not recover");
    }

    public static void main(String[] args) throws Exception {
        var source=new DriverManagerDataSource(System.getenv("JDBC_URL"),System.getenv("DB_USER"),System.getenv("DB_PASSWORD"));
        var db=JdbcClient.create(source);
        if (db.sql("SELECT COUNT(*) FROM vp_dispatch").query(Integer.class).single()!=0)
            throw new IllegalStateException("Run on an empty disposable dispatch queue");
        try(var context=new AnnotationConfigApplicationContext()) {
            context.registerBean(JdbcClient.class,()->db);
            context.registerBean(DataSourceTransactionManager.class,()->new DataSourceTransactionManager(source));
            context.register(DispatchOutboxCheck.Config.class,DispatchOutbox.class);
            context.refresh();
            var check=new DispatchOutboxCheck(db,context.getBean(DispatchOutbox.class));
            try {
                check.concurrentRelays(); check.lockedHead(source); check.recovery(); check.failures();
                System.out.println("Locked head, crash recovery, late ACK, recreate, partial batch and ambiguous broker status OK");
            } finally {
                for(String id:check.jobs){
                    db.sql("DELETE FROM vp_dispatch WHERE job_id=?").param(id).update();
                    db.sql("DELETE FROM vp_job WHERE id=?").param(id).update();
                }
            }
        }
    }
    @EnableTransactionManagement static class Config {}
}
