const hyprland = await Service.import("hyprland")
const mpris = await Service.import("mpris")
const audio = await Service.import("audio")
const systemtray = await Service.import("systemtray")
const notifications = await Service.import("notifications")
notifications.popupTimeout = 3000;

import { Calendar, CalendarOptions } from "./calendar.js"
import { Weather } from "./weather.js"
//import { AemetForecast } from "./aemet.js"
import * as MyUtils from "./myutils.js"

const NetworkIndicator = () => Widget.Label({
    class_name: "network",
    label: (function () {
        let iface = 'bridge0';
        let ipv4 = Utils.exec('ip addr show ' + iface).split("inet ")[1].split("/")[0];
        return ipv4 + "  ";
    }()),
    tooltip_text: "bridge0",
});

function IdleInhibitor() {
    const label = Widget.Label({
        label: "",
        class_name: "disabled",
        tooltip_text: "Idle Inhibitor",
    })
    const toggle = Widget.ToggleButton({
        setup: self => {
            self.set_active(false);
            Utils.execAsync("matcha --daemon --off");
        },
        class_name: "idle-inhibitor",
        child: label,
        on_toggled: ({ active }) => {
            [ label.label, label.class_name ] = active ?
                [ "", "enabled" ] : [ "", "disabled" ];
            Utils.execAsync("matcha --toggle");
        }
    });
    return toggle;
}


// widgets can be only assigned as a child in one container
// so to make a reuseable widget, make it a function
// then you can simply instantiate one by calling it

function Workspaces() {
    const dispatch = ws => hyprland.messageAsync(`dispatch workspace ${ws}`);
    const active_id = hyprland.active.workspace.bind("id")
    return Widget.EventBox({
        class_name: "workspaces",
        on_scroll_up: () => dispatch('-1'),
        on_scroll_down: () => dispatch('+1'),
        child: Widget.Box({
            children: Array.from({ length: 10 }, (_, id) => id + 1).map(id => Widget.Button({
                attribute: id,
                label: `${id}`,
                class_name: active_id.as(i=> `${i === id ? "focused" : ""}`),
                on_clicked: () => dispatch(id),
            })),

            // remove this setup hook if you want fixed number of buttons
            setup: self => self.hook(hyprland, () => self.children.forEach(btn => {
                btn.visible = hyprland.workspaces.some(ws => ws.id === btn.attribute);
            })),
        }),
    })
}

function ClientTitle() {
    return Widget.Label({
        setup(self) {
            self.set_ellipsize(3); // END
            self.set_max_width_chars(100);
        },
        class_name: "client-title",
        label: hyprland.active.client.bind("title"),
    })
}

function SubMap() {
    const submap_label = Widget.Label({
        label: ''
    })
    const submap = Widget.Box({
        class_name: "submap",
        child: submap_label,
    })
    hyprland.connect('submap', (_, name) => {
        if (name != "") {
            submap_label.label = "̌󰌌    " + name
        } else {
            submap_label.label = ''
        }
    })
    return submap
}


const date = Variable("", {
    poll: [15000, 'date +"%a %b %e   %H:%M"'],
})

function Clock(monitor) {
    const options = new CalendarOptions();
    const today = new Date();
    options.startDate = new Date(today.getFullYear(), 0, 1);
    options.calendarDataDir = "Documents/calendar";
    const calendar = new Calendar(monitor, options);

    return Widget.Button({
        class_name: "clock",
        child: Widget.Label({
            label: date.bind()
        }),
        on_clicked: () => {
            calendar.toggle_visibility();
        }
    });
}

function GetKeyboardLayout() {
    const devices = Utils.exec('hyprctl devices -j');
    const json = JSON.parse(devices);

    for (let keyboard of json.keyboards) {
        if (keyboard.name == "logitech-usb-keyboard") {
            return keyboard.active_keymap;
        }
    }
    return keyboards[0].active_keymap
}

function KeyboardLayout() {
    const active_layout = GetKeyboardLayout()
    const keyboard_label = Widget.Label({
        label: active_layout
    })
    const keyboard = Widget.Box({
        class_name: "keyboard",
        child: keyboard_label,
    })
    hyprland.connect('keyboard-layout', (_, _keyboardname, layoutname) => {
        // There is a bug, it doesn't print the whole string
        //keyboard_label.label = layoutname
        keyboard_label.label = GetKeyboardLayout();
    })
    return keyboard
}


