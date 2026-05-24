console.log("[UC] caption-overlay: loaded on", location.href);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[UC] caption-overlay: received message", message);

  switch (message.type) {
    case "SHOW_CAPTION":
      console.log("[UC] caption-overlay: rendering caption →", message.text);
      // TODO: inject/update overlay DOM element with caption text
      sendResponse({ status: "ok" });
      break;

    case "HIDE_OVERLAY":
      console.log("[UC] caption-overlay: hiding overlay");
      // TODO: remove overlay DOM element
      sendResponse({ status: "ok" });
      break;

    default:
      console.warn("[UC] caption-overlay: unknown message type", message.type);
  }

  return true;
});

function createOverlay() {
  console.log("[UC] caption-overlay: createOverlay() called");
  // TODO: build and append overlay <div> to document.body
}

function removeOverlay() {
  console.log("[UC] caption-overlay: removeOverlay() called");
  // TODO: remove overlay element from DOM
}
