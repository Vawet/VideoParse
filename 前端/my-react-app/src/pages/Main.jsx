import React, { useState } from 'react';
import Header from '../components/Header.jsx'; // 导入顶部导航栏
import Left from '../components/Left.jsx'; // 导入顶部导航栏
import Video from '../components/Video.jsx'; // 导入顶部导航栏
// 页面级组件
const Main = ({videoId}) => {
  // 定义页面级状态（供多个组件共享）
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true); // 侧边栏展开/收起状态

  // 处理左边侧边栏切换，右边的解析在主页不设置可以切换
  const handleSidebarToggle = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden">
        <Header />
        <div className="flex flex-1 overflow-hidden">
            <Left sidebarCollapsed={sidebarCollapsed} onToggle={handleSidebarToggle}/>
            <Video videoId={videoId}/>
        </div>
    </div>
  );
};

export default Main;
