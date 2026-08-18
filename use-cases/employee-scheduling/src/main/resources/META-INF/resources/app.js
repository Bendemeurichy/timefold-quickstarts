let autoRefreshIntervalId = null;
const zoomMin = 2 * 1000 * 60 * 60 * 24 // 2 days in milliseconds
const zoomMax = 4 * 7 * 1000 * 60 * 60 * 24 // 4 weeks in milliseconds

const UNAVAILABLE_COLOR = '#ef2929' // Tango Scarlet Red
const UNDESIRED_COLOR = '#f57900' // Tango Orange
const DESIRED_COLOR = '#73d216' // Tango Chameleon

let scheduleId = null;
let loadedSchedule = null;

const byEmployeePanel = document.getElementById("byEmployeePanel");
const byEmployeeTimelineOptions = {
    timeAxis: {scale: "hour", step: 6},
    orientation: {axis: "top"},
    stack: false,
    xss: {disabled: true}, // Items are XSS safe through JQuery
    zoomMin: zoomMin,
    zoomMax: zoomMax,
};
let byEmployeeGroupDataSet = new vis.DataSet();
let byEmployeeItemDataSet = new vis.DataSet();
let byEmployeeTimeline = new vis.Timeline(byEmployeePanel, byEmployeeItemDataSet, byEmployeeGroupDataSet, byEmployeeTimelineOptions);

$(document).ready(function () {
    $("#solveButton").click(function () {
        solve();
    });
    $("#stopSolvingButton").click(function () {
        stopSolving();
    });
    $("#printButton").click(function () {
        window.print();
    });
    $("#editDataButton").click(function () {
        openDataEditor();
    });
    $("#generateDataButton").click(function () {
        generateDataFromEditor();
    });
    // HACK to allow vis-timeline to work within Bootstrap tabs
    $("#byEmployeeTab").on('shown.bs.tab', function (event) {
        byEmployeeTimeline.redraw();
    })

    setupAjax();
    loadedSchedule = generateScheduleFromConfig(scheduleConfig);
    renderSchedule(loadedSchedule);
});

function setupAjax() {
    $.ajaxSetup({
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json,text/plain', // plain text is required by solve() returning UUID of the solver job
        }
    });
    // Extend jQuery to support $.delete()
    jQuery.each(["delete"], function (i, method) {
        jQuery[method] = function (url, data, callback, type) {
            if (jQuery.isFunction(data)) {
                type = type || callback;
                callback = data;
                data = undefined;
            }
            return jQuery.ajax({
                url: url,
                type: method,
                dataType: type,
                data: data,
                success: callback
            });
        };
    });
}

function overlapsUnavailablePeriod(shift, employee) {
    const shiftStart = JSJoda.LocalDateTime.parse(shift.start);
    const shiftEnd = JSJoda.LocalDateTime.parse(shift.end);
    return (employee.unavailablePeriods || []).some(period => {
        const periodStart = JSJoda.LocalDate.parse(period.date).atTime(JSJoda.LocalTime.parse(period.from));
        const periodEnd = JSJoda.LocalDate.parse(period.date).atTime(JSJoda.LocalTime.parse(period.to));
        return shiftStart.isBefore(periodEnd) && shiftEnd.isAfter(periodStart);
    });
}

function getShiftColor(shift, employee) {
    const shiftStart = JSJoda.LocalDateTime.parse(shift.start);
    const shiftStartDateString = shiftStart.toLocalDate().toString();
    const shiftEnd = JSJoda.LocalDateTime.parse(shift.end);
    const shiftEndDateString = shiftEnd.toLocalDate().toString();
    if (employee.unavailableDates.includes(shiftStartDateString) ||
        overlapsUnavailablePeriod(shift, employee) ||
        // The contains() check is ignored for a shift end at midnight (00:00:00).
        (shiftEnd.isAfter(shiftStart.toLocalDate().plusDays(1).atStartOfDay()) &&
            employee.unavailableDates.includes(shiftEndDateString))) {
        return UNAVAILABLE_COLOR
    } else if (employee.undesiredDates.includes(shiftStartDateString) ||
        // The contains() check is ignored for a shift end at midnight (00:00:00).
        (shiftEnd.isAfter(shiftStart.toLocalDate().plusDays(1).atStartOfDay()) &&
            employee.undesiredDates.includes(shiftEndDateString))) {
        return UNDESIRED_COLOR
    } else if (employee.desiredDates.includes(shiftStartDateString) ||
        // The contains() check is ignored for a shift end at midnight (00:00:00).
        (shiftEnd.isAfter(shiftStart.toLocalDate().plusDays(1).atStartOfDay()) &&
            employee.desiredDates.includes(shiftEndDateString))) {
        return DESIRED_COLOR
    } else {
        return "#729fcf"; // Tango Sky Blue
    }
}

