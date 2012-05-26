// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gtk = imports.gi.Gtk;
const Meta = imports.gi.Meta;
const Mainloop = imports.mainloop;
const Signals = imports.signals;
const Lang = imports.lang;
const St = imports.gi.St;
const Shell = imports.gi.Shell;
const Gdk = imports.gi.Gdk;

const Main = imports.ui.main;
const Search = imports.ui.search;
const ShellEntry = imports.ui.shellEntry;
const Tweener = imports.ui.tweener;

const SearchEntry = new Lang.Class({
    Name: 'SearchEntry',
        
    _init: function() {
        this.actor = new St.Entry({ name: 'searchEntry',
                                     hint_text: _("Type to search..."),
                                     track_hover: true,
                                     can_focus: true });

        this._inactiveIcon = new St.Icon({ style_class: 'search-entry-icon',
                                           icon_name: 'edit-find',
                                           icon_type: St.IconType.SYMBOLIC });
        this._activeIcon = new St.Icon({ style_class: 'search-entry-icon',
                                         icon_name: 'edit-clear',
                                         icon_type: St.IconType.SYMBOLIC });

        this.actor.set_secondary_icon(this._inactiveIcon);
    }
});
