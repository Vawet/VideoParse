// src/db.js
import { openDB } from 'idb';

const DB_NAME = 'my-database';
const DB_VERSION = 2;
export const STORES = {
  VIDEOS:'video-store',
  FILES:'file-store',
};
// VIDEOS 存储 视频路径 视频的命名 上传时间 概览内容的存储 md笔记的存储 脑图的存储 ppt路径的存储！ 所属的文件夹
// 视频的自增序号！
// 查询VIDEOS的时候就可以按照序号查询
// FILES 存储  文件夹的命名 文件夹的序号 在该文件夹之下的视频的序号（新增：拖动的时候+新建表格的时候）
/**
 * 初始化数据库的异步函数
 * 使用 IndexedDB 创建或打开数据库
 * @returns {Promise} 返回一个数据库实例的 Promise
 */
export const initDB = async () => {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // 1. 创建用户存储（假设用户数据以 'userId' 为键）
      if (!db.objectStoreNames.contains(STORES.VIDEOS)) {
        db.createObjectStore(STORES.VIDEOS, { keyPath: 'videoId', autoIncrement: true });
      }
      // 2. 创建产品存储（使用自增 ID 作为键）
      if (!db.objectStoreNames.contains(STORES.FILES)) {
        db.createObjectStore(STORES.FILES, { keyPath: 'fileId', autoIncrement: true });
      }
    },
  });
};

// 新增数据（通用方法，指定存储名称）
export const addToStore = async (db, storeName, item) => {
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  // await store.add(item);
  const newId=await store.add(item);
  await tx.done;
  const newItem=await getFromStoreByKey(db,storeName,newId);
  return newItem; // 返回添加的完整对象
};

// 查询指定存储的所有数据
export const getAllFromStore = async (db, storeName) => {
  const tx = db.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  return store.getAll();
};

// 根据键查询指定存储的数据
export const getFromStoreByKey = async (db, storeName, key) => {
  const tx = db.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  return store.get(key);
};

// 更新指定存储的数据
export const updateStore = async (db, storeName, item) => {
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  await store.put(item); // put 方法：存在则更新，不存在则新增
  await tx.done;
};

// 删除指定存储的数据
export const deleteFromStore = async (db, storeName, key) => {
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  await store.delete(key);
  await tx.done;
};