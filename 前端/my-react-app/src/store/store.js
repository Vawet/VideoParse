import { configureStore } from '@reduxjs/toolkit';

// 创建一个默认的reducer来避免'not defined'错误
const rootReducer = (state = {}, action) => {
  // 这里可以根据需要添加更多的reducer逻辑
  return state;
};

// 创建Redux store
const store = configureStore({
  reducer: rootReducer,
  devTools: window.__REDUX_DEVTOOLS_EXTENSION__ && window.__REDUX_DEVTOOLS_EXTENSION__()
});

export { store };