function PackageUpdates() {
    let updates = ""
    const updates_label = Widget.Label()
    const source = MyUtils.interval(300000, () => {
        const arch = Utils.exec('checkupdates')
        const aur = Utils.exec('paru -Qua')
        updates = arch.trimEnd();
        if (aur != "") {
            updates += updates == "" ? aur : '\n' + aur;
        }
        const nupdates = updates == "" ? 0 : updates.split(/\r\n|\r|\n/).length
        updates_label.label = "󰻌   " + nupdates
        const threshold_yellow = 25
        if (nupdates == 0) {
            updates_label.class_name = "updates-green"
        } else if (nupdates <= threshold_yellow) {
            updates_label.class_name = "updates-yellow"
        } else {
            updates_label.class_name = "updates-red"
        }
    }, updates_label)

    const updates_button = Widget.Button({
        class_name: "updates",
        child: updates_label,
        on_clicked: () => Utils.execAsync("pamac-manager --updates"),
        on_secondary_click: () => {
            MyUtils.reset_interval(source);
        },
        on_hover: () => {
            updates_button.tooltip_text = updates
        }
    })
    updates_button.child = updates_label

    return updates_button
}


class MPlayer {
    constructor (player) {
        this.player = player;
        this.play_label = Widget.Label();
        this.play_button = Widget.Button({
            child: this.play_label,
            on_clicked: () => {
                player.playPause();
                this.update_player();
            },
        });
        this.prev_label = Widget.Label("");
        this.prev_button = Widget.Button({
            child: this.prev_label,
            on_clicked: () => {
                if (this.player.can_go_prev) {
                    this.player.previous();
                    this.update_player();
                }
            },
        });
        this.next_label = Widget.Label("");
        this.next_button = Widget.Button({
            child: this.next_label,
            on_clicked: () => {
                if (this.player.can_go_next) {
                    this.player.next();
                    this.update_player();
                }
            },
        });
        this.info_label = Widget.Label();
        this.box = Widget.Box({
            visible: false,
            children: [ this.info_label, this.prev_button, this.play_button, this.next_button ],
        });
        this.update_player();
    }

    get_ui() {
        return this.box;
    }

    visible(isvisible) {
        this.box.visible = isvisible;
    }

    get_info() {
        return this.player.name + ": " + this.play_label.label + " " + this.info_label.label;
    }

    update_player() {
        const { play_back_status, track_title, track_album, track_artists } = this.player;
        let status_icon;
        let class_name;
        if (play_back_status == "Paused") {
            class_name = "mpris-paused";
            status_icon = "";
        } else if (play_back_status == "Playing") {
            class_name = "mpris-playing";
            status_icon = "";
        } else {
            class_name = "mpris-stopped";
            status_icon = "";
            // "", "", "", "", ""
        }
        if (!this.player.can_go_prev) {
            this.prev_label.visible = false;
            this.prev_button.visible = false;
        }
        if (!this.player.can_go_next) {
            this.next_label.visible = false;
            this.next_button.visible = false;
        }
        this.play_label.label = `${status_icon}`;
        this.info_label.label = `${track_title} - ${track_album} - ${track_artists.join(', ')}`;
        this.box.class_name = class_name;
    }
}

function MediaPlayerBox() {
    let mplayers = {};
    function create_children(players) {
        let cs = [];
        mplayers = {};
        for (let p of players) {
            const mplayer = new MPlayer(p);
            cs.push(mplayer.get_ui());
            mplayers[p.bus_name] = mplayer;
        }
        return cs;
    }
    function make_visible(bus) {
        for (let player in mplayers) {
            mplayers[player].visible(player == bus ? true : false);
        }
    }
    function get_players_info() {
        let text = "";
        for (let bus in mplayers) {
            text += mplayers[bus].get_info() + '\n';
        }
        return text.trimEnd();
    }
    function create_menu_items() {
        let mi = [];
        for (let bus in mplayers) {
            mi.push(Widget.MenuItem({
                child: Widget.Label(mplayers[bus].get_info()),
                on_activate: () => {
                    mpris.emit('player-changed', bus);
                }
            }));
        }
        return mi;
    }
    const menu = Widget.Menu();
    return Widget.EventBox({
        child: Widget.Box({
            setup: self => {
                mpris.connect('player-changed', (mpr, bus) => {
                    if (mplayers[bus]) {
                        mplayers[bus].update_player();
                        make_visible(bus);
                    }
                    self.tooltip_text = get_players_info();
                    menu.children = create_menu_items();
                });
            },
            // See https://github.com/Aylur/ags/issues/392
            // All children will be visible at creation time.
            children: mpris.bind('players').as(players => create_children(players)),
        }),
        on_secondary_click: (_, _event) => Utils.execAsync("kitty ncmpcpp"),
        on_primary_click: (_, event) => {
            menu.popup_at_pointer(event);
        }
    });
}

