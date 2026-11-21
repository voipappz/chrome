// Answers a ping from the popup with the page it is on. Kept from the Angular
// build's contentPage.ts; nothing in the popup sends one today.
//
// No imports: a content script is a classic script, not a module.
chrome.runtime.onMessage.addListener((request, _sender, respond) => {
  if (request) respond(`Hi from contentPage! You are currently on: ${window.location.href}`);
  else respond('request is empty.');
  return true;
});
