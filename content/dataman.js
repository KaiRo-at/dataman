/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is KaiRo's data manager.
 *
 * The Initial Developer of the Original Code is
 * Robert Kaiser <kairo@kairo.at>.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Robert Kaiser <kairo@kairo.at> (original author)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either of the GNU General Public License Version 2 or later (the "GPL"),
 * or the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

window.addEventListener("load", initialize, false);
window.addEventListener("unload", shutdown, false);

// locally loaded services
var gLocSvc = {};
XPCOMUtils.defineLazyServiceGetter(gLocSvc, "eTLD",
                                   "@mozilla.org/network/effective-tld-service;1",
                                   "nsIEffectiveTLDService");
XPCOMUtils.defineLazyServiceGetter(gLocSvc, "cookie",
                                   "@mozilla.org/cookiemanager;1",
                                   "nsICookieManager2");
XPCOMUtils.defineLazyServiceGetter(gLocSvc, "cpref",
                                   "@mozilla.org/content-pref/service;1",
                                   "nsIContentPrefService"); // rv: >= 2.0b3 - Services.contentPrefs
XPCOMUtils.defineLazyServiceGetter(gLocSvc, "pwd",
                                   "@mozilla.org/login-manager;1",
                                   "nsILoginManager");
XPCOMUtils.defineLazyServiceGetter(gLocSvc, "date",
                                   "@mozilla.org/intl/scriptabledateformat;1",
                                   "nsIScriptableDateFormat");
XPCOMUtils.defineLazyServiceGetter(gLocSvc, "fhist",
                                   "@mozilla.org/satchel/form-history;1",
                                   "nsIFormHistory2");
XPCOMUtils.defineLazyServiceGetter(gLocSvc, "url",
                                   "@mozilla.org/network/url-parser;1?auth=maybe",
                                   "nsIURLParser");
XPCOMUtils.defineLazyServiceGetter(gLocSvc, "clipboard",
                                   "@mozilla.org/widget/clipboardhelper;1",
                                   "nsIClipboardHelper");

var gDatamanBundle = null;
var gDatamanDebug = false;

function initialize() {
  gDatamanBundle = document.getElementById("datamanBundle");
  gTabs.initialize();
  gDomains.initialize();
}

function shutdown() {
  gDomains.shutdown();
}

var gChangeObserver = {
  interfaces: [Components.interfaces.nsIObserver,
               Components.interfaces.nsIContentPrefObserver,
               Components.interfaces.nsISupports],

  QueryInterface: function ContentPrefTest_QueryInterface(iid) {
    if (!this.interfaces.some( function(v) { return iid.equals(v) } ))
      throw Components.results.NS_ERROR_NO_INTERFACE;
    return this;
  },

  observe: function changeobserver_observe(aSubject, aTopic, aState) {
    switch (aTopic) {
      case "cookie-changed":
        gCookies.reactToChange(aSubject, aState);
        break;
      case "perm-changed":
        gPerms.reactToChange(aSubject, aState);
        break;
      case "passwordmgr-storage-changed":
        if (/^hostSaving/.test(aState)) {
          gPerms.reactToChange(aSubject, aState);
        }
        else {
          gPasswords.reactToChange(aSubject, aState);
        }
        break;
      case "satchel-storage-changed":
        gFormdata.reactToChange(aSubject, aState);
        break;
      default:
        if (gDatamanDebug)
          Components.utils.reportError("Unexpected change topic observed: " + aTopic);
        break;
    }
  },

  onContentPrefSet: function changeobserver_onContentPrefSet(aGroup, aName, aValue) {
    gPrefs.reactToChange({host: aGroup, name: aName, value: aValue}, "prefSet");
  },

  onContentPrefRemoved: function changeobserver_onContentPrefRemoved(aGroup, aName) {
    gPrefs.reactToChange({host: aGroup, name: aName}, "prefRemoved");
  },
}

var gDomains = {
  tree: null,
  searchfield: null,

  domains: {},
  domainObjects: [],
  displayedDomains: [],
  selectedDomain: {},
  xlcache_hosts: [],
  xlcache_domains: [],

  ignoreSelect: false,
  ignoreUpdate: false,

  initialize: function domain_initialize() {
    if (gDatamanDebug)
      Services.console.logStringMessage("Start building domain list: " + Date.now()/1000);

    this.tree = document.getElementById("domainTree");
    this.tree.view = domainTreeView;

    this.searchfield = document.getElementById("domainSearch");

    Services.obs.addObserver(gChangeObserver, "cookie-changed", false);
    Services.obs.addObserver(gChangeObserver, "perm-changed", false);
    Services.obs.addObserver(gChangeObserver, "passwordmgr-storage-changed", false);
    gLocSvc.cpref.addObserver(null, gChangeObserver);
    Services.obs.addObserver(gChangeObserver, "satchel-storage-changed", false);

    this.ignoreUpdate = true;
    // global "domain"
    this.domainObjects.push({title: "*",
                             hasPreferences: gLocSvc.cpref.getPrefs(null).enumerator.hasMoreElements(),
                             hasFormData: true});

    // add domains for all cookies we find
    if (gDatamanDebug)
      Services.console.logStringMessage("Add cookies to domain list: " + Date.now()/1000);
    gCookies.loadList();
    for (let i = 0; i < gCookies.cookies.length; i++) {
      this.addDomainOrFlag(gCookies.cookies[i].rawHost, "hasCookies");
    }

    // add domains for permissions
    if (gDatamanDebug)
      Services.console.logStringMessage("Add permissions to domain list: " + Date.now()/1000);
    let enumerator = Services.perms.enumerator;
    while (enumerator.hasMoreElements()) {
      let nextPermission = enumerator.getNext();
      nextPermission = nextPermission.QueryInterface(Components.interfaces.nsIPermission);
      this.addDomainOrFlag(nextPermission.host.replace(/^\./, ""), "hasPermissions");
    }
    // add domains for password rejects to permissions
    if (gDatamanDebug)
      Services.console.logStringMessage("Add pwd reject permissions to domain list: " + Date.now()/1000);
    let rejectHosts = gLocSvc.pwd.getAllDisabledHosts();
    for (let i = 0; i < rejectHosts.length; i++) {
      this.addDomainOrFlag(rejectHosts[i], "hasPermissions");
    }

    // add domains for content prefs
    if (gDatamanDebug)
      Services.console.logStringMessage("Add content prefs to domain list: " + Date.now()/1000);
    try {
      var statement = gLocSvc.cpref.DBConnection.createStatement("SELECT groups.name AS host FROM groups");
      while (statement.executeStep()) {
        this.addDomainOrFlag(statement.row["host"], "hasPreferences");
      }
    }
    finally {
      statement.reset();
    }

    // add domains for passwords
    if (gDatamanDebug)
      Services.console.logStringMessage("Add passwords to domain list: " + Date.now()/1000);
    gPasswords.loadList();
    for (let i = 0; i < gPasswords.allSignons.length; i++) {
      this.addDomainOrFlag(gPasswords.allSignons[i].hostname, "hasPasswords");
    }

    if (gDatamanDebug)
      Services.console.logStringMessage("Finalize domain list: " + Date.now()/1000);
    this.ignoreUpdate = false;
    this.search("");
    this.tree.view.selection.select(0);
    gTabs.formdataTab.focus();

    if (gDatamanDebug)
      Services.console.logStringMessage("Domain list built: " + Date.now()/1000);
  },

  shutdown: function domain_shutdown() {
    Services.obs.removeObserver(gChangeObserver, "cookie-changed");
    Services.obs.removeObserver(gChangeObserver, "perm-changed");
    Services.obs.removeObserver(gChangeObserver, "passwordmgr-storage-changed");
    gLocSvc.cpref.removeObserver(null, gChangeObserver);
    Services.obs.removeObserver(gChangeObserver, "satchel-storage-changed");
  },

  _getObjID: function domain__getObjID(aIdx) {
    return gDomains.domainObjects[gDomains.displayedDomains[aIdx]].title;
  },

  getDomainFromHost: function domain_getDomainFromHost(aHostname) {
    // find the base domain name for the given host name
    var cache_idx = this.xlcache_hosts.indexOf(aHostname);
    if (cache_idx < 0) {
      // return vars for nsIURLParser must all be objects
      // see bug 568997 for improvements to that interface
      var schemePos = {}, schemeLen = {}, authPos = {}, authLen = {}, pathPos = {},
          pathLen = {}, usernamePos = {}, usernameLen = {}, passwordPos = {},
          passwordLen = {}, hostnamePos = {}, hostnameLen = {}, port = {};
      gLocSvc.url.parseURL(aHostname, -1, schemePos, schemeLen, authPos, authLen,
                          pathPos, pathLen);
      var auth = aHostname.substring(authPos.value, authPos.value + authLen.value);
      gLocSvc.url.parseAuthority(auth, authLen.value, usernamePos, usernameLen,
                                passwordPos, passwordLen, hostnamePos, hostnameLen, port);
      var hostName = auth.substring(hostnamePos.value, hostnamePos.value + hostnameLen.value);

      var domain;
      try {
        domain = gLocSvc.eTLD.getBaseDomainFromHost(hostName);
      }
      catch (e) {
        domain = hostName;
      }
      this.xlcache_hosts.push(aHostname);
      this.xlcache_domains.push(domain);
      cache_idx = this.xlcache_hosts.length - 1;
    }
    return this.xlcache_domains[cache_idx];
  },

  hostMatchesSelected: function domain_hostMatchesSelected(aHostname) {
    return this.getDomainFromHost(aHostname) == this.selectedDomain.title;
  },

  addDomainOrFlag: function domain_addDomainOrFlag(aHostname, aFlag) {
    // for existing domains, add flags, for others, add them to the object
    let domain = this.getDomainFromHost(aHostname);
    let idx = -1, domAdded = false;
    if (!this.domainObjects.some(
          function(aElement, aIndex, aArray) {
            if (aElement && aElement.title == domain) {
              aArray[aIndex][aFlag] = true;
              idx = aIndex;
            }
            return aElement && aElement.title == domain;
          })) {
      let domObj = {title: domain};
      domObj[aFlag] = true;
      this.domainObjects.push(domObj);
      idx = this.domainObjects.length - 1;
      domAdded = true;
    }
    if (idx >= 0 && !this.ignoreUpdate) {
      if (domAdded)
        this.search(this.searchfield.value);
      else if (domain == this.selectedDomain.title) {
        this.ignoreUpdate = true;
        this.select();
        this.ignoreUpdate = false;
      }
    }
  },

  removeDomainOrFlag: function domain_removeDomainOrFlag(aDomain, aFlag) {
    // remove a flag from the given domain,
    // remove the whole domain if it doesn't have any flags left
    var selectionCache = gDatamanUtils.getSelectedIDs(this.tree, this._getObjID);
    this.tree.view.selection.clearSelection();
    let idx = -1;
    for (let i = 0; i < this.domainObjects.length; i++) {
      if (this.domainObjects[i] &&
          this.domainObjects[i].title == aDomain) {
        idx = i;
        break;
      }
    }
    this.domainObjects[idx][aFlag] = false
    if (!this.domainObjects[idx].hasCookies &&
        !this.domainObjects[idx].hasPermissions &&
        !this.domainObjects[idx].hasPreferences &&
        !this.domainObjects[idx].hasPasswords &&
        !this.domainObjects[idx].hasFormData) {
      this.domainObjects[idx] = null;
      this.search(this.searchfield.value);
    }
    else {
      this.ignoreUpdate = true;
      this.select();
      this.ignoreUpdate = false;
    }
    gDatamanUtils.restoreSelectionFromIDs(this.tree, this._getObjID,
                                          selectionCache);
    // make sure we clear the data pane when selection has been removed
    if (!this.tree.view.selection.count && selectionCache.length)
      this.select();
  },

  resetFlagToDomains: function domain_resetFlagToDomains(aFlag, aDomainList) {
    // Reset a flag to be only set on a specific set of domains,
    // purging then-emtpy domain in the process.
    // Needed when we need to reload a complete set of items.
    this.ignoreSelect = true;
    var selectionCache = gDatamanUtils.getSelectedIDs(this.tree, this._getObjID);
    this.tree.view.selection.clearSelection();
    // First, clear all domains of this flag.
    for (let i = 0; i < this.domainObjects.length; i++) {
      this.domainObjects[i][aFlag] = false;
    }
    // Then, set it again on all domains in the new list.
    for (let i = 0; i < aDomainList.length; i++) {
      this.addDomainOrFlag(aDomainList[i], aFlag);
    }
    // Now, purge all empty doamins.
    for (let i = 0; i < this.domainObjects.length; i++) {
      if (!this.domainObjects[i].hasCookies &&
          !this.domainObjects[i].hasPermissions &&
          !this.domainObjects[i].hasPreferences &&
          !this.domainObjects[i].hasPasswords &&
          !this.domainObjects[i].hasFormData) {
        this.domainObjects[i] = null;
      }
    }
    this.search(this.searchfield.value);
    this.ignoreSelect = false;
    this.ignoreUpdate = true;
    gDatamanUtils.restoreSelectionFromIDs(this.tree, this._getObjID,
                                          selectionCache);
    this.ignoreUpdate = false;
    // make sure we clear the data pane when selection has been removed
    if (!this.tree.view.selection.count && selectionCache.length)
      this.select();
  },

  select: function domain_select() {
    if (this.ignoreSelect) {
      if (this.tree.view.selection.count == 1)
        this.selectedDomain = this.domainObjects[this.displayedDomains[this.tree.currentIndex]];
      return;
    }

    if (gDatamanDebug)
      Services.console.logStringMessage("Domain selected: " + Date.now()/1000);

    if (!this.tree.view.selection.count) {
      gTabs.cookiesTab.disabled = true;
      gTabs.permissionsTab.disabled = true;
      gTabs.preferencesTab.disabled = true;
      gTabs.passwordsTab.disabled = true;
      gTabs.formdataTab.hidden = true;
      gTabs.formdataTab.disabled = true;
      gTabs.forgetTab.hidden = true;
      gTabs.forgetTab.disabled = true;
      gTabs.select();
      this.selectedDomain = {title: false};
      return;
    }

    if (this.tree.view.selection.count > 1) {
      Components.utils.reportError("Data Manager doesn't support anything but one selected domain");
      this.tree.view.selection.clearSelection();
      this.selectedDomain = {title: false};
      return;
    }
    this.selectedDomain = this.domainObjects[this.displayedDomains[this.tree.currentIndex]];
    // disable/enable and hide/show the tabs as needed
    gTabs.cookiesTab.disabled = !this.selectedDomain.hasCookies;
    gTabs.permissionsTab.disabled = !this.selectedDomain.hasPermissions;
    gTabs.preferencesTab.disabled = !this.selectedDomain.hasPreferences;
    gTabs.passwordsTab.disabled = !this.selectedDomain.hasPasswords;
    gTabs.formdataTab.hidden = !this.selectedDomain.hasFormData;
    gTabs.formdataTab.disabled = !this.selectedDomain.hasFormData;
    gTabs.forgetTab.hidden = true;
    let prevtab = gTabs.tabbox.selectedTab || gTabs.cookiesTab;
    let stoptab = null;
    while (gTabs.tabbox.selectedTab != stoptab &&
           (gTabs.tabbox.selectedTab.disabled || gTabs.tabbox.selectedTab.hidden)) {
      gTabs.tabbox.tabs.advanceSelectedTab(1, true);
      if (!stoptab)
        stoptab = prevtab;
    }
    if (!this.ignoreUpdate)
      gTabs.select();

    if (gDatamanDebug)
      Services.console.logStringMessage("Domain select finished: " + Date.now()/1000);
  },

  handleKeyPress: function domain_handleKeyPress(aEvent) {
    if (aEvent.keyCode == KeyEvent.DOM_VK_DELETE) {
      this.forget();
    }
  },

  sort: function domain_sort() {
    // Compare function for two domain items
    let compfunc = function domain_sort_compare(aOne, aTwo) {
      return (gDomains.domainObjects[aOne].title
              .localeCompare(gDomains.domainObjects[aTwo].title));
    };

    // Do the actual sorting of the array
    this.displayedDomains.sort(compfunc);
    this.tree.treeBoxObject.invalidate();
  },

  forget: function domain_forget() {
    gTabs.forgetTab.hidden = false;
    gTabs.tabbox.selectedTab = gTabs.forgetTab;
  },

  search: function domain_search(aSearchString) {
    this.ignoreSelect = true;
    var selectionCache = gDatamanUtils.getSelectedIDs(this.tree, this._getObjID);
    this.tree.view.selection.clearSelection();
    this.tree.treeBoxObject.beginUpdateBatch();
    this.displayedDomains = [];
    for (let i = 0; i < this.domainObjects.length; i++) {
      if (this.domainObjects[i] &&
          this.domainObjects[i].title.toLocaleLowerCase().indexOf(aSearchString) != -1)
        this.displayedDomains.push(i);
    }
    this.tree.treeBoxObject.endUpdateBatch();
    this.sort();
    gDatamanUtils.restoreSelectionFromIDs(this.tree, this._getObjID,
                                          selectionCache);
    this.ignoreSelect = false;
    // make sure we clear the data pane when selection has been removed
    if (!this.tree.view.selection.count && selectionCache.length)
      this.select();
  },

  focusSearch: function domain_focusSearch() {
    this.searchfield.focus();
  },

  updateContext: function domain_updateContext() {
    let forgetCtx = document.getElementById("domain-context-forget");
    forgetCtx.disabled = !this.selectedDomain.title;
    forgetCtx.label = (this.selectedDomain.title == "*") ?
                      forgetCtx.getAttribute("label_global") :
                      forgetCtx.getAttribute("label_domain");
    forgetCtx.accesskey = (this.selectedDomain.title == "*") ?
                          forgetCtx.getAttribute("accesskey_global") :
                          forgetCtx.getAttribute("accesskey_domain");
  },
};

