package org.videoparse;

import com.fasterxml.jackson.databind.*;
import java.io.*;
import java.nio.file.*;
import java.text.Normalizer;
import java.util.*;
import java.util.regex.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
class EvidenceCorpus {
    record Passage(int id,String source,double start,double end,String text,String frame) {}
    private final Path outputs;
    private final ObjectMapper json;
    EvidenceCorpus(@Value("${videoparse.data}") Path root,ObjectMapper json){this.outputs=root.resolve("outputs");this.json=json;}

    List<Passage> load(String video) throws IOException {
        if(!video.matches("[a-zA-Z0-9_-]{1,64}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"视频编号无效");
        var dir=outputs.resolve(video+"_work");
        if(!Files.isDirectory(dir)) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"视频未解析");
        var result=new ArrayList<Passage>();
        if(Files.isRegularFile(dir.resolve("transcript.json"))) {
            var data=json.readTree(dir.resolve("transcript.json").toFile());
            for(var s:data.path("segments")) add(result,s.path("text").asText(),s.path("start_time").asDouble(),
                    s.path("end_time").asDouble(),data.path("source").asText("").equals("visual")?"frame_note":"speech","");
        }
        if(Files.isRegularFile(dir.resolve("ocr.json"))) {
            for(var f:json.readTree(dir.resolve("ocr.json").toFile())) {
                double start=f.path("start").asDouble();
                add(result,f.path("text").asText(),start,start,"ocr",f.path("frame").asText());
            }
        }
        return result;
    }
    private static void add(List<Passage> out,String text,double start,double end,String source,String frame) {
        if(!text.isBlank()) out.add(new Passage(out.size(),source,start,end,text,frame));
    }

    private static final Pattern TOKEN=Pattern.compile("\\p{IsHan}+|[\\p{L}\\p{N}_]+");
    static Map<String,Integer> tokens(String text) {
        var map=new HashMap<String,Integer>();
        var matcher=TOKEN.matcher(Normalizer.normalize(text,Normalizer.Form.NFKC).toLowerCase(Locale.ROOT));
        while(matcher.find()) {
            String word=matcher.group();
            if(Character.UnicodeScript.of(word.codePointAt(0))==Character.UnicodeScript.HAN) {
                int[] cps=word.codePoints().toArray();
                for(int i=0;i<cps.length;i++) {
                    map.merge(new String(cps,i,1),1,Integer::sum);
                    if(i>0) map.merge(new String(cps,i-1,2),1,Integer::sum);
                }
            } else map.merge(word,1,Integer::sum);
        }
        return map;
    }
    static List<Integer> lexical(List<Passage> docs,String question) {
        var query=tokens(question).keySet();
        var terms=docs.stream().map(p->tokens(p.text())).toList();
        var df=new HashMap<String,Integer>();
        var lengths=new int[docs.size()]; int total=0;
        for(int i=0;i<terms.size();i++) {
            var frequencies=terms.get(i);
            for(String q:query) if(frequencies.containsKey(q)) df.merge(q,1,Integer::sum);
            lengths[i]=frequencies.values().stream().mapToInt(Integer::intValue).sum(); total+=lengths[i];
        }
        double avg=(double)Math.max(1,total)/Math.max(1,docs.size());
        var scores=new HashMap<Integer,Double>();
        for(int i=0;i<terms.size();i++) {
            double score=0;
            for(String q:query) {
                int f=terms.get(i).getOrDefault(q,0);
                if(f==0) continue;
                double idf=Math.log1p((docs.size()-df.get(q)+0.5)/(df.get(q)+0.5));
                score+=idf*f*2.2/(f+1.2*(0.25+0.75*lengths[i]/avg));
            }
            if(score>0) scores.put(i,score);
        }
        return rank(scores);
    }
    static List<Integer> rank(Map<Integer,Double> scores) {
        return scores.keySet().stream().sorted(Comparator.<Integer>comparingDouble(scores::get).reversed().thenComparingInt(i->i)).limit(16).toList();
    }
}
