// 手画 SVG 图标。服务器渲染登录页、网页前端都从这里取，页面里不用 emoji。
// 颜色统一跟随 currentColor，由外层 CSS 决定。

export const ICONS = {
  // 弯月：一大一小两个圆相减
  moon:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M14.6 3.2a8.8 8.8 0 1 0 6.2 14.4 8.2 8.2 0 0 1-6.2-14.4z"/></svg>',
  // 五瓣小花：排卵期标记
  flower:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="currentColor"><circle cx="12" cy="6.2" r="3.6"/><circle cx="17.5" cy="10.2" r="3.6"/><circle cx="15.4" cy="16.8" r="3.6"/><circle cx="8.6" cy="16.8" r="3.6"/><circle cx="6.5" cy="10.2" r="3.6"/></g><circle cx="12" cy="12" r="2.4" fill="var(--flower-core, #0d1b3e)"/></svg>',
  chevronLeft:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M14.5 5.5 8 12l6.5 6.5"/></svg>',
  chevronRight:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9.5 5.5 16 12l-6.5 6.5"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M5.5 12.5 10 17l8.5-9.5"/></svg>',
  minus:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M6.5 12h11"/></svg>',
  plus:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M12 6.5v11M6.5 12h11"/></svg>',
  // 门 + 向外的箭头：退出登录
  logout:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 4.5h-6a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5h6"/><path d="M11 12h9M17 8.5 20.5 12 17 15.5"/></g></svg>',
};

// 网页图标（favicon / 主屏幕图标）：深蓝底 + 弯月
export const APP_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0d1b3e"/><path fill="#e8c7cf" d="M38.9 12.5a21 21 0 1 0 14.8 34.4 19.6 19.6 0 0 1-14.8-34.4z"/></svg>';