var domainTreeView = {
  get rowCount() {
    return gDomains.displayedDomains.length;
  },
  setTree: function(aTree) {},
  getImageSrc: function(aRow, aColumn) {},
  getProgressMode: function(aRow, aColumn) {},
  getCellValue: function(aRow, aColumn) {},
  getCellText: function(aRow, aColumn) {
    switch (aColumn.id) {
      case "domainCol":
        return gDomains.domainObjects[gDomains.displayedDomains[aRow]].title;
    }
  },
  isSeparator: function(aIndex) { return false; },
  isSorted: function() { return false; },
  isContainer: function(aIndex) { return false; },
  cycleHeader: function(aCol) {},
  getRowProperties: function(aRow, aProp) {},
  getColumnProperties: function(aColumn, aProp) {},
  getCellProperties: function(aRow, aColumn, aProp) {}
};


var gTabs = {
  tabbox: null,
  cookiesTab: null,
  permissionsTab: null,
  preferencesTab: null,
  passwordsTab: null,
  formdataTab: null,
  forgetTab: null,

  activePanel: null,

  initialize: function tabs_initialize() {
    this.tabbox = document.getElementById("tabbox");
    this.cookiesTab = document.getElementById("cookiesTab");
    this.permissionsTab = document.getElementById("permissionsTab");
    this.preferencesTab = document.getElementById("preferencesTab");
    this.passwordsTab = document.getElementById("passwordsTab");
    this.formdataTab = document.getElementById("formdataTab");
    this.forgetTab = document.getElementById("forgetTab");
  },

  select: function tabs_select() {
    if (this.activePanel) {
      switch (this.activePanel) {
        case "cookiesPanel":
          gCookies.shutdown();
          break;
        case "permissionsPanel":
          gPerms.shutdown();
          break;
        case "preferencesPanel":
          gPrefs.shutdown();
          break;
        case "passwordsPanel":
          gPasswords.shutdown();
          break;
        case "formdataPanel":
          gFormdata.shutdown();
          break;
        case "forgetPanel":
          this.forgetTab.hidden = true;
          gForget.shutdown();
          break;
      }
      this.activePanel = null;
    }

    if (!this.tabbox)
      return;

    switch (this.tabbox.selectedPanel.id) {
      case "cookiesPanel":
        gCookies.initialize();
        break;
      case "permissionsPanel":
        gPerms.initialize();
        break;
      case "preferencesPanel":
        gPrefs.initialize();
        break;
      case "passwordsPanel":
        gPasswords.initialize();
        break;
      case "formdataPanel":
        gFormdata.initialize();
        break;
      case "forgetPanel":
        gForget.initialize();
        break;
    }
    this.activePanel = this.tabbox.selectedPanel.id;
  },

  selectAll: function tabs_selectAll() {
    switch (this.activePanel) {
      case "cookiesPanel":
        gCookies.selectAll();
        break;
      case "preferencesPanel":
        gPrefs.selectAll();
        break;
      case "passwordsPanel":
        gPasswords.selectAll();
        break;
      case "formdataPanel":
        gFormdata.selectAll();
        break;
    }
  },

  focusSearch: function tabs_focusSearch() {
    switch (this.activePanel) {
      case "formdataPanel":
        gFormdata.focusSearch();
        break;
    }
  },
};