function refreshSchedule() {
    if (scheduleId === null) {
        if (loadedSchedule != null) {
            renderSchedule(loadedSchedule);
        }
        return;
    }
    $.getJSON("/schedules/" + scheduleId, function (schedule) {
        loadedSchedule = schedule;
        renderSchedule(schedule);
    })
        .fail(function (xhr, ajaxOptions, thrownError) {
            showError("Ophalen van het rooster is mislukt.", xhr);
            refreshSolvingButtons(false);
        });
}

function renderSchedule(schedule) {
    refreshSolvingButtons(schedule.solverStatus != null && schedule.solverStatus !== "NOT_SOLVING");
    $("#score").text("Score: " + (schedule.score == null ? "?" : schedule.score));

    renderRoster(schedule);

    byEmployeeGroupDataSet.clear();
    byEmployeeItemDataSet.clear();

    schedule.employees.forEach((employee, index) => {
        const employeeGroupElement = $('<div class="card-body p-2"/>')
            .append($(`<h5 class="card-title mb-2"/>)`)
                .append(employee.name))
            .append($('<div/>')
                .append($(employee.skills.map(skill => `<span class="badge me-1 mt-1" style="background-color:#d3d7cf">${skill}</span>`).join(''))));
        if (employee.classroom != null) {
            employeeGroupElement.append($('<div/>')
                .append($(`<span class="badge me-1 mt-1" style="background-color:#868e96">Klas ${employee.classroom}</span>`)));
        }
        byEmployeeGroupDataSet.add({id: employee.name, content: employeeGroupElement.html()});

        employee.unavailableDates.forEach((rawDate, dateIndex) => {
            const date = JSJoda.LocalDate.parse(rawDate)
            const start = date.atStartOfDay().toString();
            const end = date.plusDays(1).atStartOfDay().toString();
            const byEmployeeShiftElement = $(`<div/>`)
                .append($(`<h5 class="card-title mb-1"/>`).text("Niet beschikbaar"));
            byEmployeeItemDataSet.add({
                id: "employee-" + index + "-unavailability-" + dateIndex, group: employee.name,
                content: byEmployeeShiftElement.html(),
                start: start, end: end,
                type: "background",
                style: "opacity: 0.5; background-color: " + UNAVAILABLE_COLOR,
            });
        });
        (employee.unavailablePeriods || []).forEach((period, periodIndex) => {
            const byEmployeeShiftElement = $(`<div/>`)
                .append($(`<h5 class="card-title mb-1"/>`).text("Niet beschikbaar"));
            byEmployeeItemDataSet.add({
                id: "employee-" + index + "-unavailable-period-" + periodIndex, group: employee.name,
                content: byEmployeeShiftElement.html(),
                start: period.date + "T" + period.from, end: period.date + "T" + period.to,
                type: "background",
                style: "opacity: 0.5; background-color: " + UNAVAILABLE_COLOR,
            });
        });
        employee.undesiredDates.forEach((rawDate, dateIndex) => {
            const date = JSJoda.LocalDate.parse(rawDate)
            const start = date.atStartOfDay().toString();
            const end = date.plusDays(1).atStartOfDay().toString();
            const byEmployeeShiftElement = $(`<div/>`)
                .append($(`<h5 class="card-title mb-1"/>`).text("Liever niet"));
            byEmployeeItemDataSet.add({
                id: "employee-" + index + "-undesired-" + dateIndex, group: employee.name,
                content: byEmployeeShiftElement.html(),
                start: start, end: end,
                type: "background",
                style: "opacity: 0.5; background-color: " + UNDESIRED_COLOR,
            });
        });
        employee.desiredDates.forEach((rawDate, dateIndex) => {
            const date = JSJoda.LocalDate.parse(rawDate)
            const start = date.atStartOfDay().toString();
            const end = date.plusDays(1).atStartOfDay().toString();
            const byEmployeeShiftElement = $(`<div/>`)
                .append($(`<h5 class="card-title mb-1"/>`).text("Voorkeur"));
            byEmployeeItemDataSet.add({
                id: "employee-" + index + "-desired-" + dateIndex, group: employee.name,
                content: byEmployeeShiftElement.html(),
                start: start, end: end,
                type: "background",
                style: "opacity: 0.5; background-color: " + DESIRED_COLOR,
            });
        });
    });

    schedule.shifts.forEach((shift, index) => {
        if (shift.employee == null) {
            return; // Unassigned shifts are shown as "Unassigned" chips on the week roster.
        }
        const skillColor = (shift.employee.skills.indexOf(shift.requiredSkill) === -1 ? '#ef2929' : '#8ae234');
        const byEmployeeShiftElement = $('<div class="card-body p-2"/>')
            .append($(`<h5 class="card-title mb-2"/>)`)
                .append(shift.location))
            .append($('<div/>')
                .append($(`<span class="badge me-1 mt-1" style="background-color:${skillColor}">${shift.requiredSkill}</span>`))
                .append($((shift.classrooms || []).map(classroom =>
                    `<span class="badge me-1 mt-1" style="background-color:#868e96">Klas ${classroom}</span>`).join(''))));

        const shiftColor = getShiftColor(shift, shift.employee);
        byEmployeeItemDataSet.add({
            id: 'shift-' + index, group: shift.employee.name,
            content: byEmployeeShiftElement.html(),
            start: shift.start, end: shift.end,
            style: "background-color: " + shiftColor
        });
    });

    $("#info").text(`Deze gegevens bevatten ${schedule.shifts.length} diensten en ${schedule.employees.length} leerkrachten.`);

    if (schedule.shifts.length > 0) {
        // Show only the first 7 days
        const scheduleStart = schedule.shifts.map(shift => JSJoda.LocalDateTime.parse(shift.start).toLocalDate()).sort()[0].toString();
        const scheduleEnd = JSJoda.LocalDate.parse(scheduleStart).plusDays(7).toString();
        byEmployeeTimeline.setWindow(scheduleStart, scheduleEnd);
    }
}

