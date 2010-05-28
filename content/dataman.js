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

var gDatamanBundle = null;

function initialize() {
  gDatamanBundle = document.getElementById("datamanBundle");
  gDomains.initialize();
  gTabs.initialize();
}

var gDomains = {
  tree: null,

  domains: {},
  domainObjects: [],
  displayedDomains: [],

  initialize: function() {
    this.tree = document.getElementById("domainTree");
    this.tree.treeBoxObject.view = domainTreeView;

    // global "domain"
    this.domainObjects.push({title: "*", hasFormData: true});

    // add domains for all cookies we find
    let enumerator = gLocSvc.cookie.enumerator;
    while (enumerator.hasMoreElements()) {
      let nextCookie = enumerator.getNext();
      if (!nextCookie) break;
      nextCookie = nextCookie.QueryInterface(Components.interfaces.nsICookie);
      this._addDomainOrFlag(nextCookie.host.replace(/^\./, ""), "hasCookies", false);
    }

    // add domains for permissions
    let enumerator = Services.perms.enumerator;
    while (enumerator.hasMoreElements()) {
      let nextPermission = enumerator.getNext();
      nextPermission = nextPermission.QueryInterface(Components.interfaces.nsIPermission);
      this._addDomainOrFlag(nextPermission.host.replace(/^\./, ""), "hasPermissions", false);
    }
    // add domains for password rejects to permissions
    let rejectHosts = gLocSvc.pwd.getAllDisabledHosts();
    for (let i = 0; i < rejectHosts.length; i++) {
      this._addDomainOrFlag(rejectHosts[i], "hasPermissions", true);
    }

    // add domains for content prefs
    try {
      var statement = gLocSvc.cpref.DBConnection.createStatement("SELECT groups.name AS host FROM groups");
      while (statement.executeStep()) {
        this._addDomainOrFlag(statement.row["host"], "hasPreferences", false);
      }
    }
    finally {
      statement.reset();
    }

    // add domains for passwords
    let signons = gLocSvc.pwd.getAllLogins();
    for (let i = 0; i < signons.length; i++) {
      this._addDomainOrFlag(signons[i].hostname, "hasPasswords", true);
    }

    this.search("");
  },

  getDomainFromHost: function(aHostname, aHostIsURI) {
    // find the base domain name for the given host name
    var domain;
    if (aHostIsURI) {
      try {
        let hostURI = Services.io.newURI(aHostname, null, null);
        try {
          domain = gLocSvc.eTLD.getBaseDomain(hostURI);
        }
        catch (e) {
          domain = hostURI.host;
        }
      }
      catch (e) {
        Components.utils.reportError(e + "\nOffending Non-URI Hostname is: " + aHostname);
        try {
          domain = gLocSvc.eTLD.getBaseDomainFromHost(aHostname);
        }
        catch (e) {
          domain = aHostname;
        }
      }
    }
    else {
      try {
        domain = gLocSvc.eTLD.getBaseDomainFromHost(aHostname);
      }
      catch (e) {
        domain = aHostname;
      }
    }
    return domain;
  },

  hostMatchesSelected: function(aHostname, aHostIsURI) {
    return this.getDomainFromHost(aHostname, aHostIsURI) == this.selectedDomainName;
  },

  _addDomainOrFlag: function(aHostname, aFlag, aHostIsURI) {
    // for existing domains, add flags, for others, add them to the object
    let domain = this.getDomainFromHost(aHostname, aHostIsURI);
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

  select: function() {
    if (this.tree.view.selection.count != 1) {
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

  search: function(aSearchString) {
    this.tree.treeBoxObject.beginUpdateBatch();
    this.displayedDomains = [];
    for (let i = 0; i < this.domainObjects.length; i++) {
      if (this.domainObjects[i].title.indexOf(aSearchString) != -1)
        this.displayedDomains.push(i);
    }
    this.displayedDomains.sort(this._sortCompare);
    this.tree.treeBoxObject.endUpdateBatch();
    this.tree.treeBoxObject.invalidate();
  },

  _sortCompare: function domain__sortCompare(aOne, aTwo) {
    return (gDomains.domainObjects[aOne].title
            .localeCompare(gDomains.domainObjects[aTwo].title));
  }
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

  initialize: function() {
    this.tabbox = document.getElementById("tabbox");
    this.cookiesTab = document.getElementById("cookiesTab");
    this.permissionsTab = document.getElementById("permissionsTab");
    this.preferencesTab = document.getElementById("preferencesTab");
    this.passwordsTab = document.getElementById("passwordsTab");
    this.formdataTab = document.getElementById("formdataTab");
    this.forgetTab = document.getElementById("forgetTab");
  },

  select: function() {
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
    Services.console.logStringMessage("Selected: " + this.tabbox.selectedPanel.id);
  },
};


var gCookies = {
  tree: null,

  cookies: [],

  initialize: function() {
    this.tree = document.getElementById("cookiesTree");
    this.tree.treeBoxObject.view = cookieTreeView;

    this.tree.treeBoxObject.beginUpdateBatch();
    let enumerator = gLocSvc.cookie.enumerator;
    while (enumerator.hasMoreElements()) {
      let nextCookie = enumerator.getNext();
      if (!nextCookie) break;
      nextCookie = nextCookie.QueryInterface(Components.interfaces.nsICookie);
      let host = nextCookie.host;
      if (gDomains.hostMatchesSelected(host.replace(/^\./, ""), false))
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
    this.tree.treeBoxObject.endUpdateBatch();
    this.tree.treeBoxObject.invalidate();
  },

  shutdown: function() {
    this.tree.treeBoxObject.view = null;
    this.cookies = [];
  },

  _getExpiresString: function cookies_getExpiresString(aExpires) {
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

  select: function() {
    Services.console.logStringMessage("Selected: " + this.tree.currentIndex);
  },

  handleKeyPress: function(aEvent) {
    if (aEvent.keyCode == KeyEvent.DOM_VK_DELETE) {
      this.delete();
    }
  },

  sort: function(aColumn, aUpdateSelection) {
    Services.console.logStringMessage("Sort: " + aColumn);
  },

  delete: function() {
    Services.console.logStringMessage("Cookie delete requested");
  },
};

var cookieTreeView = {
  get rowCount() {
    return gCookies.cookies.length;
  },
  setTree: function(aTree) {},
  getImageSrc: function(aRow, aColumn) {},
  getProgressMode: function(aRow, aColumn) {},
  getCellValue: function(aRow, aColumn) {},
  getCellText: function(aRow, aColumn) {
    switch (aColumn.id) {
      case "cookieHostCol":
        return gCookies.cookies[aRow].rawHost;
      case "cookieNameCol":
        return gCookies.cookies[aRow].name;
      case "cookieExpiresCol":
        return gCookies.cookies[aRow].expires;
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
      if (gDomains.hostMatchesSelected(host.replace(/^\./, ""), false)) {
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
      if (gDomains.hostMatchesSelected(rejectHosts[i], true)) {
        let permElem = document.createElement("richlistitem");
        permElem.setAttribute("type", "password");
        permElem.setAttribute("host", rejectHosts[i]);
        permElem.setAttribute("rawHost", gDomains.getDomainFromHost(rejectHosts[i], true));
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
};


var gPasswords = {
  tree: null,
  toggleButton: null,
  pwdCol: null,

  showPasswords: false,
  signons: [],

  initialize: function() {
    this.tree = document.getElementById("passwordsTree");
    this.tree.treeBoxObject.view = passwordTreeView;

    this.toggleButton = document.getElementById("pwdToggle");
    this.toggleButton.label = gDatamanBundle.getString("pwd.showPasswords");
    this.toggleButton.accessKey = gDatamanBundle.getString("pwd.showPasswords.accesskey");

    this.pwdCol = document.getElementById("pwdPasswordCol");

    this.tree.treeBoxObject.beginUpdateBatch();
    let allSignons = gLocSvc.pwd.getAllLogins();
    for (let i = 0; i < allSignons.length; i++) {
      if (gDomains.hostMatchesSelected(allSignons[i].hostname, true))
      this.signons.push(allSignons[i]);
    }
    this.tree.treeBoxObject.endUpdateBatch();
    this.tree.treeBoxObject.invalidate();
  },

  shutdown: function() {
    this.tree.treeBoxObject.view = null;
    this.signons = [];
  },

  select: function() {
    Services.console.logStringMessage("Selected: " + this.tree.currentIndex);
  },

  handleKeyPress: function(aEvent) {
    if (aEvent.keyCode == KeyEvent.DOM_VK_DELETE) {
      this.delete();
    }
  },

  sort: function(aColumn, aUpdateSelection) {
    Services.console.logStringMessage("Sort: " + aColumn);
  },

  delete: function() {
    Services.console.logStringMessage("Password delete requested");
  },

  togglePasswordVisible: function() {
    if (this.showPasswords || this._confirmShowPasswords()) {
      this.showPasswords = !this.showPasswords;
      this.toggleButton.label = gDatamanBundle.getString(this.showPasswords ? "pwd.hidePasswords" : "pwd.showPasswords");
      this.toggleButton.accessKey = gDatamanBundle.getString(this.showPasswords ? "pwd.hidePasswords.accesskey" : "pwd.showPasswords.accesskey");
      this.pwdCol.hidden = !this.showPasswords;
    }
  },

  _confirmShowPasswords: function() {
    // This doesn't harm if passwords are not encrypted
    let tokendb = Components.classes["@mozilla.org/security/pk11tokendb;1"]
                            .createInstance(Components.interfaces.nsIPK11TokenDB);
    let token = tokendb.getInternalKeyToken();

    // If there is no master password, still give the user a chance to opt-out of displaying passwords
    if (token.checkPassword(""))
      return this._askUserShowPasswords();

    // So there's a master password. But since checkPassword didn't succeed, we're logged out (per nsIPK11Token.idl).
    try {
      // Relogin and ask for the master password.
      token.login(true);  // 'true' means always prompt for token password. User will be prompted until
                          // clicking 'Cancel' or entering the correct password.
    } catch (e) {
      // An exception will be thrown if the user cancels the login prompt dialog.
      // User is also logged out of Software Security Device.
    }

    return token.isLoggedIn();
  },

  _askUserShowPasswords: function() {
    let dummy = { value: false };

    // Confirm the user wants to display passwords
    return Services.prompt.confirmEx(window,
                                     null,
                                     gDatamanBundle.getString("pwd.noMasterPasswordPrompt"),
                                     Services.prompt.STD_YES_NO_BUTTONS,
                                     null, null, null, null, dummy) == 0; // 0=="Yes" button
  },

  updateContext: function() {
    Services.console.logStringMessage("Should update context menu");
  },

  copyPassword: function() {
    Services.console.logStringMessage("Should copy password");
  },
};

var passwordTreeView = {
  get rowCount() {
    return gPasswords.signons.length;
  },
  setTree: function(aTree) {},
  getImageSrc: function(aRow, aColumn) {},
  getProgressMode: function(aRow, aColumn) {},
  getCellValue: function(aRow, aColumn) {},
  getCellText: function(aRow, aColumn) {
    let signon = gPasswords.signons[aRow];
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

  prefs: [],

  initialize: function() {
    this.tree = document.getElementById("prefsTree");
    this.tree.treeBoxObject.view = prefsTreeView;

    this.tree.treeBoxObject.beginUpdateBatch();
    try {
      // get all groups (hosts) that match the domain
      let sql = "SELECT groups.name AS host FROM groups WHERE host=:hostName OR host LIKE :hostMatch ESCAPE '/'";
      var statement = gLocSvc.cpref.DBConnection.createStatement(sql);
      statement.params.hostName = gDomains.selectedDomainName;
      statement.params.hostMatch = "%." + statement.escapeStringForLIKE(gDomains.selectedDomainName, "/");
      while (statement.executeStep()) {
        // now, get all prefs for that host
        let enumerator =  gLocSvc.cpref.getPrefs(statement.row["host"]).enumerator;
        while (enumerator.hasMoreElements()) {
          let pref = enumerator.getNext().QueryInterface(Components.interfaces.nsIProperty);
          this.prefs.push({host: statement.row["host"], name: pref.name, value: pref.value});
        }
      }
    }
    finally {
      statement.reset();
    }
    this.tree.treeBoxObject.endUpdateBatch();
    this.tree.treeBoxObject.invalidate();
  },

  shutdown: function() {
    this.tree.treeBoxObject.view = null;
    this.prefs = [];
  },

  select: function() {
    Services.console.logStringMessage("Selected: " + this.tree.currentIndex);
  },

  handleKeyPress: function(aEvent) {
    if (aEvent.keyCode == KeyEvent.DOM_VK_DELETE) {
      this.delete();
    }
  },

  sort: function(aColumn, aUpdateSelection) {
    Services.console.logStringMessage("Sort: " + aColumn);
  },

  delete: function() {
    Services.console.logStringMessage("Pref delete requested");
  },
};

var prefsTreeView = {
  get rowCount() {
    return gPrefs.prefs.length;
  },
  setTree: function(aTree) {},
  getImageSrc: function(aRow, aColumn) {},
  getProgressMode: function(aRow, aColumn) {},
  getCellValue: function(aRow, aColumn) {},
  getCellText: function(aRow, aColumn) {
    switch (aColumn.id) {
      case "prefsHostCol":
        return gPrefs.prefs[aRow].host;
      case "prefsNameCol":
        return gPrefs.prefs[aRow].name;
      case "prefsValueCol":
        return gPrefs.prefs[aRow].value;
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

  formdata: [],

  initialize: function() {
    this.tree = document.getElementById("formdataTree");
    this.tree.treeBoxObject.view = formdataTreeView;

    this.tree.treeBoxObject.beginUpdateBatch();
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
    this.tree.treeBoxObject.endUpdateBatch();
    this.tree.treeBoxObject.invalidate();
  },

  shutdown: function() {
    this.tree.treeBoxObject.view = null;
    this.formdata = [];
  },

  _getTimeString: function formdata_getTimeString(aTimestamp) {
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

  select: function() {
    Services.console.logStringMessage("Selected: " + this.tree.currentIndex);
  },

  handleKeyPress: function(aEvent) {
    if (aEvent.keyCode == KeyEvent.DOM_VK_DELETE) {
      this.delete();
    }
  },

  sort: function(aColumn, aUpdateSelection) {
    Services.console.logStringMessage("Sort: " + aColumn);
  },

  delete: function() {
    Services.console.logStringMessage("Form data entry delete requested");
  },
};

var formdataTreeView = {
  get rowCount() {
    return gFormdata.formdata.length;
  },
  setTree: function(aTree) {},
  getImageSrc: function(aRow, aColumn) {},
  getProgressMode: function(aRow, aColumn) {},
  getCellValue: function(aRow, aColumn) {},
  getCellText: function(aRow, aColumn) {
    switch (aColumn.id) {
      case "fdataFieldCol":
        return gFormdata.formdata[aRow].fieldname;
      case "fdataValueCol":
        return gFormdata.formdata[aRow].value;
      case "fdataCountCol":
        return gFormdata.formdata[aRow].timesUsed;
      case "fdataFirstCol":
        return gFormdata.formdata[aRow].firstUsed;
      case "fdataLastCol":
        return gFormdata.formdata[aRow].lastUsed;
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
