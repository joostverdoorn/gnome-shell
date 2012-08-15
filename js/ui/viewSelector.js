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
const Main = imports.ui.main;
const PlaceDisplay = imports.ui.placeDisplay;
const Search = imports.ui.search;
const SearchDisplay = imports.ui.searchDisplay;
const ShellEntry = imports.ui.shellEntry;
const Tweener = imports.ui.tweener;
const Wanda = imports.ui.wanda;
const WorkspacesView = imports.ui.workspacesView;


const ViewSelector = new Lang.Class({
    Name: 'ViewSelector',

    _init : function(searchEntry, showAppsButton) {
        this.actor = new St.BoxLayout({ name: 'viewSelector',
                                        vertical: true });

        this._showAppsButton = showAppsButton;
        this._showAppsButton.connect('notify::checked', Lang.bind(this, this._onShowAppsButtonToggled));

        this._pageArea = new Shell.Stack();
        this.actor.add(this._pageArea, { x_fill: true,
                                         y_fill: true,
                                         expand: true });

        this._activePage = null;

        this.active = false;
        this._searchPending = false;
        this._searchTimeoutId = 0;

        this._searchSystem = new Search.SearchSystem();
        this._openSearchSystem = new Search.OpenSearchSystem();

        this._entry = searchEntry;
        ShellEntry.addContextMenu(this._entry);

        this._text = this._entry.clutter_text;
        this._text.connect('text-changed', Lang.bind(this, this._onTextChanged));
        this._text.connect('key-press-event', Lang.bind(this, this._onKeyPress));
        this._text.connect('key-focus-in', Lang.bind(this, function() {
            this._searchResults.highlightDefault(true);
        }));
        this._text.connect('key-focus-out', Lang.bind(this, function() {
            this._searchResults.highlightDefault(false);
        }));
        this._entry.connect('notify::mapped', Lang.bind(this, this._onMapped));
        global.stage.connect('notify::key-focus', Lang.bind(this, this._onStageKeyFocusChanged));

        this._inactiveIcon = new St.Icon({ style_class: 'search-entry-icon',
                                           icon_name: 'edit-find',
                                           icon_type: St.IconType.SYMBOLIC });
        this._activeIcon = new St.Icon({ style_class: 'search-entry-icon',
                                         icon_name: 'edit-clear',
                                         icon_type: St.IconType.SYMBOLIC });
        this._entry.set_secondary_icon(this._inactiveIcon);

        this._iconClickedId = 0;
        this._capturedEventId = 0;

        this._workspacesDisplay = new WorkspacesView.WorkspacesDisplay();
        this._workspacesPage = this._addPage(this._workspacesDisplay.actor, null,
                                             _("Windows"), 'text-x-generic');

        this._appDisplay = new AppDisplay.AllAppDisplay();
        this._appsPage = this._addPage(this._appDisplay.actor, null,
                                       _("Applications"), 'system-run');

        this._searchResults = new SearchDisplay.SearchResults(this._searchSystem, this._openSearchSystem);
        this._searchPage = this._addPage(this._searchResults.actor, this._entry,
                                         _("Search"), 'edit-find');

        // Default search providers
        // Wanda comes obviously first
        this.addSearchProvider(new Wanda.WandaSearchProvider());
        this.addSearchProvider(new AppDisplay.AppSearchProvider());
        this.addSearchProvider(new AppDisplay.SettingsSearchProvider());
        this.addSearchProvider(new PlaceDisplay.PlaceSearchProvider());

        // Since the entry isn't inside the results container we install this
        // dummy widget as the last results container child so that we can
        // include the entry in the keynav tab path...
        this._focusTrap = new St.Bin({ can_focus: true });
        this._focusTrap.connect('key-focus-in', Lang.bind(this, function() {
            this._entry.grab_key_focus();
        }));
        // ... but make it unfocusable using arrow keys keynav by making its
        // bounding box always contain the possible focus source's bounding
        // box since StWidget's keynav logic won't ever select it as a target
        // in that case.
        this._focusTrap.add_constraint(new Clutter.BindConstraint({ source: this._searchResults.actor,
                                                                    coordinate: Clutter.BindCoordinate.ALL }));
        this._searchResults.actor.add_actor(this._focusTrap);

        global.focus_manager.add_group(this._searchResults.actor);

        Main.overview.connect('item-drag-begin',
                              Lang.bind(this, this._resetShowAppsButton));

        this._stageKeyPressId = 0;
        Main.overview.connect('showing', Lang.bind(this,
            function () {
                this._resetShowAppsButton();
                this._stageKeyPressId = global.stage.connect('key-press-event',
                                                             Lang.bind(this, this._onStageKeyPress));
            }));
        Main.overview.connect('hiding', Lang.bind(this,
            function () {
                this._resetShowAppsButton();
                if (this._stageKeyPressId != 0) {
                    global.stage.disconnect(this._stageKeyPressId);
                    this._stageKeyPressId = 0;
                }
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

        this._appsPage.hide();
        this._searchPage.hide();
        this._workspacesDisplay.show();

        if (!this._workspacesDisplay.activeWorkspaceHasMaximizedWindows())
            Main.overview.fadeOutDesktop();

        this._showPage(this._workspacesPage);
    },

    zoomFromOverview: function() {
        this._workspacesDisplay.zoomFromOverview();

        if (!this._workspacesDisplay.activeWorkspaceHasMaximizedWindows())
            Main.overview.fadeInDesktop();
    },

    hide: function() {
        this._workspacesDisplay.hide();
    },

    _addPage: function(actor, a11yFocus, name, a11yIcon) {
        let page = new St.Bin({ child: actor,
                                x_align: St.Align.START,
                                y_align: St.Align.START,
                                x_fill: true,
                                y_fill: true,
                                style_class: 'view-tab-page' });
        if (a11yFocus)
            Main.ctrlAltTabManager.addGroup(a11yFocus, name, a11yIcon);
        else
            Main.ctrlAltTabManager.addGroup(actor, name, a11yIcon,
                                            { proxy: this.actor,
                                              focusCallback: Lang.bind(this,
                                                  function() {
                                                      this._a11yFocusPage(page);
                                                  })
                                            });;
        this._pageArea.add_actor(page);
        return page
    },

    _showPage: function(page) {
        if(page == this._activePage)
            return;

        if(this._activePage) {
            Tweener.addTween(this._activePage,
                             { opacity: 0,
                               time: 0.1,
                               transition: 'easeOutQuad',
                               onComplete: Lang.bind(this,
                                   function() {
                                       this._activePage.hide();
                                       this._activePage = page;
                                   })
                             });
        }

        page.show();
        Tweener.addTween(page,
                         { opacity: 255,
                           time: 0.1,
                           transition: 'easeOutQuad'
                         });
    },

    _a11yFocusPage: function(page) {
        this._showAppsButton.checked = page == this._appsPage;
        page.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
    },

    _onShowAppsButtonToggled: function() {
        if (this.active)
            this.reset();
        else
            this._showPage(this._showAppsButton.checked ? this._appsPage
                                                        : this._workspacesPage);
    },

    _resetShowAppsButton: function() {
        this._showAppsButton.checked = false;
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
            this.startSearch(event);
        } else if (!this.active) {
            if (symbol == Clutter.Tab) {
                this._activePage.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
                return true;
            } else if (symbol == Clutter.ISO_Left_Tab) {
                this._activePage.navigate_focus(null, Gtk.DirectionType.TAB_BACKWARD, false);
                return true;
            }
        }
        return false;
    },

    _searchCancelled: function() {
        this._showPage(this._showAppsButton.checked ? this._appsPage
                                                    : this._workspacesPage);

        // Leave the entry focused when it doesn't have any text;
        // when replacing a selected search term, Clutter emits
        // two 'text-changed' signals, one for deleting the previous
        // text and one for the new one - the second one is handled
        // incorrectly when we remove focus
        // (https://bugzilla.gnome.org/show_bug.cgi?id=636341) */
        if (this._text.text != '')
            this.reset();
    },

    reset: function () {
        global.stage.set_key_focus(null);

        this._entry.text = '';

        this._text.set_cursor_visible(true);
        this._text.set_selection(0, 0);
    },

    _onStageKeyFocusChanged: function() {
        let focus = global.stage.get_key_focus();
        let appearFocused = (this._entry.contains(focus) ||
                             this._searchResults.actor.contains(focus));

        this._text.set_cursor_visible(appearFocused);

        if (appearFocused)
            this._entry.add_style_pseudo_class('focus');
        else
            this._entry.remove_style_pseudo_class('focus');
    },

    _onMapped: function() {
        if (this._entry.mapped) {
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

    startSearch: function(event) {
        global.stage.set_key_focus(this._text);
        this._text.event(event, false);
    },

    // the entry does not show the hint
    _isActivated: function() {
        return this._text.text == this._entry.get_text();
    },

    _onTextChanged: function (se, prop) {
        let searchPreviouslyActive = this.active;
        this.active = this._entry.get_text() != '';
        this._searchPending = this.active && !searchPreviouslyActive;
        if (this._searchPending) {
            this._searchResults.startingSearch();
        }
        if (this.active) {
            this._entry.set_secondary_icon(this._activeIcon);

            if (this._iconClickedId == 0) {
                this._iconClickedId = this._entry.connect('secondary-icon-clicked',
                    Lang.bind(this, function() {
                        this.reset();
                    }));
            }
            this._showPage(this._searchPage);
        } else {
            if (this._iconClickedId > 0)
                this._entry.disconnect(this._iconClickedId);
            this._iconClickedId = 0;

            this._entry.set_secondary_icon(this._inactiveIcon);
            this._searchCancelled();
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
        } else if (symbol == Clutter.Return || symbol == Clutter.KP_Enter) {
            // We can't connect to 'activate' here because search providers
            // might want to do something with the modifiers in activateDefault.
            if (this._searchTimeoutId > 0) {
                Mainloop.source_remove(this._searchTimeoutId);
                this._doSearch();
            }
            this._searchResults.activateDefault();
            return true;
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
        this._searchResults.doSearch(text);

        this._showPage(this._searchPage);
    },

    addSearchProvider: function(provider) {
        this._searchSystem.registerProvider(provider);
        this._searchResults.createProviderMeta(provider);
    },

    removeSearchProvider: function(provider) {
        this._searchSystem.unregisterProvider(provider);
        this._searchResults.destroyProviderMeta(provider);
    }
});
Signals.addSignalMethods(ViewSelector.prototype);
