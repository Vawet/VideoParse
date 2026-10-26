import React, { useEffect, useState, useRef } from "react";
import Header from "../components/Header.jsx"; // 导入顶部导航栏
import { Icon } from "@iconify/react";
import NewItemModal from "../components/NewItemModel.jsx";
import Hero from "../components/Hero.jsx";
import { useNavigate } from 'react-router-dom'; // React Router v6+ 推荐用法
import {STORES,initDB,addToStore,getAllFromStore,getFromStoreByKey,updateStore,deleteFromStore} from '../db.js';
const Home = () => {
  const [activeItem, setActiveItem] = useState('all-files'); // 默认选中"所有记录"
// 这里的files是解析卡片 对用存储的videos category是文件类型 对应files
  const [db, setDb] = useState(null);
    // 初始化数据库
    useEffect(() => {
          const init = async () => {
              const database = await initDB();
              setDb(database);
          };
          init();
      }, []);
  // left
  // 使用 useState 管理侧边栏状态，替代原生变量 sidebarCollapsed
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // 处理点击事件，替代原生 addEventListener
  const handleToggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };
  const sidebarRef = useRef(null);
  useEffect(() => {
    const sidebar = sidebarRef.current;
    const sidebarTexts = sidebar.querySelectorAll(
      "span, h2:not(#sidebarTitle)"
    );
    sidebarTexts.forEach((el) => {
      if (sidebarCollapsed) el.classList.add("hidden");
      else el.classList.remove("hidden");
    });
  }, [sidebarCollapsed]);
//   弹窗的状态管理
// 控制弹窗显示/隐藏的状态
  const [isModalOpen, setIsModalOpen] = useState(false);
  // 处理弹窗提交事件（可根据实际需求对接接口）
  const handleModalSubmit =async (data) => {
    if(data.type==='video'){
      await getFilesData();
    }else{
      await getCategoriesData();
    }
  };

  //mainContent
  //files是全部记录下的video catrgoryFiles是分类文件下的video
  const [files, setFiles] = useState([]);
  // categories是二维数组
  const [categories, setCategories] = useState([]);
  const [categoryFiles, setCategoryFiles] = useState([]);
  const getFilesData = async () => {
    try {
      if (db) {
        // 从数据库获取所有视频数据
        const videoData = await getAllFromStore(db, STORES.VIDEOS);

        // // 映射为需要的字段结构
        // const formattedData = videoData.map(item => ({
        //   videoId: item.videoId , // 确保有唯一ID
        //   name: item.name || "未命名视频", // 视频名称
        //   category: item.category || "Video", // 类别默认为Video
        //   date: item.date || new Date().toISOString().split('T')[0] // 日期格式化为YYYY-MM-DD
        // }));

        // 更新状态
        setFiles(videoData);
      }
    } catch (error) {
      console.error("获取数据库video-files数据失败:", error);
    }
  };
  // 获取分类文件夹的所有名称
  const getCategoriesData = async () => {
    try {
      if (db) {
        // 从数据库获取所有视频数据
        const fileData = await getAllFromStore(db, STORES.FILES);

        // 映射为需要的字段结构
        const formattedData = fileData.map(item => ({
          fileId: item.fileId , // 确保有唯一ID
          name: item.name ,
          videos:item.videos
        }));

        // 更新状态
        setCategories(formattedData);
      }
    } catch (error) {
      console.error("获取数据库的文件夹数据失败:", error);
    }
  };
