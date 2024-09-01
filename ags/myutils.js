import GLib from 'gi://GLib';

export function interval(interval, callback, bind) {
    callback();
    const source = GLib.timeout_source_new(interval);
    source.set_priority(GLib.PRIORITY_DEFAULT);
    source.set_callback(() => {
        callback();
        return GLib.SOURCE_CONTINUE;
    });
    const id = source.attach(null);
    if (bind)
        bind.connect('destroy', () => GLib.source_remove(id));

    return source;
}

export function reset_interval(source) {
    source.set_ready_time(0);
}
