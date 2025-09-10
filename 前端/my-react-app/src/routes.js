import React from 'react';
import { createBrowserRouter,useParams } from 'react-router-dom';
import Main from './pages/Main.jsx';
import Home from './pages/Home.jsx';
// 1. 修复核心问题：通过"加载组件"接收路由参数，传递给Main
// 方式：用箭头函数包裹Main，通过props获取路由参数params
const MainWithParams = () => {
  // 从路由props中解构params，获取:id参数（即videoId）
  const { id } = useParams();
  const videoId=id?Number(id):0;
  return <Main videoId={videoId} />;
};
// 创建路由配置
const router = createBrowserRouter([
  {
    path: '/',element: <Home />, // 访问 / 时显示 Home
  },
  {
    path: '/main/:id',element: <MainWithParams />,
  },
   { path: '*', element: <div style={{ textAlign: 'center', marginTop: '50px' }}>404 - 路径没匹配到</div> }
]);

export default router;