var gCookies = {
  tree: null,
  cookieInfoName: null,
  cookieInfoValue: null,
  cookieInfoHostLabel: null,
  cookieInfoHost: null,
  cookieInfoPath: null,
  cookieInfoSendType: null,
  cookieInfoExpires: null,
  removeButton: null,
  blockOnRemove: null,

  cookies: [],
  displayedCookies: [],

  initialize: function cookies_initialize() {
    this.tree = document.getElementById("cookiesTree");
    this.tree.view = cookieTreeView;

    this.cookieInfoName = document.getElementById("cookieInfoName");
    this.cookieInfoValue = document.getElementById("cookieInfoValue");
    this.cookieInfoHostLabel = document.getElementById("cookieInfoHostLabel");
    this.cookieInfoHost = document.getElementById("cookieInfoHost");
    this.cookieInfoPath = document.getElementById("cookieInfoPath");
    this.cookieInfoSendType = document.getElementById("cookieInfoSendType");
    this.cookieInfoExpires = document.getElementById("cookieInfoExpires");

    this.removeButton = document.getElementById("cookieRemove");
    this.blockOnRemove = document.getElementById("cookieBlockOnRemove");

    if (!this.cookies.length)
      this.loadList();
    this.tree.treeBoxObject.beginUpdateBatch();
    for (let i = 0; i < this.cookies.length; i++) {
      if (this.cookies[i] &&
          gDomains.hostMatchesSelected(this.cookies[i].rawHost))
        this.displayedCookies.push(i);
    }
    this.sort(null, false, false);
    this.tree.treeBoxObject.endUpdateBatch();
    this.tree.treeBoxObject.invalidate();
  },

  shutdown: function cookies_shutdown() {
    this.tree.view.selection.clearSelection();
    this.tree.view = null;
    this.displayedCookies = [];
  },

  loadList: function cookies_loadList() {
    this.cookies = [];
    let enumerator = gLocSvc.cookie.enumerator;
    while (enumerator.hasMoreElements()) {
      let nextCookie = enumerator.getNext();
      if (!nextCookie) break;
      nextCookie = nextCookie.QueryInterface(Components.interfaces.nsICookie2);
      this.cookies.push(this._makeCookieObject(nextCookie));
    }
  },

  _makeCookieObject: function cookies__makeCookieObject(aCookie) {
      return {name: aCookie.name,
              value: aCookie.value,
              isDomain: aCookie.isDomain,
              host: aCookie.host,
              rawHost: aCookie.rawHost,
              path: aCookie.path,
              isSecure: aCookie.isSecure,
              isSession: aCookie.isSession,
              isHttpOnly: aCookie.isHttpOnly,
              expires: this._getExpiresString(aCookie.expires),
              expiresSortValue: aCookie.expires};
  },

  _getObjID: function cookies__getObjID(aIdx) {
    var curCookie = gCookies.cookies[gCookies.displayedCookies[aIdx]];
    return curCookie.host + "|" + curCookie.path + "|" + curCookie.name;
  },

  _getExpiresString: function cookies__getExpiresString(aExpires) {
    if (aExpires) {
      let date = new Date(1000 * aExpires);

      // if a server manages to set a really long-lived cookie, the dateservice
      // can't cope with it properly, so we'll just return a blank string
      // see bug 238045 for details
      let expiry = "";
      try {
        expiry = gLocSvc.date.FormatDateTime("", gLocSvc.date.dateFormatLong,
                                             gLocSvc.date.timeFormatSeconds,
                                             date.getFullYear(), date.getMonth()+1,
                                             date.getDate(), date.getHours(),
                                             date.getMinutes(), date.getSeconds());
      } catch(ex) {
        // do nothing
      }
      return expiry;
    }
    return gDatamanBundle.getString("cookies.expireAtEndOfSession");
  },

  select: function cookies_select() {
    var selections = gDatamanUtils.getTreeSelections(this.tree);
    this.removeButton.disabled = !selections.length;
    if (!selections.length) {
      this._clearCookieInfo();
      return true;
    }

    if (selections.length > 1) {
      this._clearCookieInfo();
      return true;
    }

    // At this point, we have a single cookie selected.
    var showCookie = this.cookies[this.displayedCookies[selections[0]]];

    this.cookieInfoName.value = showCookie.name;
    this.cookieInfoValue.value = showCookie.value;
    this.cookieInfoHostLabel.value = showCookie.isDomain ?
                                     this.cookieInfoHostLabel.getAttribute("value_domain") :
                                     this.cookieInfoHostLabel.getAttribute("value_host");
    this.cookieInfoHost.value = showCookie.host;
    this.cookieInfoPath.value = showCookie.path;
    var typestringID = "cookies." +
                       (showCookie.isSecure ? "secureOnly" : "anyConnection") +
                       (showCookie.isHttpOnly ? ".httponly" : ".all");
    this.cookieInfoSendType.value = gDatamanBundle.getString(typestringID);
    this.cookieInfoExpires.value = showCookie.expires;
    return true;
  },

  selectAll: function cookies_selectAll() {
    this.tree.view.selection.selectAll();
  },

  _clearCookieInfo: function cookies__clearCookieInfo() {
    var fields = ["cookieInfoName", "cookieInfoValue", "cookieInfoHost",
                  "cookieInfoPath", "cookieInfoSendType", "cookieInfoExpires"];
    for (let i = 0; i < fields.length; i++) {
      this[fields[i]].value = "";
    }
    this.cookieInfoHostLabel.value = this.cookieInfoHostLabel.getAttribute("value_host");
  },

  handleKeyPress: function cookies_handleKeyPress(aEvent) {
    if (aEvent.keyCode == KeyEvent.DOM_VK_DELETE) {
      this.delete();
    }
  },

  sort: function cookies_sort(aColumn, aUpdateSelection, aInvertDirection) {
    // make sure we have a valid column
    let column = aColumn;
    if (!column) {
      let sortedCol = this.tree.columns.getSortedColumn();
      if (sortedCol)
        column = sortedCol.element;
      else
        column = document.getElementById("cookieHostCol");
    }
    else if (column.localName == "treecols" || column.localName == "splitter")
      return;

    if (!column || column.localName != "treecol") {
      Components.utils.reportError("No column found to sort cookies by");
      return;
    }

    let dirAscending = column.getAttribute("sortDirection") !=
                       (aInvertDirection ? "ascending" : "descending");
    let dirFactor = dirAscending ? 1 : -1;

    // Clear attributes on all columns, we're setting them again after sorting
    for (let node = column.parentNode.firstChild; node; node = node.nextSibling) {
      node.removeAttribute("sortActive");
      node.removeAttribute("sortDirection");
    }

    // Compare function for two formdata items
    let compfunc = function formdata_sort_compare(aOne, aTwo) {
      switch (column.id) {
        case "cookieHostCol":
          return dirFactor * gCookies.cookies[aOne].rawHost
                             .localeCompare(gCookies.cookies[aTwo].rawHost);
        case "cookieNameCol":
          return dirFactor * gCookies.cookies[aOne].name
                             .localeCompare(gCookies.cookies[aTwo].name);
        case "cookieExpiresCol":
          return dirFactor * (gCookies.cookies[aOne].expiresSortValue -
                              gCookies.cookies[aTwo].expiresSortValue);
      }
      return 0;
    };

    if (aUpdateSelection) {
      var selectionCache = gDatamanUtils.getSelectedIDs(this.tree, this._getObjID);
    }
    this.tree.view.selection.clearSelection();

    // Do the actual sorting of the array
    this.displayedCookies.sort(compfunc);
    this.tree.treeBoxObject.invalidate();

    if (aUpdateSelection) {
      gDatamanUtils.restoreSelectionFromIDs(this.tree, this._getObjID,
                                            selectionCache);
    }

    // Set attributes to the sorting we did
    column.setAttribute("sortActive", "true");
    column.setAttribute("sortDirection", dirAscending ? "ascending" : "descending");
  },

  delete: function cookies_delete() {
    var selections = gDatamanUtils.getTreeSelections(this.tree);

    if (selections.length > 1) {
      let title = gDatamanBundle.getString("cookies.deleteSelectedTitle");
      let msg = gDatamanBundle.getString("cookies.deleteSelected");
      let flags = ((Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0) +
                   (Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1) +
                   Services.prompt.BUTTON_POS_1_DEFAULT)
      let yes = gDatamanBundle.getString("cookies.deleteSelectedYes");
      if (Services.prompt.confirmEx(window, title, msg, flags, yes, null, null,
                                    null, {value: 0}) == 1) // 1=="Cancel" button
        return;
    }

    this.tree.view.selection.clearSelection();
    // Loop backwards so later indexes in the list don't change.
    for (let i = selections.length - 1; i >= 0; i--) {
      let delCookie = this.cookies[this.displayedCookies[selections[i]]];
      this.cookies[this.displayedCookies[selections[i]]] = null;
      this.displayedCookies.splice(selections[i], 1);
      this.tree.treeBoxObject.rowCountChanged(selections[i], -1);
      gLocSvc.cookie.remove(delCookie.host, delCookie.name, delCookie.path,
                            this.blockOnRemove.checked);
    }
    if (!this.displayedCookies.length)
      gDomains.removeDomainOrFlag(gDomains.selectedDomain.title, "hasCookies");
  },

  updateContext: function cookies_updateContext() {
    document.getElementById("cookies-context-remove").disabled =
      this.removeButton.disabled;
    document.getElementById("cookies-context-selectall").disabled =
      (this.tree.view.selection.count >= this.tree.view.rowCount);
  },

  reactToChange: function cookies_reactToChange(aSubject, aState) {
    // aState: added, changed, deleted, batch-deleted, cleared, reload
    // see http://mxr.mozilla.org/mozilla-central/source/netwerk/cookie/nsICookieService.idl
    if (aState == "batch-deleted" || aState == "cleared" || aState == "reload") {
      // Go for re-parsing the whole thing, as cleared and reload need that anyhow
      // (batch-deleted has an nsIArray of cookies, we could in theory do better there)
      var selectionCache = [];
      if (this.displayedCookies.length) {
        selectionCache = gDatamanUtils.getSelectedIDs(this.tree, this._getObjID);
        this.displayedCookies = [];
      }
      this.loadList();
      var domainList = [];
      for (let i = 0; i < this.cookies.length; i++) {
        let domain = gDomains.getDomainFromHost(this.cookies[i].rawHost);
        if (domainList.indexOf(domain) == -1)
          domainList.push(domain);
      }
      gDomains.resetFlagToDomains("hasCookies", domainList);
      // Restore the local panel display if needed
      if (gTabs.activePanel == "cookiesPanel" &&
          gDomains.selectedDomain.hasCookies) {
        this.tree.treeBoxObject.beginUpdateBatch();
        for (let i = 0; i < this.cookies.length; i++) {
          if (this.cookies[i] &&
              gDomains.hostMatchesSelected(this.cookies[i].rawHost))
            this.displayedCookies.push(i);
        }
        this.sort(null, false, false);
        this.tree.treeBoxObject.endUpdateBatch();
        this.tree.treeBoxObject.invalidate();
        gDatamanUtils.restoreSelectionFromIDs(this.tree, this._getObjID,
                                              selectionCache);
      }
      return;
    }

    // Usual notifications for added, changed, deleted - do "surgical" updates.
    aSubject.QueryInterface(Components.interfaces.nsICookie2);
    let domain = gDomains.getDomainFromHost(aSubject.rawHost);
    // Does change affect possibly loaded Cookies pane?
    let affectsLoaded = this.displayedCookies.length &&
                        gDomains.hostMatchesSelected(aSubject.rawHost);
    if (aState == "added") {
      this.cookies.push(this._makeCookieObject(aSubject));
      if (affectsLoaded) {
        this.displayedCookies.push(this.cookies.length - 1);
        this.tree.treeBoxObject.rowCountChanged(this.cookies.length - 1, 1);
        this.sort(null, true, false);
      }
      else {
        gDomains.addDomainOrFlag(aSubject.rawHost, "hasCookies");
      }
    }
    else {
      idx = -1; disp_idx = -1; domainCookies = 0;
      if (affectsLoaded) {
        for (let i = 0; i < this.displayedCookies.length; i++) {
          let cookie = this.cookies[this.displayedCookies[i]];
          if (cookie && cookie.host == aSubject.host &&
              cookie.name == aSubject.name && cookie.path == aSubject.path) {
            idx = this.displayedCookies[i]; disp_idx = i;
            break;
          }
        }
        if (aState == "deleted")
          domainCookies = this.displayedCookies.length;
      }
      else {
        for (let i = 0; i < this.cookies.length; i++) {
          let cookie = this.cookies[i];
          if (cookie && cookie.host == aSubject.host &&
              cookie.name == aSubject.name && cookie.path == aSubject.path) {
            idx = i;
            if (aState != "deleted")
              break;
          }
          if (aState == "deleted" &&
              gDomains.getDomainFromHost(cookie.rawHost) == domain)
            domainCookies++;
        }
      }
      if (idx >= 0) {
        if (aState == "changed") {
          this.cookies[idx] = this._makeCookieObject(aSubject);
          if (affectsLoaded)
            this.tree.treeBoxObject.invalidateRow(disp_idx);
        }
        else if (aState == "deleted") {
          this.cookies[idx] = null;
          if (affectsLoaded) {
            this.displayedCookies.splice(disp_idx, 1);
            this.tree.treeBoxObject.rowCountChanged(disp_idx, -1);
          }
          if (domainCookies == 1)
            gDomains.removeDomainOrFlag(domain, "hasCookies");
        }
      }
    }
  },

  forget: function cookies_forget() {
    for (let i = 0; i < this.cookies.length; i++) {
      if (this.cookies[i] &&
          gDomains.hostMatchesSelected(this.cookies[i].rawHost)) {
        gLocSvc.cookie.remove(this.cookies[i].host, this.cookies[i].name,
                              this.cookies[i].path, false);
        this.cookies[i] = null;
      }
    }
  },
};

