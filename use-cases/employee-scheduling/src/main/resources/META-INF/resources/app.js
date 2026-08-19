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
    $("#uploadConfigButton").click(function () {
        $("#configFileInput").click();
    });
    $("#configFileInput").change(function (event) {
        uploadConfigFile(event.target.files[0]);
        // Reset so selecting the same file again still triggers a change event.
        event.target.value = "";
    });
    $("#exportConfigButton").click(function () {
        exportConfig();
    });
    $("#uploadRosterButton").click(function () {
        $("#rosterFileInput").click();
    });
    $("#rosterFileInput").change(function (event) {
        uploadRosterFile(event.target.files[0]);
        // Reset so selecting the same file again still triggers a change event.
        event.target.value = "";
    });
    $("#exportRosterButton").click(function () {
        exportRoster();
    });
    $("#generateDataButton").click(function () {
        generateDataFromEditor();
    });
    // HACK to allow vis-timeline to work within Bootstrap tabs
    $("#byEmployeeTab").on('shown.bs.tab', function (event) {
        byEmployeeTimeline.redraw();
    })

    setupAjax();
    loadInitialScheduleConfig(function (config) {
        scheduleConfig = config;
        loadedSchedule = generateScheduleFromConfig(scheduleConfig);
        renderSchedule(loadedSchedule);
    });
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

function overlapsPeriod(shift, periods) {
    const shiftStart = JSJoda.LocalDateTime.parse(shift.start);
    const shiftEnd = JSJoda.LocalDateTime.parse(shift.end);
    return (periods || []).some(period => {
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
        overlapsPeriod(shift, employee.unavailablePeriods) ||
        // The contains() check is ignored for a shift end at midnight (00:00:00).
        (shiftEnd.isAfter(shiftStart.toLocalDate().plusDays(1).atStartOfDay()) &&
            employee.unavailableDates.includes(shiftEndDateString))) {
        return UNAVAILABLE_COLOR
    } else if (employee.undesiredDates.includes(shiftStartDateString) ||
        overlapsPeriod(shift, employee.undesiredPeriods) ||
        // The contains() check is ignored for a shift end at midnight (00:00:00).
        (shiftEnd.isAfter(shiftStart.toLocalDate().plusDays(1).atStartOfDay()) &&
            employee.undesiredDates.includes(shiftEndDateString))) {
        return UNDESIRED_COLOR
    } else if (employee.desiredDates.includes(shiftStartDateString) ||
        overlapsPeriod(shift, employee.desiredPeriods) ||
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
        // The solver never received the volunteer shifts, so add them back for display.
        const volunteerShifts = (loadedSchedule != null ? loadedSchedule.shifts : [])
            .filter(shift => shift.volunteersOnly);
        schedule.shifts = schedule.shifts.concat(volunteerShifts);
        loadedSchedule = schedule;
        renderSchedule(schedule);
    })
        .fail(function (xhr, ajaxOptions, thrownError) {
            showError("Ophalen van het rooster is mislukt.", xhr);
            refreshSolvingButtons(false);
        });
}

/**
 * The total planned minutes per teacher name: the sum of the lengths of all shifts
 * assigned to that teacher, limited to the given dates (all dates when null).
 * Shown as a tooltip on the teacher's name in the timeline (the whole schedule) and
 * on the teacher's chips on the roster (per week, just like the weekly minute limit).
 */
function plannedMinutesPerEmployee(schedule, dates) {
    const daySet = dates == null ? null : new Set(dates.map(date => date.toString()));
    const plannedMinutes = {};
    schedule.shifts.forEach(shift => {
        if (shift.employee != null && (daySet == null || daySet.has(shift.start.substring(0, 10)))) {
            plannedMinutes[shift.employee.name] = (plannedMinutes[shift.employee.name] || 0)
                + JSJoda.LocalDateTime.parse(shift.start)
                    .until(JSJoda.LocalDateTime.parse(shift.end), JSJoda.ChronoUnit.MINUTES);
        }
    });
    return plannedMinutes;
}