const ROSTER_DAY_NAMES = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag"];
const ROSTER_MONTH_NAMES = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

function formatRosterDate(date) {
    return date.dayOfMonth() + " " + ROSTER_MONTH_NAMES[date.monthValue() - 1];
}

function rosterChip(color, text, lightText) {
    return $("<span class=\"roster-chip\"/>")
        .css("background-color", color)
        .css("color", lightText ? "#fff" : "#212529")
        .text(text);
}

function renderRoster(schedule) {
    const roster = $("#rosterPanel");
    roster.children().remove();

    if (schedule.shifts.length === 0) {
        roster.text("Geen diensten in deze gegevens.");
        return;
    }

    // Legend
    const legend = $("<div class=\"d-flex align-items-center flex-wrap mb-3 roster-legend\"/>");
    legend.append($("<span class=\"me-1\"/>").text("Legende:"));
    legend.append(rosterChip("#729fcf", "Toezicht"));
    legend.append(rosterChip(DESIRED_COLOR, "Voorkeursdag"));
    legend.append(rosterChip(UNDESIRED_COLOR, "Liever niet"));
    legend.append(rosterChip(UNAVAILABLE_COLOR, "Niet beschikbaar", true));
    legend.append(rosterChip("#f4b6b6", "Niet toegewezen"));
    roster.append(legend);

    // One roster row per shift (same location, hour and classrooms)
    const rosterRows = [];
    schedule.shifts.forEach(shift => {
        const start = JSJoda.LocalDateTime.parse(shift.start).toLocalTime().toString();
        const end = JSJoda.LocalDateTime.parse(shift.end).toLocalTime().toString();
        const classrooms = shift.classrooms || [];
        const key = shift.location + "|" + start + "|" + end + "|" + classrooms.join(",");
        if (!rosterRows.some(row => row.key === key)) {
            rosterRows.push({key: key, location: shift.location, start: start, end: end, classrooms: classrooms});
        }
    });

    const shiftDays = [...new Set(schedule.shifts
        .map(shift => JSJoda.LocalDateTime.parse(shift.start).toLocalDate().toString()))].sort();
    const shiftDaySet = new Set(shiftDays);

    // Group the schedule into weeks, Monday to Friday
    const weekMondays = [...new Set(shiftDays.map(day => JSJoda.LocalDate.parse(day)
        .with(JSJoda.TemporalAdjusters.previousOrSame(JSJoda.DayOfWeek.MONDAY)).toString()))].sort();

    weekMondays.forEach(mondayString => {
        const monday = JSJoda.LocalDate.parse(mondayString);
        const weekDates = [];
        for (let i = 0; i < 5; i++) {
            weekDates.push(monday.plusDays(i));
        }

        const card = $("<div class=\"card roster-week mb-4 shadow-sm\"/>");
        card.append($("<div class=\"card-header fw-bold\"/>")
            .text(`Week van ${formatRosterDate(monday)} – ${formatRosterDate(monday.plusDays(4))}`));

        const table = $("<table class=\"table table-bordered roster-table mb-0\"/>");
        table.append($("<thead/>").append($("<tr/>")
            .append($("<th class=\"roster-location-header\"/>").text("Dienst"))
            .append(weekDates.map(date => $("<th class=\"text-center\"/>")
                .html(`${ROSTER_DAY_NAMES[date.dayOfWeek().value() - 1]}<br><small class=\"text-muted\">${formatRosterDate(date)}</small>`)))));

        const tbody = $("<tbody/>");
        rosterRows.forEach((rosterRow, rowIndex) => {
            const tr = $("<tr/>");
            const rowHeader = $("<th class=\"roster-location-cell align-middle\"/>");
            rowHeader.append($("<div/>").text(rosterRow.location));
            rowHeader.append($("<div class=\"small fw-normal text-muted\"/>")
                .text(`${rosterRow.start} – ${rosterRow.end}`));
            if (rosterRow.classrooms.length > 0) {
                rowHeader.append($("<div class=\"mt-1\"/>").append(rosterRow.classrooms.map(classroom =>
                    `<span class="badge me-1" style="background-color:#868e96">Klas ${classroom}</span>`).join("")));
            }
            tr.append(rowHeader);
            weekDates.forEach(date => {
                const dayString = date.toString();
                if (!shiftDaySet.has(dayString)) {
                    // A school day without shifts (for example Wednesday afternoon off):
                    // one merged "Geen toezicht" cell for all rows.
                    if (rowIndex === 0) {
                        tr.append($(`<td class="roster-no-lunch align-middle text-center" rowspan="${rosterRows.length}"/>`)
                            .append($("<span/>").text("Geen toezicht")));
                    }
                    return;
                }
                const td = $("<td class=\"roster-cell\"/>");
                schedule.shifts
                    .filter(shift => shift.start.startsWith(dayString)
                        && shift.location === rosterRow.location
                        && JSJoda.LocalDateTime.parse(shift.start).toLocalTime().toString() === rosterRow.start
                        && JSJoda.LocalDateTime.parse(shift.end).toLocalTime().toString() === rosterRow.end
                        && (shift.classrooms || []).join(",") === rosterRow.classrooms.join(","))
                    .forEach(shift => {
                        if (shift.employee == null) {
                            td.append(rosterChip("#f4b6b6", "Niet toegewezen"));
                        } else {
                            const color = getShiftColor(shift, shift.employee);
                            const chip = rosterChip(color, shift.employee.name, color === UNAVAILABLE_COLOR);
                            if (shift.employee.classroom != null) {
                                chip.attr("title", "Klas " + shift.employee.classroom);
                            }
                            td.append(chip);
                        }
                    });
                tr.append(td);
            });
            tbody.append(tr);
        });
        table.append(tbody);
        card.append(table);
        roster.append(card);
    });
}