function SpeakerIndicator() {
    const volume_box = Widget.Box();
    const volume_button = Widget.Button();
    const volume_icon = Widget.Icon();
    const volume_label = Widget.Label();
    volume_icon.hook(audio.speaker, () => {
        const vol = audio.speaker.volume * 100;
        const icon = [
            [101, 'overamplified'],
            [67, 'high'],
            [34, 'medium'],
            [1, 'low'],
            [0, 'muted'],
        ].find(([threshold]) => threshold <= vol)?.[1];
        volume_icon.icon = `audio-volume-${icon}-symbolic`;
        volume_icon.tooltip_text = audio.speaker.description;
        volume_label.label = `${Math.floor(vol)}%`;
    })
    volume_button.child = volume_icon;
    volume_button.on_clicked = () => audio.speaker.is_muted = !audio.speaker.is_muted;
    volume_button.on_secondary_click = () => Utils.execAsync("pavucontrol");
    volume_button.on_scroll_up = () => audio.speaker.volume = audio.speaker.volume + 0.01;
    volume_button.on_scroll_down = () => audio.speaker.volume = audio.speaker.volume - 0.01;
    volume_box.children = [volume_button, volume_label];
    volume_box.class_name = "speaker";
    return volume_box;
}

function MicrophoneIndicator() {
    const volume_box = Widget.Box();
    const volume_button = Widget.Button()
    const volume_icon = Widget.Icon()
    const volume_label = Widget.Label()
    volume_button.hook(audio, () => {
        const visible = audio.recorders.length > 0 ||
            audio.microphone.is_muted || false;
        volume_button.visible = visible;
        volume_label.visible = visible;
    })
    volume_icon.hook(audio.microphone, () => {
        const vol = audio.microphone.volume * 100;
        const icon = [
            [101, 'overamplified'],
            [67, 'high'],
            [34, 'medium'],
            [1, 'low'],
            [0, 'muted'],
        ].find(([threshold]) => threshold <= vol)?.[1];
        volume_icon.icon = `audio-volume-${icon}-symbolic`;
        volume_icon.tooltip_text = audio.microphone.description;
        volume_label.label = `${Math.floor(vol)}%`;
    })
    volume_button.child = volume_icon;
    volume_button.on_clicked = () => audio.microphone.is_muted = !audio.microphone.is_muted;
    volume_button.on_secondary_click = () => Utils.execAsync("pavucontrol");
    volume_box.children = [volume_button, volume_label]
    volume_box.class_name = "microphone";
    return volume_box
}

function SysTray() {
    const SysTrayItem = item => Widget.Button({
        child: Widget.Icon({
            size: 16,
            icon: item.bind("icon"),
        }),
        tooltipMarkup: item.bind('tooltip_markup'),
        onPrimaryClick: (_, event) => item.activate(event),
        onSecondaryClick: (_, event) => item.openMenu(event),
    });

    return Widget.Box({
        class_name: "systray",
        children: systemtray.bind('items').as(i => i.map(SysTrayItem))
    });
}


function Graph(value, history, color) {
    return Widget.DrawingArea({
        setup(self) {
            let data = [];
            self.hook(value, () => {
                data.push(value.value);
                if (data.length > history) {
                    data.shift();
                }
                self.queue_draw()
            });
            self.set_size_request(36, 12);

            self.connect('draw', (_, cr) => {
                let [width, height] = [self.get_allocated_width(), self.get_allocated_height()];
                cr.scale(width, height);
                cr.rectangle(0, 0, 1.0, 1.0);
                cr.fill();
                let samples = data.length - 1;
                let max = 100.0;
                cr.setSourceRGB(color[0], color[1], color[2]);
                if (samples > 0) {
                    cr.moveTo(1.0, 1.0);
                    let x = 1.0, y = 1.0 - data[samples] / max;
                    cr.lineTo(x, y);
                    for (let j = samples - 1; j >= 0; j--) {
                        y = 1.0 - data[j] / max;
                        x = j / samples;
                        cr.lineTo(x, y);
                    }
                    cr.lineTo(x, 1.0);
                    cr.closePath();
                    cr.fill();
                }
                cr.$dispose();
            });
        }
    })
}

