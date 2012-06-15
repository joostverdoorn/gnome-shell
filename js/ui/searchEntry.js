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

        this._text = this.actor.clutter_text;

        this.active = false;

        this._text.connect('key-press-event', Lang.bind(this, this._onKeyPress));
        this.actor.connect('notify::mapped', Lang.bind(this, this._onMapped));

        Main.overview.connect('showing', Lang.bind(this,
            function () {
                this.show();
                this._stageKeyPressId = global.stage.connect('key-press-event',
                                                             Lang.bind(this, this._onStageKeyPress));
            }));

        Main.overview.connect('hiding', Lang.bind(this,
            function () {
                this.hide();
                if (this._stageKeyPressId != 0) {
                    global.stage.disconnect(this._stageKeyPressId);
                    this._stageKeyPressId = 0;
                }
            }));

        this._text.connect('text-changed', Lang.bind(this, this._onTextChanged));
        this._text.connect('key-press-event', Lang.bind(this, function (o, e) {
            // We can't connect to 'activate' here because search providers
            // might want to do something with the modifiers in activateDefault.
            let symbol = e.get_key_symbol();
            if (symbol == Clutter.Return || symbol == Clutter.KP_Enter) {
                if (this._searchTimeoutId > 0) {
                    Mainloop.source_remove(this._searchTimeoutId);
                    this._doSearch();
                }
                Main.overview.viewSelector._searchResults.activateDefault();
                return true;
            }
            return false;
        }));
    },

    show: function() {


    },

    hide: function() {
        if(this.active)
            this.reset();
    },

    reset: function() {
        global.stage.set_key_focus(null);

        this.actor.text = '';

        this._text.set_cursor_visible(true);
        this._text.set_selection(0, 0);
        Main.overview.viewSelector.resetSearch();
    },

    _startSearch: function(event) {
        global.stage.set_key_focus(this._text);
        this._text.event(event, false);
    },

    _isActivated: function() {
        return this._text.text == this.actor.get_text();
    },

    _onMapped: function() {
        if (this.actor.mapped) {
            // Enable 'find-as-you-type'
            this._capturedEventId = global.stage.connect('captured-event',
                                 Lang.bind(this, this._onCapturedEvent));
            this._text.set_cursor_visible(true);
            this._text.set_selection(0, 0);
        } else {
           // Disable 'find-as-you-type'
            if (this._capturedEventId > 0)
                global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = 0;
        }
    },

    _onTextChanged: function (se, prop) {
        let searchPreviouslyActive = this.active;
        this.active = this.actor.get_text() != '';
        this._searchPending = this.active && !searchPreviouslyActive;
        if (this._searchPending) {
            Main.overview.viewSelector._searchResults.startingSearch();
        }
        if (this.active) {
            this.actor.set_secondary_icon(this._activeIcon);

            if (this._iconClickedId == 0) {
                this._iconClickedId = this.actor.connect('secondary-icon-clicked',
                    Lang.bind(this, function() {
                        this.reset();
                    }));
            }

        } else {
            if (this._iconClickedId > 0)
                this.actor.disconnect(this._iconClickedId);
            this._iconClickedId = 0;

            this.actor.set_secondary_icon(this._inactiveIcon);
            if(searchPreviouslyActive) {
                this.reset();
            }
        }
        if (!this.active) {
            if (this._searchTimeoutId > 0) {
                Mainloop.source_remove(this._searchTimeoutId);
                this._searchTimeoutId = 0;
            }
            return;
        }
        if (this._searchTimeoutId > 0)
            return;
        this._searchTimeoutId = Mainloop.timeout_add(150, Lang.bind(this, this._doSearch));
    },

    _onKeyPress: function(entry, event) {
        let symbol = event.get_key_symbol();
        if (symbol == Clutter.Escape) {
            if (this._isActivated()) {
                this.reset();
                return true;
            }
        } else if (this.active) {
            let arrowNext, nextDirection;
            if (entry.get_text_direction() == Clutter.TextDirection.RTL) {
                arrowNext = Clutter.Left;
                nextDirection = Gtk.DirectionType.LEFT;
            } else {
                arrowNext = Clutter.Right;
                nextDirection = Gtk.DirectionType.RIGHT;
            }

            if (symbol == Clutter.Tab) {
                this._searchResults.navigateFocus(Gtk.DirectionType.TAB_FORWARD);
                return true;
            } else if (symbol == Clutter.ISO_Left_Tab) {
                this._focusTrap.can_focus = false;
                this._searchResults.navigateFocus(Gtk.DirectionType.TAB_BACKWARD);
                this._focusTrap.can_focus = true;
                return true;
            } else if (symbol == Clutter.Down) {
                this._searchResults.navigateFocus(Gtk.DirectionType.DOWN);
                return true;
            } else if (symbol == arrowNext && this._text.position == -1) {
                this._searchResults.navigateFocus(nextDirection);
                return true;
            }
        }
        return false;
    },

    _onStageKeyPress: function(actor, event) {
        let modifiers = event.get_state();
        let symbol = event.get_key_symbol();

        if (symbol == Clutter.Escape) {
            if (this.active)
                this.reset();
            else
                Main.overview.hide();
            return true;
        } else if (Clutter.keysym_to_unicode(symbol) ||
                   (symbol == Clutter.BackSpace && this.active)) {
            this._startSearch(event);
        } else if (!this.active) {
            if (modifiers & Clutter.ModifierType.CONTROL_MASK) {
                if (symbol == Clutter.Page_Up) {
                    this._prevTab();
                    return true;
                } else if (symbol == Clutter.Page_Down) {
                    this._nextTab();
                    return true;
                }
            } else if (symbol == Clutter.Tab) {
                this._activeTab.page.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
                return true;
            } else if (symbol == Clutter.ISO_Left_Tab) {
                this._activeTab.page.navigate_focus(null, Gtk.DirectionType.TAB_BACKWARD, false);
                return true;
            }
        }
        return false;
    },

    _onCapturedEvent: function(actor, event) {
        if (event.type() == Clutter.EventType.BUTTON_PRESS) {
            let source = event.get_source();
            if (source != this._text && this._text.text == '' &&
                !Main.layoutManager.keyboardBox.contains(source)) {
                // the user clicked outside after activating the entry, but
                // with no search term entered and no keyboard button pressed
                // - cancel the search
                this.reset();
            }
        }

        return false;
    },

    _doSearch: function () {
        this._searchTimeoutId = 0;
        let text = this._text.get_text().replace(/^\s+/g, '').replace(/\s+$/g, '');
        Main.overview.viewSelector.doSearch(text);

        return false;
    }
});
