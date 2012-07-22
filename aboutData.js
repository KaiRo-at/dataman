/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function AboutData() { }
AboutData.prototype = {
  classDescription: "about:data",
  contractID: "@mozilla.org/network/protocol/about;1?what=data",
  classID: Components.ID("{16b2ea73-0a14-4b7e-a5da-fdd883bc73a5}"),
  QueryInterface: XPCOMUtils.generateQI([Components.interfaces.nsIAboutModule]),

  getURIFlags: function(aURI) {
    return Components.interfaces.nsIAboutModule.ALLOW_SCRIPT;
  },

  newChannel: function(aURI) {
    let channel = Services.io.newChannel("chrome://dataman/content/dataman.xul",
                                         null, null);
    channel.originalURI = aURI;
    return channel;
  }
};

/**
 * XPCOMUtils.generateNSGetFactory was introduced in Mozilla 2.
 * XPCOMUtils.generateNSGetModule is for Mozilla 1.9.x.
 */
if (XPCOMUtils.generateNSGetFactory)
  var NSGetFactory = XPCOMUtils.generateNSGetFactory([AboutData]);
else
  var NSGetModule = XPCOMUtils.generateNSGetModule([AboutData]);