// ---------- Editable break duty data ----------

const DAY_CHECKBOXES = [
    {value: 1, label: "ma"}, {value: 2, label: "di"}, {value: 3, label: "wo"},
    {value: 4, label: "do"}, {value: 5, label: "vr"}
];

let editDataModal = null;
let scheduleConfig = loadScheduleConfig();

function defaultScheduleConfig() {
    // A contract cycle with mostly full-time teachers and some part-time Mon/Wed/Fri or Tue/Thu.
    const patterns = [[1, 2, 3, 4, 5], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5], [1, 3, 5], [2, 4]];
    const classrooms = ["1A", "1B", "2A", "2B"];
    const names = ["Amy Cole", "Beth Fox", "Carl Green", "Dan Jones", "Elsa King", "Flo Li",
        "Gus Poe", "Hugo Rye", "Ivy Smith", "Jay Watt", "Amy Fox", "Beth Green"];
    return {
        weeks: 2,
        daysWithoutDuty: [3], // Wednesday
        // One shift per school day per entry: location, hour and the classrooms it supervises.
        shifts: [
            {location: "Speelplaats", start: "10:00", end: "10:30", classrooms: ["1A", "1B"]},
            {location: "Speelplaats", start: "10:00", end: "10:30", classrooms: ["2A", "2B"]},
            {location: "Refter", start: "12:00", end: "13:00", classrooms: ["1A", "1B"]},
            {location: "Refter", start: "12:00", end: "13:00", classrooms: ["2A", "2B"]},
            {location: "Speelplaats", start: "12:00", end: "13:00", classrooms: ["1A", "2A"]},
            {location: "Speelplaats", start: "12:00", end: "13:00", classrooms: ["1B", "2B"]},
            {location: "Speelplaats", start: "14:45", end: "15:15", classrooms: ["1A", "1B"]},
            {location: "Speelplaats", start: "14:45", end: "15:15", classrooms: ["2A", "2B"]}
        ],
        teachers: names.map((name, i) => ({
            name: name,
            workingDays: [...patterns[i % patterns.length]],
            classroom: classrooms[i % classrooms.length],
            exceptions: []
        }))
    };
}

