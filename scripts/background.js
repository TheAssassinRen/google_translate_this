const APPLICABLE_PROTOCOLS = ["http:", "https:"];

const NOT_ANDROID = navigator.userAgent.toLocaleLowerCase().indexOf("android") === -1;

function protocolIsApplicable(url) {
  var anchor = document.createElement('a');
  anchor.href = url;
  return APPLICABLE_PROTOCOLS.includes(anchor.protocol);
}

function showPageActionOnTab(tabInfo) {
  if (protocolIsApplicable(tabInfo.url) && NOT_ANDROID) {
    browser.pageAction.show(tabInfo.id);
  }
}

async function toggleTranslateCurrentDomain(domain, currentTabId) {
  const alwaysTranslateDomain = await StorageService.toggleTranslateDomain(domain);
  updateMenuForDomain();
  if (alwaysTranslateDomain) {
    const hasCsp = await StorageService.hasCsp(domain);
    if (!hasCsp) {
      translateTab(currentTabId);
    } else {
      BrowserService.reloadTab(currentTabId);
    }
  } else {
    BrowserService.reloadTab(currentTabId);
  }
}

function translateCurrentPage() {
  browser.tabs.query({
    currentWindow: true,
    active: true
  }, function (foundTabs) {
    var currentTabId = foundTabs[0].id;
    toggleTranslateCurrentDomain(getDomain(foundTabs[0].url), currentTabId);
  });
}

browser.browserAction.onClicked.addListener(translateCurrentPage);

if (NOT_ANDROID) {
  browser.commands.onCommand.addListener(function (action) {
    if (action == "translate-current-page") {
      translateCurrentPage();
    }
  });

  browser.contextMenus.onClicked.addListener(function (info, tab) {
    if (info.menuItemId == "translate-current-page") {
      translateCurrentPage();
    }
  });

  browser.contextMenus.create({
    id: "translate-current-page",
    title: browser.i18n.getMessage("translateCurrentPage"),
    contexts: ["all"]
  });

  browser.browserAction.setIcon({
    "path": {
      "19": "images/icon-19.png",
      "38": "images/icon-38.png"
    }
  });

  browser.pageAction.onClicked.addListener(translateCurrentPage);
  browser.tabs.query({}).then((tabs) => {
    var tab;
    for (tab of tabs) {
      showPageActionOnTab(tab);
    }
  });

  browser.tabs.onUpdated.addListener((id, changeInfo, tab) => {
    showPageActionOnTab(tab);
  });
}

function parseCsp(policy) {
  return policy.split(';').reduce((result, directive) => {
    const trimmed = directive.trim();
    if (!trimmed) {
      return result;
    }
    const split = trimmed.split(/\s+/g);
    const key = split.shift();
    if (!Object.prototype.hasOwnProperty.call(result, key)) {
      result[key] = split;
    }
    return result;
  }, {});
};

function joinCsp(parsedCsp) {
  let directives = [];
  for (var directiveName in parsedCsp) {
    let directiveValue = parsedCsp[directiveName];
    let directivePartToAppend;
    if (directiveValue.length === 0) {
      directivePartToAppend = directiveName;
    } else if (directiveValue.length === 1) {
      directivePartToAppend = directiveName + " " + directiveValue[0];
    } else {
      directivePartToAppend = directiveName + " " + directiveValue.join(" ");
    }
    directives.push(directivePartToAppend);
  }
  return directives.join('; ');
}