var cookieTreeView = {
  get rowCount() {
    return gCookies.displayedCookies.length;
  },
  setTree: function(aTree) {},
  getImageSrc: function(aRow, aColumn) {},
  getProgressMode: function(aRow, aColumn) {},
  getCellValue: function(aRow, aColumn) {},
  getCellText: function(aRow, aColumn) {
    let cookie = gCookies.cookies[gCookies.displayedCookies[aRow]];
    switch (aColumn.id) {
      case "cookieHostCol":
        return cookie.rawHost;
      case "cookieNameCol":
        return cookie.name;
      case "cookieExpiresCol":
        return cookie.expires;
    }
  },
  isSeparator: function(aIndex) { return false; },
  isSorted: function() { return false; },
  isContainer: function(aIndex) { return false; },
  cycleHeader: function(aCol) {},
  getRowProperties: function(aRow, aProp) {},
  getColumnProperties: function(aColumn, aProp) {},
  getCellProperties: function(aRow, aColumn, aProp) {}
};


var gPerms = {
  list: null,

  initialize: function() {
    this.list = document.getElementById("permList");

    let enumerator = Services.perms.enumerator;
    while (enumerator.hasMoreElements()) {
      let nextPermission = enumerator.getNext();
      nextPermission = nextPermission.QueryInterface(Components.interfaces.nsIPermission);
      let host = nextPermission.host;
      if (gDomains.hostMatchesSelected(host.replace(/^\./, ""))) {
        let permElem = document.createElement("richlistitem");
        permElem.setAttribute("type", nextPermission.type);
        permElem.setAttribute("host", host);
        permElem.setAttribute("rawHost", (host.charAt(0) == ".") ? host.substring(1, host.length) : host);
        permElem.setAttribute("capability", nextPermission.capability);
        permElem.setAttribute("class", "permission");
        permElem.setAttribute("orient", "vertical");
        this.list.appendChild(permElem);
      }
    }
    // visually treat password rejects like permissions
    let rejectHosts = gLocSvc.pwd.getAllDisabledHosts();
    for (let i = 0; i < rejectHosts.length; i++) {
      if (gDomains.hostMatchesSelected(rejectHosts[i])) {
        let permElem = document.createElement("richlistitem");
        permElem.setAttribute("type", "password");
        permElem.setAttribute("host", rejectHosts[i]);
        permElem.setAttribute("rawHost", gDomains.getDomainFromHost(rejectHosts[i]));
        permElem.setAttribute("capability", 2);
        permElem.setAttribute("class", "permission");
        permElem.setAttribute("orient", "vertical");
        this.list.appendChild(permElem);
      }
    }
  },

  shutdown: function() {
    while (this.list.hasChildNodes())
      this.list.removeChild(this.list.firstChild);
  },

  // Most functions of permissions are in the XBL items!

  getDefault: function permissions_getDefault(aType) {
    switch (aType) {
      case "cookie":
        if (Services.prefs.getIntPref("network.cookie.cookieBehavior") == 2)
          return Services.perms.DENY_ACTION;
        if (Services.prefs.getIntPref("network.cookie.lifetimePolicy") == 2)
          return Components.interfaces.nsICookiePermission.ACCESS_SESSION;
        return Services.perms.ALLOW_ACTION;
      case "geo":
        return Services.perms.DENY_ACTION;
      case "image":
        if (Services.prefs.getIntPref("permissions.default.image") == 2)
          return Services.perms.DENY_ACTION;
        return Services.perms.ALLOW_ACTION;
      case "install":
        if (Services.prefs.getBoolPref("xpinstall.whitelist.required"))
          return Services.perms.DENY_ACTION;
        return Services.perms.ALLOW_ACTION;
      case "password":
        return Services.perms.ALLOW_ACTION;
      case "popup":
        if (Services.prefs.getBoolPref("dom.disable_open_during_load"))
          return Services.perms.DENY_ACTION;
        return Services.perms.ALLOW_ACTION;
    }
    return false;
  },

  reactToChange: function permissions_reactToChange(aSubject, aState) {
    if (/^hostSaving/.test(aState)) {
      // aState: hostSavingEnabled, hostSavingDisabled
      aSubject.QueryInterface(Components.interfaces.nsISupportsString);
      let domain = gDomains.getDomainFromHost(aSubject.data);
      // Does change affect possibly loaded Preferences pane?
      let affectsLoaded = this.list.childElementCount &&
                          gDomains.hostMatchesSelected(aSubject.data);
      let permElem = null;
      if (affectsLoaded) {
        for (let i = 0; i < this.list.children.length; i++) {
          let elem = this.list.children[i];
          if (elem.getAttribute("host") == aSubject.data &&
              elem.getAttribute("type") == "password")
            permElem = elem;
        }
      }
      if (aState == "hostSavingEnabled") {
        if (affectsLoaded) {
          if (permElem.capability != Services.perms.ALLOW_ACTION)
            permElem.setCapability(Services.perms.ALLOW_ACTION);
        }
        else {
          // Only remove if domain is not shown, note that this may leave an empty domain.
          let haveDomainPerms = false;
          let enumerator = Services.perms.enumerator;
          while (enumerator.hasMoreElements()) {
            let nextPermission = enumerator.getNext();
            nextPermission = nextPermission.QueryInterface(Components.interfaces.nsIPermission);
            if (domain == gDomains.getDomainFromHost(nextPermission.host.replace(/^\./, "")))
              haveDomainPerms = true;
          }
          let rejectHosts = gLocSvc.pwd.getAllDisabledHosts();
          for (let i = 0; i < rejectHosts.length; i++) {
            if (domain == gDomains.getDomainFromHost(rejectHosts[i]))
              haveDomainPerms = true;
          }
          if (!haveDomainPerms)
            gDomains.removeDomainOrFlag(domain, "hasPermissions");
        }
      }
      else if (aState == "hostSavingDisabled") {
        if (affectsLoaded) {
          if (permElem) {
            if (permElem.capability != Services.perms.DENY_ACTION)
              permElem.setCapability(Services.perms.DENY_ACTION);
          }
          else {
            permElem = document.createElement("richlistitem");
            permElem.setAttribute("type", "password");
            permElem.setAttribute("host", aSubject.data);
            permElem.setAttribute("rawHost", domain);
            permElem.setAttribute("capability", 2);
            permElem.setAttribute("class", "permission");
            permElem.setAttribute("orient", "vertical");
            this.list.appendChild(permElem);
          }
        }
        gDomains.addDomainOrFlag(aSubject.data, "hasPermissions");
      }
    }
    else {
      // aState: added, changed, deleted, cleared
      // See http://mxr.mozilla.org/mozilla-central/source/netwerk/base/public/nsIPermissionManager.idl
      if (aState == "cleared") {
        let domainList = [];
        // Blocked passwords still belong in the list.
        let rejectHosts = gLocSvc.pwd.getAllDisabledHosts();
        for (let i = 0; i < rejectHosts.length; i++) {
          let dom = gDomains.getDomainFromHost(rejectHosts[i]);
          if (domainList.indexOf(dom) == -1)
            domainList.push(dom);
        }
        gDomains.resetFlagToDomains("hasPermissions", domainList);
        return;
      }
      aSubject.QueryInterface(Components.interfaces.nsIPermission);
      let domain = gDomains.getDomainFromHost(aSubject.host);
      // Does change affect possibly loaded Preferences pane?
      let affectsLoaded = this.list.childElementCount &&
                          gDomains.hostMatchesSelected(aSubject.host);
      let permElem = null;
      if (affectsLoaded) {
        for (let i = 0; i < this.list.children.length; i++) {
          let elem = this.list.children[i];
          if (elem.getAttribute("host") == aSubject.host &&
              elem.getAttribute("type") == aSubject.type)
            permElem = elem;
        }
      }
      if (aState == "deleted") {
        if (affectsLoaded) {
          permElem.useDefault(true);
        }
        else {
          // Only remove if domain is not shown, note that this may leave an empty domain.
          let haveDomainPerms = false;
          let enumerator = Services.perms.enumerator;
          while (enumerator.hasMoreElements()) {
            let nextPermission = enumerator.getNext();
            nextPermission = nextPermission.QueryInterface(Components.interfaces.nsIPermission);
            if (domain == gDomains.getDomainFromHost(nextPermission.host.replace(/^\./, "")))
              haveDomainPerms = true;
          }
          let rejectHosts = gLocSvc.pwd.getAllDisabledHosts();
          for (let i = 0; i < rejectHosts.length; i++) {
            if (domain == gDomains.getDomainFromHost(rejectHosts[i]))
              haveDomainPerms = true;
          }
          if (!haveDomainPerms)
            gDomains.removeDomainOrFlag(domain, "hasPermissions");
        }
      }
      else if (aState == "changed" && affectsLoaded) {
        permElem.setCapability(aSubject.capability);
      }
      else if (aState == "added") {
        if (affectsLoaded) {
          if (permElem) {
            permElem.useDefault(false);
            permElem.setCapability(aSubject.capability);
          }
          else {
            permElem = document.createElement("richlistitem");
            permElem.setAttribute("type", aSubject.type);
            permElem.setAttribute("host", aSubject.host);
            permElem.setAttribute("rawHost",
                                  (aSubject.host.charAt(0) == ".") ?
                                  aSubject.host.substring(1, aSubject.host.length) :
                                  aSubject.host);
            permElem.setAttribute("capability", aSubject.capability);
            permElem.setAttribute("class", "permission");
            permElem.setAttribute("orient", "vertical");
            this.list.appendChild(permElem);
          }
        }
        gDomains.addDomainOrFlag(aSubject.host, "hasPermissions");
      }
    }
  },

  forget: function permissions_forget() {
    let delPerms = [];
    let enumerator = Services.perms.enumerator;
    while (enumerator.hasMoreElements()) {
      let nextPermission = enumerator.getNext();
      nextPermission = nextPermission.QueryInterface(Components.interfaces.nsIPermission);
      let host = nextPermission.host;
      if (gDomains.hostMatchesSelected(host.replace(/^\./, ""))) {
        delPerms.push({host: host, type: nextPermission.type});
      }
    }
    for (let i = 0; i < delPerms.length; i++) {
      Services.perms.remove(delPerms[i].host, delPerms[i].type);
    }
    // also remove all password rejects
    let rejectHosts = gLocSvc.pwd.getAllDisabledHosts();
    for (let i = 0; i < rejectHosts.length; i++) {
      if (gDomains.hostMatchesSelected(rejectHosts[i])) {
        gLocSvc.pwd.setLoginSavingEnabled(rejectHosts[i], true);
      }
    }
  },
};


