package org.videoparse;

import java.util.List;
import java.util.Map;
import org.apache.ibatis.annotations.*;

@Mapper
public interface JobMapper {
    record Job(String id, String videoId, String status, String error) {}
    record Status(String videoId, String status, String error, long events) {}
    record Event(long id, String payload) {}
    record Tail(String id, String status, long lastEvent) {
        boolean finished() { return "done".equals(status) || "error".equals(status); }
    }

    @Insert("INSERT INTO vp_job(id,video_id,active_video,status) VALUES(#{id},#{video},#{video},'queued') ON DUPLICATE KEY UPDATE id=id")
    void submit(String id, String video);
    @Insert("INSERT INTO vp_dispatch(job_id,stage,attempt) VALUES(#{id},#{stage},#{attempt}) ON DUPLICATE KEY UPDATE attempt=#{attempt}")
    void enqueue(String id,String stage,int attempt);
    @Delete("DELETE FROM vp_dispatch WHERE job_id=#{id}")
    void clearDispatch(String id);
    @Select("SELECT id FROM vp_job WHERE active_video=#{video} FOR UPDATE")
    String active(String video);
    @Select("SELECT id,video_id,status,error FROM vp_job WHERE id=#{id}")
    Job get(String id);
    String OWNED_JOB = " FROM vp_job j JOIN videos v ON v.id=j.video_id WHERE j.id=#{id} AND v.owner_id=#{owner}";
    @Select("SELECT j.id,j.video_id,j.status,j.error" + OWNED_JOB)
    Job ownedJob(String id, String owner);
    @Select("SELECT j.video_id,j.status,j.error,(SELECT COUNT(*) FROM vp_event e WHERE e.job_id=j.id) AS events" + OWNED_JOB)
    Status ownedStatus(String id, String owner);
    String LOCK_PREFIX = "videoparse:";
    // Advisory only. The runner must still acquire the same lock and check the current stage.
    String FREE_JOB = " AND IS_FREE_LOCK(CONCAT('" + LOCK_PREFIX + "',id))=1";
    String OLDEST_FREE = FREE_JOB + " ORDER BY created_at,id LIMIT 128";
    @Select("SELECT id FROM (" +
        "(SELECT id,created_at FROM vp_job WHERE status='queued'" + OLDEST_FREE + ")" +
        " UNION ALL (SELECT id,created_at FROM vp_job WHERE status='running'" + OLDEST_FREE + ")" +
        ") candidates ORDER BY created_at,id LIMIT 128")
    List<String> candidates();
    @Update("UPDATE vp_job SET status='running' WHERE id=#{id} AND status='queued'")
    int startQueued(String id);
    @Update("UPDATE vp_job SET status='publishing' WHERE id=#{id} AND status='running'")
    int mediaReady(String id);
    @Select("SELECT id FROM vp_job WHERE status='publishing' AND publish_after<=CURRENT_TIMESTAMP(3)" + FREE_JOB +
        " ORDER BY publish_after,id LIMIT 128")
    List<String> publications();
    record Publication(String videoId,int attempts) {}
    @Select("SELECT video_id,publish_attempts AS attempts FROM vp_job WHERE id=#{id} AND status='publishing' AND publish_after<=CURRENT_TIMESTAMP(3)")
    Publication publication(String id);
    @Update("UPDATE vp_job SET publish_attempts=#{attempt},publish_after=TIMESTAMPADD(SECOND,#{delay},CURRENT_TIMESTAMP(3)) WHERE id=#{id} AND status='publishing' AND publish_attempts=#{attempt}-1")
    int recordFailure(String id,int attempt,int delay);
    @Update("UPDATE vp_job SET status=#{status},error=#{error},active_video=NULL WHERE id=#{id} AND status=#{expected}")
    int finish(String id,String expected,String status,String error);
    @Update("UPDATE videos SET folder_id='videos' WHERE id=#{video} AND folder_id IS NULL")
    void archiveVideo(String video);
    @Insert("INSERT INTO vp_graph_head(video_id,job_id) VALUES(#{video},#{job}) ON DUPLICATE KEY UPDATE job_id=#{job}")
    void publishHead(String video,String job);
    @Delete("DELETE FROM vp_graph_head WHERE video_id=#{video}")
    void clearHead(String video);
    @Insert("INSERT INTO vp_event(job_id,payload) VALUES(#{job},#{json})")
    void event(String job,String json);
    @Select("SELECT id,CAST(payload AS CHAR CHARACTER SET utf8mb4) AS payload FROM vp_event WHERE job_id=#{job} AND id>#{after} ORDER BY id LIMIT 100")
    List<Event> events(String job,long after);
    @Select("SELECT j.id,j.status,COALESCE((SELECT MAX(id) FROM vp_event WHERE job_id=#{id}),0) AS last_event" + OWNED_JOB)
    Tail ownedTail(String id, String owner);
    String JOB_IDS = "<foreach collection='ids' item='id' open='(' separator=',' close=')'>#{id}</foreach>";
    // Group on the leading replay index column so MySQL can skip each job's event history.
    @MapKey("id")
    @Select("<script>SELECT j.id,j.status,COALESCE(t.last_event,0) AS last_event FROM vp_job j " +
        "LEFT JOIN (SELECT job_id,MAX(id) AS last_event FROM vp_event WHERE job_id IN " + JOB_IDS +
        " GROUP BY job_id) t ON t.job_id=j.id WHERE j.id IN " + JOB_IDS + "</script>")
    Map<String,Tail> tails(@Param("ids") List<String> ids);
}