async function rewriteCSPHeader(e) {
  if (e.type === "main_frame") {
    for (var header of e.responseHeaders) {
      if (header.name.toLowerCase() === "content-security-policy") {
        const domain = getDomain(e.url);
        const shouldAlwaysTranslate = await StorageService.shouldAlwaysTranslate(domain);
        if (shouldAlwaysTranslate) {
          const parsedCsp = parseCsp(header.value);
          const defaultSrc = parsedCsp['default-src'];
          var translateStaticLocation = "translate.googleapis.com";
          let newValue = parsedCsp;
          newValue = insertOrAppend('script-src', translateStaticLocation, newValue, defaultSrc);
          newValue = insertOrAppend('script-src', "'unsafe-inline'", newValue, defaultSrc);
          newValue = insertOrAppend('script-src', "'unsafe-eval'", newValue, defaultSrc);
          newValue = insertOrAppend('connect-src', translateStaticLocation, newValue);
          newValue = insertOrAppend('style-src', translateStaticLocation, newValue, defaultSrc);
          newValue = insertOrAppend('img-src', translateStaticLocation, newValue, defaultSrc);
          newValue = insertOrAppend('img-src', "translate.google.com", newValue, defaultSrc);
          newValue = insertOrAppend('img-src', "www.gstatic.com", newValue, defaultSrc);
          newValue = insertOrAppend('img-src', "www.google.com", newValue, defaultSrc);
          const joinedCsp = joinCsp(newValue);
          // console.log("..." + e.url + " " + e.type);
          // console.log("---" + header.value);
          // console.log("+++" + joinedCsp);
          // console.log(header.value === joinedCsp);
          header.value = joinedCsp;
        }
      }
    }
  }
  return { responseHeaders: e.responseHeaders };
}

function insertOrAppend(typeOfContent, domain, oldValue, defaultSrc) {
  if (!oldValue[typeOfContent]) {
    if (defaultSrc) {
      oldValue[typeOfContent] = defaultSrc.slice();
    } else {
      oldValue[typeOfContent] = ["'self'"];
    }
  }
  if (oldValue[typeOfContent].indexOf(domain) === -1) {
    oldValue[typeOfContent].push(domain);
  }
  return oldValue;
}

function getDomain(url) {
  return new URL(url).host;
}

function translateTab(tabId) {
  setTimeout(function () {
    browser.tabs.get(tabId).then(function (tabInfo) {
      StorageService.setLangCookie(tabInfo.url);
      browser.tabs.executeScript(tabId, {
        file: 'scripts/inject_google_translate_content.js'
      });
    });
  }, 250);
}

async function updateMenuForDomain() {
  browser.tabs.query({
    currentWindow: true,
    active: true
  }, async function (foundTabs) {
    const tabId = foundTabs[0].id;
    const domain = getDomain(foundTabs[0].url);
    const alwaysOrNever = await StorageService.shouldAlwaysTranslate(domain);
    const title = browser.i18n.getMessage("alwaysTranslate-" + !alwaysOrNever) + " " + domain;
    const visible = domain.length > 0;
    if (NOT_ANDROID) {
      browser.contextMenus.update("translate-current-page", {
        visible, title
      });
      if (visible) {
        browser.pageAction.setTitle({ tabId, title });
        browser.browserAction.setTitle({ title });
        browser.pageAction.show(tabId);
        browser.browserAction.enable(tabId);
      } else {
        browser.pageAction.hide(tabId);
        browser.browserAction.disable(tabId);
      }
    }
  });
}

async function onComplete(e) {
  if (e.type === "main_frame") {
    const shouldAlwaysTranslate = await StorageService.shouldAlwaysTranslate(getDomain(e.url));
    if (shouldAlwaysTranslate) {
      translateTab(e.tabId);
    }
  }
}

let lastSelectedTab = 0;
function handleUpdated(tabId, changeInfo, tabInfo) {
  const isWindowFocusChange = changeInfo === undefined && tabInfo === undefined;
  if (isWindowFocusChange || changeInfo.url || lastSelectedTab !== tabId) {
    updateMenuForDomain();
  }
}

browser.tabs.onUpdated.addListener(handleUpdated);
if(NOT_ANDROID){
  browser.windows.onFocusChanged.addListener(handleUpdated);
}

browser.webRequest.onCompleted.addListener(
  onComplete,
  { urls: ["<all_urls>"] }
);

browser.webRequest.onHeadersReceived.addListener(rewriteCSPHeader,
  { urls: ["<all_urls>"] },
  ["blocking", "responseHeaders"]);

class BrowserService {
  static reloadTab(currentTabId) {
    browser.tabs.executeScript(
      currentTabId, {
        code: `window.location = window.location; ""`
      });
  }
}