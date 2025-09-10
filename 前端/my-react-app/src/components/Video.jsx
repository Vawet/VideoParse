import React, { useState,useRef,useEffect } from 'react';
import { Icon } from '@iconify/react'; // 添加Icon导入
import GPPT from './GPPT.jsx'; // 导入PPT组件
import GNotes from './GNotes.jsx';
import GMindMap from './GMindMap.jsx';
import {STORES,initDB,addToStore,updateStore,getFromStoreByKey} from '../db.js';
import axios from 'axios';
const Video = ({videoId}) => {
  const [db, setDb] = useState(null);
  // 初始化数据库,检查数据库里是否有存储视频的地址和解析的内容，
  // 修复后的useEffect
  const [video,setVideo]=useState({});
useEffect(() => {
  
  const init = async () => {
      try {
          // 1. 先初始化数据库
          const database = await initDB();
          setDb(database);
          
          // 2. 使用新初始化的database，而不是db状态
          if (videoId) {
              const video = await getFromStoreByKey(database, STORES.VIDEOS, videoId);
              
              if (video) {
                  if (video.status === 'parsing') {
                      video.status = 'null';
                      await updateStore(database, STORES.VIDEOS, video);
                  }
                  
                  if (video.status === 'completed') {
                      setAnalysis(video.analysis);
                      setPPT(video.ppt);
                      setVideoUrl(video.videoUrl);
                  }
              }
              setVideo(video);
          }
      } catch (error) {
          console.error('初始化失败:', error);
      }
  };
  
  init();
}, [videoId]);

  const handleUpdateVideo1=async (videoUrl)=>{
    if(db){
      // const video={
      //   videoId:videoId,
      //   videoUrl:videoUrl,
      //   status:'parsing'
      // }
      video.videoUrl=videoUrl;
      video.status='parsing';
      await updateStore(db, STORES.VIDEOS, video);
    }
  };
  // 添加状态来跟踪当前选中的标签页，默认为 'aiNotes'
  const [activeTab, setActiveTab] = useState('aiNotes');

  // 实现 switchTab 函数
  const switchTab = (tabId) => {
    setActiveTab(tabId);
  };
  const [isDragging, setIsDragging] = useState(false);
  const [videoUrl, setVideoUrl] = useState(null);
  const videoUploadRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    handleVideoFile(file);
    console.log(analysis)
  };
  // const progressBarRef = useRef(null);
  const [progressText, setProgressText] = useState('');
  const [uploadPercent,setUploadPercent]=useState(0);
  const API_BASE_URL = 'http://localhost:5000'
  const handleVideoFile = (file) => {
    if (file && file.type.startsWith('video/')) {
            const formData = new FormData();
            formData.append('video', file);

            // 发送上传请求
            // fetch(`${API_BASE_URL}/upload`, {
            //     method: 'POST',
            //     body: formData,
            //     mode: 'cors', // 如果涉及跨域，设置为cors
            // })
            // .then(response => response.json())
            // .then(data => {
            //     if (data.success) {
            //         // 上传成功，开始分析视频
            //         // progressTextRef.current.textContent = '上传完成！正在分析视频...';
            //         analyzeVideo(data.filepath);
            //         setVideoUrl(`${API_BASE_URL}/uploads/${data.filepath}`);
            //         // db需要存储 视频路径 ai笔记 ai概览 ai脑图 ppt 
            //         // 同时在这里更新status为parsing
            //         handleUpdateVideo1(videoUrl)
            //     } else {
            //         // progressTextRef.current.textContent = `上传失败: ${data.error}`;
            //     }
            // })
            // .catch(error => {
            //     console.error('上传错误:', error);
            // });
            // 发送上传请求（axios 版本）
            axios({
              method: 'POST', // 与原 fetch 一致：POST 请求
              url: `${API_BASE_URL}/upload`, // 与原 fetch 一致：上传接口地址
              data: formData, // 与原 fetch 一致：表单数据（包含文件）
              mode: 'cors', // 跨域配置（axios 会自动处理，可保留）
              headers: {
                // 可选：若后端需要特定请求头，可在此添加（如 Content-Type 无需手动设，axios 会自动识别 formData 并设置）
                // 'Authorization': 'Bearer xxx' // 示例：如果需要token认证
              },
              // 核心：axios 自带的上传进度回调（无需额外封装）
              onUploadProgress: (progressEvent) => {
                // 判断进度是否可计算（避免异常情况）
                if (progressEvent.lengthComputable) {
                  // 计算上传进度百分比（保留1位小数）
                  const percent = (progressEvent.loaded / progressEvent.total) * 100;
                  setUploadPercent(Number(percent.toFixed(1)));
                
                  // 更新UI进度（根据你的实际UI调整）
                  
                    setProgressText(`上传中: ${uploadPercent}%`);
                  
                  // if (progressBarRef) {
                  //   progressBarRef.current.style.width = `${uploadPercent}%`; // 进度条宽度同步
                  // }
                
                  // 可选：打印进度日志（调试用）
                  console.log(`上传进度：${uploadPercent}%，已传：${progressEvent.loaded}字节，总：${progressEvent.total}字节`);
                }
              },
              // 可选：设置超时时间（避免长时间无响应，单位：毫秒）
              timeout: 60000 // 60秒超时
            })
            .then((response) => {
              // 上传成功：axios 会自动解析响应体（无需手动 response.json()）
              const data = response.data; // 直接拿到后端返回的JSON数据
              if (data.success) {
                // 原有业务逻辑不变：更新进度提示、分析视频、设置视频URL等
                setProgressText('上传完成！正在分析视频...') ;
                analyzeVideo(data.filepath);
                setVideoUrl(`${API_BASE_URL}/uploads/${data.filepath}`);
                handleUpdateVideo1(`${API_BASE_URL}/uploads/${data.filepath}`); // 注意：原videoUrl可能未更新，直接用data.filepath推导更可靠
              } else {
                // 上传失败（后端返回success: false）
                setProgressText(`上传失败: ${data.error || '未知错误'}`);
              }
            })
            .catch((error) => {
              // 捕获请求异常（网络错误、超时、后端500等）
              console.error('上传错误:', error);
                if (error.code === 'ECONNABORTED') {
                  setProgressText('上传超时，请重试');
                } else {
                  setProgressText('上传出错，请检查网络');
                
              }
            });
    } else if (file) {
      alert('请上传有效的视频文件');
    }
  };
  // 分析视频
  const [analysis, setAnalysis] = useState(null);
  const [PPT,setPPT]=useState([]);
  const handleUpdateVideo2 = async (analysis,ppt,heavy_img) => {
    if(db){
      
      video.analysis=analysis;
      video.ppt=ppt;
      video.status='completed';
      video.heavy_img=heavy_img;
      await updateStore(db, STORES.VIDEOS, video);
    }
  }
  function analyzeVideo(filepath) {
    fetch(`${API_BASE_URL}/analyze`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ filepath: filepath })
    })
    .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP错误! 状态码: ${response.status}`);
            }
            return response.json();
        })
    .then(async (data) => {
        if (data.success) {
            // 显示分析结果区域
            // document.getElementById('summarySection').style.display = 'block';
            // document.getElementById('highlightsSection').style.display = 'block';
            // document.getElementById('segmentsSection').style.display = 'block';
            // 隐藏上传进度
            // document.getElementById('uploadProgress').classList.add('d-none');
            // 表示把获取到的heavy改名为heavy_img
            const {ppt, heavy:heavy_img}=await getPPT(data.video_id);
            setAnalysis(data.result);
            
            // 这里会更新statues的值为completed！
            handleUpdateVideo2(data.result,ppt,heavy_img);
        } else {
            alert(`分析失败: ${data.error}`);
        }
    })
    .catch(error => {
        console.error('分析错误:', error);
        alert('分析发生错误',error);
    });
  };
  const [HEAVY,setHEAVY]=useState([]);

  useEffect(() => {
  console.log("HEAVY 状态更新后：", HEAVY);
  console.log("PPT 状态更新后：", PPT);
}, [HEAVY,PPT]);

  // 定义函数获取 PNG 文件名列表
  async function getPPT(videoId) {
      try {
          const response = await fetch(`${API_BASE_URL}/frames/${videoId}`);
          const data = await response.json();
          if (data.success) {
            console.log("PPT",data.ppt);
              console.log("HEAVY",data.heavy)
              setPPT(data.ppt);
              setHEAVY(data.heavy);
              
              return {ppy:data.ppt,heavy:data.heavy};
          } 
      } catch (error) {
          console.error('请求出错:', error);
          return {ppt:[],heavy:[]};
      }
  }
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    handleVideoFile(file);
    console.log(analysis)
    
    // 更新file input的值
    if (videoUploadRef.current && file) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      videoUploadRef.current.files = dataTransfer.files;
    }
  };
  
    const triggerFileSelect = () => {
      videoUploadRef.current.click();
    };
    // 处理点击AI概览区域按钮视频跳转到对应时间戳！
    const videoRef = useRef(null);
    const parseTimeToSeconds = (timeStr) => {
      if (!timeStr) return 0;
      if(timeStr.includes(':')){
        const parts = timeStr.split(':').map(p => Number(p));
        if (parts.length === 3) {
          return parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
          return parts[0] * 60 + parts[1];
        }
      }
      return Number(timeStr) || 0;
    };
    const handleSeek = (timeStr) => {
      const sec = parseTimeToSeconds(timeStr);
      const v = videoRef.current;
      if (!v) return;
      // 如果视频尚未加载元数据，先加载后再跳转
      if (isNaN(v.duration) || v.readyState < 1) {
        v.addEventListener('loadedmetadata', function once() {
          v.currentTime = Math.min(sec, v.duration);
          v.play().catch(()=>{});
          v.removeEventListener('loadedmetadata', once);
        });
      } else {
        v.currentTime = Math.min(sec, v.duration);
        v.play().catch(()=>{});
      }
    };
    // 我想要验证一下analysis的数据是否正确
    useEffect(() => {
      // console.log('analysis对象结构:', analysis);
      // console.log('mindmap数据:', analysis?.mind_map);
      // console.log('segments数据:', analysis?.segments);
      console.log(PPT)
    }, [analysis]);
  return (
    // 主内容区 - 添加动态宽度调整 
    <div id="mainContent" className="flex-1 flex overflow-hidden transition-all duration-300">
      <div className="flex-1 overflow-y-auto bg-gray-50 p-2">
        {/* 上传视频 + 预览区域 */}
        <div>
      {/* 文件上传输入（隐藏） */}
      <input
        type="file"
        id="videoUpload"
        ref={videoUploadRef}
        accept="video/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* 上传区域 */}
      {!videoUrl && (
        <div
          className={`relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            isDragging ? 'bg-blue-50 border-blue-300' : 'border-gray-300 hover:bg-gray-50'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={triggerFileSelect}
        >
          <div id="uploadArea" className="space-y-2">
            <p>拖放视频文件到此处，或点击选择视频</p>
            <p className="text-sm text-gray-500">支持常见视频格式</p>
          </div>
        </div>
      )}

      {/* 视频预览区域 */}
      {videoUrl && (
        <div id="videoPreviewContainer" className="mt-4">
          <video
            id="videoPreview"
            src={videoUrl}
            ref={videoRef}
            controls
            className="w-full max-w-4xl mx-auto"
          />
        </div>
      )}
    </div>


        {/* 亮点横条展示区域 */}
        <div className="mt-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-3">亮点分析</h3>
          <div className="flex flex-col space-y-2">
            {analysis?.highlights && Array.isArray(analysis.highlights)&& analysis.highlights.length > 0 ? (
              analysis.highlights.map((highlight, index) => (
                <div key={index} className="bg-white rounded-lg p-3 shadow-sm mb-2">
                  <p className="text-gray-700" id={`highlight${index + 1}`}>
                    {highlight}
                  </p>
                </div>
              ))
            ) : (
              <div className="bg-white rounded-lg p-3 shadow-sm">
                <p className="text-gray-700">暂无亮点</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 右侧详情面板 - 扩大宽度 */}
      <div id="rightPanel"
        className="right-panel w-[670px] bg-white border-l border-gray-200 p-5 overflow-y-auto">
        {/* 面包屑导航 - 默认选中AI笔记 */}
        <div className="border-b border-gray-200 mb-6 overflow-x-auto">
          <div className="flex space-x-1 pb-2 min-w-max">
            <button 
              id="aiOverview"
              className={`px-4 py-2 rounded-t-lg text-sm font-medium border-t-2 transition-colors ${activeTab === 'aiOverview' ? 'bg-blue-50 text-blue-600 border-blue-500' : 'hover:bg-gray-50 text-gray-600 border-transparent hover:border-gray-300'}`}
              onClick={() => switchTab('aiOverview')}
            >
              AI概览
            </button>
            <button 
              id="aiNotes"
              className={`px-4 py-2 rounded-t-lg text-sm font-medium border-t-2 transition-colors ${activeTab === 'aiNotes' ? 'bg-blue-50 text-blue-600 border-blue-500' : 'hover:bg-gray-50 text-gray-600 border-transparent hover:border-gray-300'}`}
              onClick={() => switchTab('aiNotes')}
            >
              AI笔记
            </button>
            <button 
              id="aiMindmap"
              className={`px-4 py-2 rounded-t-lg text-sm font-medium border-t-2 transition-colors ${activeTab === 'aiMindmap' ? 'bg-blue-50 text-blue-600 border-blue-500' : 'hover:bg-gray-50 text-gray-600 border-transparent hover:border-gray-300'}`}
              onClick={() => switchTab('aiMindmap')}
            >
              AI脑图
            </button>
            <button 
              id="aiPpt"
              className={`px-4 py-2 rounded-t-lg text-sm font-medium border-t-2 transition-colors ${activeTab === 'aiPpt' ? 'bg-blue-50 text-blue-600 border-blue-500' : 'hover:bg-gray-50 text-gray-600 border-transparent hover:border-gray-300'}`}
              onClick={() => switchTab('aiPpt')}
            >
              PPT页面
            </button>
          </div>
        </div>

        {/* AI概览内容 */}
        {activeTab === 'aiOverview' && (
          <div id="aiOverviewContent" className="space-y-6">
                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                        <h4 className="font-medium text-blue-800 mb-2 flex items-center">
                            <Icon icon="mdi:chart-line" className="mr-2 text-blue-600"></Icon>
                            视频内容分析
                        </h4>
                        {/* <!-- 新增的解析内容盒子 --> */}
                        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 mb-3">
                            {/* <!-- 摘要解读 --> */}
                            <div className="mb-6">
                                <h5 className="text-base font-semibold text-gray-800 mb-3">摘要解读</h5>
                                <p className="text-sm text-gray-600 leading-relaxed">
                                   {analysis?.summary ?? '等待分析结果…'}
                                </p>
                            </div>
                            {analysis?.division && Array.isArray(analysis.division)&& analysis.division.length > 0 ? (
                            analysis.division.map((divide, index) => (
                                  <div className="mb-6" key={`divide${index + 1}`} >
                                <div className="mb-4 pb-4 border-b border-gray-100 last:border-0 last:mb-0 last:pb-0">
                                    <div className="flex items-start mb-2">
                                        {/* <!-- 点击时间戳左侧视频进行对应跳转--> */}
                                        <div className="flex-shrink-0 w-16 text-center"
                                        onClick={() => handleSeek(divide.time_range.start_time)}
                                        >
                                            <span
                                                className="inline-block px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded hover:bg-blue-100 hover:text-blue-700 transition-colors duration-200 cursor-pointer">
                                                {divide.time_range.start_time}<br></br>-{divide.time_range.end_time}
                                            </span>
                                        </div>
                        
                                        {/* <!-- 内容区域 --> */}
                                        <div className="flex-1 ml-3">
                                            <h6 className="font-semibold text-gray-800 mb-2">{divide.title}</h6>
                                            <ul className="text-sm text-gray-600 space-y-1.5 ml-5 list-disc">
                                              {divide.summary.map((point,index)=>(
                                                <li key={`point${index + 1}`}>{point}</li>
                                              ))
                                              }
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                              </div>
                            ))
                              ) : (
                                <div className="mb-6">
                                <h5 className="text-base font-semibold text-gray-800 mb-3">分段总结</h5>

                                <div className="mb-4 pb-4 border-b border-gray-100 last:border-0 last:mb-0 last:pb-0">
                                    <div className="flex items-start mb-2">
                                        {/* <!-- 时间戳 --> */}
                                        <div className="flex-shrink-0 w-16 text-center"
                                        
                                        >
                                            <span
                                                className="inline-block px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded hover:bg-blue-100 hover:text-blue-700 transition-colors duration-200 cursor-pointer">
                                                时间戳
                                            </span>
                                        </div>
                        
                                        {/* <!-- 内容区域 --> */}
                                        <div className="flex-1 ml-3">
                                            <h6 className="font-semibold text-gray-800 mb-2">分段总结小标题</h6>
                                            <ul className="text-sm text-gray-600 space-y-1.5 ml-5 list-disc">
                                                <li>分点总结</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            </div>
                              )}
                            
                            
                            {/* <!-- 重点总结 --> */}
                            <div>
                                <h5 className="text-base font-semibold text-gray-800 mb-3">重点总结</h5>
                                {analysis?.heavys && Array.isArray(analysis.heavys)&& analysis.heavys? (
                                analysis.heavys.map((heavy, index) => (
                                  <div className="mb-2" key={`heavy${index + 1}`}>
                                    <div className="flex items-start mb-3">
                                        {/* <!-- 时间戳 --> */}
                                        <div className="flex-shrink-0 w-16 text-center"
                                        onClick={() => handleSeek(heavy.time_range.start_time)}
                                        >
                                            <span
                                                className="inline-block px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded hover:bg-blue-100 hover:text-blue-700 transition-colors duration-200 cursor-pointer">
                                                {heavy.time_range.start_time}<br></br>-{heavy.time_range.end_time}
                                            </span>
                                        </div>
                        
                                        {/* <!-- 内容区域 --> */}
                                        <div className="flex-1 ml-3">
                                            <h6 className="font-semibold text-gray-800 mb-2">{heavy.title}</h6>
                        
                                            {/* <!-- 图片显示区域 根据 idx显示对用图片！ HEAVY数组 --> */}
                                            <div className="mt-2 rounded-lg overflow-hidden border border-gray-200">
                                                <img src={`http://localhost:5000${HEAVY[index]}`} alt="AI重点解析" className="w-full h-auto object-cover"></img>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                ))
                              ) : (
                                <div className="bg-white rounded-lg p-3 shadow-sm">
                                  <p className="text-gray-700">重点解析中...</p>
                                </div>
                              )}
                                
                                
                            </div>
                        </div>
                        
                        <p className="text-sm text-gray-700 mb-3">{progressText}</p>
                        {/* 进度条 */}
                        <div className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm">
                            <div className="flex justify-between text-xs text-gray-500 mb-1">
                                <span>进度</span>
                                <span>{uploadPercent}%</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-1.5 mb-2">
                                <div  className="bg-blue-600 h-1.5 rounded-full" style={{width:'`${uploadPercent}`%'}}></div>
                            </div>
                            <button className="text-xs text-blue-600 hover:text-blue-800">查看详情</button>
                        </div> 
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div
                            className="p-3 bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex items-center justify-between mb-2">
                                <h5 className="text-sm font-medium text-gray-800">关键词提取</h5>
                                <iconify-icon icon="mdi:tag-outline" className="text-blue-500"></iconify-icon>
                            </div>
                            <p className="text-xs text-gray-500">已识别12个核心关键词</p>
                        </div>
                        <div
                            className="p-3 bg-white rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                            <div className="flex items-center justify-between mb-2">
                                <h5 className="text-sm font-medium text-gray-800">情感分析</h5>
                                <iconify-icon icon="mdi:emotion-happy-outline" className="text-green-500"></iconify-icon>
                            </div>
                            <p className="text-xs text-gray-500">积极: 75%, 消极: 25%</p>
                        </div>
                    </div>
                </div>
        )}

        {/* AI笔记内容 */}
        {activeTab === 'aiNotes' && (
          <GNotes textSample={analysis?.segments && Array.isArray(analysis.segments) ?analysis.segments[0].notes.content:''}></GNotes>
        )}

        {/* AI脑图内容 */}
        {activeTab === 'aiMindmap' && (
          <GMindMap mindMapData={analysis?.mind_map }></GMindMap>
        )}

        {/* PPT页面内容 */}
        {activeTab === 'aiPpt' && (
          <GPPT aPPT={PPT}></GPPT>
        )}
      </div>
    </div>
  );

};

export default Video;