var gPasswords = {
  tree: null,
  removeButton: null,
  toggleButton: null,
  pwdCol: null,

  allSignons: [],
  displayedSignons: [],
  showPasswords: false,

  initialize: function passwords_initialize() {
    this.tree = document.getElementById("passwordsTree");
    this.tree.view = passwordTreeView;

    this.removeButton = document.getElementById("pwdRemove");
    this.toggleButton = document.getElementById("pwdToggle");
    this.toggleButton.label = gDatamanBundle.getString("pwd.showPasswords");
    this.toggleButton.accessKey = gDatamanBundle.getString("pwd.showPasswords.accesskey");

    this.pwdCol = document.getElementById("pwdPasswordCol");

    this.tree.treeBoxObject.beginUpdateBatch();
    if (!this.allSignons)
      this.loadList();
    for (let i = 0; i < this.allSignons.length; i++) {
      if (this.allSignons[i] &&
          gDomains.hostMatchesSelected(this.allSignons[i].hostname))
        this.displayedSignons.push(i);
    }
    this.sort(null, false, false);
    this.tree.treeBoxObject.endUpdateBatch();
    this.tree.treeBoxObject.invalidate();
  },

  shutdown: function passwords_shutdown() {
    if (this.showPasswords)
      this.togglePasswordVisible();
    this.tree.view.selection.clearSelection();
    this.tree.view = null;
    this.displayedSignons = [];
  },

  loadList: function passwords_loadList() {
    this.allSignons = [];
    this.allSignons = gLocSvc.pwd.getAllLogins();
  },

  _getObjID: function passwords__getObjID(aIdx) {
    var curSignon = gPasswords.allSignons[gPasswords.displayedSignons[aIdx]];
    return curSignon.hostname + "|" + curSignon.httpRealm + "|" + curSignon.username;
  },

  select: function passwords_select() {
    var selections = gDatamanUtils.getTreeSelections(this.tree);
    this.removeButton.disabled = !selections.length;
    return true;
  },

  selectAll: function passwords_selectAll() {
    this.tree.view.selection.selectAll();
  },

  handleKeyPress: function passwords_handleKeyPress(aEvent) {
    if (aEvent.keyCode == KeyEvent.DOM_VK_DELETE) {
      this.delete();
    }
  },

  sort: function passwords_sort(aColumn, aUpdateSelection, aInvertDirection) {
    // make sure we have a valid column
    let column = aColumn;
    if (!column) {
      let sortedCol = this.tree.columns.getSortedColumn();
      if (sortedCol)
        column = sortedCol.element;
      else
        column = document.getElementById("pwdHostCol");
    }
    else if (column.localName == "treecols" || column.localName == "splitter")
      return;

    if (!column || column.localName != "treecol") {
      Components.utils.reportError("No column found to sort form data by");
      return;
    }

    let dirAscending = column.getAttribute("sortDirection") !=
                       (aInvertDirection ? "ascending" : "descending");
    let dirFactor = dirAscending ? 1 : -1;

    // Clear attributes on all columns, we're setting them again after sorting
    for (let node = column.parentNode.firstChild; node; node = node.nextSibling) {
      node.removeAttribute("sortActive");
      node.removeAttribute("sortDirection");
    }

    // Compare function for two signons
    let compfunc = function passwords_sort_compare(aOne, aTwo) {
      switch (column.id) {
        case "pwdHostCol":
          return dirFactor * gPasswords.allSignons[aOne].hostname
                             .localeCompare(gPasswords.allSignons[aTwo].hostname);
        case "pwdUserCol":
          return dirFactor * gPasswords.allSignons[aOne].username
                             .localeCompare(gPasswords.allSignons[aTwo].username);
        case "pwdPasswordCol":
          return dirFactor * gPasswords.allSignons[aOne].password
                             .localeCompare(gPasswords.allSignons[aTwo].password);
      }
      return 0;
    };

    if (aUpdateSelection) {
      var selectionCache = gDatamanUtils.getSelectedIDs(this.tree, this._getObjID);
    }
    this.tree.view.selection.clearSelection();

    // Do the actual sorting of the array
    this.displayedSignons.sort(compfunc);
    this.tree.treeBoxObject.invalidate();

    if (aUpdateSelection) {
      gDatamanUtils.restoreSelectionFromIDs(this.tree, this._getObjID,
                                            selectionCache);
    }

    // Set attributes to the sorting we did
    column.setAttribute("sortActive", "true");
    column.setAttribute("sortDirection", dirAscending ? "ascending" : "descending");
  },

  delete: function passwords_delete() {
    var selections = gDatamanUtils.getTreeSelections(this.tree);

    if (selections.length > 1) {
      let title = gDatamanBundle.getString("pwd.deleteSelectedTitle");
      let msg = gDatamanBundle.getString("pwd.deleteSelected");
      let flags = ((Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0) +
                   (Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1) +
                   Services.prompt.BUTTON_POS_1_DEFAULT)
      let yes = gDatamanBundle.getString("pwd.deleteSelectedYes");
      if (Services.prompt.confirmEx(window, title, msg, flags, yes, null, null,
                                    null, {value: 0}) == 1) // 1=="Cancel" button
        return;
    }

    this.tree.view.selection.clearSelection();
    // Loop backwards so later indexes in the list don't change.
    for (let i = selections.length - 1; i >= 0; i--) {
      let delSignon = this.allSignons[this.displayedSignons[selections[i]]];
      this.allSignons[this.displayedSignons[selections[i]]] = null;
      this.displayedSignons.splice(selections[i], 1);
      this.tree.treeBoxObject.rowCountChanged(selections[i], -1);
      gLocSvc.pwd.removeLogin(delSignon);
    }
  },

  togglePasswordVisible: function passwords_togglePasswordVisible() {
    if (this.showPasswords || this._confirmShowPasswords()) {
      this.showPasswords = !this.showPasswords;
      this.toggleButton.label = gDatamanBundle.getString(this.showPasswords ?
                                                         "pwd.hidePasswords" :
                                                         "pwd.showPasswords");
      this.toggleButton.accessKey = gDatamanBundle.getString(this.showPasswords ?
                                                             "pwd.hidePasswords.accesskey" :
                                                             "pwd.showPasswords.accesskey");
      this.pwdCol.hidden = !this.showPasswords;
    }
  },

  _confirmShowPasswords: function passwords__confirmShowPasswords() {
    // This doesn't harm if passwords are not encrypted
    let tokendb = Components.classes["@mozilla.org/security/pk11tokendb;1"]
                            .createInstance(Components.interfaces.nsIPK11TokenDB);
    let token = tokendb.getInternalKeyToken();

    // If there is no master password, still give the user a chance to opt-out
    // of displaying passwords
    if (token.checkPassword(""))
      return this._askUserShowPasswords();

    // So there's a master password. But since checkPassword didn't succeed,
    // we're logged out (per nsIPK11Token.idl).
    try {
      // Relogin and ask for the master password.
      token.login(true);  // 'true' means always prompt for token password. User
                          // will be prompted until clicking 'Cancel' or
                          // entering the correct password.
    } catch (e) {
      // An exception will be thrown if the user cancels the login prompt dialog.
      // User is also logged out of Software Security Device.
    }

    return token.isLoggedIn();
  },

  _askUserShowPasswords: function passwords__askUserShowPasswords() {
    // Confirm the user wants to display passwords
    return Services.prompt.confirmEx(window,
                                     null,
                                     gDatamanBundle.getString("pwd.noMasterPasswordPrompt"),
                                     Services.prompt.STD_YES_NO_BUTTONS,
                                     null, null, null, null, { value: false }) == 0; // 0=="Yes" button
  },

  updateContext: function passwords_updateContext() {
    document.getElementById("pwd-context-remove").disabled =
      this.removeButton.disabled;
    document.getElementById("pwd-context-copypassword").disabled =
      (this.tree.view.selection.count != 1);
    document.getElementById("pwd-context-selectall").disabled =
      (this.tree.view.selection.count >= this.tree.view.rowCount);
  },

  copyPassword: function passwords_copyPassword() {
    // Copy selected signon's password to clipboard
    let row = this.tree.currentIndex;
    let password = gPasswords.allSignons[gPasswords.displayedSignons[row]].password;
    gLocSvc.clipboard.copyString(password);
  },

  reactToChange: function passwords_reactToChange(aSubject, aState) {
    // aState: addLogin, modifyLogin, removeLogin, removeAllLogins
    if (aState == "removeAllLogins") {
      // Go for re-parsing the whole thing
      if (this.displayedSignons.length) {
        this.tree.view.selection.clearSelection();
        this.tree.treeBoxObject.beginUpdateBatch();
        this.displayedSignons = [];
        this.tree.treeBoxObject.endUpdateBatch();
        this.tree.treeBoxObject.invalidate();
      }
      this.loadList();
      let domainList = [];
      for (let i = 0; i < this.allSignons.length; i++) {
        let domain = gDomains.getDomainFromHost(this.allSignons[i].hostname);
        if (domainList.indexOf(domain) == -1)
          domainList.push(domain);
      }
      gDomains.resetFlagToDomains("hasPasswords", domainList);
      return;
    }

    // Usual notifications for addLogin, modifyLogin, removeLogin - do "surgical" updates.
    let curLogin = null, oldLogin = null;
    if (aState == "modifyLogin" &&
        aSubject instanceof Components.interfaces.nsIArray) {
      let enumerator = aSubject.enumerate();
      if (enumerator.hasMoreElements()) {
        oldLogin = enumerator.getNext();
        oldLogin.QueryInterface(Components.interfaces.nsILoginInfo);
      }
      if (enumerator.hasMoreElements()) {
        curLogin = enumerator.getNext();
        curLogin.QueryInterface(Components.interfaces.nsILoginInfo);
      }
    }
    else if (aSubject instanceof Components.interfaces.nsILoginInfo) {
      curLogin = aSubject; oldLogin = aSubject;
    }
    else {
      Components.utils.reportError("Observed an unrecognized signon change of type " + aState);
    }

    let domain = gDomains.getDomainFromHost(curLogin.hostname);
    // Does change affect possibly loaded Passwords pane?
    let affectsLoaded = this.displayedSignons.length &&
                        gDomains.hostMatchesSelected(curLogin.hostname);
    if (aState == "addLogin") {
      this.allSignons.push(curLogin);

      if (affectsLoaded) {
        this.displayedSignons.push(this.allSignons.length - 1);
        this.tree.treeBoxObject.rowCountChanged(this.allSignons.length - 1, 1);
        this.sort(null, true, false);
      }
      else {
        gDomains.addDomainOrFlag(curLogin.hostname, "hasPasswords");
      }
    }
    else {
      idx = -1; disp_idx = -1; domainPasswords = 0;
      if (affectsLoaded) {
        for (let i = 0; i < this.displayedSignons.length; i++) {
          let signon = this.allSignons[this.displayedSignons[i]];
          if (signon && signon.equals(oldLogin)) {
            idx = this.displayedSignons[i]; disp_idx = i;
            break;
          }
        }
        if (aState == "removeLogin")
          domainPasswords = this.displayedSignons.length;
      }
      else {
        for (let i = 0; i < this.allSignons.length; i++) {
          let signon = this.allSignons[i];
          if (signon && signon.equals(oldLogin)) {
            idx = i;
            if (aState != "removeLogin")
              break;
          }
          if (aState == "removeLogin" &&
              gDomains.getDomainFromHost(oldLogin.hostname) == domain)
            domainPasswords++;
        }
      }
      if (idx >= 0) {
        if (aState == "modifyLogin") {
          this.allSignons[idx] = curLogin;
          if (affectsLoaded)
            this.tree.treeBoxObject.invalidateRow(disp_idx);
        }
        else if (aState == "removeLogin") {
          this.allSignons[idx] = null;
          if (affectsLoaded) {
            this.displayedSignons.splice(disp_idx, 1);
            this.tree.treeBoxObject.rowCountChanged(disp_idx, -1);
          }
          if (domainCookies == 1)
            gDomains.removeDomainOrFlag(domain, "hasPasswords");
        }
      }
    }
  },

  forget: function passwords_forget() {
    for (let i = 0; i < this.allSignons.length; i++) {
      if (this.allSignons[i] &&
          gDomains.hostMatchesSelected(this.allSignons[i].hostname)) {
        gLocSvc.pwd.removeLogin(this.allSignons[i]);
        this.allSignons[i] = null;
      }
    }
  },
};

