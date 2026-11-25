package org.videoparse;

import io.minio.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
class MediaStore {
    private final MinioClient client;
    private final String bucket;
    MediaStore(@Value("${MINIO_ENDPOINT}") String endpoint, @Value("${MINIO_ACCESS_KEY}") String key,
               @Value("${MINIO_SECRET_KEY}") String secret,@Value("${MINIO_BUCKET:videoparse}") String bucket) {
        this.client=MinioClient.builder().endpoint(endpoint).credentials(key,secret).build(); this.bucket=bucket;
    }
    private boolean ready;
    synchronized void ensureBucket() throws Exception {
        if(ready) return;
        if(!client.bucketExists(BucketExistsArgs.builder().bucket(bucket).build())) {
            try {client.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());}
            catch (io.minio.errors.ErrorResponseException e) {
                if(!"BucketAlreadyOwnedByYou".equals(e.errorResponse().code())) throw e;
            }
        }
        ready=true;
    }
    String partKey(String id,int part) {return "parts/"+id+"/"+part;}
    void put(String id,int part,byte[] data) throws Exception {
        ensureBucket();
        client.putObject(PutObjectArgs.builder().bucket(bucket).object(partKey(id,part))
             .stream(new ByteArrayInputStream(data),data.length,-1).build());
    }
    void assemble(String id,int count,String filename,Path directory) throws Exception {
        String key="videos/"+filename;
        var sources=new ArrayList<ComposeSource>();
        for(int i=0;i<count;i++) sources.add(ComposeSource.builder().bucket(bucket).object(partKey(id,i)).build());
        client.composeObject(ComposeObjectArgs.builder().bucket(bucket).object(key).sources(sources).build());
        Files.createDirectories(directory);
        Path temp=Files.createTempFile(directory,".assembling-",".tmp");
        try(var source=client.getObject(GetObjectArgs.builder().bucket(bucket).object(key).build())) {
            Files.copy(source,temp,StandardCopyOption.REPLACE_EXISTING);
            Files.move(temp,directory.resolve(filename),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
        } finally {Files.deleteIfExists(temp);}
    }
    void removePart(String id,int n) throws Exception {
        client.removeObject(RemoveObjectArgs.builder().bucket(bucket).object(partKey(id,n)).build());
    }
}
