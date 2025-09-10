import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './store/store.js';  // 确保路径正确
import { RouterProvider } from 'react-router-dom';
import router from './routes.js';
import './index.css'; // 关键：导入包含 Tailwind 的 CSS 文件
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {/* <Provider store={store}> */}
    <RouterProvider router={router} /> // 使用 RouterProvider 组件并传入 router 配置
    {/* </Provider> */}
  </React.StrictMode>
);
