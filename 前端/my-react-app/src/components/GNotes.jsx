import React, { useState } from 'react';
import { Icon } from '@iconify/react';
import MDEditor from '@uiw/react-md-editor';
const API_BASE_URL = 'http://localhost:5000';


const GNotes = ({textSample}) => {  // 定义函数组件 GNotes，未接收任何 props
    // console.log('笔记数据:', textSample);
    const [value, setValue] = useState(textSample);
    // 添加导出 Markdown 文件的函数
    const exportToMarkdown = () => {
        // 创建一个 Blob 对象
        const blob = new Blob([value], { type: 'text/markdown' });
        
        // 创建一个下载链接
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        
        // 设置文件名
        const date = new Date();
        const fileName = `笔记_${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}.md`;
        link.download = fileName;
        
        // 触发下载
        document.body.appendChild(link);
        link.click();
        
        // 清理
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };
    return (
        <div id="aiNotesContent" className="space-y-6">
          <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
            <h4 className="font-medium text-purple-800 mb-2 flex items-center">
              <Icon icon="mdi:file-document-outline" className="mr-2 text-purple-600"></Icon>
              {/* <iconify-icon icon="mdi:file-document-outline" className="mr-2 text-purple-600"></iconify-icon> */}
              自动笔记
            </h4>
            <p className="text-sm text-gray-700 mb-3">基于视频内容生成的详细笔记摘要。</p>
            <MDEditor
                value={value}
                onChange={(val) => setValue(val ?? '')}
                height={800}
              />
            <button
              onClick={exportToMarkdown}  // 添加点击事件处理
              className="w-full mt-3 bg-purple-600 hover:bg-purple-700 text-white py-2 rounded text-sm transition-colors">
              生成完整笔记
            </button>
          </div>
        </div>
    )
};
export default GNotes;