function loadScheduleConfig() {
    try {
        const stored = localStorage.getItem("lunchDutyConfig");
        if (stored != null) {
            const config = JSON.parse(stored);
            if (Array.isArray(config.shifts) && Array.isArray(config.teachers)) {
                // Renamed in the break duty version
                if (!Array.isArray(config.daysWithoutDuty)) {
                    config.daysWithoutDuty = config.daysWithoutLunch || [3];
                }
                return config;
            }
        }
    } catch (e) {
        console.warn("Ignoring invalid stored config.", e);
    }
    return defaultScheduleConfig();
}

function openDataEditor() {
    renderDataEditor();
    if (editDataModal == null) {
        editDataModal = new bootstrap.Modal("#editDataModal");
    }
    editDataModal.show();
}

function dayCheckboxes(cssClass, checkedValues) {
    return DAY_CHECKBOXES.map(day => {
        const check = $("<div class=\"form-check form-check-inline mb-0\"/>");
        check.append($("<input class=\"form-check-input\" type=\"checkbox\"/>")
            .addClass(cssClass)
            .attr("value", day.value)
            .prop("checked", checkedValues.includes(day.value)));
        check.append($(`<label class="form-check-label small">${day.label}</label>`));
        return check;
    });
}

function exceptionRow(exception) {
    const row = $("<div class=\"d-flex gap-2 align-items-center flex-wrap mb-1 cfg-exception\"/>");
    const dateInput = $("<input type=\"date\" class=\"form-control cfg-exc-date\" style=\"max-width: 10.5rem\"/>")
        .val(exception.date || "");
    const typeSelect = $("<select class=\"form-select cfg-exc-type\" style=\"max-width: 12.5rem\">"
        + "<option value=\"unavailable\">Vrij (niet beschikbaar)</option>"
        + "<option value=\"undesired\">Liever niet</option>"
        + "<option value=\"desired\">Voorkeur</option>"
        + "</select>").val(exception.type || "unavailable");
    const fromInput = $("<input type=\"time\" class=\"form-control cfg-exc-from\" style=\"max-width: 6rem\" "
        + "title=\"Enkel voor vrij-uitzonderingen: begin van de niet-beschikbare periode. Leeg betekent de hele dag.\"/>")
        .val(exception.from || "");
    const toInput = $("<input type=\"time\" class=\"form-control cfg-exc-to\" style=\"max-width: 6rem\" "
        + "title=\"Enkel voor vrij-uitzonderingen: einde van de niet-beschikbare periode. Leeg betekent de hele dag.\"/>")
        .val(exception.to || "");
    const repeatsInput = $("<input type=\"number\" min=\"0\" max=\"52\" class=\"form-control cfg-exc-repeats\" style=\"max-width: 5rem\"/>")
        .val(exception.repeats || 0);
    const removeButton = $("<button type=\"button\" class=\"btn btn-outline-danger btn-sm\" title=\"Uitzondering verwijderen\">"
        + "<span class=\"fas fa-trash\"></span></button>");
    removeButton.click(() => row.remove());
    row.append($("<span class=\"small text-muted\">Op</span>"), dateInput, typeSelect,
        $("<span class=\"small text-muted\">van</span>"), fromInput,
        $("<span class=\"small text-muted\">tot</span>"), toInput,
        $("<span class=\"small text-muted\">herhaal wekelijks &times;</span>"), repeatsInput, removeButton);
    return row;
}

function teacherCard(teacher) {
    const card = $("<div class=\"card mb-2 cfg-teacher\"/>");
    const body = $("<div class=\"card-body p-2\"/>");

    const header = $("<div class=\"d-flex align-items-center gap-2 flex-wrap\"/>");
    header.append($("<input class=\"form-control cfg-teacher-name\" style=\"max-width: 12rem\" placeholder=\"Naam\"/>")
        .val(teacher.name));
    header.append($("<span class=\"small text-muted\">klas:</span>"));
    header.append($("<input class=\"form-control cfg-teacher-classroom\" list=\"cfgClassroomList\" "
        + "style=\"max-width: 7rem\" placeholder=\"bv. 1A\"/>").val(teacher.classroom || ""));
    header.append($("<span class=\"small text-muted\">werkt:</span>"));
    dayCheckboxes("cfg-working-day", teacher.workingDays).forEach(check => header.append(check));
    const removeButton = $("<button type=\"button\" class=\"btn btn-outline-danger btn-sm ms-auto\" title=\"Leerkracht verwijderen\">"
        + "<span class=\"fas fa-trash\"></span></button>");
    removeButton.click(() => card.remove());
    header.append(removeButton);

    const exceptions = $("<div class=\"cfg-exceptions mt-2\"/>");
    teacher.exceptions.forEach(exception => exceptions.append(exceptionRow(exception)));
    const addExceptionButton = $("<button type=\"button\" class=\"btn btn-outline-secondary btn-sm mt-1\">"
        + "<span class=\"fas fa-plus\"></span> Vrij-uitzondering</button>");
    addExceptionButton.click(() => exceptions.append(exceptionRow({date: "", type: "unavailable", repeats: 0})));

    body.append(header, exceptions, addExceptionButton);
    card.append(body);
    return card;
}

