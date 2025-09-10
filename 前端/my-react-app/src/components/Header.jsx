import React from 'react';
import { Icon } from '@iconify/react';
// import folderIcon from '@iconify-icons/ion/folder';
// import searchIcon from '@iconify-icons/mdi/search';
// import bellOutlineIcon from '@iconify-icons/mdi/bell-outline';
// import chevronDownIcon from '@iconify-icons/mdi/chevron-down';
const Header = () => {
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm z-10">
      <div className="flex items-center">
        <div className="mr-8 flex items-center">
          <Icon icon='mdi:folder' className="text-2xl text-blue-600 mr-2" />
          <h1 className="text-xl font-semibold">视频解析平台</h1>
        </div>

        {/* 面包屑导航（保持注释状态，需要时可启用） */}
        {/* <div className="flex items-center text-sm text-gray-600">
            <span>我的空间</span>
            <iconify-icon icon="mdi:chevron-right" className="mx-1"></iconify-icon>
            <span>项目文档</span>
            <iconify-icon icon="mdi:chevron-right" className="mx-1"></iconify-icon>
            <span className="text-blue-600">产品设计</span>
        </div> */}
      </div>

      {/* 搜索框和用户操作区 */}
      {/* <div className="flex items-center">
        <div className="relative mr-4">
          <input 
            type="text" 
            placeholder="搜索文件..."
            className="pl-10 pr-4 py-2 w-64 bg-gray-100 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
          />
          <Icon icon='mdi:search' className="absolute left-3 top-2.5 text-gray-500" />
        </div>

        <button
          className="flex items-center justify-center mr-4 h-9 w-9 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
        >
         <Icon icon='mdi:bell-outline' className="text-xl text-gray-600" />
        </button>

        <div className="flex items-center">
          <div
            className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center mr-2 text-white font-medium"
          >
            JD
          </div>
          <span className="text-sm font-medium">John Doe</span>
          <Icon icon='mdi:chevron-down' className="ml-1 text-gray-500" />
        </div>
      </div> */}
    </header>
  );
};

export default Header;