var passwordTreeView = {
  get rowCount() {
    return gPasswords.displayedSignons.length;
  },
  setTree: function(aTree) {},
  getImageSrc: function(aRow, aColumn) {},
  getProgressMode: function(aRow, aColumn) {},
  getCellValue: function(aRow, aColumn) {},
  getCellText: function(aRow, aColumn) {
    let signon = gPasswords.allSignons[gPasswords.displayedSignons[aRow]];
    switch (aColumn.id) {
      case "pwdHostCol":
        return signon.httpRealm ?
               (signon.hostname + " (" + signon.httpRealm + ")") :
               signon.hostname;
      case "pwdUserCol":
        return signon.username || "";
      case "pwdPasswordCol":
        return signon.password || "";
    }
  },
  isSeparator: function(aIndex) { return false; },
  isSorted: function() { return false; },
  isContainer: function(aIndex) { return false; },
  cycleHeader: function(aCol) {},
  getRowProperties: function(aRow, aProp) {},
  getColumnProperties: function(aColumn, aProp) {},
  getCellProperties: function(aRow, aColumn, aProp) {}
};


var gPrefs = {
  tree: null,
  removeButton: null,

  prefs: [],
  displayedPrefs: [],

  initialize: function prefs_initialize() {
    this.tree = document.getElementById("prefsTree");
    this.tree.view = prefsTreeView;

    this.removeButton = document.getElementById("prefsRemove");

    this.tree.treeBoxObject.beginUpdateBatch();
    // get all groups (hosts) that match the domain
    let domain = gDomains.selectedDomain.title;
    if (domain == "*") {
      let enumerator = gLocSvc.cpref.getPrefs(null).enumerator;
      while (enumerator.hasMoreElements()) {
        let pref = enumerator.getNext().QueryInterface(Components.interfaces.nsIProperty);
        this.prefs.push({host: null, name: pref.name, value: pref.value});
        this.displayedPrefs.push(this.prefs.length - 1);
      }
    }
    else {
      try {
        let sql = "SELECT groups.name AS host FROM groups WHERE host=:hostName OR host LIKE :hostMatch ESCAPE '/'";
        var statement = gLocSvc.cpref.DBConnection.createStatement(sql);
        statement.params.hostName = domain;
        statement.params.hostMatch = "%." + statement.escapeStringForLIKE(domain, "/");
        while (statement.executeStep()) {
          // now, get all prefs for that host
          let enumerator =  gLocSvc.cpref.getPrefs(statement.row["host"]).enumerator;
          while (enumerator.hasMoreElements()) {
            let pref = enumerator.getNext().QueryInterface(Components.interfaces.nsIProperty);
            this.prefs.push({host: statement.row["host"], name: pref.name, value: pref.value});
            this.displayedPrefs.push(this.prefs.length - 1);
          }
        }
      }
      finally {
        statement.reset();
      }
    }
    this.sort(null, false, false);
    this.tree.treeBoxObject.endUpdateBatch();
    this.tree.treeBoxObject.invalidate();
  },

  shutdown: function prefs_shutdown() {
    this.tree.view.selection.clearSelection();
    this.tree.view = null;
    this.prefs = [];
    this.displayedPrefs = [];
  },

  _getObjID: function prefs__getObjID(aIdx) {
    var curPref = gPrefs.prefs[gPrefs.displayedPrefs[aIdx]];
    return curPref.host + "|" + curPref.name;
  },

  select: function prefs_select() {
    var selections = gDatamanUtils.getTreeSelections(this.tree);
    this.removeButton.disabled = !selections.length;
    return true;
  },

  selectAll: function prefs_selectAll() {
    this.tree.view.selection.selectAll();
  },

  handleKeyPress: function prefs_handleKeyPress(aEvent) {
    if (aEvent.keyCode == KeyEvent.DOM_VK_DELETE) {
      this.delete();
    }
  },

  sort: function prefs_sort(aColumn, aUpdateSelection, aInvertDirection) {
    // make sure we have a valid column
    let column = aColumn;
    if (!column) {
      let sortedCol = this.tree.columns.getSortedColumn();
      if (sortedCol)
        column = sortedCol.element;
      else
        column = document.getElementById("prefsHostCol");
    }
    else if (column.localName == "treecols" || column.localName == "splitter")
      return;

    if (!column || column.localName != "treecol") {
      Components.utils.reportError("No column found to sort form data by");
      return;
    }

    let dirAscending = column.getAttribute("sortDirection") !=
                       (aInvertDirection ? "ascending" : "descending");
    let dirFactor = dirAscending ? 1 : -1;

    // Clear attributes on all columns, we're setting them again after sorting
    for (let node = column.parentNode.firstChild; node; node = node.nextSibling) {
      node.removeAttribute("sortActive");
      node.removeAttribute("sortDirection");
    }

    // Compare function for two signons
    let compfunc = function passwords_sort_compare(aOne, aTwo) {
      switch (column.id) {
        case "prefsHostCol":
          return dirFactor * gPrefs.prefs[aOne].host
                             .localeCompare(gPrefs.prefs[aTwo].host);
        case "prefsNameCol":
          return dirFactor * gPrefs.prefs[aOne].name
                             .localeCompare(gPrefs.prefs[aTwo].name);
        case "prefsValueCol":
          return dirFactor * gPrefs.prefs[aOne].value
                             .localeCompare(gPrefs.prefs[aTwo].value);
      }
      return 0;
    };

    if (aUpdateSelection) {
      var selectionCache = gDatamanUtils.getSelectedIDs(this.tree, this._getObjID);
    }
    this.tree.view.selection.clearSelection();

    // Do the actual sorting of the array
    this.displayedPrefs.sort(compfunc);
    this.tree.treeBoxObject.invalidate();

    if (aUpdateSelection) {
      gDatamanUtils.restoreSelectionFromIDs(this.tree, this._getObjID,
                                            selectionCache);
    }

    // Set attributes to the sorting we did
    column.setAttribute("sortActive", "true");
    column.setAttribute("sortDirection", dirAscending ? "ascending" : "descending");
  },

  delete: function prefs_delete() {
    var selections = gDatamanUtils.getTreeSelections(this.tree);

    if (selections.length > 1) {
      let title = gDatamanBundle.getString("prefs.deleteSelectedTitle");
      let msg = gDatamanBundle.getString("prefs.deleteSelected");
      let flags = ((Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0) +
                   (Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1) +
                   Services.prompt.BUTTON_POS_1_DEFAULT)
      let yes = gDatamanBundle.getString("prefs.deleteSelectedYes");
      if (Services.prompt.confirmEx(window, title, msg, flags, yes, null, null,
                                    null, {value: 0}) == 1) // 1=="Cancel" button
        return;
    }

    this.tree.view.selection.clearSelection();
    // Loop backwards so later indexes in the list don't change.
    for (let i = selections.length - 1; i >= 0; i--) {
      let delPref = this.prefs[this.displayedPrefs[selections[i]]];
      this.prefs[this.displayedPrefs[selections[i]]] = null;
      this.displayedPrefs.splice(selections[i], 1);
      this.tree.treeBoxObject.rowCountChanged(selections[i], -1);
      gLocSvc.cpref.removePref(delPref.host, delPref.name);
    }
  },

  updateContext: function prefs_updateContext() {
    document.getElementById("prefs-context-remove").disabled =
      this.removeButton.disabled;
    document.getElementById("prefs-context-selectall").disabled =
      (this.tree.view.selection.count >= this.tree.view.rowCount);
  },

  reactToChange: function prefs_reactToChange(aSubject, aState) {
    // aState: prefSet, prefRemoved

    // Do "surgical" updates.
    let domain = gDomains.getDomainFromHost(aSubject.host);
    // Does change affect possibly loaded Preferences pane?
    let affectsLoaded = this.displayedPrefs.length &&
                        gDomains.hostMatchesSelected(aSubject.host);
    idx = -1; disp_idx = -1; domainPrefs = 0;
    if (affectsLoaded) {
      for (let i = 0; i < this.displayedPrefs.length; i++) {
        let cpref = this.prefs[this.displayedPrefs[i]];
        if (cpref && cpref.host == aSubject.host && cpref.name == aSubject.name) {
          idx = this.displayedPrefs[i]; disp_idx = i;
          break;
        }
      }
      if (aState == "prefRemoved")
        domainPrefs = this.displayedPrefs.length;
    }
    else if (aState == "prefRemoved") {
      // See if there are any prefs left for that domain.
      if (domain == "*") {
        let enumerator = gLocSvc.cpref.getPrefs(null).enumerator;
        if (enumerator.hasMoreElements())
          domainPrefs++;
      }
      else {
        try {
          let sql = "SELECT groups.name AS host FROM groups WHERE host=:hostName OR host LIKE :hostMatch ESCAPE '/'";
          var statement = gLocSvc.cpref.DBConnection.createStatement(sql);
          statement.params.hostName = domain;
          statement.params.hostMatch = "%." + statement.escapeStringForLIKE(domain, "/");
          while (statement.executeStep()) {
            // now, get all prefs for that host
            let enumerator = gLocSvc.cpref.getPrefs(statement.row["host"]).enumerator;
            if (enumerator.hasMoreElements())
              domainPrefs++;
          }
        }
        finally {
          statement.reset();
        }
      }
      if (!domainPrefs)
        gDomains.removeDomainOrFlag(domain, "hasPreferences");
    }
    if (idx >= 0) {
      if (aState == "prefSet") {
        this.prefs[idx] = aSubject;
        if (affectsLoaded)
          this.tree.treeBoxObject.invalidateRow(disp_idx);
      }
      else if (aState == "prefRemoved") {
        this.prefs[idx] = null;
        if (affectsLoaded) {
          this.displayedPrefs.splice(disp_idx, 1);
          this.tree.treeBoxObject.rowCountChanged(disp_idx, -1);
        }
        if (domainPrefs == 1)
          gDomains.removeDomainOrFlag(domain, "hasPreferences");
      }
    }
    else if (aState == "prefSet") {
      // Pref set, no prev index known - either new or existing pref domain.
      if (affectsLoaded) {
        this.prefs.push(aSubject);
        this.displayedPrefs.push(this.prefs.length - 1);
        this.tree.treeBoxObject.rowCountChanged(this.prefs.length - 1, 1);
        this.sort(null, true, false);
      }
      else {
        gDomains.addDomainOrFlag(aSubject.host, "hasPreferences");
      }
    }
  },

  forget: function prefs_forget() {
    let delPrefs = [];
    try {
      // get all groups (hosts) that match the domain
      let domain = gDomains.selectedDomain.title;
      if (domain == "*") {
        let enumerator =  gLocSvc.cpref.getPrefs(null).enumerator;
        while (enumerator.hasMoreElements()) {
          let pref = enumerator.getNext().QueryInterface(Components.interfaces.nsIProperty);
          delPrefs.push({host: null, name: pref.name, value: pref.value});
        }
      }
      else {
        let sql = "SELECT groups.name AS host FROM groups WHERE host=:hostName OR host LIKE :hostMatch ESCAPE '/'";
        var statement = gLocSvc.cpref.DBConnection.createStatement(sql);
        statement.params.hostName = domain;
        statement.params.hostMatch = "%." + statement.escapeStringForLIKE(domain, "/");
        while (statement.executeStep()) {
          // now, get all prefs for that host
          let enumerator =  gLocSvc.cpref.getPrefs(statement.row["host"]).enumerator;
          while (enumerator.hasMoreElements()) {
            let pref = enumerator.getNext().QueryInterface(Components.interfaces.nsIProperty);
            delPrefs.push({host: statement.row["host"], name: pref.name, value: pref.value});
          }
        }
      }
    }
    finally {
      statement.reset();
    }
    for (let i = 0; i < delPrefs.length; i++) {
      gLocSvc.cpref.removePref(delPrefs[i].host, delPrefs[i].name);
    }
  },
};

