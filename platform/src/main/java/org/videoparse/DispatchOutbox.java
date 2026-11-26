package org.videoparse;

import java.util.concurrent.ThreadLocalRandom;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
class DispatchOutbox {
    record Entry(String jobId, String stage, int sendFailures) {}
    private final JdbcClient db;
    DispatchOutbox(JdbcClient db) { this.db = db; }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public Entry claim(String lease) {
        // Lock only the intent. Task transitions lock the job first, then update its intents.
        var row = db.sql("""
            SELECT d.job_id,d.stage,d.send_failures
            FROM vp_dispatch d JOIN vp_job j ON j.id=d.job_id
            WHERE d.available_at<=CURRENT_TIMESTAMP(3) AND (
                (d.stage='parse' AND j.status IN ('queued','running'))
                OR (d.stage='graph' AND j.status='publishing' AND j.publish_after<=CURRENT_TIMESTAMP(3)))
            ORDER BY d.available_at,d.created_at,d.job_id,d.stage
            LIMIT 1 FOR UPDATE OF d SKIP LOCKED
            """).query(Entry.class).optional().orElse(null);
        if (row != null) db.sql("""
            UPDATE vp_dispatch SET send_lease=?,available_at=TIMESTAMPADD(SECOND,30,CURRENT_TIMESTAMP(3))
            WHERE job_id=? AND stage=?
            """).params(lease,row.jobId(),row.stage()).update();
        return row;
    }

    void acknowledge(Entry row,String lease) {
        db.sql("DELETE FROM vp_dispatch WHERE job_id=? AND stage=? AND send_lease=?")
            .params(row.jobId(),row.stage(),lease).update();
    }

    void defer(Entry row,String lease) {
        // Broker retries have their own budget of time; they never advance the job's graph attempt.
        long ceilingMs = Math.min(60_000L,2_000L << Math.min(5,row.sendFailures()));
        long delayMs = ThreadLocalRandom.current().nextLong(ceilingMs/2,ceilingMs+1);
        db.sql("""
            UPDATE vp_dispatch SET send_lease=NULL,send_failures=LEAST(send_failures+1,6),
                available_at=TIMESTAMPADD(MICROSECOND,?,CURRENT_TIMESTAMP(3))
            WHERE job_id=? AND stage=? AND send_lease=?
            """).params(delayMs*1000,row.jobId(),row.stage(),lease).update();
    }
}
