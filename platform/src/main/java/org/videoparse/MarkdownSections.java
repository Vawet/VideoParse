package org.videoparse;

import java.util.*;
import java.util.regex.Pattern;

final class MarkdownSections {
    record Chunk(int ordinal,String heading,int firstLine,int lastLine,String body) {}
    private static final Pattern HEADING = Pattern.compile("^ {0,3}(#{1,6})(?:[ \\t]+(.*)|$)");
    private static final Pattern FENCE = Pattern.compile("^ {0,3}(`{3,}|~{3,})(.*)$");
    private static final int LIMIT = 600;
    private final List<Chunk> chunks = new ArrayList<>();
    private final StringBuilder body = new StringBuilder();
    private int start, end;
    private String heading = "";

    static List<Chunk> split(String markdown) {
        var out = new MarkdownSections();
        var path = new String[6];
        String fence = null;
        String[] lines = markdown.split("\n",-1);
        for (int i=0; i<lines.length; i++) {
            String line=lines[i];
            var marker=FENCE.matcher(line);
            if (marker.matches()) {
                String run=marker.group(1);
                if (fence==null) fence=run;
                else if (run.startsWith(fence) && marker.group(2).isBlank()) fence=null;
            } else if (fence==null) {
                var h=HEADING.matcher(line);
                if (h.matches()) {
                    out.flush();
                    int level=h.group(1).length()-1;
                    Arrays.fill(path,level,6,null);
                    path[level]=title(h.group(2));
                    String title=String.join(" › ",Arrays.stream(path).filter(Objects::nonNull).toList());
                    out.heading=cut(title,480);
                }
            }
            out.line(line,i+1);
        }
        out.flush();
        return out.chunks;
    }

    private static String title(String text) {
        String value=Objects.toString(text,"").stripTrailing();
        int marker=value.length();
        while (marker>0 && value.charAt(marker-1)=='#') marker--;
        if (marker<value.length() && (marker==0 || value.charAt(marker-1)==' ' || value.charAt(marker-1)=='\t'))
            value=value.substring(0,marker);
        return cut(value.strip(),480);
    }

    private static int sliceEnd(String text,int offset,int max) {
        int end=Math.min(text.length(),offset+max);
        return end<text.length() && Character.isHighSurrogate(text.charAt(end-1)) ? end-1 : end;
    }

    private static String cut(String s,int max) {
        return s.substring(0,sliceEnd(s,0,max));
    }

    private void line(String text,int number) {
        if (!body.isEmpty() && body.length()+text.length()+1>LIMIT) flush();
        if (body.isEmpty() && text.isBlank()) return;
        int offset=0;
        while (text.length()-offset>LIMIT) {
            int next=sliceEnd(text,offset,LIMIT);
            start=end=number;
            body.append(text,offset,next);
            flush();
            offset=next;
        }
        if (body.isEmpty()) start=number;
        else body.append('\n');
        body.append(text,offset,text.length());
        end=number;
    }

    private void flush() {
        if (!body.isEmpty() && !body.toString().isBlank()) chunks.add(new Chunk(chunks.size(),heading,start,end,body.toString()));
        body.setLength(0);
    }
}
