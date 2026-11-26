package org.videoparse;

import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
class CourseController {
    private final JdbcClient db;
    private final Visitor visitor;
    CourseController(JdbcClient db,Visitor visitor){this.db=db;this.visitor=visitor;}
    private String create(String title){
        if(title==null || title.isBlank() || title.strip().length()>200)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"课程名称需要 1 至 200 字");
        String id=UUID.randomUUID().toString().replace("-","");
        db.sql("INSERT INTO courses(id,name,created_at,owner_id) VALUES(?,?,UTC_TIMESTAMP(),?)").params(id,title.strip(),visitor.id()).update();
        return id;
    }
    @PostMapping("/courses") Map<String,Object> add(@RequestBody Map<String,String> b){
        String title=b.get("name"), id=create(title);
        return Map.of("success",true,"course",Map.of("name",title.strip(),"id",id));
    }
    @GetMapping("/courses") Map<String,Object> list(){
        var rows=db.sql("SELECT c.id,c.name,COUNT(v.id) video_count FROM courses c LEFT JOIN videos v ON v.course_id=c.id AND v.owner_id=c.owner_id WHERE c.owner_id=? GROUP BY c.id,c.name ORDER BY c.created_at,c.id").param(visitor.id()).query().listOfRows();
        return Map.of("success",true,"courses",rows);
    }
    @GetMapping("/courses/{id}") Map<String,Object> course(@PathVariable String id){
        var name=db.sql("SELECT name FROM courses WHERE id=? AND owner_id=?").params(id,visitor.id()).query(String.class).optional()
            .orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"课程不存在"));
        var videos=db.sql("SELECT id,COALESCE(NULLIF(title,''),LEFT(id,8)) title,duration,status FROM videos WHERE course_id=? AND owner_id=? ORDER BY created_at,id").params(id,visitor.id()).query().listOfRows();
        return Map.of("success",true,"course",Map.of("id",id,"name",name,"videos",videos));
    }
    @PostMapping("/courses/{id}/videos") @Transactional
    public Map<String,Object> assign(@PathVariable String id,@RequestBody Map<String,String> input){
        visitor.course(id);
        String video=input.getOrDefault("video_id","");
        if(db.sql("SELECT id FROM videos WHERE id=? AND owner_id=? FOR UPDATE").params(video,visitor.id()).query(String.class).optional().isEmpty())
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"请先上传视频");
        db.sql("UPDATE videos SET course_id=? WHERE id=?").params(id,video).update();
        return course(id);
    }
    @PostMapping("/v2/videos/{video}/course") @Transactional
    public Map<String,Object> courseForLearning(@PathVariable String video){
        var row=db.sql("SELECT course_id,title FROM videos WHERE id=? AND owner_id=? FOR UPDATE").params(video,visitor.id()).query((rs,n) -> { var m=new HashMap<String,String>(); m.put("course_id",rs.getString(1)); m.put("title",rs.getString(2)); return m; }).optional()
            .orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"未登记视频"));
        String id=(String)row.get("course_id");
        if(id==null){
            String title=Objects.toString(row.get("title"),video);
            id=create(title.isBlank()?video:title.substring(0,Math.min(200,title.length())));
            db.sql("UPDATE videos SET course_id=? WHERE id=?").params(id,video).update();
        }
        return Map.of("success",true,"course_id",id);
    }
}