function shiftRow(shiftDef) {
    const row = $("<tr/>");
    row.append($("<td/>").append($("<input class=\"form-control cfg-shift-location\" placeholder=\"bv. Refter\"/>")
        .val(shiftDef.location)));
    row.append($("<td/>").append($("<input type=\"time\" class=\"form-control cfg-shift-start\"/>")
        .val(shiftDef.start)));
    row.append($("<td/>").append($("<input type=\"time\" class=\"form-control cfg-shift-end\"/>")
        .val(shiftDef.end)));
    row.append($("<td/>").append($("<input class=\"form-control cfg-shift-classrooms\" placeholder=\"bv. 1A, 1B\"/>")
        .val((shiftDef.classrooms || []).join(", "))));
    const removeButton = $("<button type=\"button\" class=\"btn btn-outline-danger btn-sm\" title=\"Dienst verwijderen\">"
        + "<span class=\"fas fa-trash\"></span></button>");
    removeButton.click(() => row.remove());
    row.append($("<td/>").append(removeButton));
    return row;
}

function renderDataEditor() {
    const body = $("#editDataModalContent");
    body.children().remove();
    const config = scheduleConfig;

    // Schedule settings
    const settings = $("<div class=\"card mb-3\"/>").append($("<div class=\"card-body\"/>"));
    const settingsRow = $("<div class=\"d-flex align-items-end gap-3 flex-wrap\"/>");
    settingsRow.append($("<div/>")
        .append($("<label class=\"form-label\"/>").text("Weken"))
        .append($("<input id=\"cfgWeeks\" type=\"number\" min=\"1\" max=\"8\" class=\"form-control\" style=\"max-width: 6rem\"/>")
            .val(config.weeks)));
    const noDuty = $("<div id=\"cfgDaysWithoutDuty\"/>")
        .append($("<label class=\"form-label d-block\"/>").text("Geen toezicht op"));
    dayCheckboxes("cfg-no-duty-day", config.daysWithoutDuty).forEach(check => noDuty.append(check));
    settingsRow.append(noDuty);
    settings.children().first().append($("<h5 class=\"card-title\"/>").text("Planning"), settingsRow);
    body.append(settings);

    // Shifts: each entry is one shift per school day, with its own hour and classrooms
    const shiftsCard = $("<div class=\"card mb-3\"/>").append($("<div class=\"card-body\"/>")
        .append($("<h5 class=\"card-title\"/>").text("Diensten"))
        .append($("<p class=\"card-text small text-muted\"/>")
            .text("Elke rij is één toezichtdienst op elke schooldag: waar ze is, om welk uur "
                + "en welke klassen ze dekt.")));
    const shiftsTable = $("<table class=\"table table-sm align-middle mb-1\"/>")
        .append($("<thead/>").append($("<tr/>")
            .append($("<th/>").text("Locatie"))
            .append($("<th style=\"width: 7rem\"/>").text("Start"))
            .append($("<th style=\"width: 7rem\"/>").text("Einde"))
            .append($("<th/>").text("Klassen (gescheiden door komma's)"))
            .append($("<th style=\"width: 3rem\"/>"))));
    const shiftsBody = $("<tbody id=\"cfgShifts\"/>");
    config.shifts.forEach(shiftDef => shiftsBody.append(shiftRow(shiftDef)));
    shiftsTable.append(shiftsBody);
    const addShiftButton = $("<button type=\"button\" class=\"btn btn-outline-secondary btn-sm\">"
        + "<span class=\"fas fa-plus\"></span> Dienst</button>");
    addShiftButton.click(() => shiftsBody.append(shiftRow({location: "", start: "12:00", end: "13:00", classrooms: []})));
    shiftsCard.children().first().append(shiftsTable, addShiftButton);
    body.append(shiftsCard);

    // Teachers
    const teachersCard = $("<div class=\"card\"/>").append($("<div class=\"card-body\"/>")
        .append($("<h5 class=\"card-title\"/>").text("Leerkrachten"))
        .append($("<p class=\"card-text small text-muted\"/>")
            .text("Een leerkracht past enkel bij diensten die zijn of haar eigen klas dekken. "
                + "Niet-aangevinkte weekdagen worden niet-beschikbare dagen. Een vrij-uitzondering is een "
                + "eenmalige datum (bijvoorbeeld een doktersafspraak) die eventueel wekelijks herhaald kan worden; "
                + "vul van/tot-uren in om ze te beperken tot een deel van de dag.")));
    // Suggest the classrooms used by the shifts when filling in a teacher's classroom
    const classroomSuggestions = [...new Set(config.shifts.flatMap(shiftDef => shiftDef.classrooms || []))].sort();
    const classroomList = $("<datalist id=\"cfgClassroomList\"/>");
    classroomSuggestions.forEach(classroom => classroomList.append($("<option/>").attr("value", classroom)));
    teachersCard.children().first().append(classroomList);
    const teachersContainer = $("<div id=\"cfgTeachers\"/>");
    config.teachers.forEach(teacher => teachersContainer.append(teacherCard(teacher)));
    const addTeacherButton = $("<button type=\"button\" class=\"btn btn-outline-secondary btn-sm mt-2\">"
        + "<span class=\"fas fa-plus\"></span> Leerkracht</button>");
    addTeacherButton.click(() => teachersContainer.append(
        teacherCard({name: "", classroom: "", workingDays: [1, 2, 3, 4, 5], exceptions: []})));
    teachersCard.children().first().append(teachersContainer, addTeacherButton);
    body.append(teachersCard);
}