let cpumonitor;

class CpuMonitor {
    constructor(interval, history, color) {
        this.cpu_load = Variable(0);
        this.prev_idle_time = 0;
        this.prev_total_time = 0;
        this.label = Widget.Label({
            label: this.cpu_load.bind().as(value => value.toFixed(0).toString() + "%"),
        });
        this.drawing = Graph(this.cpu_load, history, color);
        this.button = Widget.Button({
            child: this.drawing,
            on_clicked: () => Utils.execAsync("kitty btop --utf-force"),
            on_secondary_click: () => Utils.execAsync("kitty nvtop"),
            on_hover: () => {
                //top -d 0.2 -n 2 -b -o=-%CPU | tail -10 | tac | awk '{printf "%7.1f  %s\n", $9 ,$12}'
                this.button.tooltip_text = Utils.exec("bash -c \"top -d 0.2 -n 2 -b -o=-%CPU | tail -10 | tac | awk '{printf \\\"%7.1f %s\\n\\\", \$9, \$12}'\"");
            }
        });
        this.box = Widget.Box({
            class_name: "cpu-monitor",
            children: [ this.label, this.button ]
        });
        const id = Utils.interval(interval, () => {
            // runs immediately and once every 'interval'
            const stats = Utils.readFile("/proc/stat");
            const times = stats.split('\n', 1)[0].split(/\s+/);
            times.shift();
            const [
                user, nice, system, idle, iowait,
                irq, softirq, steal, guest, guest_nice,
            ] = times.map(s => {
                let v = parseInt(s);
                return v;
            });
            let total = user + nice + system + idle + iowait + irq + softirq + steal + guest + guest_nice;
            const idle_time_delta = idle - this.prev_idle_time;
            this.prev_idle_time = idle;
            const total_time_delta = total - this.prev_total_time;
            this.prev_total_time = total;
            const utilization =
                100.0 * (1.0 - idle_time_delta / total_time_delta);
            this.cpu_load.setValue(Math.round(utilization));
        }, this.box);
    }
    get_ui() {
        return this.box;
    }
}

function CpuGraph() {
    if (!cpumonitor) {
        cpumonitor = new CpuMonitor(2000, 8, [0.0, 0.57, 0.9]);
    }
    return cpumonitor.get_ui();
}

let memmonitor;

class MemMonitor {
    constructor(interval, history, color) {
        this.mem_load = Variable(0);
        this.mem_available = 0;
        this.mem_total = 0;
        this.label = Widget.Label({
            label: this.mem_load.bind().as(value => value.toFixed(0).toString() + "%"),
        });
        this.drawing = Graph(this.mem_load, history, color);
        this.button = Widget.Button({
            child: this.drawing,
            on_clicked: () => Utils.execAsync("kitty btop --utf-force"),
            on_secondary_click: () => Utils.execAsync("kitty nvtop"),
            on_hover: () => {
                let used = (this.mem_total - this.mem_available) / (1024 * 1024);
                let result = used.toFixed(1).toString() + " GB used\n\n";
                result += Utils.exec("bash -c \"ps -eo rss,comm --sort -rss --no-headers | head -n 10 | numfmt --to-unit=1024 --field 1 --padding 5\"");
                //this.button.tooltip_text = Utils.exec("bash -c \"top -d 0.2 -n 2 -b -o=-RES | tail -10 | tac | awk '{printf \\\"%8s %s\\n\\\", \$6, \$12}'\"");
                this.button.tooltip_text = result;
            }
        });
        this.box = Widget.Box({
            class_name: "mem-monitor",
            children: [ this.label, this.button ]
        });
        const id = Utils.interval(interval, () => {
            this.mem_available = 0;
            this.mem_total = 0;
            const stats = Utils.readFile("/proc/meminfo").split('\n');
            for (let stat of stats) {
                const memory = stat.split(/\s+/);
                if (memory[0] == "MemTotal:") {
                    this.mem_total = parseInt(memory[1]);
                } else if (memory[0] == "MemAvailable:") {
                    this.mem_available = parseInt(memory[1]);
                }
                if (this.mem_available > 0 && this.mem_total > 0)
                    break;
            }
            const utilization = (100.0 * (this.mem_total - this.mem_available)) / this.mem_total;
            this.mem_load.setValue(Math.round(utilization));
        }, this.box);
    }
    get_ui() {
        return this.box;
    }
}

