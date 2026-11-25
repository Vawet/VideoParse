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
    static final class Index {
        private record Posting(int passage, int frequency) {}
        private final List<Passage> passages;
        private final Map<String,List<Posting>> postings = new HashMap<>();
        private final int[] lengths;
        private final double averageLength;
        private final int estimatedBytes;

        Index(List<Passage> passages) {
            this.passages = List.copyOf(passages);
            lengths = new int[passages.size()];
            long totalLength = 0, bytes = 256;
            for (int i = 0; i < passages.size(); i++) {
                var passage = passages.get(i);
                bytes += 176L + 2L * (passage.text().length() + (long) Objects.toString(passage.frame(), "").length()
                    + Objects.toString(passage.source(), "").length());
                for (var term : tokens(passage.text()).entrySet()) {
                    int frequency = term.getValue();
                    postings.computeIfAbsent(term.getKey(), key -> new ArrayList<>()).add(new Posting(i, frequency));
                    lengths[i] += frequency;
                }
                totalLength += lengths[i];
            }
            averageLength = (double) Math.max(1, totalLength) / Math.max(1, passages.size());
            for (var term : postings.entrySet())
                bytes += 192L + 2L * term.getKey().length() + 40L * term.getValue().size();
            estimatedBytes = (int) Math.min(bytes, Integer.MAX_VALUE);
        }

        List<Passage> passages() { return passages; }
        int estimatedBytes() { return estimatedBytes; }

        List<Integer> lexical(String question) {
            var scores = new HashMap<Integer,Double>();
            for (String term : tokens(question).keySet()) {
                var matches = postings.get(term);
                if (matches == null) continue;
                int df = matches.size();
                double idf = Math.log1p((passages.size() - df + 0.5) / (df + 0.5));
                for (var match : matches) {
                    int i = match.passage(), f = match.frequency();
                    double score = idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * lengths[i] / averageLength));
                    scores.merge(i, score, Double::sum);
                }
            }
            return rank(scores);
        }
    }
    static List<Integer> rank(Map<Integer,Double> scores) {
        return scores.keySet().stream().sorted(Comparator.<Integer>comparingDouble(scores::get).reversed().thenComparingInt(i->i)).limit(16).toList();
    }
}