// 组件挂载时获取数据
useEffect(() => {
  const fetchData=async () => {
    await Promise.all([
      getFilesData().catch(err => console.error('文件数据获取失败:', err)),
      getCategoriesData().catch(err => console.error('分类数据获取失败:', err))
    ])
  }
  fetchData();
}, [db]);

  const [draggingId, setDraggingId] = useState(null);
  // 排序 / 回收站
  const [sortKey, setSortKey] = useState('date'); // date | name | id
  const [sortDir, setSortDir] = useState('desc');
  const [sortOpen, setSortOpen] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2400); };
  useEffect(() => {
    if (!sortOpen) return undefined;
    const close = () => setSortOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [sortOpen]);

  // 软删除：移入回收站（可恢复）；彻底删除才真正从数据库移除
  const patchFile = (file, patch) => {
    const next = { ...file, ...patch };
    setFiles((fs) => fs.map((f) => (f.videoId === file.videoId ? next : f)));
    updateStore(db, STORES.VIDEOS, next);
    return next;
  };
  const moveToTrash = (file) => { patchFile(file, { deleted: true }); showToast(`"${file.name}" 已移入回收站`); };
  const restoreFile = (file, category) => {
    patchFile(file, category ? { deleted: false, category } : { deleted: false });
    showToast(`"${file.name}" 已恢复`);
  };
  const purgeFile = async (file) => {
    if (!window.confirm(`彻底删除"${file.name}"？此操作不可恢复。`)) return;
    setFiles((fs) => fs.filter((f) => f.videoId !== file.videoId));
    await deleteFromStore(db, STORES.VIDEOS, file.videoId);
    showToast('已彻底删除');
  };
  const emptyTrash = async () => {
    const gone = files.filter((f) => f.deleted);
    if (!gone.length || !window.confirm(`清空回收站？将彻底删除 ${gone.length} 项，不可恢复。`)) return;
    setFiles((fs) => fs.filter((f) => !f.deleted));
    await Promise.all(gone.map((f) => deleteFromStore(db, STORES.VIDEOS, f.videoId)));
    showToast('回收站已清空');
  };
  const [highlightedTarget, setHighlightedTarget] = useState(null);

  // 文件卡片拖拽开始
  const handleDragStart = (e, fileId) => {
    // 存储被拖拽文件的ID
    e.dataTransfer.setData('text/plain', fileId.toString());
    setDraggingId(fileId);
  };

  // 文件卡片拖拽结束
  const handleDragEnd = () => {
    setDraggingId(null);
    setHighlightedTarget(null);
  };

  // 侧边栏目标区域拖拽悬停
  const handleSidebarDragOver = (e, target) => {
    e.preventDefault();
    setHighlightedTarget(target);
  };

  // 离开侧边栏目标区域
  const handleSidebarDragLeave = () => {
    setHighlightedTarget(null);
  };

  // 在侧边栏目标区域放下文件
  const handleSidebarDrop = (e, target) => {
    e.preventDefault();
    setHighlightedTarget(null);
    
    const fileId = parseInt(e.dataTransfer.getData('text/plain'));
    const file = files.find(f => f.videoId === fileId);
    
    if (file) {
      // 处理不同目标的逻辑
      if (target === 'trash') {
        if (!file.deleted) moveToTrash(file);
      } else if (target === 'all-files') {
        // 从回收站拖回"所有记录" = 恢复；本来就在其中则无事发生
        if (file.deleted) restoreFile(file);
      } else {
        // 移动到指定分类（回收站里的拖进来则同时恢复）
        if (file.deleted) restoreFile(file, target);
        else patchFile(file, { category: target });
      }
    }
}
  const navigate = useNavigate();
  const trashCount = (files || []).filter((f) => f.deleted).length;
  const SORTS = { date: '修改时间', name: '名称', id: '创建顺序' };
  const visibleFiles = (files || [])
    .filter((f) => (activeItem === 'trash' ? f.deleted : !f.deleted && (activeItem === 'all-files' || f.category === activeItem)))
    .sort((a, b) => {
      let r;
      if (sortKey === 'name') r = String(a.name || '').localeCompare(String(b.name || ''), 'zh');
      else if (sortKey === 'id') r = (a.videoId || 0) - (b.videoId || 0);
      else r = String(a.date || '').localeCompare(String(b.date || ''));
      return sortDir === 'asc' ? r : -r;
    });
  const handleCardClick=(videoId)=>{
    navigate(`/main/${videoId}`)
  }
  // const getCategoryFilesData=async(categoryId)=>{
  //   const catrgory=await getFromStoreByKey(db,STORES.FILES,categoryId);
  //   setCategoryFiles(catrgory.videos)
  // }
  
  return (
    <div className="h-screen flex flex-col overflow-hidden page-enter">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        {/* <!-- 左侧导航栏 - 添加展开/收起功能 --> */}
        <aside
          ref={sidebarRef}
          className={`sidebar bg-white border-r border-gray-200 h-full flex flex-col transition-all duration-300 ${
            sidebarCollapsed ? "w-20" : "w-64"
          }`}
        >
          {/* <!-- 左侧顶部==添加展开/收起按钮 -->  */}
          <div className="p-4 border-b border-gray-100 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-800">视频解析工具</h2>
            <button
              className={`p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 ${
                sidebarCollapsed ? "mx-auto" : "ml-auto"
              }`}
              onClick={handleToggleSidebar}
            >
              <Icon
                icon={
                  sidebarCollapsed ? "mdi:chevron-right" : "mdi:chevron-left"
                }
                className="text-lg"
              ></Icon>
            </button>
          </div>
          {/* <!-- 左侧状态导航 --> */}
          <div className="p-4 overflow-y-auto">
            {/* 新建button */}
            <button 
            onClick={() => setIsModalOpen(true)} // 点击打开弹窗
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg w-full flex items-center justify-center mb-4 transition">
              <Icon icon="mdi:plus" className={`${sidebarCollapsed?"":"mr-1 text-xl"}`}></Icon>
              <span>新建</span>
            </button>
            
            {/* 引入弹窗组件 */}
            <NewItemModal
              isOpen={isModalOpen}
              onClose={() => setIsModalOpen(false)} // 关闭弹窗
              onSubmit={handleModalSubmit} // 提交表单回调
            />

            <div className="mb-6">
              <h2 className="text-xs uppercase text-gray-500 font-semibold mb-3 px-2">
                我的解析记录
              </h2>
              <ul >
                <li className={`sidebar-item  rounded-lg mb-1 px-2 py-2 
                ${ activeItem === 'all-files' ? 'bg-blue-100 active' : 'hover:bg-gray-100'}
                ${highlightedTarget === "all-files" ? 'bg-blue-100' : ''}
                `}
                onClick={() => setActiveItem('all-files')}
                onDragOver={(e) => handleSidebarDragOver(e, 'all-files')}
                onDragLeave={handleSidebarDragLeave}
                onDrop={(e) => handleSidebarDrop(e, 'all-files')}
                >
                  <a href="#" className="flex items-center">
                    <Icon
                      icon="mdi:folder-outline"
                      className="text-blue-600 mr-3 text-xl"
                    ></Icon>
                    <span className="font-medium">所有记录</span>
                  </a>
                </li>
                <li className={`sidebar-item  rounded-lg mb-1 px-2 py-2  ${activeItem === 'trash' ? 'bg-blue-100 active' : ''} ${highlightedTarget === "trash" ? 'bg-blue-100' : ''}`}
                onClick={() => setActiveItem('trash')}
                onDragOver={(e) => handleSidebarDragOver(e, 'trash')}
                onDragLeave={handleSidebarDragLeave}
                onDrop={(e) => handleSidebarDrop(e, 'trash')}
                >
                  <a href="#" className="flex items-center">
                    <Icon
                      icon="mdi:delete-outline"
                      className="text-red-500 mr-3 text-xl"
                    ></Icon>
                    <span>回收站</span>
                    {trashCount > 0 && <span className="trash-badge">{trashCount}</span>}
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h2 className="text-xs uppercase text-gray-500 font-semibold mb-3 flex items-center justify-between px-2">
                <span>视频解析分类</span>
                <Icon icon="mdi:chevron-down" className="text-gray-500"></Icon>
              </h2>
              {/* // 渲染分类列表 */}
              <ul>
                {categories&&categories.map((category) => (
                  <li 
                    key={category.fileId} // 必须添加唯一key
                    className={`sidebar-item rounded-lg mb-1 px-2 py-2 
                    ${activeItem === category.name ? 'bg-blue-100 active' : 'hover:bg-gray-100'}
                    ${highlightedTarget === category.fileId ? 'bg-blue-100' : ''}`}
                    onClick={() => setActiveItem(category.name)}
                    onDragOver={(e) => handleSidebarDragOver(e, category.fileId)} // 传递分类id
                    onDragLeave={handleSidebarDragLeave}
                    onDrop={(e) => handleSidebarDrop(e, category.name)} // 传递分类id
                  >
                    <a href="#" className="flex items-center">
                      <Icon
                        icon="mdi:folder-multiple-outline"
                        className="text-blue-500 mr-3 text-xl"
                      ></Icon>
                      <span>{category.name}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>

        {/* <!-- 主内容区 - 添加动态宽度调整 --> */}
        <main
          
          className="flex-1 flex overflow-hidden transition-all duration-300"
        >
          <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
            <Hero count={(files || []).filter((f) => !f.deleted).length} categories={(categories || []).length} />
            {/* <!-- 筛选工具栏 --> */}
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center">
                <div className="mr-4 flex items-center">
                  <span className="text-sm text-gray-500 mr-2">排序:</span>
                  <div className="relative">
                    <button
                      className="text-gray-800 bg-white border rounded-lg px-3 py-1.5 flex items-center text-sm"
                      onClick={(e) => { e.stopPropagation(); setSortOpen((o) => !o); }}
                    >
                      <span>{SORTS[sortKey]}</span>
                      <Icon icon={sortDir === 'asc' ? 'mdi:arrow-up' : 'mdi:arrow-down'} className="ml-1 text-cyan-300"></Icon>
                      <Icon icon="mdi:chevron-down" className={`ml-1 transition-transform ${sortOpen ? 'rotate-180' : ''}`}></Icon>
                    </button>
                    {sortOpen && (
                      <div className="sort-menu" onClick={(e) => e.stopPropagation()}>
                        {Object.entries(SORTS).map(([k, label]) => (
                          <button key={k} className={`sort-opt ${sortKey === k ? 'on' : ''}`}
                                  onClick={() => { setSortKey(k); setSortOpen(false); }}>
                            <Icon icon={sortKey === k ? 'mdi:check' : 'mdi:blank'} /> {label}
                          </button>
                        ))}
                        <div className="sort-sep" />
                        {[['desc', '从新到旧 / 降序', 'mdi:arrow-down'], ['asc', '从旧到新 / 升序', 'mdi:arrow-up']].map(([d, label, ic]) => (
                          <button key={d} className={`sort-opt ${sortDir === d ? 'on' : ''}`}
                                  onClick={() => { setSortDir(d); setSortOpen(false); }}>
                            <Icon icon={ic} /> {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {activeItem === 'trash' && trashCount > 0 && (
                    <button className="ml-3 text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-gray-100" onClick={emptyTrash}>
                      <Icon icon="mdi:delete-sweep-outline" className="inline mr-1" />清空回收站
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* <!-- 所有文件 --> */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">
                  {activeItem === 'trash' ? '回收站' : activeItem === 'all-files' ? '所有记录' : (categories || []).find(c => c.name === activeItem)?.name || '分类文件'
                  }
                </h2>
              </div>

              
               <div className="grid grid-cols-2 xl:grid-cols-4 gap-6 stagger">
                 {visibleFiles.map((file) => (
                     <div
                       key={file.videoId}
                       id={`file-card-${file.videoId}`}
                       className={`file-card tilt rounded-xl bg-white overflow-hidden shadow-sm 
                         transition-all duration-200 cursor-move
                         ${draggingId === file.videoId ? "opacity-50" : ""}`}
                       draggable
                       onDragStart={(e) => handleDragStart(e, file.videoId)}
                       onDragEnd={(e) => handleDragEnd(e, file.videoId)}
                       onClick={() => !file.deleted && handleCardClick(file.videoId)}
                     >
                       <div className="h-28 flex items-center justify-center hover:bg-gray-50 transition-colors">
                         <Icon icon="mdi:file" className="text-5xl text-blue-500" />
                       </div>
                       <div className="p-3">
                         <h3 className="font-bold text-gray-800 mb-1 truncate">
                           {file.name}
                         </h3>
                         <div className="flex justify-between text-xs text-gray-500">
                           <span>{file.category}</span>
                           <span>{file.date}</span>
                         </div>
                         {file.deleted && (
                           <div className="flex gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                             <button className="trash-act ok" onClick={() => restoreFile(file)}>
                               <Icon icon="mdi:restore" /> 恢复
                             </button>
                             <button className="trash-act bad" onClick={() => purgeFile(file)}>
                               <Icon icon="mdi:delete-forever-outline" /> 彻底删除
                             </button>
                           </div>
                         )}
                       </div>
                     </div>
                   ))}

                 {/* 空状态显示 */}
                 {visibleFiles.length === 0 && (
                   <div className="col-span-3 text-center py-12">
                     <Icon icon="mdi:folder-open-outline" className="text-6xl text-gray-300 mx-auto mb-4" />
                     <p className="text-gray-500">
                       {activeItem === 'trash' ? '回收站是空的，把卡片拖到左侧「回收站」即可暂存' : activeItem === 'all-files' ? '暂无文件' : '该分类下暂无文件'}
                     </p>
                   </div>
                 )}
               </div>
            </div>
          </div>

      
        </main>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};

export default Home;
