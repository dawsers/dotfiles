import Gio from 'gi://Gio';
const notifications = await Service.import("notifications");
notifications.popupTimeout = 3000;

/*
 * Manage calendar data like holidays, birthdays, etc.
 * Data should be located in a directory passed to the constructor
 * in text files (.txt). CalendarData will read every text file, creating a
 * "class_name" equal to the name of the file for the events contained in it
 * The format of the files is very simple:
 *   '#' At the beginning of a line ignores that line
 *   Any other line is read, split by `,`, and the parsed like this:
 *   There MUST be 6 elements per record.
 *     - BEGIN_DATE(YYYY,MM,DD),REPEAT,COMPUTE,DESCRIPTION
 *     - BEGIN_DATE: (YYYY,MM,DD) Date from which the day will be marked
 *     - REPEAT: 0|1. Repeat the date from then on.
 *     - COMPUTE: 0|1. Personalize message with difference TODAY-BEGIN_DATE (birthdays, anniversaries)
 *     - DESCRIPTION: Anything after the last ','. Of couse it cannot contain commas, or anything after one will be ignored 
 */

class CalendarData {
    database = {}; // contains one element per file, so they can be updated by the file monitor

    constructor(calendar, directory) {
        const cwd = Gio.File.new_for_path(directory);

        const files = cwd.enumerate_children('standard::*', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);

        for (let fileinfo of files) {
            const file = files.get_child(fileinfo);
            this._parse(file.get_basename(), Utils.readFile(file));
        }
        
        const monitor = Utils.monitorFile(directory, (file, _event) => {
            this._parse(file.get_basename(), Utils.readFile(file));
            calendar.update_ui();
        });
    }
    get_data_for_day(year, month, day) {
        let results = [];
        // Try naive first
        for (let event_type in this.database) {
            for (let event of this.database[event_type]) {
                const [y, m, d, repeat, compute, desc] = event;
                if (repeat == 0) {
                    // No REPEAT
                    if (y != year || m != month || d != day)
                        continue;
                } else {
                    if (m != month || d != day)
                        continue;
                }
                let result = event_type + ": ";
                if (compute) {
                    result += `${year - y} `;
                }
                result += desc;
                results.push([event_type, result]);
            }
        }
        return results;
    }

    _parse(name, contents) {
        let records = [];
        let file = contents.split('\n');
        for (let line of file) {
            if (line.startsWith("#"))
                continue;
            let record = line.split(',');
            if (record.length != 6) {
                // invalid record
                continue;
            }
            records.push([
                parseInt(record[0]), parseInt(record[1] - 1), parseInt(record[2]),
                parseInt(record[3]), parseInt(record[4]), record[5]
            ]);
        }
        this.database[name.split('.')[0]] = records;
    }
}

export class CalendarOptions {
    constructor(options = null) {
        if (options) {
            this.startDate = options.startDate || Date;
            this.startYear = options.startYear || 1970;
            this.numberMonthsDisplayed = options.numberMonthsDisplayed || 12;
            this.minDate = options.minDate || null;
            this.maxDate = options.maxDate || null;
            this.language = options.language || "en";
            this.displayWeekNumber = options.displayWeekNumber || false;
            this.weekStart = options.weekStart || 1;
            this.calendarDataDir = options.calendarDataDir || ".config/ags/calendar";
        } else {
            this.startDate = new Date();
            this.startYear = 1970;
            this.numberMonthsDisplayed = 12;
            this.minDate = null;
            this.maxDate = null;
            this.language = "en";
            this.displayWeekNumber = false;
            this.weekStart = 1;
            this.calendarDataDir = ".config/ags/calendar";
        }
    }
}

/**
 * Calendar instance.
 */
export class Calendar {
	options;
    monitor;
	_startDate;

    static notification_sent = false;

	static locales = {
		en: {
			days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
			daysShort: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
			daysMin: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
			months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
			monthsShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
			weekShort: 'W',
			weekStart:0
		}
	};