var prefsTreeView = {
  get rowCount() {
    return gPrefs.displayedPrefs.length;
  },
  setTree: function(aTree) {},
  getImageSrc: function(aRow, aColumn) {},
  getProgressMode: function(aRow, aColumn) {},
  getCellValue: function(aRow, aColumn) {},
  getCellText: function(aRow, aColumn) {
    let cpref = gPrefs.prefs[gPrefs.displayedPrefs[aRow]];
    switch (aColumn.id) {
      case "prefsHostCol":
        return cpref.host || "*";
      case "prefsNameCol":
        return cpref.name;
      case "prefsValueCol":
        return cpref.value;
    }
  },
  isSeparator: function(aIndex) { return false; },
  isSorted: function() { return false; },
  isContainer: function(aIndex) { return false; },
  cycleHeader: function(aCol) {},
  getRowProperties: function(aRow, aProp) {},
  getColumnProperties: function(aColumn, aProp) {},
  getCellProperties: function(aRow, aColumn, aProp) {}
};


var gFormdata = {
  tree: null,
  removeButton: null,
  searchfield: null,

  formdata: [],
  displayedFormdata: [],

  initialize: function formdata_initialize() {
    this.tree = document.getElementById("formdataTree");
    this.tree.view = formdataTreeView;

    this.searchfield = document.getElementById("fdataSearch");
    this.removeButton = document.getElementById("fdataRemove");

    // Always load fresh list, no need to react to changes when pane not open.
    this.loadList();
    this.search("");
  },

  shutdown: function formdata_shutdown() {
    this.tree.view.selection.clearSelection();
    this.tree.view = null;
    this.displayedFormdata = [];
  },

  loadList: function formdata_loadList() {
    this.formdata = [];
    try {
      let sql = "SELECT fieldname, value, timesUsed, firstUsed, lastUsed, guid FROM moz_formhistory";
      var statement = gLocSvc.fhist.DBConnection.createStatement(sql);
      while (statement.executeStep()) {
        this.formdata.push({fieldname: statement.row["fieldname"],
                            value: statement.row["value"],
                            timesUsed: statement.row["timesUsed"],
                            firstUsed: this._getTimeString(statement.row["firstUsed"]),
                            firstUsedSortValue: statement.row["firstUsed"],
                            lastUsed: this._getTimeString(statement.row["lastUsed"]),
                            lastUsedSortValue: statement.row["lastUsed"],
                            guid: statement.row["guid"]}
                          );
      }
    }
    finally {
      statement.reset();
    }
  },

  _getTimeString: function formdata__getTimeString(aTimestamp) {
    if (aTimestamp) {
      let date = new Date(aTimestamp / 1000);

      // If a date has an extreme value, the dateservice can't cope with it
      // properly, so we'll just return a blank string
      // see bug 238045 for details
      let dtString = "";
      try {
        dtString = gLocSvc.date.FormatDateTime("", gLocSvc.date.dateFormatLong,
                                               gLocSvc.date.timeFormatSeconds,
                                               date.getFullYear(), date.getMonth()+1,
                                               date.getDate(), date.getHours(),
                                               date.getMinutes(), date.getSeconds());
      } catch(ex) {
        // do nothing
      }
      return dtString;
    }
    return "";
  },

  _getObjID: function formdata__getObjID(aIdx) {
    return gFormdata.formdata[gFormdata.displayedFormdata[aIdx]].guid;
  },

  select: function formdata_select() {
    var selections = gDatamanUtils.getTreeSelections(this.tree);
    this.removeButton.disabled = !selections.length;
    return true;
  },

  selectAll: function formdata_selectAll() {
    this.tree.view.selection.selectAll();
  },

  handleKeyPress: function formdata_handleKeyPress(aEvent) {
    if (aEvent.keyCode == KeyEvent.DOM_VK_DELETE) {
      this.delete();
    }
  },

  sort: function formdata_sort(aColumn, aUpdateSelection, aInvertDirection) {
    // make sure we have a valid column
    let column = aColumn;
    if (!column) {
      let sortedCol = this.tree.columns.getSortedColumn();
      if (sortedCol)
        column = sortedCol.element;
      else
        column = document.getElementById("fdataFieldCol");
    }
    else if (column.localName == "treecols" || column.localName == "splitter")
      return;

    if (!column || column.localName != "treecol") {
      Components.utils.reportError("No column found to sort form data by");
      return;
    }

    let dirAscending = column.getAttribute("sortDirection") !=
                       (aInvertDirection ? "ascending" : "descending");
    let dirFactor = dirAscending ? 1 : -1;

    // Clear attributes on all columns, we're setting them again after sorting
    for (let node = column.parentNode.firstChild; node; node = node.nextSibling) {
      node.removeAttribute("sortActive");
      node.removeAttribute("sortDirection");
    }

    // Compare function for two formdata items
    let compfunc = function formdata_sort_compare(aOne, aTwo) {
      switch (column.id) {
        case "fdataFieldCol":
          return dirFactor * gFormdata.formdata[aOne].fieldname
                             .localeCompare(gFormdata.formdata[aTwo].fieldname);
        case "fdataValueCol":
          return dirFactor * gFormdata.formdata[aOne].value
                             .localeCompare(gFormdata.formdata[aTwo].value);
        case "fdataCountCol":
          return dirFactor * (gFormdata.formdata[aOne].timesUsed -
                              gFormdata.formdata[aTwo].timesUsed);
        case "fdataFirstCol":
          return dirFactor * (gFormdata.formdata[aOne].firstUsedSortValue -
                              gFormdata.formdata[aTwo].firstUsedSortValue);
        case "fdataLastCol":
          return dirFactor * (gFormdata.formdata[aOne].lastUsedSortValue -
                              gFormdata.formdata[aTwo].lastUsedSortValue);
      }
      return 0;
    };

    if (aUpdateSelection) {
      var selectionCache = gDatamanUtils.getSelectedIDs(this.tree, this._getObjID);
    }
    this.tree.view.selection.clearSelection();

    // Do the actual sorting of the array
    this.displayedFormdata.sort(compfunc);
    this.tree.treeBoxObject.invalidate();

    if (aUpdateSelection) {
      gDatamanUtils.restoreSelectionFromIDs(this.tree, this._getObjID,
                                            selectionCache);
    }

    // Set attributes to the sorting we did
    column.setAttribute("sortActive", "true");
    column.setAttribute("sortDirection", dirAscending ? "ascending" : "descending");
  },

  delete: function formdata_delete() {
    var selections = gDatamanUtils.getTreeSelections(this.tree);

    if (selections.length > 1) {
      let title = gDatamanBundle.getString("fdata.deleteSelectedTitle");
      let msg = gDatamanBundle.getString("fdata.deleteSelected");
      let flags = ((Services.prompt.BUTTON_TITLE_IS_STRING * Services.prompt.BUTTON_POS_0) +
                   (Services.prompt.BUTTON_TITLE_CANCEL * Services.prompt.BUTTON_POS_1) +
                   Services.prompt.BUTTON_POS_1_DEFAULT)
      let yes = gDatamanBundle.getString("fdata.deleteSelectedYes");
      if (Services.prompt.confirmEx(window, title, msg, flags, yes, null, null,
                                    null, {value: 0}) == 1) // 1=="Cancel" button
        return;
    }

    this.tree.view.selection.clearSelection();
    // Loop backwards so later indexes in the list don't change.
    for (let i = selections.length - 1; i >= 0; i--) {
      let delFData = this.formdata[this.displayedFormdata[selections[i]]];
      this.formdata[this.displayedFormdata[selections[i]]] = null;
      this.displayedFormdata.splice(selections[i], 1);
      this.tree.treeBoxObject.rowCountChanged(selections[i], -1);
      gLocSvc.fhist.removeEntry(delFData.fieldname, delFData.value);
    }
  },

  search: function formdata_search(aSearchString) {
    var selectionCache = gDatamanUtils.getSelectedIDs(this.tree, this._getObjID);
    this.tree.view.selection.clearSelection();
    this.tree.treeBoxObject.beginUpdateBatch();
    this.displayedFormdata = [];
    for (let i = 0; i < this.formdata.length; i++) {
      if (this.formdata[i] &&
          (this.formdata[i].fieldname.toLocaleLowerCase().indexOf(aSearchString) != -1 ||
           this.formdata[i].value.toLocaleLowerCase().indexOf(aSearchString) != -1))
        this.displayedFormdata.push(i);
    }
    this.tree.treeBoxObject.endUpdateBatch();
    this.sort(null, false, false);
    gDatamanUtils.restoreSelectionFromIDs(this.tree, this._getObjID,
                                          selectionCache);
  },

  focusSearch: function formdata_focusSearch() {
    this.searchfield.focus();
  },

  updateContext: function formdata_updateContext() {
    document.getElementById("fdata-context-remove").disabled =
      this.removeButton.disabled;
    document.getElementById("fdata-context-selectall").disabled =
      (this.tree.view.selection.count >= this.tree.view.rowCount);
  },

  reactToChange: function formdata_reactToChange(aSubject, aState) {
    // aState: addEntry, modifyEntry, removeEntry, removeAllEntries,
    // removeEntriesForName, removeEntriesByTimeframe, expireOldEntries,
    // before-removeEntry, before-removeAllEntries, before-removeEntriesForName,
    // before-removeEntriesByTimeframe, before-expireOldEntries

    // Ignore changes when no form data pane is loaded
    // or if we caught a before-* notification.
    if (!this.displayedFormdata.length || /^before-/.test(aState))
      return;

    if (aState == "removeAllEntries" || aState == "removeEntriesForName" ||
        aState == "removeEntriesByTimeframe" || aState == "expireOldEntries") {
      // Go for re-parsing the whole thing
      this.tree.view.selection.clearSelection();
      this.tree.treeBoxObject.beginUpdateBatch();
      this.displayedFormdata = [];
      this.tree.treeBoxObject.endUpdateBatch();
      this.tree.treeBoxObject.invalidate();

      this.loadList();
      this.search("");
      return;
    }

    // Usual notifications for addEntry, modifyEntry, removeEntry - do "surgical" updates.
    let subjectData = []; // those notifications all have: name, value, guid
    if (aSubject instanceof Components.interfaces.nsIArray) {
      let enumerator = aSubject.enumerate();
      while (enumerator.hasMoreElements()) {
        let nextElem = enumerator.getNext();
        if (nextElem instanceof Components.interfaces.nsISupportsString ||
            nextElem instanceof Components.interfaces.nsISupportsPRInt64) {
          subjectData.push(nextElem.data);
        }
      }
    }
    else {
      Components.utils.reportError("Observed an unrecognized formdata change of type " + aState);
      return;
    }

    let entryData = null;
    if (aState == "addEntry" || aState == "modifyEntry") {
      try {
        let sql = "SELECT fieldname, value, timesUsed, firstUsed, lastUsed, guid FROM moz_formhistory WHERE guid=:guid";
        var statement = gLocSvc.fhist.DBConnection.createStatement(sql);
        statement.params.guid = subjectData[2];
        while (statement.executeStep()) {
          entryData = {fieldname: statement.row["fieldname"],
                       value: statement.row["value"],
                       timesUsed: statement.row["timesUsed"],
                       firstUsed: this._getTimeString(statement.row["firstUsed"]),
                       firstUsedSortValue: statement.row["firstUsed"],
                       lastUsed: this._getTimeString(statement.row["lastUsed"]),
                       lastUsedSortValue: statement.row["lastUsed"],
                       guid: statement.row["guid"]};
        }
      }
      finally {
        statement.reset();
      }

      if (!entryData) {
        Components.utils.reportError("Could not find added/modifed formdata entry");
        return;
      }
    }

    if (aState == "addEntry") {
      this.formdata.push(entryData);

      this.displayedFormdata.push(this.formdata.length - 1);
      this.tree.treeBoxObject.rowCountChanged(this.formdata.length - 1, 1);
      this.search("");
    }
    else {
      idx = -1; disp_idx = -1;
      for (let i = 0; i < this.displayedFormdata.length; i++) {
        let fdata = this.formdata[this.displayedFormdata[i]];
        if (fdata && fdata.guid == subjectData[2]) {
          idx = this.displayedFormdata[i]; disp_idx = i;
          break;
        }
      }
      if (idx >= 0) {
        if (aState == "modifyEntry") {
          this.formdata[idx] = entryData;
          this.tree.treeBoxObject.invalidateRow(disp_idx);
        }
        else if (aState == "removeEntry") {
          this.formdata[idx] = null;
          this.displayedFormdata.splice(disp_idx, 1);
          this.tree.treeBoxObject.rowCountChanged(disp_idx, -1);
        }
      }
    }
  },

  forget: function formdata_forget() {
    gLocSvc.fhist.removeAllEntries();
  },
};