function readDataEditor() {
    const config = {
        weeks: Math.max(1, parseInt($("#cfgWeeks").val()) || 1),
        daysWithoutDuty: $("#cfgDaysWithoutDuty input:checked").map((i, e) => parseInt(e.value)).get(),
        shifts: [],
        teachers: []
    };
    $("#cfgShifts tr").each(function () {
        const location = $(this).find(".cfg-shift-location").val().trim();
        const classrooms = ($(this).find(".cfg-shift-classrooms").val() || "")
            .split(",").map(classroom => classroom.trim()).filter(classroom => classroom.length > 0);
        if (location.length > 0) {
            config.shifts.push({
                location: location,
                start: $(this).find(".cfg-shift-start").val() || "12:00",
                end: $(this).find(".cfg-shift-end").val() || "13:00",
                classrooms: classrooms
            });
        }
    });
    $("#cfgTeachers > div").each(function () {
        const name = $(this).find(".cfg-teacher-name").val().trim();
        if (name.length === 0) {
            return;
        }
        const workingDays = $(this).find(".cfg-working-day:checked").map((i, e) => parseInt(e.value)).get();
        const exceptions = [];
        $(this).find(".cfg-exception").each(function () {
            const date = $(this).find(".cfg-exc-date").val();
            if (date) {
                exceptions.push({
                    date: date,
                    type: $(this).find(".cfg-exc-type").val(),
                    from: $(this).find(".cfg-exc-from").val() || null,
                    to: $(this).find(".cfg-exc-to").val() || null,
                    repeats: Math.max(0, parseInt($(this).find(".cfg-exc-repeats").val()) || 0)
                });
            }
        });
        config.teachers.push({
            name: name,
            classroom: $(this).find(".cfg-teacher-classroom").val().trim(),
            workingDays: workingDays,
            exceptions: exceptions
        });
    });
    return config;
}

function generateDataFromEditor() {
    scheduleConfig = readDataEditor();
    try {
        localStorage.setItem("lunchDutyConfig", JSON.stringify(scheduleConfig));
    } catch (e) {
        console.warn("Could not store config.", e);
    }
    scheduleId = null;
    loadedSchedule = generateScheduleFromConfig(scheduleConfig);
    renderSchedule(loadedSchedule);
    editDataModal.hide();
}