	static colors = ['#2C8FC9', '#9CB703', '#F5BB00', '#FF4A32', '#B56CE2', '#45A597'];

	
	/**
	 * Create a new calendar.
	 * @param element The element (or the selector to an element) in which the calendar should be created.
	 * @param options [Optional] The options used to customize the calendar
	 */
	constructor(monitor, options) {
		if (!options) {
			options = new CalendarOptions();
		}
        this.options = options;
        this.monitor = monitor;

		let startYear = new Date().getFullYear();
		let startMonth = 0;

		if (this.options.startDate) {
			startYear = this.options.startDate.getFullYear();
			startMonth = this.options.startDate.getMonth();
		}
		else if (this.options.startYear) {
			startYear = this.options.startYear;
		}
        this.data = new CalendarData(this, this.options.calendarDataDir);

		this.setStartDate(new Date(startYear, startMonth, 1));

        //this._create_ui();
	}
	
    get_ui() {
        return this.window;
    }

    toggle_visibility() {
        this.window.visible = !this.window.visible;
    }

    update_ui() {
        this._create_ui();
    }

	/**
     * Renders the calendar.
     */
	_create_ui() {
        // Window is invisible by default
        let visible = false;
        if (this.window) {
            // but inherits visibility in case one existed previously
            // and we are just re-creating the UI
            visible = this.window.visible;
            this.window.destroy();
        }
	    this.window = Widget.Window({
            monitor: this.monitor,
            name: "Calendar",
            anchor: [ "top" ],
            visible: visible,
            child: Widget.Box({
                class_name: "calendar",
                vertical: true,
                children: [
                    this._renderHeader(),
                    this._renderBody()
                ]
            })
        });
	}

	_renderHeader() {
        const header_table = Widget.Box({
            homogeneous: true,
        });
        header_table.class_name = 'calendar-header';
		
		const period = this.getCurrentPeriod();
		
		// Left arrow
		const prev_div = Widget.Button({
            class_name: 'prev',
            child:  Widget.Label({
                label: "‹"
            }),
            on_clicked: () => {
                this.setYear(this.getYear() - 1);
            }
        });
		
		if (this.options.minDate != null && this.options.minDate >= period.startDate) {
			prev_div.visible = false; // ('disabled');
		}
		
		header_table.pack_start(prev_div, false, false, 0);
		
		if (this._isFullYearMode()) {
			// Year N-2
			const prev2year_div = Widget.Button({
                class_name: 'year-title',
                child: Widget.Label({
                    label: (this._startDate.getFullYear() - 2).toString()
                }),
                on_clicked: () => {
                    this.setYear(this._startDate.getFullYear() - 2);
                }
            });
			
			if (this.options.minDate != null && this.options.minDate > new Date(this._startDate.getFullYear() - 2, 11, 31)) {
				prev2year_div.visible = false; //('disabled');
			}
			header_table.pack_start(prev2year_div, false, false, 0);
			
			// Year N-1
			const prevyear_div = Widget.Button({
                class_name: 'year-title',
                child: Widget.Label({
                    label: (this._startDate.getFullYear() - 1).toString()
                }),
                on_clicked: () => {
                    this.setYear(this._startDate.getFullYear() - 1);
                }
            });
			
			if (this.options.minDate != null && this.options.minDate > new Date(this._startDate.getFullYear() - 1, 11, 31)) {
				prevyear_div.visible = false; //('disabled');
			}
			header_table.pack_start(prevyear_div, false, false, 0);
		}
		
		// Current year
		const year_div = Widget.Label({
            class_name: 'year-title-current',
        });

		if (this._isFullYearMode()) {
			year_div.label = this._startDate.getFullYear().toString();
		} else if (this.options.numberMonthsDisplayed == 12) {
			year_div.label = `${period.startDate.getFullYear()} - ${(period.endDate.getFullYear())}`;
		} else if (this.options.numberMonthsDisplayed > 1) {
			year_div.label = `${Calendar.locales[this.options.language].months[period.startDate.getMonth()]} ${period.startDate.getFullYear()} - ${Calendar.locales[this.options.language].months[period.endDate.getMonth()]} ${period.endDate.getFullYear()}`;
		} else {
			year_div.label = `${Calendar.locales[this.options.language].months[period.startDate.getMonth()]} ${period.startDate.getFullYear()}`;
		}
		
		header_table.pack_start(year_div, false, false, 0);

		if (this._isFullYearMode()) {
			// Year N+1
			const nextyear_div = Widget.Button({
                class_name: 'year-title',
                child:  Widget.Label({
                    label: (this._startDate.getFullYear() + 1).toString()
                }),
                on_clicked: () => {
                    this.setYear(this._startDate.getFullYear() + 1);
                }
            });
			
			if (this.options.minDate != null && this.options.minDate > new Date(this._startDate.getFullYear() + 1, 0, 1)) {
				nextyear_div.visible = false; //('disabled');
			}
			header_table.pack_start(nextyear_div, false, false, 0);

			// Year N+2
			const next2year_div = Widget.Button({
                class_name: 'year-title',
                child: Widget.Label({
                    label: (this._startDate.getFullYear() + 2).toString()
                }),
                on_clicked: () => {
                    this.setYear(this._startDate.getFullYear() + 2);
                }
            });
			
			if (this.options.minDate != null && this.options.minDate > new Date(this._startDate.getFullYear() + 2, 0, 1)) {
				next2year_div.visible = false; //('disabled');
			}
			header_table.pack_start(next2year_div, false, false, 0);
		}
 
		// Right arrow
		const next_div = Widget.Button({
            class_name: 'next',
            child:  Widget.Label({
                label: "›"
            }),
            on_clicked: () => {
                this.setYear(this.getYear() + 1);
            }
        });
		
		if (this.options.maxDate != null && this.options.maxDate <= period.endDate) {
			next_div.visible = false; // ('disabled');
		}
		
		header_table.pack_start(next_div, false, false, 0);

        return header_table;
	}

