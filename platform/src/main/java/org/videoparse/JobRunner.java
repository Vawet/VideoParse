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
    JobRunner(DataSource db, JobMapper jobs, JobService service, ObjectMapper json,
              @Value("${videoparse.python}") String python, @Value("${videoparse.worker-dir}") Path directory,
              @Value("${videoparse.data}") Path data, @Value("${videoparse.public-base}") String publicBase) {
        this.db=db; this.jobs=jobs; this.service=service; this.json=json;
        this.python=python; this.directory=directory; this.data=data; this.publicBase=publicBase;
    }
    private boolean lock(Connection c, String function, String id) throws SQLException {
        String sql=function.equals("acquire")?"SELECT GET_LOCK(?,0)":"SELECT RELEASE_LOCK(?)";
        try(var s=c.prepareStatement(sql)) {
            s.setString(1,"videoparse:"+id);
            try(var r=s.executeQuery()) {return r.next() && r.getInt(1)==1;}
        }
    }
    @Scheduled(fixedDelayString="${WORKER_POLL_MS:1500}")
    public void poll() throws SQLException {
        for(String id:jobs.candidates()) {
            try(var c=db.getConnection()) {
                if(!lock(c,"acquire",id)) continue;
                try {
                    if(jobs.begin(id)==0) continue;
                    execute(id,jobs.get(id).videoId(),c);
                } finally {lock(c,"release",id);}
            }
            return;
        }
    }
    private void execute(String id,String video,Connection lock) throws SQLException {
        var pb=new ProcessBuilder(python,"-m","app.platform_worker",id,video);
        pb.directory(directory.toFile()); pb.redirectError(ProcessBuilder.Redirect.INHERIT);
        pb.environment().put("DATA_ROOT",data.toAbsolutePath().normalize().toString());
        pb.environment().put("PUBLIC_BASE_URL",publicBase);
        Process child;
        try {child=pb.start();} catch(java.io.IOException e) {service.finish(id,"无法启动解析进程");return;}
        try(var readers=Executors.newVirtualThreadPerTaskExecutor()) {
            var reader=readers.submit(() -> {
                try(var stream=child.inputReader(StandardCharsets.UTF_8)) {
                    for(String line;(line=stream.readLine())!=null;) {
                        if(!line.startsWith("VP_EVENT ")) continue;
                        var ev=json.readTree(line.substring(9));
                        if(ev.isObject() && ev.hasNonNull("type")) jobs.event(id,ev.toString());
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
                service.finish(id,child.exitValue()==0?null:"解析进程失败，退出码 "+child.exitValue());
            } catch(InterruptedException e) {Thread.currentThread().interrupt();}
              catch(ExecutionException e) {log.error("事件记录失败，保留可恢复任务 {}",id,e);}
            finally {if(child.isAlive()) child.destroyForcibly();}
        }
    }
}
