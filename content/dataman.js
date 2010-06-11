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

window.addEventListener("load",  initialize, false);
window.addEventListener("unload",  shutdown, false);

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
                                   "nsIContentPrefService");
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

function initialize() {
  gDatamanBundle = document.getElementById("datamanBundle");
  gTabs.initialize();
  gDomains.initialize();
}

function shutdown() {
  gDomains.shutdown();
}

var gUpdatingBatch = "";
var gChangeObserver = {
  observe: function changeobserver_observe(aSubject, aTopic, aState) {
    if (aTopic == gUpdatingBatch)
      return;
    switch (aTopic) {
      case "cookie-changed":
        // aState: added, changed, deleted
        Services.console.logStringMessage("cookie change observed: " + aSubject + ", " + aState);
        break;
      case "perm-changed":
        // aState: added, changed, deleted
        Services.console.logStringMessage("permission change observed: " + aSubject + ", " + aState);
        break;
      case "passwordmgr-storage-changed":
        if (/^hostSaving/.test(aState)) {
          // aState: hostSavingEnabled, hostSavingDisabled
          Services.console.logStringMessage("signon permission change observed: " + aSubject + ", " + aState);
        }
        else {
          // aState: addLogin, modifyLogin, removeLogin, removeAllLogins
          Services.console.logStringMessage("signon change observed: " + aSubject + ", " + aState);
        }
        break;
      case "satchel-storage-changed":
        // aState: addEntry, removeEntry
        Services.console.logStringMessage("form data change observed: " + aSubject + ", " + aState);
        break;
      default:
        // aState: addEntry, modifyEntry, removeEntry
        Services.console.logStringMessage("form data change observed: " + aSubject + ", " + aState);
        break;
    }
  },

  onContentPrefSet: function changeobserver_onContentPrefSet(aGroup, aName, aValue) {
    Services.console.logStringMessage("content pref setting observed: " + aGroup + ", " + aName + ", " + aValue);
  },

  onContentPrefRemoved: function changeobserver_onContentPrefRemoved(aGroup, aName) {
    Services.console.logStringMessage("content pref removal observed: " + aGroup + ", " + aName);
  },
}