	_renderBody() {
        const today = new Date();
        const today_d = today.getDate();
        const today_m = today.getMonth();
        const today_y = today.getFullYear();

        const months_div = Widget.FlowBox({
            class_name: 'months-container',
            setup(self) {
                self.set_selection_mode(0/*Gtk.SelectionMode.NONE*/);
                self.set_column_spacing(8);
                self.set_row_spacing(8);
                self.set_min_children_per_line(3);
                self.set_max_children_per_line(4);
            }
        });

		let monthStartDate = new Date(this._startDate.getTime());
		
		for (let m = 0; m < this.options.numberMonthsDisplayed; ++m) {
			/* Container */
			const month_div = Widget.Box({
                vertical: true,
                class_name: 'month-container',
                attribute: m.toString(),
            })

			
			/* Month header */
			const thead = Widget.Box({
                vertical: true
            });
			
			const title_row = Widget.Label({
                class_name: 'month-title',
                label: Calendar.locales[this.options.language].months[monthStartDate.getMonth()]
            });
			
			thead.pack_start(title_row, false, false, 0);
			
            const header_row = Widget.Box({
                class_name: 'day-header',
                spacing: 2,
                homogeneous: true,
            });
			
			if (this.options.displayWeekNumber) {
                const week_number_cell = Widget.Label({
                    class_name: 'week-number',
                    label: Calendar.locales[this.options.language].weekShort
                })
				header_row.pack_start(week_number_cell, false, false, 0);
			}
			
			let weekStart = this.getWeekStart();
			let d = weekStart;
			do {
				const header_cell = Widget.Label({
                    class_name: 'day-names',
                    label: Calendar.locales[this.options.language].daysShort[d]
                });
				
				header_row.pack_start(header_cell, false, false, 0);
				
				d++;
				if (d >= 7)
					d = 0;
			} while (d != weekStart)
			
			thead.pack_start(header_row, false, false, 0);
			month_div.pack_start(thead, false, false, 0);
			
			/* Days */
			var currentDate = new Date(monthStartDate.getTime());
			var lastDate = new Date(monthStartDate.getFullYear(), monthStartDate.getMonth() + 1, 0);
			
			while (currentDate.getDay() != weekStart)
			{
				currentDate.setDate(currentDate.getDate() - 1);
			}
			
			while (currentDate <= lastDate)
			{
				var row = Widget.Box({
                    spacing: 2,
                    homogeneous: true,
                });
				
				if (this.options.displayWeekNumber) {
					const week_number_cell = Widget.Label({
                        class_name: 'week-number'
                    });
					var currentThursday = new Date(currentDate.getTime()); // Week number is computed based on the thursday
					currentThursday.setDate(currentThursday.getDate() - weekStart + 4);
					week_number_cell.label = this.getWeekNumber(currentThursday).toString();
					row.pack_start(week_number_cell, false, false, 0);
				}
			
				do {
					const cell = Widget.Label();
					if (currentDate < monthStartDate) {
						cell.class_name = 'day-old';
					} else if (currentDate > lastDate) {
						cell.class_name = 'day-new';
					} else {
                        // Get calendar data
                        const [ day_y, day_m, day_d ] = [ currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() ];
                        const day_data = this.data.get_data_for_day(day_y, day_m, day_d);
                        let class_names = [];
                        if (day_data.length > 0) {
                            let tooltip = ""
                            for (let event of day_data) {
                                class_names.push("day-" + event[0]);
                                tooltip += event[1] + "\n";
                            }
                            cell.tooltip_text = tooltip.trimEnd();
                        }

                        // Today is special!
                        if (currentDate.getDate() == today_d &&
                            currentDate.getMonth() == today_m &&
                            currentDate.getFullYear() == today_y) {
                            class_names.push('day-today');
                            if (Calendar.notification_sent == false) {
                                Calendar.notification_sent = true;
                                if (day_data.length > 0) {
                                    // Try to load the notifications service so
                                    // libnotify doesn't start dunst
                                    notifications.clear();
                                    Utils.notify({
                                        summary: "Today's Events",
                                        iconName: "info-symbolic",
                                        body: `${cell.tooltip_text}`,
                                    });
                                }
                            }
                        } else {
                            const dow = currentDate.getDay();
                            if (dow == 0) {
                                // sunday
                                class_names.push('day-sunday');
                            } else if (dow == 6) {
                                // saturday
                                class_names.push('day-saturday');
                            } else {
                                class_names.push('day-weekday');
                            }
                        }
                        cell.class_names = class_names;
						cell.label = currentDate.getDate().toString();
					}
					
					row.pack_start(cell, false, false, 0);
					
					currentDate.setDate(currentDate.getDate() + 1);
				} while (currentDate.getDay() != weekStart)
				
			    month_div.pack_start(row, false, false, 0);
			}
			
			months_div.add(month_div);

			monthStartDate.setMonth(monthStartDate.getMonth() + 1);
		}
		
		return months_div;
	}

