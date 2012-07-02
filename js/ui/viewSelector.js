// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gtk = imports.gi.Gtk;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Signals = imports.signals;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const AppDisplay = imports.ui.appDisplay;
const ContactDisplay = imports.ui.contactDisplay;
const Main = imports.ui.main;
const PlaceDisplay = imports.ui.placeDisplay;
const Search = imports.ui.search;
const SearchDisplay = imports.ui.searchDisplay;
const ShellEntry = imports.ui.shellEntry;
const Tweener = imports.ui.tweener;
const Wanda = imports.ui.wanda;
const WorkspacesView = imports.ui.workspacesView;

const ANIMATION_TIME;

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
                //this._searchResults.navigateFocus(Gtk.DirectionType.TAB_FORWARD);
                Main.overview.viewSelector.focusActivePage();
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

        if (symbol == Clutter.Escape && this.active) {
            this.reset();
            return true;
        } else if (Clutter.keysym_to_unicode(symbol) ||
                   (symbol == Clutter.BackSpace && this.active)) {
            this._startSearch(event);        
            return false;
        }
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

const ViewSelector = new Lang.Class({
    Name: 'ViewSelector',

    _init : function() {
        ANIMATION_TIME = Main.overview.ANIMATION_TIME;

        this.actor = new St.BoxLayout({ name: 'viewSelector',
                                        vertical: true });

        this._pageArea = new Shell.Stack();
        this.actor.add(this._pageArea, { x_fill: true,
                                         y_fill: true,
                                         expand: true });
        this._activePage;

        this._workspacesDisplay = new WorkspacesView.WorkspacesDisplay();
        this._workspacesPage = new St.Bin({ child: this._workspacesDisplay.actor,
                                 x_align: St.Align.START,
                                 y_align: St.Align.START,
                                 x_fill: true,
                                 y_fill: true,
                                 style_class: 'view-tab-page' });        
        this._pageArea.add_actor(this._workspacesPage);

        this._appDisplay = new AppDisplay.AllAppDisplay();
        this._appsPage = new St.Bin({ child: this._appDisplay.actor,
                                 x_align: St.Align.START,
                                 y_align: St.Align.START,
                                 x_fill: true,
                                 y_fill: true,
                                 style_class: 'view-tab-page' });
        this._pageArea.add_actor(this._appsPage);

        this._searchSystem = new Search.SearchSystem();
        this._openSearchSystem = new Search.OpenSearchSystem();
        this._searchResults = new SearchDisplay.SearchResults(this._searchSystem, this._openSearchSystem);
        this._searchPage = new St.Bin({ child: this._searchResults.actor,
                                 x_align: St.Align.START,
                                 y_align: St.Align.START,
                                 x_fill: true,
                                 y_fill: true,
                                 style_class: 'view-tab-page' });
        this._pageArea.add_actor(this._searchPage);

        this.addSearchProvider(new Wanda.WandaSearchProvider());
        this.addSearchProvider(new AppDisplay.AppSearchProvider());
        this.addSearchProvider(new AppDisplay.SettingsSearchProvider());
        this.addSearchProvider(new PlaceDisplay.PlaceSearchProvider());
        this.addSearchProvider(new ContactDisplay.ContactSearchProvider());

        this._searchEntry = new SearchEntry();
        this.entryActor = this._searchEntry.actor;

        this._desktopFade = new St.Bin();
        global.overlay_group.add_actor(this._desktopFade);

        Main.overview.connect('showing', Lang.bind(this,
            function () {
                this.show();
            }));

        Main.overview.connect('shown', Lang.bind(this,
            function () {
                this.showDone();
            }));

        Main.overview.connect('hiding', Lang.bind(this,
            function () {
                this.hide();
            }));

        Main.overview.connect('hidden', Lang.bind(this,
            function() {
                this.hideDone();
            }));
                

        // Public constraints which may be used to tie actors' height or
        // vertical position to the current tab's content; as the content's
        // height and position depend on the view selector's style properties
        // (e.g. font size, padding, spacing, ...) it would be extremely hard
        // and ugly to get these from the outside. While it would be possible
        // to use position and height properties directly, outside code would
        // need to ensure that the content is properly allocated before
        // accessing the properties.
        this.constrainHeight = new Clutter.BindConstraint({ source: this._pageArea,
                                                            coordinate: Clutter.BindCoordinate.HEIGHT });
    },

    show: function() {
        this._activePage = this._workspacesPage;
        this._prevPage = null;

        this._workspacesDisplay.show();
        this._appsPage.hide();
        this._searchPage.hide();        

        this._showPage(this._workspacesPage);

        if (!this._desktopFade.child)
            this._desktopFade.child = this._getDesktopClone();

        if (!this._workspacesDisplay.activeWorkspaceHasMaximizedWindows()) {
            this._desktopFade.opacity = 255;
            this._desktopFade.show();
            Tweener.addTween(this._desktopFade,
                             { opacity: 0,
                               time: ANIMATION_TIME,
                               transition: 'easeOutQuad'
                             });
        }
    },

    showDone: function() {
        this._desktopFade.hide();
        
    },

    hide: function() {
        this._showPage(this._workspacesPage);

        if (!this._workspacesDisplay.activeWorkspaceHasMaximizedWindows()) {
            this._desktopFade.opacity = 0;
            this._desktopFade.show();
            Tweener.addTween(this._desktopFade,
                             { opacity: 255,
                               time: ANIMATION_TIME,
                               transition: 'easeOutQuad' });
        }

        this._workspacesDisplay.zoomFromOverview();        
    },

    hideDone: function() {
        this._workspacesDisplay.hide();
        this._desktopFade.hide();
    },

    searchActive: function() {
        return this._searchEntry.active;
    },

    _getDesktopClone: function() {
        let windows = global.get_window_actors().filter(function(w) {
            return w.meta_window.get_window_type() == Meta.WindowType.DESKTOP;
        });
        if (windows.length == 0)
            return null;

        let clone = new Clutter.Clone({ source: windows[0].get_texture() });
        clone.source.connect('destroy', Lang.bind(this, function() {
            clone.destroy();
        }));
        return clone;
    },

    addSearchProvider: function(provider) {
        this._searchSystem.registerProvider(provider);
        this._searchResults.createProviderMeta(provider);
    },

    removeSearchProvider: function(provider) {
        this._searchSystem.unregisterProvider(provider);
        this._searchResults.destroyProviderMeta(provider);
    },

    focusActivePage: function() {
        this._activePage.child.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
    },

    _showPage: function(page) {
        if(page == this._activePage && this._prevPage != null)
            return;

        if(this._activePage) {
            Tweener.addTween(this._activePage,
                             { opacity: 0,
                               time: 0.1,
                               transition: 'easeOutQuad',
                               onComplete: Lang.bind(this,
                                   function() {
                                       this._activePage.hide_all();
                                       this._prevPage = this._activePage;
                                       this._activePage = page;
                                   })
                             });
        }

        page.show_all();
        Tweener.addTween(page,
                         { opacity: 255,
                           time: 0.1,
                           transition: 'easeOutQuad'
                         });
    },

    showAppsPage: function(doShow) {
        if(doShow || (doShow == undefined && this._activePage != this._appsPage)) {
            this._showPage(this._appsPage);
        } else if(this._prevPage) {
            this._showPage(this._prevPage);
        }
    },

    doSearch: function(text) {
        this._showPage(this._searchPage);
        this._searchResults.doSearch(text);
    },

    resetSearch: function() {
        if(this._prevPage && this._prevPage != this._searchPage) {
            this._showPage(this._prevPage);
        }
    }
});
Signals.addSignalMethods(ViewSelector.prototype);
