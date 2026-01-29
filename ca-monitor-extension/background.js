// 点击插件图标时打开侧边栏
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// 安装时设置侧边栏行为
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({
    enabled: true
  });
  console.log('CA Monitor 插件已安装');
});

// 监听来自sidepanel的消息（用于发送通知）
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'notification') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: message.title,
      message: message.body,
      priority: 2
    });
  }
});
