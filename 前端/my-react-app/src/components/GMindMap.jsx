import React from 'react';
// 假设你使用的是 Iconify 图标（与你原代码中的 mdi:mindmap 保持一致）
import { Icon } from '@iconify/react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// 递归节点组件：渲染单个脑图节点及子节点
const MindMapNode = ({ node, levelStyles }) => {
  // 获取当前节点的样式（优先用节点层级样式，无则用默认）
  const nodeStyle = levelStyles[node.level] || {
    fontSize: '14px',
    color: '#6b7280',
    fontWeight: 'normal'
  };

  return (
    <div className="mindmap-node-container">
      {/* 单个节点：包含图标和文字 */}
      <div 
        className="mindmap-node flex items-center gap-2 px-3 py-2 rounded-md bg-gray-50 border border-gray-100"
        style={{
          fontSize: nodeStyle.font_size,
          color: nodeStyle.color,
          fontWeight: nodeStyle.font_weight,
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
        }}
      >
        {/* 提取节点名称中的 emoji（若有），无则用默认图标 */}
        <span className="node-icon">
          {node.name.match(/^[\uD83C-\uDBFF\uDC00-\uDFFF]+/)?.[0] || '📌'}
        </span>
        <span className="node-text truncate">{node.name.replace(/^[\uD83C-\uDBFF\uDC00-\uDFFF]+/, '').trim()}</span>
      </div>

      {/* 递归渲染子节点：纵向排列，左侧留缩进 */}
      {node.children && node.children.length > 0 && (
        <div className="mindmap-children ml-6 mt-2 flex flex-col gap-3">
          {node.children.map((childNode) => (
            <MindMapNode 
              key={childNode.id}  // 用后端返回的唯一id做key
              node={childNode} 
              levelStyles={levelStyles} 
            />
          ))}
        </div>
      )}
    </div>
  );
};

// 主脑图渲染组件：接收后端 mind_map 数据，控制加载/渲染状态
const GMindMap = ({ mindMapData }) => {
  console.log('脑图数据:', mindMapData);

  // 导出思维导图为PDF的函数
  const exportMindMap = async () => {
    try {
      // 获取思维导图容器元素
      const element = document.getElementById('aiMindmapContent');
      
      if (!element) {
        console.error('未找到思维导图容器');
        return;
      }

      // 显示加载提示
      const button = document.querySelector('button');
      const originalText = button.textContent;
      button.textContent = '导出中...';
      button.disabled = true;

      // 使用html2canvas将DOM转换为canvas
      const canvas = await html2canvas(element, {
        scale: 2, // 提高清晰度
        useCORS: true,
        backgroundColor: '#ffffff',
        allowTaint: true,
        logging: false,
        width: element.scrollWidth,
        height: element.scrollHeight
      });

      // 创建PDF
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      // 计算PDF页面尺寸
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      // 计算缩放比例，确保内容适合PDF页面
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
      
      const imgX = (pdfWidth - imgWidth * ratio) / 2;
      const imgY = 10;

      // 添加图片到PDF
      const imgData = canvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', imgX, imgY, imgWidth * ratio, imgHeight * ratio);

      // 保存PDF
      const fileName = `思维导图_${new Date().toLocaleDateString()}.pdf`;
      pdf.save(fileName);

      // 恢复按钮状态
      button.textContent = originalText;
      button.disabled = false;

    } catch (error) {
      console.error('导出失败:', error);
      const button = document.querySelector('button');
      button.textContent = '导出失败，请重试';
      setTimeout(() => {
        button.textContent = '下载脑图';
        button.disabled = false;
      }, 2000);
    }
  };

  // 处理加载状态（若 mindMapData 未获取或生成失败）
  if (!mindMapData || mindMapData.mind_map?.data?.name.includes('生成失败')) {
    const errorMsg = mindMapData?.mind_map?.data?.children?.[0]?.name || '脑图生成中...';
    return (
      <>
        <div className="space-y-6">
          <div className="p-4 bg-green-50 rounded-lg border border-green-100">
            <h4 className="font-medium text-green-800 mb-2 flex items-center">
              <Icon icon="mdi:sitemap" className="mr-2 text-green-600"></Icon>
              知识脑图
            </h4>
            <p className="text-sm text-gray-700 mb-3">视频内容的结构化知识图谱展示。</p>
            <div id="aiMindmapContent"
              className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm h-64 flex items-center justify-center">
              <div className="text-center text-gray-400">
                <Icon icon="mdi:mindmap" className="text-6xl mb-2"></Icon>
                <p>脑图生成中...</p>
              </div>
            </div>
            <button
              className="w-full mt-3 bg-green-100 hover:bg-green-200 text-green-700 py-1.5 rounded text-sm transition-colors">
              暂无脑图
            </button>
          </div>
        </div>
      </>
    );
  }

  // 从后端数据中提取 层级数据 和 样式配置
  const { data: mindMapStructure, config } = mindMapData.mind_map;
  const { level_styles } = config;

  return (
    <>
      <div id="aiMindmapContent" className="space-y-6">
        <div className="p-4 bg-green-50 rounded-lg border border-green-100">
          <h4 className="font-medium text-green-800 mb-2 flex items-center">
            <Icon icon="mdi:sitemap" className="mr-2 text-green-600"></Icon>
            知识脑图
          </h4>
          <p className="text-sm text-gray-700 mb-3">视频内容的结构化知识图谱展示。</p>
          <div className="bg-white rounded-lg p-3 border border-gray-200 shadow-sm h-64 flex flex-col overflow-auto">
            {/* 脑图标题：用根节点名称 */}
            <div className="text-center mb-4">
              <h3 
                style={{
                  fontSize: level_styles[1].font_size,
                  color: level_styles[1].color,
                  fontWeight: level_styles[1].font_weight
                }}
                className="truncate"
              >
                {mindMapStructure.name}
              </h3>
            </div>
            
            {/* 脑图内容：从根节点的子节点开始渲染（避免根节点重复） */}
            <div className="mindmap-content flex flex-col gap-4 px-4 pb-4">
              {mindMapStructure.children.map((rootChild) => (
                <MindMapNode 
                  key={rootChild.id} 
                  node={rootChild} 
                  levelStyles={level_styles} 
                />
              ))}
            </div>
          </div>
          <button
            onClick={exportMindMap}
            className="w-full mt-3 bg-green-100 hover:bg-green-200 text-green-700 py-1.5 rounded text-sm transition-colors">
            下载脑图
          </button>
        </div>
      </div>
    </>
  );
};

export default GMindMap;