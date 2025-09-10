import React from 'react';
import { Icon } from '@iconify/react';
import PptxGenJS from 'pptxgenjs'; // 直接导入pptxgenjs
import { saveAs } from 'file-saver';

const API_BASE_URL = 'http://localhost:5000';

// 统一处理图片路径
const getImageUrl = (path) => `${API_BASE_URL}/${path}`;

/**
 * GPPT组件 - 用于生成和导出PPT演示文稿
 * @param {Array} aPPT - 包含图片路径的数组，用于生成PPT幻灯片
 */
const GPPT = ({ aPPT }) => {
  async function exportToPPT(
    imagePaths, 
    title = '', 
    fileName = '视频的PPT.pptx'
  ) {
    // 1. 验证参数
    if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
      throw new Error('请提供有效的图片路径数组');
    }

    try {
      // 2. 初始化PPT实例（浏览器环境直接使用）
      const ppt = new PptxGenJS();

      // 3. 为每张图片创建幻灯片
      for (const [index, imagePath] of imagePaths.entries()) {
        // 添加空白幻灯片
        const slide = ppt.addSlide();

        // 加载图片（处理跨域）
        const response = await fetch(getImageUrl(imagePath), {
          mode: 'cors', // 确保跨域请求正常
        });
        if (!response.ok) {
          throw new Error(`图片加载失败：${imagePath}`);
        }

        // 转换图片为Base64（pptxgenjs支持Base64格式图片）
        const blob = await response.blob();
        const base64Image = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });

        // 4. 向幻灯片添加图片（铺满整个幻灯片）
        slide.addImage({
          data: base64Image, // 直接使用Base64图片
          x: 0,    // 左上角x坐标
          y: 0,    // 左上角y坐标
          w: '100%',// 宽度占满幻灯片
          h: '100%' // 高度占满幻灯片
        });

        // 5. 第一张幻灯片添加标题（可选）
        if (index === 0 && title) {
          slide.addText(title, {
            x: '10%',  // 标题x坐标（距左侧10%）
            y: '10%',  // 标题y坐标（距顶部10%）
            w: '80%',  // 标题宽度（占幻灯片80%）
            h: '20%',  // 标题高度
            fontSize: 36,
            color: '#000000',
            bold: true,
            align: 'center' // 文字居中
          });
        }
      }

      // 6. 生成PPT并下载（浏览器环境生成Blob）
      const pptBlob = await ppt.writeFile({
        type: 'blob', // 生成Blob格式（浏览器支持下载）
      });
      saveAs(pptBlob, fileName); // 调用file-saver下载

      console.log(`PPT导出成功：${fileName}`);
    } catch (error) {
      console.error('PPT导出失败：', error);
      throw error; // 抛出错误让前端提示用户
    }
  }

  return (
    <div id="aiPptContent" className="space-y-6">
      <div className="p-4 bg-orange-50 rounded-lg border border-orange-100">
        <h4 className="font-medium text-orange-800 mb-2 flex items-center">
          <Icon icon="mdi:file-powerpoint-box" className="mr-2 text-orange-600"></Icon>
          PPT演示文稿
        </h4>
        <p className="text-sm text-gray-700 mb-3">基于视频内容自动生成的演示幻灯片。</p>
        
        {/* 幻灯片预览 */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {aPPT ? (
            aPPT.map((item, index) => (
              <div 
                key={`aPPT-${index}`}
                className="aspect-video bg-white rounded border border-gray-200 shadow-sm flex items-center justify-center text-gray-300 hover:border-orange-300 transition-colors"
              >
                <img
                  src={getImageUrl(item)}
                  alt={`slide-${index}`}
                  className="w-full h-full object-cover rounded"
                  onError={(e) => {
                    // 图片加载失败时显示占位图
                    e.target.src = 'https://picsum.photos/200/300?grayscale';
                    e.target.alt = `幻灯片${index}加载失败`;
                  }}
                />
              </div>
            ))
          ) : (
            <div className="aspect-video bg-white rounded border border-gray-200 shadow-sm flex items-center justify-center text-gray-300 hover:border-orange-300 transition-colors">
              <span className="text-xs">封面</span>
            </div>
          )}          
        </div>
        
        {/* 导出按钮 */}
        <button
          onClick={async () => {
            try {
              await exportToPPT(aPPT);
            } catch (err) {
              alert(err.message || '导出PPT失败，请重试');
            }
          }}
          disabled={!aPPT || (Array.isArray(aPPT) && aPPT.length === 0)}
          className={`w-full bg-orange-100 text-orange-700 py-1.5 rounded text-sm transition-colors ${
            (!aPPT || (Array.isArray(aPPT) && aPPT.length === 0))
              ? 'opacity-50 cursor-not-allowed hover:bg-orange-100'
              : 'hover:bg-orange-200'
          }`}
        >
          {aPPT && aPPT.length > 0 ? '生成完整PPT' : '暂无幻灯片内容'}
        </button>
      </div>
    </div>
  );
};

export default GPPT;