	_isFullYearMode() {
		return this._startDate.getMonth() == 0 && this.options.numberMonthsDisplayed == 12;
	}

	/**
     * Gets the week number for a specified date.
     *
     * @param date The specified date.
     */
	getWeekNumber(date) {
		// Algorithm from https://weeknumber.net/how-to/javascript
		const workingDate = new Date(date.getTime());
		workingDate.setHours(0, 0, 0, 0);
		// Thursday in current week decides the year.
		workingDate.setDate(workingDate.getDate() + 3 - (workingDate.getDay() + 6) % 7);
		// January 4 is always in week 1.
		const week1 = new Date(workingDate.getFullYear(), 0, 4);
		// Adjust to Thursday in week 1 and count number of weeks from date to week1.
		return 1 + Math.round(((workingDate.getTime() - week1.getTime()) / 86400000
			- 3 + (week1.getDay() + 6) % 7) / 7);
	}


	/**
     * Gets the period displayed on the calendar.
     */
	getCurrentPeriod() {
		const startDate = new Date(this._startDate.getTime());
		const endDate = new Date(this._startDate.getTime());
		endDate.setMonth(endDate.getMonth() + this.options.numberMonthsDisplayed);
		endDate.setTime(endDate.getTime() - 1);

		return { startDate, endDate };
	}

	/**
     * Gets the year displayed on the calendar.
	 * If the calendar is not used in a full year configuration, this will return the year of the first date displayed in the calendar.
     */
	getYear() {
        return this._startDate.getFullYear();
	}

	/**
     * Sets the year displayed on the calendar.
	 * If the calendar is not used in a full year configuration, this will set the start date to January 1st of the given year.
     *
     * @param year The year to displayed on the calendar.
     */
	setYear(year) {
		if (!isNaN(year)) {
			this.setStartDate(new Date(year, 0 , 1));
		}
	}

