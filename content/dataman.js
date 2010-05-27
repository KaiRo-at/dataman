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

Components.utils.import("resource://gre/modules/Services.jsm");

window.addEventListener("load",  initialize, false);

var gCookieService = Components.classes["@mozilla.org/cookiemanager;1"]
                               .getService(Components.interfaces.nsICookieManager);

function initialize() {
  gDomains.initialize();
  gTabs.initialize();
}

var gDomains = {
  tree: null,

  domains: [],
  domainObjects: [],
  displayedDomains: [],

  initialize: function() {
    this.tree = document.getElementById("domainTree");
    this.tree.treeBoxObject.view = domainTreeView;

    // global "domain"
    this.domainObjects.push({title: "*", hasCookies: false, hasFormData: true});

    // add domains for all cookies we find
    var enumerator = gCookieService.enumerator;
    while (enumerator.hasMoreElements()) {
      let nextCookie = enumerator.getNext();
      if (!nextCookie) break;
      nextCookie = nextCookie.QueryInterface(Components.interfaces.nsICookie);
      let host = nextCookie.host;
      if (host.charAt(0) == ".") { host = host.substring(1, host.length); }
      // add only new domains to the array
      if (!this.domainObjects.some(function(element, index, array) { return element.title == host; })) {
        this.domainObjects.push({title: host, hasCookies: true, hasFormData: false});
      }
    }

    this.search("");
  },

  select: function() {
    if (this.tree.view.selection.count != 1) {
      Components.utils.reportError("Data Manager doesn't support anything but one selected domain");
      this.tree.view.selection.clearSelection();
      return;
    }
    let selectedDomain = this.domainObjects[this.tree.currentIndex];
    Services.console.logStringMessage("Selected: " + selectedDomain.title);
    // disable/enable and hide/show the tabs as needed
    gTabs.cookiesTab.disabled = !selectedDomain.hasCookies;
    gTabs.permissionsTab.disabled = !selectedDomain.hasPermissions;
    gTabs.preferencesTab.disabled = !selectedDomain.hasPreferences;
    gTabs.passwordsTab.disabled = !selectedDomain.hasPasswords;
    gTabs.formdataTab.hidden = !selectedDomain.hasFormData;
    while (gTabs.tabbox.selectedTab.disabled || gTabs.tabbox.selectedTab.hidden) {
      gTabs.tabbox.tabs.advanceSelectedTab(1, true);
    }
  },

  search: function(aSearchString) {
    Services.console.logStringMessage("Search for: " + aSearchString);
    this.tree.treeBoxObject.beginUpdateBatch();
    this.displayedDomains = [];
    for (let i = 0; i < this.domainObjects.length; i++) {
      if (this.domainObjects[i].title.indexOf(aSearchString) != -1)
        this.displayedDomains.push(i);
    }
    this.tree.treeBoxObject.endUpdateBatch();
    this.tree.treeBoxObject.invalidate();
  },
};

var domainTreeView = {
  get rowCount() {
    return gDomains.displayedDomains.length;
  },
  setTree: function(tree) {},
  getImageSrc: function(row, column) {},
  getProgressMode: function(row, column) {},
  getCellValue: function(row, column) {},
  getCellText: function(row, column) {
    switch (column.id) {
    case "domainCol":
      return gDomains.domainObjects[gDomains.displayedDomains[row]].title;
      break;
    }
  },
  isSeparator: function(index) { return false; },
  isSorted: function() { return false; },
  isContainer: function(index) { return false; },
  cycleHeader: function(aCol) {},
  getRowProperties: function(row, prop) {},
  getColumnProperties: function(column, prop) {},
  getCellProperties: function(row, column, prop) {}
};


var gTabs = {
  tabbox: null,
  cookiesTab: null,
  permissionsTab: null,
  preferencesTab: null,
  passwordsTab: null,
  formdataTab: null,

  initialize: function() {
    this.tabbox = document.getElementById("tabbox");
    this.cookiesTab = document.getElementById("cookiesTab");
    this.permissionsTab = document.getElementById("permissionsTab");
    this.preferencesTab = document.getElementById("preferencesTab");
    this.passwordsTab = document.getElementById("passwordsTab");
    this.formdataTab = document.getElementById("formdataTab");
  },
};
