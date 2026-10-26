import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './store/store.js';  // 确保路径正确
import { RouterProvider } from 'react-router-dom';
import router from './routes.js';
import './index.css'; // 关键：导入包含 Tailwind 的 CSS 文件
import FxLayer from './components/FxLayer.jsx';
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    {/* <Provider store={store}> */}
    <FxLayer />
    <RouterProvider router={router} />
    {/* </Provider> */}
  </React.StrictMode>
);