	/**
     * Gets the first date displayed on the calendar.
     */
	getStartDate() {
		return this._startDate;
	}

	/**
     * Sets the first date that should be displayed on the calendar.
     *
     * @param startDate The first date that should be displayed on the calendar.
     */
	setStartDate(startDate) {
		if (startDate instanceof Date) {
			this.options.startDate = startDate;
			this._startDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
							
			this._create_ui();
		}
	}

	/**
     * Gets the number of months displayed by the calendar.
     */
	getNumberMonthsDisplayed() {
		return this.options.numberMonthsDisplayed;
	}

	/**
     * Sets the number of months displayed that should be displayed by the calendar.
	 * 
	 * This method causes a refresh of the calendar.
     *
     * @param numberMonthsDisplayed Number of months that should be displayed by the calendar.
	 * @param preventRedering Indicates whether the rendering should be prevented after the property update.
     */
	setNumberMonthsDisplayed(numberMonthsDisplayed) {
		if (!isNaN(numberMonthsDisplayed) && numberMonthsDisplayed > 0 && numberMonthsDisplayed <= 12) {
			this.options.numberMonthsDisplayed = numberMonthsDisplayed;
            this._create_ui();
		}
	}

	/**
     * Gets the minimum date of the calendar.
     */
	getMinDate() {
		return this.options.minDate;
	}

	/**
     * Sets the minimum date of the calendar.
	 * 
	 * This method causes a refresh of the calendar.
     *
     * @param minDate The minimum date to set.
	 * @param preventRedering Indicates whether the rendering should be prevented after the property update.
     */
    setMinDate(date) {
		if (date instanceof Date || date === null) {
			this.options.minDate = date;
			
            this._create_ui();
		}
	}

	/**
     * Gets the maximum date of the calendar.
     */
	getMaxDate() {
		return this.options.maxDate;
	}

	/**
     * Sets the maximum date of the calendar. 
	 * 
	 * This method causes a refresh of the calendar.
     *
     * @param maxDate The maximum date to set.
	 * @param preventRedering Indicates whether the rendering should be prevented after the property update.
     */
    setMaxDate(date) {
		if (date instanceof Date || date === null) {
			this.options.maxDate = date;
			
            this._create_ui();
		}
	}

	/**
     * Gets a value indicating whether the weeks number are displayed.
     */
	getDisplayWeekNumber() {
		return this.options.displayWeekNumber;
	}

	/**
     * Sets a value indicating whether the weeks number are displayed.
	 * 
	 * This method causes a refresh of the calendar.
     *
     * @param  displayWeekNumber Indicates whether the weeks number are displayed.
	 * @param preventRedering Indicates whether the rendering should be prevented after the property update.
     */
    setDisplayWeekNumber(displayWeekNumber) {
		this.options.displayWeekNumber = displayWeekNumber;
		
        this._create_ui();
	}

	/**
     * Gets the language used for calendar rendering.
     */
	getLanguage() {
		return this.options.language;
	}

	/**
     * Sets the language used for calendar rendering.
	 * 
	 * This method causes a refresh of the calendar.
     *
     * @param language The language to use for calendar redering.
	 * @param preventRedering Indicates whether the rendering should be prevented after the property update.
     */
	setLanguage(language) {
		if (language != null && Calendar.locales[language] != null) {
			this.options.language = language;
			
            this._create_ui();
		}
	}

	/**
     * Gets the starting day of the week.
     */
	getWeekStart() {
		return this.options.weekStart !== null ? this.options.weekStart : Calendar.locales[this.options.language].weekStart;
	}

	/**
     * Sets the starting day of the week.
	 * 
	 * This method causes a refresh of the calendar.
     *
     * @param weekStart The starting day of the week. This option overrides the parameter define in the language file.
     * @param preventRedering Indicates whether the rendering should be prevented after the property update.
     */
    setWeekStart(weekStart) {
		this.options.weekStart = !isNaN(weekStart) ? weekStart : null;

        this._create_ui();
	}
}
