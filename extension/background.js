// 点工具栏图标时打开侧边栏。插件的逻辑全部在侧边栏页面里，这里不做别的事
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