var formdataTreeView = {
  get rowCount() {
    return gFormdata.displayedFormdata.length;
  },
  setTree: function(aTree) {},
  getImageSrc: function(aRow, aColumn) {},
  getProgressMode: function(aRow, aColumn) {},
  getCellValue: function(aRow, aColumn) {},
  getCellText: function(aRow, aColumn) {
    switch (aColumn.id) {
      case "fdataFieldCol":
        return gFormdata.formdata[gFormdata.displayedFormdata[aRow]].fieldname;
      case "fdataValueCol":
        return gFormdata.formdata[gFormdata.displayedFormdata[aRow]].value;
      case "fdataCountCol":
        return gFormdata.formdata[gFormdata.displayedFormdata[aRow]].timesUsed;
      case "fdataFirstCol":
        return gFormdata.formdata[gFormdata.displayedFormdata[aRow]].firstUsed;
      case "fdataLastCol":
        return gFormdata.formdata[gFormdata.displayedFormdata[aRow]].lastUsed;
    }
  },
  isSeparator: function(aIndex) { return false; },
  isSorted: function() { return false; },
  isContainer: function(aIndex) { return false; },
  cycleHeader: function(aCol) {},
  getRowProperties: function(aRow, aProp) {},
  getColumnProperties: function(aColumn, aProp) {},
  getCellProperties: function(aRow, aColumn, aProp) {}
};

var gForget = {
  forgetDesc: null,
  forgetCookies: null,
  forgetPermissions: null,
  forgetPreferences: null,
  forgetPasswords: null,
  forgetFormdata: null,
  forgetCookiesLabel: null,
  forgetPermissionsLabel: null,
  forgetPreferencesLabel: null,
  forgetPasswordsLabel: null,
  forgetFormdataLabel: null,
  forgetButton: null,

  initialize: function formdata_initialize() {
    this.forgetDesc = document.getElementById("forgetDesc");
    this.forgetCookies = document.getElementById("forgetCookies");
    this.forgetPermissions = document.getElementById("forgetPermissions");
    this.forgetPreferences = document.getElementById("forgetPreferences");
    this.forgetPasswords = document.getElementById("forgetPasswords");
    this.forgetFormdata = document.getElementById("forgetFormdata");
    this.forgetCookiesLabel = document.getElementById("forgetCookiesLabel");
    this.forgetPermissionsLabel = document.getElementById("forgetPermissionsLabel");
    this.forgetPreferencesLabel = document.getElementById("forgetPreferencesLabel");
    this.forgetPasswordsLabel = document.getElementById("forgetPasswordsLabel");
    this.forgetFormdataLabel = document.getElementById("forgetFormdataLabel");
    this.forgetButton = document.getElementById("forgetButton");

    if (gDomains.selectedDomain.title == "*")
      this.forgetDesc.value = gDatamanBundle.getString("forget.desc.global.pre");
    else
      this.forgetDesc.value = gDatamanBundle.getFormattedString("forget.desc.domain.pre",
                                                                [gDomains.selectedDomain.title]);

    this.forgetCookies.disabled = !selectedDomain.hasCookies;
    this.forgetPermissions.disabled = !selectedDomain.hasPermissions;
    this.forgetPreferences.disabled = !selectedDomain.hasPreferences;
    this.forgetPasswords.disabled = !selectedDomain.hasPasswords;
    this.forgetFormdata.disabled = !selectedDomain.hasFormData;
    this.forgetFormdata.hidden = !selectedDomain.hasFormData;
    this.forgetButton.disabled = !(selectedDomain.hasCookies ||
                                   selectedDomain.hasPermissions ||
                                   selectedDomain.hasPreferences ||
                                   selectedDomain.hasPasswords ||
                                   selectedDomain.hasFormData);
  },

  shutdown: function formdata_shutdown() {
    this.forgetDesc.value = "";
    this.forgetCookies.hidden = false;
    this.forgetPermissions.hidden = false;
    this.forgetPreferences.hidden = false;
    this.forgetPasswords.hidden = false;
    this.forgetFormdata.hidden = true;
    this.forgetCookiesLabel.hidden = true;
    this.forgetPermissionsLabel.hidden = true;
    this.forgetPreferencesLabel.hidden = true;
    this.forgetPasswordsLabel.hidden = true;
    this.forgetFormdataLabel.hidden = true;
    this.forgetButton.hidden = false;

    this.forgetCookies.checked = false;
    this.forgetPermissions.checked = false;
    this.forgetPreferences.checked = false;
    this.forgetPasswords.checked = false;
    this.forgetFormdata.checked = false;
    this.forgetCookies.disabled = true;
    this.forgetPermissions.disabled = true;
    this.forgetPreferences.disabled = true;
    this.forgetPasswords.disabled = true;
    this.forgetFormdata.disabled = true;
    this.forgetButton.disabled = true;
  },

  forget: function forget_forget() {
    if (this.forgetCookies.checked) {
      gCookies.forget();
      this.forgetCookiesLabel.hidden = false;
    }
    this.forgetCookies.hidden = true;
    if (this.forgetPermissions.checked) {
      gPerms.forget();
      this.forgetPermissionsLabel.hidden = false;
    }
    this.forgetPermissions.hidden = true;
    if (this.forgetPreferences.checked) {
      gPrefs.forget();
      this.forgetPreferencesLabel.hidden = false;
    }
    this.forgetPreferences.hidden = true;
    if (this.forgetPasswords.checked) {
      gPasswords.forget();
      this.forgetPasswordsLabel.hidden = false;
    }
    this.forgetPasswords.hidden = true;
    if (this.forgetFormdata.checked) {
      gFormdata.forget();
      this.forgetFormdataLabel.hidden = false;
    }
    this.forgetFormdata.hidden = true;

    if (gDomains.selectedDomain.title == "*")
      this.forgetDesc.value = gDatamanBundle.getString("forget.desc.global.post");
    else
      this.forgetDesc.value = gDatamanBundle.getFormattedString("forget.desc.domain.post",
                                                                [gDomains.selectedDomain.title]);
    this.forgetButton.hidden = true;
  },
};


gDatamanUtils = {
  getTreeSelections: function datamanUtils_getTreeSelections(aTree) {
    let selections = [];
    let select = aTree.view.selection;
    if (select) {
      let count = select.getRangeCount();
      let min = new Object();
      let max = new Object();
      for (let i = 0; i < count; i++) {
        select.getRangeAt(i, min, max);
        for (var k=min.value; k<=max.value; k++) {
          if (k != -1) {
            selections[selections.length] = k;
          }
        }
      }
    }
    return selections;
  },

  getSelectedIDs:
  function datamanUtils_getSelectedIDs(aTree, aIDFunction) {
    // get IDs of selected elements for later restoration
    var selectionCache = [];
    if (aTree.view.selection.count < 1)
      return selectionCache;

    // Walk all selected rows and cache their IDs
    var start = {};
    var end = {};
    var numRanges = aTree.view.selection.getRangeCount();
    for (let rg = 0; rg < numRanges; rg++){
      aTree.view.selection.getRangeAt(rg, start, end);
      for (let row = start.value; row <= end.value; row++){
        selectionCache.push(aIDFunction(row));
      }
    }
    return selectionCache;
  },

  restoreSelectionFromIDs:
  function datamanUtils_getSelectedIDs(aTree, aIDFunction, aCachedIDs) {
    // Restore selection from cached IDs (as possible)
    if (!aCachedIDs.length)
      return;

    aTree.view.selection.clearSelection();
    var dataLen = aTree.view.rowCount;
    for each (let rowID in aCachedIDs) {
      // Find out what row this is now and if possible, add it to the selection
      let row = -1;
      for (let idx = 0; idx < dataLen; idx++) {
        if (aIDFunction(idx) == rowID)
          row = idx;
      }
      if (row != -1)
        aTree.view.selection.rangedSelect(row, row, true);
    }
  },
}