var gDomains = {
  tree: null,
  searchfield: null,

  domains: {},
  domainObjects: [],
  displayedDomains: [],

  ignoreSelect: false,

  initialize: function domain_initialize() {
    this.tree = document.getElementById("domainTree");
    this.tree.view = domainTreeView;

    this.searchfield = document.getElementById("domainSearch");

    Services.obs.addObserver(gChangeObserver, "cookie-changed", false);
    Services.obs.addObserver(gChangeObserver, "perm-changed", false);
    Services.obs.addObserver(gChangeObserver, "passwordmgr-storage-changed", false);
    gLocSvc.cpref.addObserver(null, gChangeObserver);
    Services.obs.addObserver(gChangeObserver, "satchel-storage-changed", false);

    // global "domain"
    this.domainObjects.push({title: "*",
                             hasPreferences: gLocSvc.cpref.getPrefs(null).enumerator.hasMoreElements(),
                             hasFormData: true});

    // add domains for all cookies we find
    gCookies.loadList();
    for (let i = 0; i < gCookies.cookies.length; i++) {
      this._addDomainOrFlag(gCookies.cookies[i].host.replace(/^\./, ""), "hasCookies");
    }

    // add domains for permissions
    let enumerator = Services.perms.enumerator;
    while (enumerator.hasMoreElements()) {
      let nextPermission = enumerator.getNext();
      nextPermission = nextPermission.QueryInterface(Components.interfaces.nsIPermission);
      this._addDomainOrFlag(nextPermission.host.replace(/^\./, ""), "hasPermissions");
    }
    // add domains for password rejects to permissions
    let rejectHosts = gLocSvc.pwd.getAllDisabledHosts();
    for (let i = 0; i < rejectHosts.length; i++) {
      this._addDomainOrFlag(rejectHosts[i], "hasPermissions");
    }

    // add domains for content prefs
    try {
      var statement = gLocSvc.cpref.DBConnection.createStatement("SELECT groups.name AS host FROM groups");
      while (statement.executeStep()) {
        this._addDomainOrFlag(statement.row["host"], "hasPreferences");
      }
    }
    finally {
      statement.reset();
    }

    // add domains for passwords
    gPasswords.allSignons = gLocSvc.pwd.getAllLogins();
    for (let i = 0; i < gPasswords.allSignons.length; i++) {
      this._addDomainOrFlag(gPasswords.allSignons[i].hostname, "hasPasswords");
    }

    this.search("");
    this.tree.view.selection.select(0);
    gTabs.formdataTab.focus();
  },

  shutdown: function domain_shutdown() {
    Services.obs.removeObserver(gChangeObserver, "cookie-changed");
    Services.obs.removeObserver(gChangeObserver, "perm-changed");
    Services.obs.removeObserver(gChangeObserver, "passwordmgr-storage-changed");
    gLocSvc.cpref.removeObserver(null, gChangeObserver);
    Services.obs.removeObserver(gChangeObserver, "satchel-storage-changed");
  },

  getDomainFromHost: function domain_getDomainFromHost(aHostname) {
    // find the base domain name for the given host name

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
    return domain;
  },

  hostMatchesSelected: function domain_hostMatchesSelected(aHostname) {
    return this.getDomainFromHost(aHostname) == this.selectedDomainName;
  },

  _addDomainOrFlag: function domain__addDomainOrFlag(aHostname, aFlag) {
    // for existing domains, add flags, for others, add them to the object
    let domain = this.getDomainFromHost(aHostname);
    if (!this.domainObjects.some(
          function(aElement, aIndex, aArray) {
            if (aElement.title == domain)
              aArray[aIndex][aFlag] = true;
            return aElement.title == domain;
          })) {
      let domObj = {title: domain};
      domObj[aFlag] = true;
      this.domainObjects.push(domObj);
    }
  },

  select: function domain_select() {
    if (this.ignoreSelect)
      return;

    if (!this.tree.view.selection.count) {
      gTabs.cookiesTab.disabled = true;
      gTabs.permissionsTab.disabled = true;
      gTabs.preferencesTab.disabled = true;
      gTabs.passwordsTab.disabled = true;
      gTabs.formdataTab.hidden = true;
      gTabs.formdataTab.disabled = true;
      gTabs.select();
      return;
    }

    if (this.tree.view.selection.count > 1) {
      Components.utils.reportError("Data Manager doesn't support anything but one selected domain");
      this.tree.view.selection.clearSelection();
      return;
    }
    let selectedDomain = this.domainObjects[gDomains.displayedDomains[this.tree.currentIndex]];
    // disable/enable and hide/show the tabs as needed
    gTabs.cookiesTab.disabled = !selectedDomain.hasCookies;
    gTabs.permissionsTab.disabled = !selectedDomain.hasPermissions;
    gTabs.preferencesTab.disabled = !selectedDomain.hasPreferences;
    gTabs.passwordsTab.disabled = !selectedDomain.hasPasswords;
    gTabs.formdataTab.hidden = !selectedDomain.hasFormData;
    gTabs.formdataTab.disabled = !selectedDomain.hasFormData;
    while (gTabs.tabbox.selectedTab.disabled || gTabs.tabbox.selectedTab.hidden) {
      gTabs.tabbox.tabs.advanceSelectedTab(1, true);
    }
    gTabs.select();
  },

  get selectedDomainName() {
    return this.domainObjects[gDomains.displayedDomains[this.tree.currentIndex]].title;
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
    Services.console.logStringMessage("Forget data on: " + this.selectedDomainName);
  },

  search: function domain_search(aSearchString) {
    this.ignoreSelect = true;
    var selectionCache = gDatamanUtils.getSelectedIDs(this.tree, this.domainObjects,
                                                      this.displayedDomains,
                                                      "title");
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
    gDatamanUtils.restoreSelectionFromIDs(this.tree, this.domainObjects,
                                          this.displayedDomains, "title",
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
  cookieInfoIsSecure: null,
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
    this.cookieInfoIsSecure = document.getElementById("cookieInfoIsSecure");
    this.cookieInfoExpires = document.getElementById("cookieInfoExpires");

    this.removeButton = document.getElementById("cookieRemove");
    this.blockOnRemove = document.getElementById("cookieBlockOnRemove");

    this.tree.treeBoxObject.beginUpdateBatch();
    if (!this.cookies.length)
      this.loadList();
    for (let i = 0; i < this.cookies.length; i++) {
      if (this.cookies[i] &&
          gDomains.hostMatchesSelected(this.cookies[i].host.replace(/^\./, "")))
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
      nextCookie = nextCookie.QueryInterface(Components.interfaces.nsICookie);
      let host = nextCookie.host;
      this.cookies.push({name: nextCookie.name,
                          value: nextCookie.value,
                          isDomain: nextCookie.isDomain,
                          host: host,
                          rawHost: (host.charAt(0) == ".") ? host.substring(1, host.length) : host,
                          path: nextCookie.path,
                          isSecure: nextCookie.isSecure,
                          expires: this._getExpiresString(nextCookie.expires),
                          expiresSortValue: nextCookie.expires}
                        );
    }
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
    var idx = selections[0];

    this.cookieInfoName.value = this.cookies[idx].name;
    this.cookieInfoValue.value = this.cookies[idx].value;
    this.cookieInfoHostLabel.value = this.cookies[idx].isDomain ?
                                     this.cookieInfoHostLabel.getAttribute("value_domain") :
                                     this.cookieInfoHostLabel.getAttribute("value_host");
    this.cookieInfoHost.value = this.cookies[idx].host;
    this.cookieInfoPath.value = this.cookies[idx].path;
    this.cookieInfoIsSecure.value = gDatamanBundle.getString(this.cookies[idx].isSecure ?
                                                             "cookies.secureOnly" :
                                                             "cookies.anyConnection");
    this.cookieInfoExpires.value = this.cookies[idx].expires;
    return true;
  },

  selectAll: function cookies_selectAll() {
    this.tree.view.selection.selectAll();
  },

  _clearCookieInfo: function cookies__clearCookieInfo() {
    var fields = ["cookieInfoName", "cookieInfoValue", "cookieInfoHost",
                  "cookieInfoPath", "cookieInfoIsSecure", "cookieInfoExpires"];
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
      // Cache the current selection
      //this._cacheSelection();
    }
    this.tree.view.selection.clearSelection();

    // Do the actual sorting of the array
    this.displayedCookies.sort(compfunc);
    this.tree.treeBoxObject.invalidate();

    if (aUpdateSelection) {
      // Restore the previous selection
      //this._restoreSelection();
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
  },

  updateContext: function cookies_updateContext() {
    document.getElementById("cookies-context-remove").disabled =
      this.removeButton.disabled;
    document.getElementById("cookies-context-selectall").disabled =
      (this.tree.view.selection.count >= this.tree.view.rowCount);
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
        permElem.setAttribute("host", nextPermission.host);
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
      this.allSignons = gLocSvc.pwd.getAllLogins();
    for (let i = 0; i < this.allSignons.length; i++) {
      if (this.allSignons[i] &&
          gDomains.hostMatchesSelected(this.allSignons[i].hostname))
        this.displayedSignons.push(i);
    }
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
    Services.console.logStringMessage("Sort: " + aColumn);
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
    try {
      // get all groups (hosts) that match the domain
      let domain = gDomains.selectedDomainName;
      if (domain == "*") {
        let enumerator =  gLocSvc.cpref.getPrefs(null).enumerator;
        while (enumerator.hasMoreElements()) {
          let pref = enumerator.getNext().QueryInterface(Components.interfaces.nsIProperty);
          this.prefs.push({host: null, name: pref.name, value: pref.value});
          this.displayedPrefs.push(this.prefs.length - 1);
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
            this.prefs.push({host: statement.row["host"], name: pref.name, value: pref.value});
            this.displayedPrefs.push(this.prefs.length - 1);
          }
        }
      }
    }
    finally {
      statement.reset();
    }
    this.tree.treeBoxObject.endUpdateBatch();
    this.tree.treeBoxObject.invalidate();
  },

  shutdown: function prefs_shutdown() {
    this.tree.view.selection.clearSelection();
    this.tree.view = null;
    this.prefs = [];
    this.displayedPrefs = [];
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
    Services.console.logStringMessage("Sort: " + aColumn);
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

    if (!this.formdata.length) {
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
    }
    this.search("");
  },

  shutdown: function formdata_shutdown() {
    this.tree.view.selection.clearSelection();
    this.tree.view = null;
    this.displayedFormdata = [];
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
      var selectionCache = gDatamanUtils.getSelectedIDs(this.tree, this.formdata,
                                                        this.displayedFormdata,
                                                        "guid");
    }
    this.tree.view.selection.clearSelection();

    // Do the actual sorting of the array
    this.displayedFormdata.sort(compfunc);
    this.tree.treeBoxObject.invalidate();

    if (aUpdateSelection) {
      gDatamanUtils.restoreSelectionFromIDs(this.tree, this.formdata,
                                            this.displayedFormdata, "guid",
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
    var selectionCache = gDatamanUtils.getSelectedIDs(this.tree, this.formdata,
                                                      this.displayedFormdata,
                                                      "guid");
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
    gDatamanUtils.restoreSelectionFromIDs(this.tree, this.formdata,
                                          this.displayedFormdata, "guid",
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
  function datamanUtils_getSelectedIDs(aTree, aData, aDisplayData, aID) {
    // get IDs of selected elements for later restoration
    var selectionCache = [];
    if (aTree.view.selection.count < 1)
      return selectionCache;

    // Walk all selected rows and cache theior download IDs
    var start = {};
    var end = {};
    var numRanges = aTree.view.selection.getRangeCount();
    for (let rg = 0; rg < numRanges; rg++){
      aTree.view.selection.getRangeAt(rg, start, end);
      for (let row = start.value; row <= end.value; row++){
        selectionCache.push(aData[aDisplayData[row]][aID]);
      }
    }
    return selectionCache;
  },

  restoreSelectionFromIDs:
  function datamanUtils_getSelectedIDs(aTree, aData, aDisplayData, aID, aCachedIDs) {
    // Restore selection from cached IDs (as possible)
    if (!aCachedIDs.length)
      return;

    aTree.view.selection.clearSelection();
    var dataLen = aDisplayData.length;
    for each (let rowID in aCachedIDs) {
      // Find out what row this is now and if possible, add it to the selection
      let row = -1;
      for (let idx = 0; idx < dataLen; idx++) {
        if (aData[aDisplayData[idx]][aID] == rowID)
          row = idx;
      }
      if (row != -1)
        aTree.view.selection.rangedSelect(row, row, true);
    }
  },
}
