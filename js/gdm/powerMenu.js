// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-
/*
 * Copyright 2011 Red Hat, Inc
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2, or (at your option)
 * any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA
 * 02111-1307, USA.
 */

const Lang = imports.lang;
const UPowerGlib = imports.gi.UPowerGlib;

const ConsoleKit = imports.gdm.consoleKit;
const Systemd = imports.gdm.systemd;

const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const PowerMenuButton = new Lang.Class({
    Name: 'PowerMenuButton',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this.parent('system-shutdown', null);
        this._upClient = new UPowerGlib.Client();

        if (Systemd.haveSystemd())
            this._systemdLoginManager = new Systemd.SystemdLoginManager();
        else
            this._consoleKitManager = new ConsoleKit.ConsoleKitManager();

        this._createSubMenu();

        this._upClient.connect('notify::can-suspend',
                               Lang.bind(this, this._updateHaveSuspend));
        this._updateHaveSuspend();

        // ConsoleKit doesn't send notifications when shutdown/reboot
        // are disabled, so we update the menu item each time the menu opens
        this.menu.connect('open-state-changed', Lang.bind(this,
            function(menu, open) {
                if (open) {
                    this._updateHaveShutdown();
                    this._updateHaveRestart();
                }
            }));
        this._updateHaveShutdown();
        this._updateHaveRestart();
    },

    _updateVisibility: function() {
        let shouldBeVisible = (this._haveSuspend || this._haveShutdown || this._haveRestart);
        this.actor.visible = shouldBeVisible;
    },

    _updateHaveShutdown: function() {

        if (Systemd.haveSystemd()) {
            this._systemdLoginManager.CanPowerOffRemote(Lang.bind(this,
                function(result, error) {
                    if (!error)
                        this._haveShutdown = result[0] != 'no';
                    else
                        this._haveShutdown = false;

                    this._powerOffItem.actor.visible = this._haveShutdown;
                    this._updateVisibility();
                }));
        } else {
            this._consoleKitManager.CanStopRemote(Lang.bind(this,
                function(result, error) {
                    if (!error)
                        this._haveShutdown = result[0];
                    else
                        this._haveShutdown = false;

                    this._powerOffItem.actor.visible = this._haveShutdown;
                    this._updateVisibility();
                }));
        }
    },

    _updateHaveRestart: function() {

        if (Systemd.haveSystemd()) {
            this._systemdLoginManager.CanRebootRemote(Lang.bind(this,
                function(result, error) {
                    if (!error)
                        this._haveRestart = result[0] != 'no';
                    else
                        this._haveRestart = false;

                    this._restartItem.actor.visible = this._haveRestart;
                    this._updateVisibility();
                }));
        } else {
            this._consoleKitManager.CanRestartRemote(Lang.bind(this,
                function(result, error) {
                    if (!error)
                        this._haveRestart = result[0];
                    else
                        this._haveRestart = false;

                    this._restartItem.actor.visible = this._haveRestart;
                    this._updateVisibility();
                }));
        }
    },

    _updateHaveSuspend: function() {
        this._haveSuspend = this._upClient.get_can_suspend();
        this._suspendItem.actor.visible = this._haveSuspend;
        this._updateVisibility();
    },

    _createSubMenu: function() {
        let item;

        item = new PopupMenu.PopupMenuItem(_("Suspend"));
        item.connect('activate', Lang.bind(this, this._onActivateSuspend));
        this.menu.addMenuItem(item);
        this._suspendItem = item;

        item = new PopupMenu.PopupMenuItem(_("Restart"));
        item.connect('activate', Lang.bind(this, this._onActivateRestart));
        this.menu.addMenuItem(item);
        this._restartItem = item;

        item = new PopupMenu.PopupMenuItem(_("Power Off"));
        item.connect('activate', Lang.bind(this, this._onActivatePowerOff));
        this.menu.addMenuItem(item);
        this._powerOffItem = item;
    },

    _onActivateSuspend: function() {
        if (this._haveSuspend)
            this._upClient.suspend_sync(null);
    },

    _onActivateRestart: function() {
        if (!this._haveRestart)
            return;

        if (Systemd.haveSystemd())
            this._systemdLoginManager.RebootRemote(true);
        else
            this._consoleKitManager.RestartRemote();
    },

    _onActivatePowerOff: function() {
        if (!this._haveShutdown)
            return;

        if (Systemd.haveSystemd())
            this._systemdLoginManager.PowerOffRemote(true);
        else
            this._consoleKitManager.StopRemote();
    }
});