function renderSchedule(schedule) {
    refreshSolvingButtons(schedule.solverStatus != null && schedule.solverStatus !== "NOT_SOLVING");
    const scoreElement = $("#score");
    scoreElement.text("Score: " + (schedule.score == null ? "?" : schedule.score));
    scoreElement.removeClass("text-danger text-success");
    if (schedule.score != null) {
        const hardScore = parseFloat((schedule.score.match(/(-?\d+(\.\d+)?)hard/) || [null, "0"])[1]);
        scoreElement.addClass(hardScore < 0 ? "text-danger" : "text-success");
        scoreElement.attr("title", hardScore < 0
            ? "Nog geen haalbare oplossing: er zijn harde overtredingen (bijv. een leerkracht op een vrije dag)."
            : "Haalbare oplossing: geen harde overtredingen.");
    }

    renderRoster(schedule);

    byEmployeeGroupDataSet.clear();
    byEmployeeItemDataSet.clear();

    // Total planned minutes per teacher, shown as a tooltip on their name.
    const plannedMinutesByEmployee = plannedMinutesPerEmployee(schedule, null);

    schedule.employees.forEach((employee, index) => {
        const employeeGroupElement = $('<div class="card-body p-2"/>')
            .append($(`<h5 class="card-title mb-2"/>)`)
                .attr("title", `Ingepland: ${plannedMinutesByEmployee[employee.name] || 0} min`)
                .append(employee.name))
            .append($('<div/>')
                .append($(employee.skills.map(skill => `<span class="badge me-1 mt-1" style="background-color:#d3d7cf">${skill}</span>`).join(''))));
        if (employee.classroom != null) {
            employeeGroupElement.append($('<div/>')
                .append($(`<span class="badge me-1 mt-1" style="background-color:${comboColor([employee.classroom])}">${classroomLabel([employee.classroom])}</span>`)));
        }
        // Show the other classrooms this teacher can also cover on the toggled day halves.
        // On those day halves the alternative classroom takes priority over the teacher's own classroom.
        const alternativeClassrooms = [...new Set((employee.alternativeClassroomPeriods || [])
            .map(period => period.classroom))].sort();
        if (alternativeClassrooms.length > 0) {
            const badges = alternativeClassrooms.map(classroom =>
                `<span class="badge me-1 mt-1" style="background-color:${comboColor([classroom])}; `
                + `border: 1px dashed #868e96" `
                + `title="Krijgt op de ingestelde dagdelen voorrang op de eigen klas; `
                + `enkel inzetbaar in klas ${classroom} tijdens pauzes binnen die dagdelen">ook in ${classroom}</span>`
            ).join('');
            employeeGroupElement.append($('<div/>').append($(badges)));
        }
        if (employee.maxWorkingMinutes != null) {
            employeeGroupElement.append($('<div/>')
                .append($(`<span class="badge me-1 mt-1" style="background-color:#e9ecef" `
                    + `title="Maximum aantal minuten toezicht per week (harde grens)">`
                    + `${contractLabel(employee)}: max. ${employee.maxWorkingMinutes} min</span>`)));
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
        (employee.undesiredPeriods || []).forEach((period, periodIndex) => {
            const byEmployeeShiftElement = $(`<div/>`)
                .append($(`<h5 class="card-title mb-1"/>`).text("Liever niet"));
            byEmployeeItemDataSet.add({
                id: "employee-" + index + "-undesired-period-" + periodIndex, group: employee.name,
                content: byEmployeeShiftElement.html(),
                start: period.date + "T" + period.from, end: period.date + "T" + period.to,
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
        (employee.desiredPeriods || []).forEach((period, periodIndex) => {
            const byEmployeeShiftElement = $(`<div/>`)
                .append($(`<h5 class="card-title mb-1"/>`).text("Voorkeur"));
            byEmployeeItemDataSet.add({
                id: "employee-" + index + "-desired-period-" + periodIndex, group: employee.name,
                content: byEmployeeShiftElement.html(),
                start: period.date + "T" + period.from, end: period.date + "T" + period.to,
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
                .append($(`<span class="badge me-1 mt-1" style="background-color:#868e96">${classroomLabel(shift.classrooms)}</span>`)));

        const shiftColor = getShiftColor(shift, shift.employee);
        byEmployeeItemDataSet.add({
            id: 'shift-' + index, group: shift.employee.name,
            content: byEmployeeShiftElement.html(),
            start: shift.start, end: shift.end,
            style: "background-color: " + shiftColor
        });
    });

    const volunteerShiftCount = schedule.shifts.filter(shift => shift.volunteersOnly).length;
    $("#info").text(`Deze gegevens bevatten ${schedule.shifts.length - volunteerShiftCount} diensten`
        + (volunteerShiftCount > 0 ? ` en ${volunteerShiftCount} vrijwilligersdiensten` : "")
        + ` en ${schedule.employees.length} leerkrachten.`);

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

/**
 * The write-in chip for a volunteers-only shift (0 teachers): not filled in by the solver,
 * only printed so a volunteer's name can be written in with pen.
 */
function volunteerChip() {
    return rosterChip("#ffffff", "Vrijwilligers: ____________")
        .css("border", "2px dashed #868e96")
        .css("box-shadow", "none")
        .css("white-space", "normal");
}

/**
 * An editable chip for one shift: a dropdown with all teacher names to swap the
 * assigned teacher by hand, plus a lock. Locking a shift pins it: the solver keeps
 * its teacher as is (or keeps it unassigned) and only plans the other shifts.
 */
function assignmentPicker(schedule, shift, plannedMinutes) {
    const wrapper = $("<span class=\"roster-assignment\"/>");
    const select = $("<select class=\"roster-select\"/>")
        .append($("<option value=\"\">Niet toegewezen</option>"));
    schedule.employees.forEach(employee => {
        select.append($("<option/>").attr("value", employee.name).text(employee.name));
    });
    select.val(shift.employee == null ? "" : shift.employee.name);

    // Same colors as the plain chips: red for a hard violation or an unassigned shift,
    // otherwise the classroom color with a border for the teacher's availability.
    if (shift.employee == null) {
        select.css("background-color", "#f4b6b6")
            .css("border", "2px dashed " + UNAVAILABLE_COLOR);
    } else {
        const statusColor = getShiftColor(shift, shift.employee);
        if (statusColor === UNAVAILABLE_COLOR) {
            // A hard violation keeps the fully red chip so it stands out.
            select.css("background-color", UNAVAILABLE_COLOR).css("color", "#fff");
        } else {
            select.css("background-color", comboColor(shift.classrooms));
            if (statusColor === DESIRED_COLOR) {
                select.css("border", "2px solid " + DESIRED_COLOR);
            } else if (statusColor === UNDESIRED_COLOR) {
                select.css("border", "2px solid " + UNDESIRED_COLOR);
            }
        }
        // Hovering over the chip shows the total minutes the teacher is planned in
        // this week, next to the classroom the chip belongs to.
        let title = `Ingepland deze week: ${(plannedMinutes || {})[shift.employee.name] || 0} min`;
        if (shift.employee.classroom != null) {
            // The teacher covers another classroom here via an alternative class toggle.
            const coveringAlternative = (shift.classrooms || []).length > 0
                && !shift.classrooms.includes(shift.employee.classroom);
            title = (coveringAlternative
                ? "Klas " + shift.employee.classroom + " – dekt hier een andere klas"
                : "Klas " + shift.employee.classroom) + "\n" + title;
        }
        select.attr("title", title);
    }
    // A pinned (locked) shift keeps its teacher: the dropdown can not change it.
    select.prop("disabled", shift.pinned);
    select.change(function () {
        const employeeName = $(this).val();
        shift.employee = employeeName === "" ? null
            : schedule.employees.find(employee => employee.name === employeeName) || null;
        // The score no longer matches the manually changed schedule.
        schedule.score = null;
        renderSchedule(schedule);
    });

    const pinButton = $("<button type=\"button\" class=\"roster-pin\"/>")
        .append($(`<span class="fas ${shift.pinned ? "fa-lock" : "fa-lock-open"}"/>`))
        .attr("title", shift.pinned
            ? "Vastgezet: de solver verandert deze naam niet. Klik om los te maken."
            : "Zet deze naam vast: de solver mag ze niet veranderen.")
        .click(function () {
            shift.pinned = !shift.pinned;
            renderSchedule(schedule);
        });
    wrapper.append(select, pinButton);
    return wrapper;
}

/**
 * A stable pastel color per classroom (combination), derived from the classroom names,
 * so every classroom and combo always gets the same color.
 */
function comboColor(classrooms) {
    if (!classrooms || classrooms.length === 0) {
        return "#729fcf"; // Tango Sky Blue
    }
    const key = [...classrooms].sort().join(",");
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    // The golden angle spreads similar names far apart on the color wheel.
    const hue = Math.round((hash * 137.508) % 360);
    return `hsl(${hue}, 70%, 78%)`;
}

/**
 * The classes are grouped in three "graden": 1A/1B/2A/2B form Graad 1,
 * 3A/3B/4A/4B form Graad 2 and 5A/5B/6A/6B form Graad 3. A combo that covers
 * a full graad is shown as that graad instead of a pile of separate class names.
 */
const GRADEN = [
    {label: "Graad 1", classrooms: ["1A", "1B", "2A", "2B"]},
    {label: "Graad 2", classrooms: ["3A", "3B", "4A", "4B"]},
    {label: "Graad 3", classrooms: ["5A", "5B", "6A", "6B"]}
];

/**
 * Splits a classroom combination into the full graden it covers plus any leftover
 * classes, e.g. ["3A", "3B", "4A", "4B", "5A"] splits into ["Graad 2"] and ["5A"].
 * Matching ignores case; leftover classes keep their original name.
 */
function splitGraden(classrooms) {
    const rest = [...(classrooms || [])];
    const labels = [];
    GRADEN.forEach(graad => {
        if (graad.classrooms.every(classroom => rest.some(c => c.toUpperCase() === classroom))) {
            graad.classrooms.forEach(classroom =>
                rest.splice(rest.findIndex(c => c.toUpperCase() === classroom), 1));
            labels.push(graad.label);
        }
    });
    return {labels: labels, rest: rest};
}

/**
 * One clear label for a classroom (combination): full graden collapse to
 * "Graad 1 + Graad 2" instead of a pile of separate class names;
 * any other combo keeps showing its classes. Empty means all classrooms.
 */
function classroomLabel(classrooms) {
    if (!classrooms || classrooms.length === 0) {
        return "Alle klassen";
    }
    const split = splitGraden(classrooms);
    const parts = split.labels.concat(split.rest);
    return split.labels.length === 0 ? "Klas " + parts.join(" + ") : parts.join(" + ");
}

function renderRoster(schedule) {
    const roster = $("#rosterPanel");
    roster.children().remove();

    if (schedule.shifts.length === 0) {
        roster.text("Geen diensten in deze gegevens.");
        return;
    }

    // Legend: one color per classroom (combination) used in this schedule
    const legend = $("<div class=\"d-flex align-items-center flex-wrap mb-3 roster-legend\"/>");
    legend.append($("<span class=\"me-1\"/>").text("Klassen:"));
    const combos = [];
    schedule.shifts.forEach(shift => {
        const key = (shift.classrooms || []).join(",");
        if (!combos.some(combo => combo.join(",") === key)) {
            combos.push(shift.classrooms || []);
        }
    });
    combos.forEach(combo => {
        const split = splitGraden(combo);
        const text = combo.length === 0 ? "Alle klassen" : split.labels.concat(split.rest).join(" + ");
        legend.append(rosterChip(comboColor(combo), text));
    });
    // Availability is shown with a colored border around the chips
    legend.append($("<span class=\"ms-3 me-1\"/>").text("Rand:"));
    legend.append(rosterChip("#e9ecef", "Voorkeursdag").css("border", "2px solid " + DESIRED_COLOR));
    legend.append(rosterChip("#e9ecef", "Liever niet").css("border", "2px solid " + UNDESIRED_COLOR));
    legend.append(rosterChip(UNAVAILABLE_COLOR, "Niet beschikbaar", true));
    legend.append(rosterChip("#f4b6b6", "Niet toegewezen").css("border", "2px dashed " + UNAVAILABLE_COLOR));
    const pinnedLegendChip = rosterChip("#e9ecef", "Vastgezet")
        .attr("title", "Klik op het slotje naast een naam om die vast te zetten: "
            + "de solver verandert vastgezette namen niet");
    pinnedLegendChip.prepend($("<span class=\"fas fa-lock me-1\"/>"));
    legend.append(pinnedLegendChip);
    if (schedule.shifts.some(shift => shift.volunteersOnly)) {
        legend.append(volunteerChip().attr("title",
            "Wordt niet door de solver ingevuld: schrijf vrijwilligers met pen op het afgedrukte rooster"));
    }
    // Max duty minutes per contract type, plus any custom maxima (a hard limit for the solver)
    const contractMaxChips = [];
    CONTRACT_TYPES.filter(type => type.ratio != null).forEach(type => {
        const employee = schedule.employees.find(e => e.workRatio === type.ratio && e.maxWorkingMinutes != null);
        if (employee != null) {
            contractMaxChips.push(rosterChip("#e9ecef", `${type.label}: ${employee.maxWorkingMinutes} min`)
                .attr("title", "Maximum aantal minuten toezicht per week (harde grens)"));
        }
    });
    const customMaxEmployees = schedule.employees
        .filter(e => e.workRatio == null && e.maxWorkingMinutes != null);
    if (contractMaxChips.length > 0 || customMaxEmployees.length > 0) {
        legend.append($("<span class=\"ms-3 me-1\"/>").text("Max. minuten:"));
        contractMaxChips.forEach(chip => legend.append(chip));
        customMaxEmployees.forEach(employee => legend.append(
            rosterChip("#e9ecef", `${employee.name}: ${employee.maxWorkingMinutes} min`)
                .attr("title", "Aangepast maximum aantal minuten toezicht per week (harde grens)")));
    }
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
    // Order the roster rows by start time, so the shifts read chronologically.
    rosterRows.sort((a, b) => a.start.localeCompare(b.start)
        || a.end.localeCompare(b.end)
        || a.location.localeCompare(b.location)
        || a.classrooms.join(",").localeCompare(b.classrooms.join(",")));

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
        // Total planned minutes per teacher in this week, shown as a tooltip on their chips.
        const plannedMinutes = plannedMinutesPerEmployee(schedule, weekDates);

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
            rowHeader.append($("<div class=\"mt-1\"/>").append(
                rosterChip(comboColor(rosterRow.classrooms), classroomLabel(rosterRow.classrooms))
                    .css("white-space", "normal")));
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
                        if (shift.volunteersOnly) {
                            td.append(volunteerChip());
                            return;
                        }
                        td.append(assignmentPicker(schedule, shift, plannedMinutes));
                    });
                if (td.children().length === 0) {
                    // This shift does not occur on this day (excluded weekday).
                    td.addClass("roster-no-lunch text-center align-middle")
                        .append($("<span/>").text("–"));
                }
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

/**
 * The teacher's contract decides the maximum amount of duty time they can be given:
 * the total shift time is divided over all teachers, weighted by the contract ratio
 * (voltijds counts 1, 4/5 counts 0.8, halftijds 0.5). "Aangepast" (custom) has no ratio
 * and instead uses the maxMinutes the user fills in.
 */
const CONTRACT_TYPES = [
    {value: "FULL_TIME", label: "Voltijds", ratio: 1},
    {value: "FOUR_FIFTHS", label: "4/5", ratio: 0.8},
    {value: "PART_TIME", label: "Halftijds", ratio: 0.5},
    {value: "CUSTOM", label: "Aangepast", ratio: null}
];

function contractRatio(teacher) {
    const contractType = CONTRACT_TYPES.find(type => type.value === (teacher.contract || "FULL_TIME"));
    return contractType != null ? contractType.ratio : 1;
}

function contractLabel(employee) {
    if (employee.workRatio == null) {
        return "Aangepast";
    }
    const contractType = CONTRACT_TYPES.find(type => type.ratio === employee.workRatio);
    return contractType != null ? contractType.label : Math.round(employee.workRatio * 100) + "%";
}

const WEDNESDAY = 3;
// The working day is split in two halves at 12:25: morning 08:00-12:25, afternoon 12:25-17:00.
// Wednesday never has an afternoon.
const DAY_START_TIME = "08:00";
const MIDDAY_SPLIT_TIME = "12:25";
const DAY_END_TIME = "17:00";

let editDataModal = null;
let scheduleConfig = loadScheduleConfig();

function defaultScheduleConfig() {
    // A contract cycle with mostly full-time teachers and some part-time Mon/Wed/Fri or Tue/Thu.
    // Wednesday never has an afternoon, so the afternoon patterns skip Wednesday.
    const morningPatterns = [[1, 2, 3, 4, 5], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5], [1, 3, 5], [2, 4]];
    const afternoonPatterns = [[1, 2, 4, 5], [1, 2, 4, 5], [1, 2, 4, 5], [1, 5], [2, 4]];
    const classrooms = ["1A", "1B", "2A", "2B"];
    const names = ["Amy Cole", "Beth Fox", "Carl Green", "Dan Jones", "Elsa King", "Flo Li",
        "Gus Poe", "Hugo Rye", "Ivy Smith", "Jay Watt", "Amy Fox", "Beth Green"];
    return {
        weeks: 2,
        // One shift per school day per entry: location, hour, the classrooms it supervises
        // and the weekdays on which the shift does not occur (excludedDays).
        // Wednesday afternoon is off: only the morning break still happens on Wednesday.
        shifts: [
            {location: "Speelplaats", start: "10:00", end: "10:30", classrooms: ["1A", "1B"], teachers: 1, excludedDays: []},
            {location: "Speelplaats", start: "10:00", end: "10:30", classrooms: ["2A", "2B"], teachers: 1, excludedDays: []},
            {location: "Refter", start: "12:00", end: "13:00", classrooms: ["1A", "1B"], teachers: 1, excludedDays: [3]},
            {location: "Refter", start: "12:00", end: "13:00", classrooms: ["2A", "2B"], teachers: 1, excludedDays: [3]},
            {location: "Speelplaats", start: "12:00", end: "13:00", classrooms: ["1A", "2A"], teachers: 1, excludedDays: [3]},
            {location: "Speelplaats", start: "12:00", end: "13:00", classrooms: ["1B", "2B"], teachers: 1, excludedDays: [3]},
            {location: "Speelplaats", start: "14:45", end: "15:15", classrooms: ["1A", "1B"], teachers: 1, excludedDays: [3]},
            {location: "Speelplaats", start: "14:45", end: "15:15", classrooms: ["2A", "2B"], teachers: 1, excludedDays: [3]}
        ],
        teachers: names.map((name, i) => ({
            name: name,
            // Full-time teachers work the whole week; part-time teachers work Mon/Wed/Fri or Tue/Thu.
            contract: i % morningPatterns.length < 3 ? "FULL_TIME" : "PART_TIME",
            maxMinutes: null,
            workingMornings: [...morningPatterns[i % morningPatterns.length]],
            workingAfternoons: [...afternoonPatterns[i % afternoonPatterns.length]],
            classroom: classrooms[i % classrooms.length],
            alternativeClassrooms: [],
            undesiredDays: [],
            desiredDays: [],
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
                migrateScheduleConfig(config);
                return config;
            }
        }
    } catch (e) {
        console.warn("Ignoring invalid stored config.", e);
    }
    return null;
}

/**
 * Migrates older config shapes in place: day exclusion moved from the whole schedule to
 * each shift, and full working days were split into mornings (before 12:25) and afternoons
 * (after 12:25). Wednesday never has an afternoon.
 */
function migrateScheduleConfig(config) {
    if (!Array.isArray(config.shifts) || !Array.isArray(config.teachers)) {
        return;
    }
    // Migrated: day exclusion moved from the whole schedule to each shift
    const legacyExcluded = config.daysWithoutDuty || config.daysWithoutLunch;
    if (Array.isArray(legacyExcluded)) {
        config.shifts.forEach(shiftDef => {
            if (!Array.isArray(shiftDef.excludedDays)) {
                shiftDef.excludedDays = [...legacyExcluded];
            }
        });
        delete config.daysWithoutDuty;
        delete config.daysWithoutLunch;
    }
    config.teachers.forEach(teacher => {
        if (teacher == null) {
            return;
        }
        // Migrated: teachers got a contract deciding their maximum duty time.
        if (typeof teacher.contract !== "string") {
            teacher.contract = "FULL_TIME";
            teacher.maxMinutes = null;
        }
        // Migrated: working days split into a morning and an afternoon half.
        if (Array.isArray(teacher.workingDays)) {
            if (!Array.isArray(teacher.workingMornings)) {
                teacher.workingMornings = [...teacher.workingDays];
            }
            if (!Array.isArray(teacher.workingAfternoons)) {
                teacher.workingAfternoons = teacher.workingDays.filter(day => day !== WEDNESDAY);
            }
            delete teacher.workingDays;
        }
        // Wednesday never has an afternoon.
        if (Array.isArray(teacher.workingAfternoons)) {
            teacher.workingAfternoons = teacher.workingAfternoons.filter(day => day !== WEDNESDAY);
        }
    });
}

function isValidScheduleConfig(config) {
    return config != null
        && Number.isInteger(config.weeks) && config.weeks >= 1
        && Array.isArray(config.shifts)
        && config.shifts.every(shiftDef => shiftDef != null
            && typeof shiftDef.location === "string" && shiftDef.location.length > 0
            && typeof shiftDef.start === "string" && typeof shiftDef.end === "string")
        && Array.isArray(config.teachers)
        && config.teachers.every(teacher => teacher != null
            && typeof teacher.name === "string" && teacher.name.length > 0
            && Array.isArray(teacher.workingMornings)
            && Array.isArray(teacher.workingAfternoons));
}

/**
 * Loads the config at startup: the config saved in the browser (localStorage) wins;
 * otherwise the demo config file demo-config.json is loaded; if that file is missing
 * (for example a fresh checkout), the built-in default config is used.
 */
function loadInitialScheduleConfig(onLoaded) {
    if (scheduleConfig != null) {
        onLoaded(scheduleConfig);
        return;
    }
    $.getJSON("demo-config.json", function (config) {
        if (isValidScheduleConfig(config)) {
            onLoaded(config);
        } else {
            console.warn("Invalid demo-config.json, using the built-in default config.");
            onLoaded(defaultScheduleConfig());
        }
    }).fail(function () {
        console.warn("demo-config.json not found, using the built-in default config.");
        onLoaded(defaultScheduleConfig());
    });
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

/**
 * Two checkboxes per weekday, stacked under the day label: one for the morning
 * (before 12:25) and one for the afternoon (after 12:25).
 * Wednesday never has an afternoon, so that checkbox is disabled.
 */
function dayHalfCheckboxes(mornings, afternoons, morningClass, afternoonClass) {
    return DAY_CHECKBOXES.map(day => {
        const wrapper = $("<div class=\"d-inline-block text-center me-2\"/>");
        wrapper.append($("<div class=\"small text-muted\"/>").text(day.label));
        const morning = $("<div class=\"form-check mb-0\"/>");
        morning.append($("<input class=\"form-check-input\" type=\"checkbox\"/>")
            .addClass(morningClass)
            .attr("value", day.value)
            .attr("title", "Voormiddag (voor 12:25)")
            .prop("checked", mornings.includes(day.value)));
        morning.append($("<label class=\"form-check-label small\">vm</label>"));
        const afternoon = $("<div class=\"form-check mb-0\"/>");
        afternoon.append($("<input class=\"form-check-input\" type=\"checkbox\"/>")
            .addClass(afternoonClass)
            .attr("value", day.value)
            .attr("title", day.value === WEDNESDAY
                ? "Woensdagnamiddag is altijd vrij"
                : "Namiddag (na 12:25)")
            .prop("checked", day.value !== WEDNESDAY && afternoons.includes(day.value))
            .prop("disabled", day.value === WEDNESDAY));
        afternoon.append($("<label class=\"form-check-label small\">nm</label>"));
        wrapper.append(morning, afternoon);
        return wrapper;
    });
}

function workingDayCheckboxes(teacher) {
    return dayHalfCheckboxes(teacher.workingMornings || [], teacher.workingAfternoons || [],
        "cfg-working-morning", "cfg-working-afternoon");
}

/**
 * One alternative classroom row: the classroom and the weekdays and day halves
 * on which the teacher can also be planned in that classroom. On those day halves
 * the alternative classroom takes priority over the teacher's own classroom and
 * the teacher is only planned there in breaks that fall inside the day half.
 */
function alternativeClassroomRow(entry) {
    const row = $("<div class=\"d-flex align-items-center gap-2 flex-wrap mb-1 cfg-alt-classroom-row\"/>");
    row.append($("<span class=\"small text-muted\">ook in klas:</span>"));
    row.append($("<input class=\"form-control cfg-alt-classroom\" list=\"cfgClassroomList\" "
        + "style=\"max-width: 7rem\" placeholder=\"bv. 2B\"/>").val(entry.classroom || ""));
    dayHalfCheckboxes(entry.mornings || [], entry.afternoons || [],
        "cfg-alt-morning", "cfg-alt-afternoon").forEach(check => row.append(check));
    const removeButton = $("<button type=\"button\" class=\"btn btn-outline-danger btn-sm\" "
        + "title=\"Alternatieve klas verwijderen\"><span class=\"fas fa-trash\"></span></button>");
    removeButton.click(() => row.remove());
    row.append(removeButton);
    return row;
}

function exceptionRow(exception) {
    const row = $("<div class=\"d-flex gap-2 align-items-center flex-wrap mb-1 cfg-exception\"/>");
    const dateInput = $("<input type=\"date\" class=\"form-control cfg-exc-date\" style=\"max-width: 10.5rem\"/>")
        .val(exception.date || "");
    const typeSelect = $("<select class=\"form-select cfg-exc-type\" style=\"max-width: 12.5rem\">"
        + "<option value=\"unavailable\">Niet beschikbaar</option>"
        + "<option value=\"undesired\">Liever niet</option>"
        + "<option value=\"desired\">Voorkeur</option>"
        + "</select>").val(exception.type || "unavailable");
    const fromInput = $("<input type=\"time\" class=\"form-control cfg-exc-from\" style=\"max-width: 6rem\" "
        + "title=\"Begin van de periode. Leeg betekent de hele dag.\"/>")
        .val(exception.from || "");
    const toInput = $("<input type=\"time\" class=\"form-control cfg-exc-to\" style=\"max-width: 6rem\" "
        + "title=\"Einde van de periode. Leeg betekent de hele dag.\"/>")
        .val(exception.to || "");
    const repeatsInput = $("<input type=\"number\" min=\"0\" max=\"52\" class=\"form-control cfg-exc-repeats\" style=\"max-width: 5rem\" "
        + "title=\"0 = elke week herhalen op deze weekdag; een hoger getal herhaalt de datum dat aantal extra weken\"/>")
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

    header.append($("<span class=\"small text-muted\">contract:</span>"));
    const contractSelect = $("<select class=\"form-select cfg-teacher-contract\" style=\"max-width: 9rem\" "
        + "title=\"Het contract bepaalt het maximum aantal minuten toezicht per week: "
        + "de wekelijkse dienstminuten worden verdeeld naar rato van het contract\"/>"
        + CONTRACT_TYPES.map(type => `<option value="${type.value}">${type.label}</option>`).join("")
        + "</select>").val(teacher.contract || "FULL_TIME");
    const maxMinutesLabel = $("<span class=\"small text-muted cfg-teacher-max-minutes-label\">max.</span>");
    const maxMinutesInput = $("<input type=\"number\" min=\"0\" step=\"5\" "
        + "class=\"form-control cfg-teacher-max-minutes\" style=\"max-width: 6rem\" "
        + "title=\"Maximum aantal minuten toezicht per week\"/>")
        .val(teacher.maxMinutes != null ? teacher.maxMinutes : "");
    const maxMinutesUnit = $("<span class=\"small text-muted cfg-teacher-max-minutes-label\">min</span>");
    contractSelect.change(() => {
        const custom = contractSelect.val() === "CUSTOM";
        maxMinutesLabel.toggle(custom);
        maxMinutesInput.toggle(custom);
        maxMinutesUnit.toggle(custom);
    });
    header.append(contractSelect, maxMinutesLabel, maxMinutesInput, maxMinutesUnit);
    maxMinutesLabel.toggle(contractSelect.val() === "CUSTOM");
    maxMinutesInput.toggle(contractSelect.val() === "CUSTOM");
    maxMinutesUnit.toggle(contractSelect.val() === "CUSTOM");

    header.append($("<span class=\"small text-muted\">werkt:</span>"));
    workingDayCheckboxes(teacher).forEach(check => header.append(check));

    header.append($("<span class=\"small text-muted ms-2\">|</span>"));
    header.append($("<span class=\"small text-muted\">liever niet:</span>"));
    dayCheckboxes("cfg-undesired-day", teacher.undesiredDays || []).forEach(check => header.append(check));

    header.append($("<span class=\"small text-muted ms-2\">|</span>"));
    header.append($("<span class=\"small text-muted\">voorkeur:</span>"));
    dayCheckboxes("cfg-desired-day", teacher.desiredDays || []).forEach(check => header.append(check));

    const removeButton = $("<button type=\"button\" class=\"btn btn-outline-danger btn-sm ms-auto\" title=\"Leerkracht verwijderen\">"
        + "<span class=\"fas fa-trash\"></span></button>");
    removeButton.click(() => card.remove());
    header.append(removeButton);

    const alternativeClassrooms = $("<div class=\"cfg-alternative-classrooms mt-2\"/>");
    (teacher.alternativeClassrooms || [])
        .forEach(entry => alternativeClassrooms.append(alternativeClassroomRow(entry)));
    const addAlternativeClassroomButton = $("<button type=\"button\" class=\"btn btn-outline-secondary btn-sm mt-1\" "
        + "title=\"Laat deze leerkracht op de aangevinkte dagdelen ook een andere klas dekken; "
        + "die klas krijgt daar voorrang op de eigen klas\">"
        + "<span class=\"fas fa-plus\"></span> Andere klas</button>");
    addAlternativeClassroomButton.click(() => alternativeClassrooms.append(
        alternativeClassroomRow({classroom: "", mornings: [], afternoons: []})));

    const exceptions = $("<div class=\"cfg-exceptions mt-2\"/>");
    (teacher.exceptions || []).forEach(exception => exceptions.append(exceptionRow(exception)));
    const addExceptionButton = $("<button type=\"button\" class=\"btn btn-outline-secondary btn-sm mt-1\">"
        + "<span class=\"fas fa-plus\"></span> Uitzondering</button>");
    addExceptionButton.click(() => exceptions.append(exceptionRow({date: "", type: "unavailable", repeats: 0})));

    body.append(header, alternativeClassrooms, addAlternativeClassroomButton, exceptions, addExceptionButton);
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
    row.append($("<td/>").append($("<input class=\"form-control cfg-shift-classrooms\" "
        + "placeholder=\"bv. 1A, 1B (leeg = alle klassen)\"/>")
        .val((shiftDef.classrooms || []).join(", "))));
    row.append($("<td/>").append($("<input type=\"number\" min=\"0\" max=\"10\" "
        + "class=\"form-control cfg-shift-teachers\" title=\"Aantal leerkrachten dat tegelijk op deze dienst nodig is; "
        + "0 = vrijwilligersdienst: gaat niet naar de solver en staat enkel op het rooster om met pen in te vullen\"/>")
        .val(shiftDef.teachers != null ? shiftDef.teachers : 1)));
    const excludedCell = $("<td class=\"text-nowrap\"/>");
    dayCheckboxes("cfg-shift-excluded-day", shiftDef.excludedDays || [])
        .forEach(check => excludedCell.append(check));
    row.append(excludedCell);
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
    settings.children().first().append($("<h5 class=\"card-title\"/>").text("Planning"), settingsRow);
    body.append(settings);

    // Shifts: each entry is one shift per school day, with its own hour, classrooms and excluded days
    const shiftsCard = $("<div class=\"card mb-3\"/>").append($("<div class=\"card-body\"/>")
        .append($("<h5 class=\"card-title\"/>").text("Diensten"))
        .append($("<p class=\"card-text small text-muted\"/>")
            .text("Elke rij is één toezichtdienst op elke schooldag: waar ze is, om welk uur, "
                + "welke klassen ze dekt en hoeveel leerkrachten er tegelijk nodig zijn. "
                + "Laat het klassenveld leeg om de dienst "
                + "voor alle klassen te laten gelden. Vink dagen aan bij \"Niet op\" om de dienst "
                + "op die weekdagen over te slaan (bijvoorbeeld geen middagtoezicht op woensdag). "
                + "Zet het aantal leerkrachten op 0 voor een vrijwilligersdienst: die gaat niet naar "
                + "de solver en staat enkel op het rooster om vrijwilligers met pen in te schrijven.")));
    const shiftsTable = $("<table class=\"table table-sm align-middle mb-1\"/>")
        .append($("<thead/>").append($("<tr/>")
            .append($("<th/>").text("Locatie"))
            .append($("<th style=\"width: 7rem\"/>").text("Start"))
            .append($("<th style=\"width: 7rem\"/>").text("Einde"))
            .append($("<th/>").text("Klassen (gescheiden door komma's)"))
            .append($("<th style=\"width: 6rem\"/>").text("Leerkrachten"))
            .append($("<th/>").text("Niet op"))
            .append($("<th style=\"width: 3rem\"/>"))));
    const shiftsBody = $("<tbody id=\"cfgShifts\"/>");
    config.shifts.forEach(shiftDef => shiftsBody.append(shiftRow(shiftDef)));
    shiftsTable.append(shiftsBody);
    const addShiftButton = $("<button type=\"button\" class=\"btn btn-outline-secondary btn-sm\">"
        + "<span class=\"fas fa-plus\"></span> Dienst</button>");
    addShiftButton.click(() => shiftsBody.append(
        shiftRow({location: "", start: "12:00", end: "13:00", classrooms: [], teachers: 1})));
    shiftsCard.children().first().append(shiftsTable, addShiftButton);
    body.append(shiftsCard);

    // Teachers
    const teachersCard = $("<div class=\"card\"/>").append($("<div class=\"card-body\"/>")
        .append($("<h5 class=\"card-title\"/>").text("Leerkrachten"))
        .append($("<p class=\"card-text small text-muted\"/>")
            .text("Een leerkracht past enkel bij diensten die zijn of haar eigen klas dekken; "
                + "laat de klas leeg om de leerkracht voor elke dienst in te zetten. "
                + "Met \"Andere klas\" kan een leerkracht op de aangevinkte dagen en dagdelen "
                + "ook diensten van een andere klas dekken, zo kan ze doorheen de week "
                + "in meerdere klassen worden ingepland. "
                + "Op die dagdelen krijgt de andere klas voorrang op de eigen klas en wordt "
                + "de leerkracht er enkel ingepland voor pauzes die binnen het dagdeel vallen. "
                + "Het contract bepaalt het maximum aantal minuten toezicht per week: "
                + "de wekelijkse dienstminuten worden verdeeld over de leerkrachten "
                + "naar rato van het contract (voltijds telt 1, 4/5 telt 0,8 en halftijds 0,5). "
                + "Kies \"Aangepast\" om zelf een maximum aantal minuten in te vullen. "
                + "Vink per weekdag aan welke dagdelen de leerkracht werkt: voormiddag (vm, voor 12:25) "
                + "en namiddag (nm, na 12:25); woensdag heeft nooit een namiddag. "
                + "Niet-aangevinkte dagdelen zijn niet-beschikbaar. "
                + "Dagen onder \"Liever niet\" of \"Voorkeur\" sturen de solver weekelijks bij "
                + "(zachte voorkeur) en gelden voor de volledige schooldag (08:00 - 17:00). "
                + "Een uitzondering geldt op een datum en wordt op dezelfde weekdag "
                + "wekelijks herhaald zolang de herhaling 0 is; een hoger getal herhaalt de datum "
                + "dat aantal extra weken. "
                + "Vul van/tot-uren in om een uitzondering te beperken tot een deel van de dag.")));
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
        teacherCard({name: "", classroom: "", alternativeClassrooms: [], contract: "FULL_TIME", maxMinutes: null,
            workingMornings: [1, 2, 3, 4, 5], workingAfternoons: [1, 2, 4, 5],
            exceptions: []})));
    teachersCard.children().first().append(teachersContainer, addTeacherButton);
    body.append(teachersCard);
}

function readDataEditor() {
    const config = {
        weeks: Math.max(1, parseInt($("#cfgWeeks").val()) || 1),
        shifts: [],
        teachers: []
    };
    $("#cfgShifts tr").each(function () {
        const location = $(this).find(".cfg-shift-location").val().trim();
        const classrooms = ($(this).find(".cfg-shift-classrooms").val() || "")
            .split(",").map(classroom => classroom.trim()).filter(classroom => classroom.length > 0);
        if (location.length > 0) {
            // 0 teachers = a volunteers-only shift that is not sent to the solver.
            const teacherCount = parseInt($(this).find(".cfg-shift-teachers").val());
            config.shifts.push({
                location: location,
                start: $(this).find(".cfg-shift-start").val() || "12:00",
                end: $(this).find(".cfg-shift-end").val() || "13:00",
                classrooms: classrooms,
                teachers: Math.max(0, isNaN(teacherCount) ? 1 : teacherCount),
                excludedDays: $(this).find(".cfg-shift-excluded-day:checked").map((i, e) => parseInt(e.value)).get()
            });
        }
    });
    $("#cfgTeachers > div").each(function () {
        const name = $(this).find(".cfg-teacher-name").val().trim();
        if (name.length === 0) {
            return;
        }
        const workingMornings = $(this).find(".cfg-working-morning:checked").map((i, e) => parseInt(e.value)).get();
        // Wednesday never has an afternoon.
        const workingAfternoons = $(this).find(".cfg-working-afternoon:checked").map((i, e) => parseInt(e.value)).get()
            .filter(day => day !== WEDNESDAY);
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
        const alternativeClassrooms = [];
        $(this).find(".cfg-alt-classroom-row").each(function () {
            const classroom = $(this).find(".cfg-alt-classroom").val().trim();
            const mornings = $(this).find(".cfg-alt-morning:checked").map((i, e) => parseInt(e.value)).get();
            const afternoons = $(this).find(".cfg-alt-afternoon:checked").map((i, e) => parseInt(e.value)).get()
                .filter(day => day !== WEDNESDAY);
            // Skip rows without a classroom or without any checked day half.
            if (classroom.length > 0 && (mornings.length > 0 || afternoons.length > 0)) {
                alternativeClassrooms.push({classroom: classroom, mornings: mornings, afternoons: afternoons});
            }
        });
        const contract = $(this).find(".cfg-teacher-contract").val() || "FULL_TIME";
        config.teachers.push({
            name: name,
            classroom: $(this).find(".cfg-teacher-classroom").val().trim(),
            alternativeClassrooms: alternativeClassrooms,
            contract: contract,
            maxMinutes: contract === "CUSTOM"
                ? Math.max(0, parseInt($(this).find(".cfg-teacher-max-minutes").val()) || 0)
                : null,
            workingMornings: workingMornings,
            workingAfternoons: workingAfternoons,
            undesiredDays: $(this).find(".cfg-undesired-day:checked").map((i, e) => parseInt(e.value)).get(),
            desiredDays: $(this).find(".cfg-desired-day:checked").map((i, e) => parseInt(e.value)).get(),
            exceptions: exceptions
        });
    });
    return config;
}

function uploadConfigFile(file) {
    if (file == null) {
        return;
    }
    const reader = new FileReader();
    reader.onload = function () {
        let config;
        try {
            config = JSON.parse(reader.result);
        } catch (e) {
            showWarning("Kon het bestand niet lezen.", "Dit is geen geldig JSON-bestand: " + e.message);
            return;
        }
        migrateScheduleConfig(config);
        if (!isValidScheduleConfig(config)) {
            showWarning("Ongeldig configuratiebestand.",
                "Het bestand moet \"weeks\" (getal), \"shifts\" (locatie, start, einde) "
                + "en \"teachers\" (naam, workingMornings, workingAfternoons) bevatten.");
            return;
        }
        applyScheduleConfig(config);
    };
    reader.readAsText(file);
}

function exportConfig() {
    const blob = new Blob([JSON.stringify(scheduleConfig, null, 2)], {type: "application/json"});
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "pauzetoezicht-config.json";
    link.click();
    URL.revokeObjectURL(link.href);
}

/**
 * Exports the roster itself (not the config): the teachers, the shifts with their
 * assigned teacher, pinned state and the score, so a planned roster can be saved
 * and loaded again later.
 */
function exportRoster() {
    if (loadedSchedule == null) {
        return;
    }
    const blob = new Blob([JSON.stringify(loadedSchedule, null, 2)], {type: "application/json"});
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "pauzetoezicht-rooster.json";
    link.click();
    URL.revokeObjectURL(link.href);
}

function isValidRoster(roster) {
    return roster != null
        && Array.isArray(roster.employees)
        && roster.employees.every(employee => employee != null && typeof employee.name === "string")
        && Array.isArray(roster.shifts)
        && roster.shifts.every(shift => shift != null
            && typeof shift.location === "string"
            && typeof shift.start === "string" && typeof shift.end === "string");
}

function uploadRosterFile(file) {
    if (file == null) {
        return;
    }
    const reader = new FileReader();
    reader.onload = function () {
        let roster;
        try {
            roster = JSON.parse(reader.result);
        } catch (e) {
            showWarning("Kon het bestand niet lezen.", "Dit is geen geldig JSON-bestand: " + e.message);
            return;
        }
        if (!isValidRoster(roster)) {
            showWarning("Ongeldig roosterbestand.",
                "Het bestand moet \"employees\" (naam) en \"shifts\" (locatie, start, einde) bevatten.");
            return;
        }
        // The skills and date arrays are required to render the roster; default them when missing.
        roster.employees.forEach(employee => {
            employee.skills = employee.skills || [];
            employee.unavailableDates = employee.unavailableDates || [];
            employee.undesiredDates = employee.undesiredDates || [];
            employee.desiredDates = employee.desiredDates || [];
        });
        // An imported roster is not a running solver job.
        scheduleId = null;
        roster.solverStatus = "NOT_SOLVING";
        loadedSchedule = roster;
        renderSchedule(roster);
    };
    reader.readAsText(file);
}

function applyScheduleConfig(config) {
    scheduleConfig = config;
    try {
        localStorage.setItem("lunchDutyConfig", JSON.stringify(scheduleConfig));
    } catch (e) {
        console.warn("Could not store config.", e);
    }
    scheduleId = null;
    loadedSchedule = generateScheduleFromConfig(scheduleConfig);
    renderSchedule(loadedSchedule);
}

function showWarning(title, message) {
    const notification = $(`<div class="toast" role="alert" aria-live="assertive" aria-atomic="true" style="min-width: 30rem"/>`)
        .append($(`<div class="toast-header bg-danger">
                 <strong class="me-auto text-dark">Fout</strong>
                 <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Sluiten"></button>
               </div>`))
        .append($(`<div class="toast-body"/>`)
            .append($(`<p/>`).text(title))
            .append($(`<pre/>`).append($(`<code/>`).text(message))));
    $("#notificationPanel").append(notification);
    notification.toast({delay: 30000});
    notification.toast('show');
}

function generateDataFromEditor() {
    applyScheduleConfig(readDataEditor());
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
        const undesiredPeriods = [];
        const desiredPeriods = [];
        const alternativeClassroomPeriods = [];
        // Day halves that are not part of the teacher's contract are unavailable:
        // the morning (08:00-12:25), the afternoon (12:25-17:00) or the whole day.
        // Wednesday never has an afternoon.
        schoolDays.forEach(schoolDay => {
            const dayOfWeek = schoolDay.dayOfWeek().value();
            const worksMorning = (teacher.workingMornings || []).includes(dayOfWeek);
            const worksAfternoon = dayOfWeek !== WEDNESDAY
                && (teacher.workingAfternoons || []).includes(dayOfWeek);
            if (!worksMorning && !worksAfternoon) {
                unavailableDates.add(schoolDay.toString());
            } else if (!worksMorning) {
                unavailablePeriods.push(
                    {date: schoolDay.toString(), from: DAY_START_TIME, to: MIDDAY_SPLIT_TIME});
            } else if (!worksAfternoon) {
                unavailablePeriods.push(
                    {date: schoolDay.toString(), from: MIDDAY_SPLIT_TIME, to: DAY_END_TIME});
            }
        });
        // Weekly recurring soft day preferences cover the whole school day (08:00 - 17:00).
        schoolDays.forEach(schoolDay => {
            if ((teacher.undesiredDays || []).includes(schoolDay.dayOfWeek().value())) {
                undesiredPeriods.push({date: schoolDay.toString(), from: DAY_START_TIME, to: DAY_END_TIME});
            }
            if ((teacher.desiredDays || []).includes(schoolDay.dayOfWeek().value())) {
                desiredPeriods.push({date: schoolDay.toString(), from: DAY_START_TIME, to: DAY_END_TIME});
            }
        });
        // Alternative classrooms: on the toggled weekdays and day halves the teacher
        // also matches shifts of another classroom, so they can be planned
        // in multiple classrooms across the week. On those day halves the alternative
        // classroom takes priority over the teacher's own classroom (soft constraint),
        // and the match only counts for breaks overlapping the day half (hard constraint).
        // Wednesday never has an afternoon.
        (teacher.alternativeClassrooms || []).forEach(alternative => {
            if (!alternative.classroom) {
                return;
            }
            schoolDays.forEach(schoolDay => {
                const dayOfWeek = schoolDay.dayOfWeek().value();
                if ((alternative.mornings || []).includes(dayOfWeek)) {
                    alternativeClassroomPeriods.push({classroom: alternative.classroom,
                        date: schoolDay.toString(), from: DAY_START_TIME, to: MIDDAY_SPLIT_TIME});
                }
                if (dayOfWeek !== WEDNESDAY && (alternative.afternoons || []).includes(dayOfWeek)) {
                    alternativeClassroomPeriods.push({classroom: alternative.classroom,
                        date: schoolDay.toString(), from: MIDDAY_SPLIT_TIME, to: DAY_END_TIME});
                }
            });
        });
        // Exceptions, optionally repeated weekly.
        // repeats = 0 repeats the exception every week on the same weekday throughout the schedule;
        // repeats = n applies it on the given date plus n extra weeks.
        (teacher.exceptions || []).forEach(exception => {
            const baseDate = JSJoda.LocalDate.parse(exception.date);
            const occurrences = [];
            if (exception.repeats > 0) {
                for (let i = 0; i <= exception.repeats; i++) {
                    occurrences.push(baseDate.plusWeeks(i));
                }
            } else {
                // Every occurrence of this weekday within the schedule.
                let occurrence = baseDate;
                while (occurrence.minusWeeks(1).compareTo(startMonday) >= 0) {
                    occurrence = occurrence.minusWeeks(1);
                }
                while (occurrence.compareTo(lastDay) <= 0) {
                    occurrences.push(occurrence);
                    occurrence = occurrence.plusWeeks(1);
                }
            }
            occurrences.forEach(occurrence => {
                if (occurrence.compareTo(startMonday) < 0 || occurrence.compareTo(lastDay) > 0) {
                    return;
                }
                if (exception.from && exception.to) {
                    // Part of the day instead of the whole day, for every exception type.
                    const period = {date: occurrence.toString(), from: exception.from, to: exception.to};
                    if (exception.type === "undesired") {
                        undesiredPeriods.push(period);
                    } else if (exception.type === "desired") {
                        desiredPeriods.push(period);
                    } else {
                        unavailablePeriods.push(period);
                    }
                } else {
                    const target = exception.type === "undesired" ? undesiredDates
                        : exception.type === "desired" ? desiredDates : unavailableDates;
                    target.add(occurrence.toString());
                }
            });
        });
        return {
            name: teacher.name,
            skills: ["Teacher"],
            classroom: teacher.classroom || null,
            alternativeClassroomPeriods: alternativeClassroomPeriods,
            unavailableDates: [...unavailableDates],
            unavailablePeriods: unavailablePeriods,
            undesiredDates: [...undesiredDates],
            desiredDates: [...desiredDates],
            undesiredPeriods: undesiredPeriods,
            desiredPeriods: desiredPeriods
        };
    });

    // An empty classrooms field means the shift supervises all classrooms.
    const allClassrooms = [...new Set([
        ...config.teachers.map(teacher => teacher.classroom),
        ...config.shifts.flatMap(shiftDef => shiftDef.classrooms || [])
    ].filter(classroom => classroom != null && classroom.length > 0))].sort();

    const shifts = [];
    let id = 0;
    schoolDays.forEach(schoolDay => {
        config.shifts.forEach(shiftDef => {
            if ((shiftDef.excludedDays || []).includes(schoolDay.dayOfWeek().value())) {
                return;
            }
            const teacherCount = shiftDef.teachers != null ? shiftDef.teachers : 1;
            if (teacherCount === 0) {
                // A shift without teachers is not sent to the solver: it only appears on the
                // (printed) roster so that volunteers can be written in with pen.
                shifts.push({
                    id: String(id++),
                    start: schoolDay.atTime(JSJoda.LocalTime.parse(shiftDef.start)).toString(),
                    end: schoolDay.atTime(JSJoda.LocalTime.parse(shiftDef.end)).toString(),
                    location: shiftDef.location,
                    requiredSkill: "Teacher",
                    classrooms: shiftDef.classrooms.length > 0 ? shiftDef.classrooms : allClassrooms,
                    employee: null,
                    volunteersOnly: true
                });
                return;
            }
            // A shift that needs several teachers at once becomes that many shifts;
            // each one gets its own teacher.
            for (let teacherSeat = 0; teacherSeat < teacherCount; teacherSeat++) {
                shifts.push({
                    id: String(id++),
                    start: schoolDay.atTime(JSJoda.LocalTime.parse(shiftDef.start)).toString(),
                    end: schoolDay.atTime(JSJoda.LocalTime.parse(shiftDef.end)).toString(),
                    location: shiftDef.location,
                    requiredSkill: "Teacher",
                    classrooms: shiftDef.classrooms.length > 0 ? shiftDef.classrooms : allClassrooms,
                    employee: null
                });
            }
        });
    });

    // The maximum duty time per teacher per week (a hard constraint for the solver): the total
    // weekly shift time is divided over all teachers, weighted by their contract ratio. Teachers
    // with a custom contract get exactly their configured weekly maximum and stay out of the
    // weighted division. Volunteer shifts take no teacher time, so they do not count towards
    // the total.
    const totalShiftMinutes = shifts.filter(shift => !shift.volunteersOnly)
        .reduce((total, shift) => total
        + JSJoda.LocalDateTime.parse(shift.start)
            .until(JSJoda.LocalDateTime.parse(shift.end), JSJoda.ChronoUnit.MINUTES), 0);
    // Every week of the schedule has the same shifts, so the weekly total is the total divided
    // over the number of weeks.
    const weeklyShiftMinutes = totalShiftMinutes / config.weeks;
    const ratioSum = config.teachers
        .map(teacher => contractRatio(teacher))
        .filter(ratio => ratio != null)
        .reduce((sum, ratio) => sum + ratio, 0);
    // Minute limits are rounded up to the nearest multiple of 5.
    const roundUpTo5 = minutes => Math.ceil(minutes / 5) * 5;
    config.teachers.forEach((teacher, index) => {
        const ratio = contractRatio(teacher);
        employees[index].workRatio = ratio;
        employees[index].maxWorkingMinutes = ratio == null
            ? roundUpTo5(Math.max(0, parseInt(teacher.maxMinutes) || 0))
            : (ratioSum > 0 ? roundUpTo5(weeklyShiftMinutes * ratio / ratioSum) : null);
    });

    return {employees: employees, shifts: shifts, score: null, solverStatus: null};
}

function solve() {
    // Volunteer shifts (0 teachers) are purely visual and are not sent to the solver.
    const solverSchedule = {...loadedSchedule,
        shifts: loadedSchedule.shifts.filter(shift => !shift.volunteersOnly)};
    $.post("/schedules", JSON.stringify(solverSchedule), function (data) {
        scheduleId = data;
        refreshSolvingButtons(true);
    }).fail(function (xhr, ajaxOptions, thrownError) {
            showError("Starten van oplossen is mislukt.", xhr);
            refreshSolvingButtons(false);
        },
        "text");
}

function refreshSolvingButtons(solving) {
    // While solving, the roster shows the best solution so far and keeps refreshing every 2 seconds.
    $("#solvingStatus").text(solving ? "Bezig met oplossen… het rooster wordt nog verbeterd." : "");
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
