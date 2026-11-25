package org.videoparse;

import java.util.List;
import org.apache.ibatis.annotations.*;

@Mapper
public interface JobMapper {
    record Job(String id, String videoId, String status, String error) {}
    record Event(long id, String payload) {}

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
    @Select("SELECT id FROM vp_job WHERE status IN ('queued','running') ORDER BY created_at LIMIT 128")
    List<String> candidates();
    @Update("UPDATE vp_job SET status='running' WHERE id=#{id} AND status IN ('queued','running')")
    int begin(String id);
    @Update("UPDATE vp_job SET status='publishing' WHERE id=#{id} AND status='running'")
    int mediaReady(String id);
    @Select("SELECT id FROM vp_job WHERE status='publishing' AND publish_after<=CURRENT_TIMESTAMP(3) ORDER BY publish_after LIMIT 128")
    List<String> publications();
    record Publication(String videoId,int attempts) {}
    @Select("SELECT video_id,publish_attempts AS attempts FROM vp_job WHERE id=#{id} AND status='publishing' AND publish_after<=CURRENT_TIMESTAMP(3)")
    Publication publication(String id);
    @Update("UPDATE vp_job SET publish_attempts=#{attempt},publish_after=TIMESTAMPADD(SECOND,#{delay},CURRENT_TIMESTAMP(3)) WHERE id=#{id} AND status='publishing' AND publish_attempts=#{attempt}-1")
    int recordFailure(String id,int attempt,int delay);
    @Update("UPDATE vp_job SET status=#{status},error=#{error},active_video=NULL WHERE id=#{id} AND status=#{expected}")
    int finish(String id,String expected,String status,String error);
    @Insert("INSERT INTO vp_graph_head(video_id,job_id) VALUES(#{video},#{job}) ON DUPLICATE KEY UPDATE job_id=#{job}")
    void publishHead(String video,String job);
    @Delete("DELETE FROM vp_graph_head WHERE video_id=#{video}")
    void clearHead(String video);
    @Insert("INSERT INTO vp_event(job_id,payload) VALUES(#{job},#{json})")
    void event(String job,String json);
    @Select("SELECT id,CAST(payload AS CHAR CHARACTER SET utf8mb4) AS payload FROM vp_event WHERE job_id=#{job} AND id>#{after} ORDER BY id LIMIT 100")
    List<Event> events(String job,long after);
    @Select("SELECT COUNT(*) FROM vp_event WHERE job_id=#{id}")
    long count(String id);
}
