import React from 'react';
import { Icon } from '@iconify/react';
import { Link } from 'react-router-dom';
const Left = ({ sidebarCollapsed = true, onToggle }) => {
  // 如果没有提供onToggle回调，使用内部函数处理
  const handleToggle = () => {
    if (onToggle) {
      onToggle();
    }
  };

  return (
    // 左侧导航栏 - 使用React状态控制展开/收起
    <aside 
      id="sidebar" 
      className={`sidebar bg-white border-r border-gray-200 h-full flex flex-col transition-all duration-300 ${
        sidebarCollapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* 展开/收起按钮 */}
      <div className="p-4 border-b border-gray-100 flex items-center">
        {!sidebarCollapsed && (
          <h2 className="text-lg font-semibold text-gray-800 mr-4">视频解析工具</h2>
        )}
        <button 
          id="toggleSidebar" 
          className={`p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 transition-all ml-auto ${
            sidebarCollapsed ? 'mx-auto' : ''
          }`}
          onClick={handleToggle}
        >
          <Icon 
            id="sidebarIcon" 
            icon={sidebarCollapsed ? 'mdi:chevron-right' : 'mdi:chevron-left'} 
            className="text-lg"
          />
        </button>
      </div>
      
      {/* 空间导航 */}
      <div className="p-4 overflow-y-auto">
        <Link to="/">
          <button
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg w-full flex items-center justify-center mb-4 transition"
          >
            <Icon icon='mdi:home-outline' className="mr-1 text-xl" />
            {!sidebarCollapsed && <span>返回主页</span>}
          </button>
        </Link>
     
      </div>
    </aside>
    
  );
};

export default Left;