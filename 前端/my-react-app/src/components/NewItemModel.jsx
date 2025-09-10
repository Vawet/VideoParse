import React, { useState, useEffect } from 'react';
// 假设你已导入 Icon 组件（若使用第三方图标库需确保路径正确）
import { Icon } from '@iconify/react';
import {STORES,initDB,addToStore,getAllFromStore,getFromStoreByKey,updateStore,deleteFromStore} from '../db.js';
const NewItemModal = ({ isOpen, onClose, onSubmit }) => {
  const [db, setDb] = useState(null);
    // 初始化数据库
  useEffect(() => {
        const init = async () => {
            const database = await initDB();
            setDb(database);
        };
        init();
    }, []);
    // 获取现存文件夹的名字，用于下拉选择
  const [names, setNames] = useState([]);
  useEffect(()=>{
    if(db){
      getNames();
    }
  },[db])
  const getNames = async () => {
    const files = await getAllFromStore(db, STORES.FILES);
    setNames(files.map(file => file.name));
  }
  // 状态管理：当前激活的选项卡（新建解析卡片/新建文件夹）
  const [activeTab, setActiveTab] = useState('card');
  // 表单数据状态
  const [formData, setFormData] = useState({
    // 新建解析卡片表单
    card: {
      name: '', // 名称输入
      belong: '', // 文件所属输入
      createTime: '' // 自动生成的日期时间（不可修改）
    },
    // 新建文件夹表单
    folder: {
      name: '' // 文件夹名称输入
    }
  });

  // 页面加载/弹窗打开时，自动获取当前日期时间
  useEffect(() => {
    if (isOpen && activeTab === 'card') {
      // 格式化日期时间为 "YYYY-MM-DD HH:MM:SS" 格式
      const now = new Date();
      const formattedTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      
      setFormData(prev => ({
        ...prev,
        card: { ...prev.card, createTime: formattedTime }
      }));
    }
  }, [isOpen, activeTab]);

  // 表单输入变化处理
  const handleInputChange = (tab, field, value) => {
    setFormData(prev => ({
      ...prev,
      [tab]: { ...prev[tab], [field]: value }
    }));
  };

  // 提交表单处理
  const handleSubmit = async () => {
    // 验证当前选项卡的表单数据
    if (activeTab === 'card') {
      const { name, belong } = formData.card;
      if (!name.trim()) {
        alert('请输入解析卡片名称');
        return;
      }
      if (!belong.trim()) {
        alert('请输入文件所属');
        return;
      }
      
      // 不仅是videos需要更新! 所属files对应的videos数组也需要更新！
      const newVideo=await addToStore(db, STORES.VIDEOS, {
        name: formData.card.name,
        category: formData.card.belong,
        date: formData.card.createTime,
        status:null
      })
      // 从新视频对象中获取自增长id，放进所属文件的videos数组！
      const newVideoId=newVideo.videoId;
      // 3. 获取当前的FILES数据
      const files = await getAllFromStore(db, STORES.FILES);
      // 4. 找到与category匹配的文件对象，并更新其videos数组（添加新视频id）
      const targetFile=files.find(f=>f.name===formData.card.belong);
      if(targetFile){
        targetFile.videos=[...(targetFile.videos||[]),newVideoId];
      }
      // 5. 将更新后的FILES数据保存回存储
      await updateStore(db, STORES.FILES, targetFile);
      await onSubmit({ type: 'video'})
    } else {
      const { name } = formData.folder;
      if (!name.trim()) {
        alert('请输入文件夹名称');
        return;
      }
      
      await addToStore(db, STORES.FILES, {
        name: formData.folder.name,
        videos:[]
        // 存放文件序号的数组
      })
      await onSubmit({ type: 'file'})
    }
    // 提交后关闭弹窗并重置表单
    onClose();
    resetForm();
  };

  // 重置表单数据
  const resetForm = () => {
    setFormData({
      card: { name: '', belong: '', createTime: '' },
      folder: { name: '' }
    });
    setActiveTab('card'); // 重置选项卡为默认的“新建解析卡片”
  };

  // 弹窗未打开时不渲染
  if (!isOpen) return null;

  return (
    // {/* 弹窗遮罩层 */}
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      {/* 弹窗容器 */}
      <div className="bg-white rounded-lg w-full max-w-md p-6 shadow-2xl">
        {/* 弹窗头部：标题 + 关闭按钮 */}
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-semibold text-gray-800">新建项目</h3>
          <button 
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 transition"
          >
            <Icon icon="mdi:close" className="text-xl" />
          </button>
        </div>

        {/* 选项卡导航（替代面包屑，更符合交互逻辑） */}
        <div className="flex border-b mb-6">
          <button
            className={`py-2 px-4 text-sm font-medium border-b-2 transition ${
              activeTab === 'card' 
                ? 'border-blue-600 text-blue-600' 
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('card')}
          >
            新建解析卡片
          </button>
          <button
            className={`py-2 px-4 text-sm font-medium border-b-2 transition ${
              activeTab === 'folder' 
                ? 'border-blue-600 text-blue-600' 
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setActiveTab('folder')}
          >
            新建文件夹
          </button>
        </div>

        {/* 选项卡内容区 */}
        <div className="space-y-4">
          {/* 新建解析卡片表单 */}
          {activeTab === 'card' && (
            <>
              {/* 名称输入栏 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  解析卡片名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.card.name}
                  onChange={(e) => handleInputChange('card', 'name', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                  placeholder="请输入解析卡片名称"
                />
              </div>

              {/* 文件所属输入栏 */}
              {/* <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  文件所属 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.card.belong}
                  onChange={(e) => handleInputChange('card', 'belong', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                  placeholder="请输入文件所属（如：项目A/模块1）"
                />
              </div> */}
              <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                      文件所属 <span className="text-red-500">*</span>
                  </label>
                  {/* <!-- 下拉框替换原输入框，保持相同的样式类 --> */}
                  <select
                      value={formData.card.belong}
                      onChange={(e) => handleInputChange('card', 'belong', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                      required 
                  >
                      {/* <!-- 空选项提示（可选，根据需求决定是否保留） --> */}
                      <option value="" disabled>请选择文件所属</option>
                            
                      {/* <!-- 遍历现存文件数组，生成下拉选项 --> */}
                      {/* 假设现存文件数组变量名为 existingFiles，每个元素含 name 字段 */}
                      {names.map((name, index) => (
                          <option key={index} value={name}>
                              {name}
                          </option>
                      ))}
                  </select>
              </div>

              {/* 日期时间显示（不可修改） */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  创建时间
                </label>
                <input
                  type="text"
                  value={formData.card.createTime}
                  readOnly // 不可修改
                  className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600 cursor-not-allowed"
                />
              </div>
            </>
          )}

          {/* 新建文件夹表单 */}
          {activeTab === 'folder' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                文件夹名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.folder.name}
                onChange={(e) => handleInputChange('folder', 'name', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                placeholder="请输入文件夹名称"
              />
            </div>
          )}
        </div>

        {/* 弹窗底部：提交/取消按钮 */}
        <div className="flex justify-end space-x-3 mt-8">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
          >
            确认新建
          </button>
        </div>
      </div>
    </div>
  );
};
export default NewItemModal;