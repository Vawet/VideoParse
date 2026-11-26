package org.videoparse;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.concurrent.*;
import javax.sql.DataSource;
import org.slf4j.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
class JobRunner {
    private final Logger log=LoggerFactory.getLogger(getClass());
    private final DataSource db;
    private final JobMapper jobs;
    private final JobService service;
    private final ObjectMapper json;
    private final String python, publicBase;
    private final Path directory, data;
    private final String engine;
    private final AnalysisFlow flow;
    private final AnalysisResults results;
    private final AnalysisGraph graph;
    JobRunner(DataSource db, JobMapper jobs, JobService service, ObjectMapper json, AnalysisFlow flow, AnalysisResults results, AnalysisGraph graph, @Value("${PARSE_ENGINE:java}") String engine,
              @Value("${videoparse.python}") String python, @Value("${videoparse.worker-dir}") Path directory,
              @Value("${videoparse.data}") Path data, @Value("${videoparse.public-base}") String publicBase) {
        if(!java.util.Set.of("java","python").contains(engine)) throw new IllegalArgumentException("PARSE_ENGINE 需为 java 或 python");
        this.results=results;this.graph=graph;this.engine=engine;this.flow=flow;this.db=db; this.jobs=jobs; this.service=service; this.json=json;
        this.python=python; this.directory=directory; this.data=data; this.publicBase=publicBase;
    }
    @Scheduled(fixedDelayString="${WORKER_POLL_MS:1500}")
    public void poll() throws SQLException {
        for(String id:jobs.candidates()) if(process(id)) return;
    }
    @Scheduled(fixedDelayString="${PUBLISH_POLL_MS:${WORKER_POLL_MS:1500}}")
    public void pollPublications() throws SQLException {
        if (!graph.enabled()) return;
        for (String id : jobs.publications()) if (publish(id)) return;
    }

    private final java.util.concurrent.locks.Lock parseCapacity=new java.util.concurrent.locks.ReentrantLock();
    private final java.util.concurrent.locks.Lock publishCapacity=new java.util.concurrent.locks.ReentrantLock();

    boolean publish(String id) throws SQLException {
        if (!graph.enabled()) return false;
        return withJobLock(id, publishCapacity, connection -> {
            var task = jobs.publication(id);
            if (task == null) return;
            try {
                results.publish(id, task.videoId());
            } catch (java.io.IOException e) {
                if (Thread.currentThread().isInterrupted() || !connection.isValid(3))
                    throw new SQLException("发布会话中断，保留任务", e);
                log.warn("图发布失败 {} (第 {} 次)", id, task.attempts()+1, e);
                service.publicationFailed(id, task.attempts()+1);
                return;
            }
            service.finish(id, "publishing", null);
        });
    }

    @FunctionalInterface
    private interface LockedJob { void run(Connection connection) throws SQLException; }

    boolean process(String id) throws SQLException {
        return withJobLock(id, parseCapacity, connection -> {
            var task = jobs.get(id);
            if (task == null) return;
            boolean runnable = switch (task.status()) {
                case "queued" -> jobs.startQueued(id) == 1;
                case "pausing" -> { service.parkIfRequested(id); yield false; }
                case "running" -> true; // Its previous execution no longer holds the job lock.
                default -> false;
            };
            if (runnable) execute(id, task.videoId(), connection);
        });
    }

    private boolean withJobLock(String id, java.util.concurrent.locks.Lock capacity, LockedJob job) throws SQLException {
        if(!capacity.tryLock()) return false;
        try(var c=db.getConnection(); var lock=MySqlLock.tryAcquire(c,JobMapper.LOCK_PREFIX+id)) {
            if(lock==null) return false;
            job.run(c);
            return true;
        } finally {capacity.unlock();}
    }
    private static final class Paused extends RuntimeException {}

    private void execute(String id,String video,Connection lock) throws SQLException {
        var pb=new ProcessBuilder(python,"-m",engine.equals("java")?"app.tool_worker":"app.platform_worker",id,video);
        pb.directory(directory.toFile()); pb.redirectError(ProcessBuilder.Redirect.INHERIT);
        pb.environment().put("DATA_ROOT",data.toAbsolutePath().normalize().toString());
        pb.environment().put("PUBLIC_BASE_URL",publicBase);
        // Imported pre-workspace jobs can have no owner. Keep their receipts separate.
        String owner=java.util.Objects.toString(jobs.videoOwner(video),"legacy");
        pb.environment().put("VP_USAGE_OWNER",owner);
        pb.environment().put("VP_USAGE_OPERATION","analyze");
        if(engine.equals("java")) {
            try (var scope=ApiUsage.scope(owner,"repair")) {
                flow.run(pb, event -> {
                    try {if(!lock.isValid(3)) throw new IllegalStateException("任务会话已断开");}
                    catch(SQLException ex){throw new IllegalStateException(ex);}
                    service.appendEvent(id,event);
                }, () -> { if (service.parkIfRequested(id)) throw new Paused(); });
            } catch(Paused stopped){return;}
              catch(InterruptedException ex){Thread.currentThread().interrupt();return;}
              catch(Exception ex){
                if(!lock.isValid(3)) throw new SQLException("丢失任务锁，保留待恢复任务",ex);
                log.error("解析失败 {}",id,ex);
                service.finish(id,"running","解析失败："+ex.getClass().getSimpleName());
                return;
            }
            service.mediaReady(id);
            return;
        }
        pb.environment().put("VP_PAUSE_PROTOCOL", "1");
        Process child;
        try {child=pb.start();} catch(java.io.IOException e) {service.finish(id,"running","无法启动解析进程");return;}
        try(var readers=Executors.newVirtualThreadPerTaskExecutor()) {
            var reader=readers.submit(() -> {
                try(var stream=child.inputReader(StandardCharsets.UTF_8);
                    var commands=child.outputWriter(StandardCharsets.UTF_8)) {
                    for(String line;(line=stream.readLine())!=null;) {
                        if (line.equals("VP_CHECKPOINT")) {
                            boolean paused = service.parkIfRequested(id);
                            commands.write(paused ? "pause\n" : "continue\n");
                            commands.flush();
                            continue;
                        }
                        if(!line.startsWith("VP_EVENT ")) continue;
                        var ev=json.readTree(line.substring(9));
                        if(ev.isObject() && ev.hasNonNull("type")) service.appendEvent(id,ev.toString());
                    }
                }
                return null;
            });
            try {
                while(!child.waitFor(1,TimeUnit.SECONDS)) {
                    if(reader.isDone()) reader.get();
                    if(!lock.isValid(3)) throw new SQLException("解析任务数据库连接中断");
                }
                reader.get();
                if(child.exitValue()==0) service.mediaReady(id);
                else if(child.exitValue()!=76) service.finish(id,"running","解析进程失败，退出码 "+child.exitValue());
            } catch(InterruptedException e) {Thread.currentThread().interrupt();}
              catch(ExecutionException e) {log.error("事件记录失败，保留可恢复任务 {}",id,e);}
            finally {if(child.isAlive()) child.destroyForcibly();}
        }
    }
}