function generateScheduleFromConfig(config) {
    const startMonday = JSJoda.LocalDate.now()
        .with(JSJoda.TemporalAdjusters.nextOrSame(JSJoda.DayOfWeek.MONDAY));
    const schoolDays = [];
    let date = startMonday;
    while (schoolDays.length < config.weeks * 5) {
        if (date.dayOfWeek() !== JSJoda.DayOfWeek.SATURDAY && date.dayOfWeek() !== JSJoda.DayOfWeek.SUNDAY) {
            schoolDays.push(date);
        }
        date = date.plusDays(1);
    }
    const lastDay = schoolDays[schoolDays.length - 1];

    const employees = config.teachers.map(teacher => {
        const unavailableDates = new Set();
        const unavailablePeriods = [];
        const undesiredDates = new Set();
        const desiredDates = new Set();
        // Weekdays that are not part of the teacher's contract are unavailable.
        schoolDays.forEach(schoolDay => {
            if (!teacher.workingDays.includes(schoolDay.dayOfWeek().value())) {
                unavailableDates.add(schoolDay.toString());
            }
        });
        // One-off exceptions, optionally repeated weekly.
        teacher.exceptions.forEach(exception => {
            for (let i = 0; i <= exception.repeats; i++) {
                const occurrence = JSJoda.LocalDate.parse(exception.date).plusWeeks(i);
                if (occurrence.compareTo(startMonday) < 0) {
                    continue;
                }
                if (occurrence.compareTo(lastDay) > 0) {
                    break;
                }
                if (exception.type === "unavailable" && exception.from && exception.to) {
                    // Part of the day off-duty instead of the whole day
                    unavailablePeriods.push({date: occurrence.toString(), from: exception.from, to: exception.to});
                } else {
                    const target = exception.type === "undesired" ? undesiredDates
                        : exception.type === "desired" ? desiredDates : unavailableDates;
                    target.add(occurrence.toString());
                }
            }
        });
        return {
            name: teacher.name,
            skills: ["Teacher"],
            classroom: teacher.classroom || null,
            unavailableDates: [...unavailableDates],
            unavailablePeriods: unavailablePeriods,
            undesiredDates: [...undesiredDates],
            desiredDates: [...desiredDates]
        };
    });

    const shifts = [];
    let id = 0;
    schoolDays.forEach(schoolDay => {
        if (config.daysWithoutDuty.includes(schoolDay.dayOfWeek().value())) {
            return;
        }
        config.shifts.forEach(shiftDef => {
            shifts.push({
                id: String(id++),
                start: schoolDay.atTime(JSJoda.LocalTime.parse(shiftDef.start)).toString(),
                end: schoolDay.atTime(JSJoda.LocalTime.parse(shiftDef.end)).toString(),
                location: shiftDef.location,
                requiredSkill: "Teacher",
                classrooms: shiftDef.classrooms,
                employee: null
            });
        });
    });

    return {employees: employees, shifts: shifts, score: null, solverStatus: null};
}

function solve() {
    $.post("/schedules", JSON.stringify(loadedSchedule), function (data) {
        scheduleId = data;
        refreshSolvingButtons(true);
    }).fail(function (xhr, ajaxOptions, thrownError) {
            showError("Starten van oplossen is mislukt.", xhr);
            refreshSolvingButtons(false);
        },
        "text");
}

function refreshSolvingButtons(solving) {
    if (solving) {
        $("#solveButton").hide();
        $("#stopSolvingButton").show();
        if (autoRefreshIntervalId == null) {
            autoRefreshIntervalId = setInterval(refreshSchedule, 2000);
        }
    } else {
        $("#solveButton").show();
        $("#stopSolvingButton").hide();
        if (autoRefreshIntervalId != null) {
            clearInterval(autoRefreshIntervalId);
            autoRefreshIntervalId = null;
        }
    }
}

function stopSolving() {
    $.delete(`/schedules/${scheduleId}`, function () {
        refreshSolvingButtons(false);
        refreshSchedule();
    }).fail(function (xhr, ajaxOptions, thrownError) {
        showError("Stoppen van oplossen is mislukt.", xhr);
    });
}

function showError(title, xhr) {
    let serverErrorMessage = !xhr.responseJSON ? `${xhr.status}: ${xhr.statusText}` : xhr.responseJSON.message;
    let serverErrorCode = !xhr.responseJSON ? `unknown` : xhr.responseJSON.code;
    let serverErrorId = !xhr.responseJSON ? `----` : xhr.responseJSON.id;
    let serverErrorDetails = !xhr.responseJSON ? `no details provided` : xhr.responseJSON.details;

    if (xhr.responseJSON && !serverErrorMessage) {
        serverErrorMessage = JSON.stringify(xhr.responseJSON);
        serverErrorCode = xhr.statusText + '(' + xhr.status + ')';
        serverErrorId = `----`;
    }

    console.error(title + "\n" + serverErrorMessage + " : " + serverErrorDetails);
    const notification = $(`<div class="toast" role="alert" aria-live="assertive" aria-atomic="true" style="min-width: 50rem"/>`)
        .append($(`<div class="toast-header bg-danger">
                 <strong class="me-auto text-dark">Fout</strong>
                 <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Sluiten"></button>
               </div>`))
        .append($(`<div class="toast-body"/>`)
            .append($(`<p/>`).text(title))
            .append($(`<pre/>`)
                .append($(`<code/>`).text(serverErrorMessage + "\n\nCode: " + serverErrorCode + "\nError id: " + serverErrorId))
            )
        );
    $("#notificationPanel").append(notification);
    notification.toast({delay: 30000});
    notification.toast('show');
}