function MemGraph() {
    if (!memmonitor) {
        memmonitor = new MemMonitor(5000, 8, [0.0, 0.7, 0.36]);
    }
    return memmonitor.get_ui();
}

let gpumonitor;

class GpuMonitor {
    constructor(interval, history, colorgpu, colormem) {
        this.gpu_load = Variable(0);
        this.gpu_mem_load = Variable(0);
        this.mem_used = 0;
        this.mem_total = 0;
        this.gpu_label = Widget.Label({
            class_name: "gpu-monitor-gpu",
            label: this.gpu_load.bind().as(value => value.toFixed(0).toString() + "%"),
        });
        /*
        this.gpu_drawing = Graph(this.gpu_load, history, colorgpu);
        this.gpu_button = Widget.Button({
            child: this.gpu_drawing,
            on_clicked: () => Utils.execAsync("kitty nvtop"),
        });
        */
        this.mem_label = Widget.Label({
            class_name: "gpu-monitor-mem",
            label: this.gpu_mem_load.bind().as(value => value.toFixed(0).toString() + "%"),
        });
        this.mem_drawing = Graph(this.gpu_mem_load, history, colormem);
        this.mem_button = Widget.Button({
            child: this.mem_drawing,
            on_clicked: () => Utils.execAsync("kitty nvtop"),
        });
        this.box = Widget.Box({
            class_name: "gpu-monitor",
            children: [ /*this.gpu_label, this.gpu_button, */this.mem_label, this.mem_button ]
        });
        const id = Utils.interval(interval, () => {
            // nvidia-smi -i 0 --query-gpu=memory.total,memory.used,utilization.gpu --format=csv,noheader,nounits
            const stats = Utils.exec("nvidia-smi -i 0 --query-gpu=memory.total,memory.used,utilization.gpu --format=csv,noheader,nounits").split(',');
            this.mem_total = parseInt(stats[0]);
            this.mem_used = parseInt(stats[1]);
            const utilization = parseInt(stats[2]);
            this.gpu_load.setValue(utilization);
            this.gpu_mem_load.setValue(100 * this.mem_used / this.mem_total);
            this.mem_button.tooltip_text = `${this.mem_used} MB used of ${this.mem_total} MB total`;
        }, this.box);
    }
    get_ui() {
        return this.box;
    }
}

function GpuGraph() {
    if (!gpumonitor) {
        gpumonitor = new GpuMonitor(5000, 8, [ 0.94, 0.78, 0.44 ], [0.65, 0.26, 0.26]);
    }
    return gpumonitor.get_ui();
}

function Screenshot() {
    return Widget.Button({
        class_name: "screenshot",
        child: Widget.Label(""),
        // grim  -g "$(slurp -d)" ~/Downloads/screenshot-$(date +"%s.png")
        on_clicked: () => Utils.exec('bash -c "grim  -g \\\"\$(slurp -d)\\\" ~/Downloads/screenshot-\$(date +\\\"%s.png\\\")"'),
        // grim -g "$(slurp -d)" - | wl-copy
        on_secondary_click: () => Utils.exec('bash -c "grim -g \\\"\$(slurp -d)\\\" - | wl-copy"'),
    })
}

function NotificationIcon({ app_entry, app_icon, image }) {
    if (image) {
        return Widget.Box({
            css: `background-image: url("${image}");`
                + "background-size: contain;"
                + "background-repeat: no-repeat;"
                + "background-position: center;",
        })
    }

    let icon = "dialog-information-symbolic"
    if (Utils.lookUpIcon(app_icon))
        icon = app_icon

    if (app_entry && Utils.lookUpIcon(app_entry))
        icon = app_entry

    return Widget.Box({
        child: Widget.Icon(icon),
    })
}

function Notification(n, close) {
    const icon = Widget.Box({
        vpack: "start",
        class_name: "icon",
        child: NotificationIcon(n),
    })

    const title = Widget.Label({
        class_name: "title",
        xalign: 0,
        justification: "left",
        wrap: true,
        label: n.summary,
        use_markup: true,
    })

    const body = Widget.Label({
        class_name: "body",
        use_markup: true,
        xalign: 0,
        justification: "left",
        label: n.body,
        wrap: true,
    })

    const actions = Widget.Box({
        class_name: "actions",
        children: n.actions.map(({ id, label }) => Widget.Button({
            class_name: "action-button",
            on_clicked: () => {
                n.invoke(id);
                if (close)
                    n.close();
                else
                    n.dismiss();
            },
            child: Widget.Label(label),
        })),
    })
    return Widget.EventBox({
        attribute: { id: n.id },
        on_primary_click: close ? n.close : n.dismiss,
        child: Widget.Box({
            class_name: `notification ${n.urgency}`,
            vertical: true,
            children: [
                Widget.Box({
                    children: [
                        icon,
                        Widget.Box({
                            vertical: true,
                            children: [ title, body ],
                        }),
                    ]
                }),
                actions
            ]
        })
    });
}

