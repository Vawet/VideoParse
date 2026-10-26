// 匿名学习者标识：只存在浏览器本地，用于关联答题记录与复习计划（无需登录）
export const getClientId = () => {
  let id = localStorage.getItem('vp_client_id');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/-/g, '');
    localStorage.setItem('vp_client_id', id);
  }
  return id;
};
