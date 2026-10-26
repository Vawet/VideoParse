import React from 'react';
import { Icon } from '@iconify/react';

const Header = () => {
  return (
    <header className="px-6 py-3 flex items-center justify-between z-10">
      <div className="flex items-center gap-3">
        <div className="logo-orb">
          <Icon icon="mdi:play-circle-outline" className="text-2xl text-white" />
        </div>
        <div className="leading-tight">
          <h1 className="text-xl font-extrabold tracking-wide neon-text">VideoParse</h1>
          <p className="text-[11px] tracking-[0.3em] text-gray-500">AI · 视频学习助手</p>
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs text-gray-600">
        <span className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 bg-gray-100">
          <span className="live-dot" /> Agent Online
        </span>
        <span className="hidden md:flex items-center gap-1 text-gray-500">
          <Icon icon="mdi:shield-check" className="text-green-500 text-base" /> 证据校验已开启
        </span>
      </div>
    </header>
  );
};

export default Header;