function NotificationPopups(monitor = 0) {
    const list = Widget.Box({
        css: "min-width: 2px; min-height: 2px;",
        class_name: "notifications",
        vertical: true,
        children: notifications.bind('popups').as(nots => {
            let cs = [];
            for (let n of nots) {
                cs.push(Notification(n, false));
            }
            return cs;
        })
    })
    return Widget.Window({
        monitor,
        name: `notificationpopups${monitor}`,
        class_name: "notification-popups",
        anchor: ["top", "right"],
        visible: true,
        child: list
    })
}

function NotificationsWindow(monitor = 0) {
    const list = Widget.Box({
        css: "min-width: 2px; min-height: 2px;",
        class_name: "notifications",
        vertical: true,
        children: notifications.bind('notifications').as(nots => {
            let cs = [];
            for (let n of nots) {
                cs.push(Notification(n, true));
            }
            return cs;
        })
    })
    return Widget.Window({
        monitor,
        name: `notifications${monitor}`,
        class_name: "notifications-window",
        anchor: ["top", "right"],
        visible: false,
        child: list,
    })
}

function Notifications() {
    const notifications_window = NotificationsWindow();
    const label = Widget.Label({
        //label: notifications.bind('notifications').as(n => `${n.length} `)
        label: notifications.bind('notifications').as(n => {
            if (n.length > 0) {
                label.class_name = "notifications-exist";
                return ` ${n.length}`;
            } else {
                label.class_name = "notifications-empty";
                return " ";
            }
        })
    });
 
    return Widget.Button({
        class_name: "notifications",
        child: label,
        on_secondary_click: () => notifications.clear(),
        on_clicked: () => {
            notifications_window.visible = !notifications_window.visible;
        }
    })
}

// layout of the bar
function Left() {
    return Widget.Box({
        spacing: 6,
        setup(self) {
            self.pack_start(Workspaces(), false, false, 0);
            self.pack_start(SubMap(), false, false, 0);
            self.pack_start(ClientTitle(), false, false, 0);
            self.pack_end(MediaPlayerBox(), false, false, 0);
        }
    })
}

function Right() {
    return Widget.Box({
        spacing: 6,
        setup(self) {
            self.pack_start(PackageUpdates(), false, false, 0);
            self.pack_start(IdleInhibitor(), false, false, 0);
            self.pack_start(KeyboardLayout(), false, false, 0);
            self.pack_end(SysTray(), false, false, 0);
            self.pack_end(Notifications(), false, false, 0);
            self.pack_end(MicrophoneIndicator(), false, false, 0);
            self.pack_end(SpeakerIndicator(), false, false, 0);
            self.pack_end(NetworkIndicator(), false, false, 0);
            self.pack_end(GpuGraph(), false, false, 0);
            self.pack_end(MemGraph(), false, false, 0);
            self.pack_end(CpuGraph(), false, false, 0);
            self.pack_end(Screenshot(), false, false, 0);
            self.pack_end(Weather(1200000), false, false, 0);
        }
    })
}
function Bar(monitor = 0) {
    if (monitor == 0) {
        return Widget.Window({
            name: `bar-${monitor}`, // name has to be unique
            class_name: "bar",
            monitor,
            anchor: ["top", "left", "right"],
            exclusivity: "exclusive",
            layer: "top",
            child: Widget.Box({
                setup(self) {
                    self.pack_start(Left(), true, true, 0);
                    self.pack_end(Right(), true, true, 0);
                    self.set_center_widget(Clock(monitor));
                },
            }),
        });
    } else {
        return Widget.Window({
            name: `bar-${monitor}`, // name has to be unique
            class_name: "bar",
            monitor,
            anchor: ["top", "left", "right"],
            exclusivity: "exclusive",
            layer: "top",
            child: Widget.CenterBox({
                start_widget: Workspaces(),
                center_widget: Clock(monitor),
            }),
        });
    }
}

App.config({
    style: "./style.css",
    windows: [
        NotificationPopups(),
        Bar(0),
        Bar(1)
    ],
})

export { }
