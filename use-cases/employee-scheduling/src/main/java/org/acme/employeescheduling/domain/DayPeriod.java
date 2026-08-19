package org.acme.employeescheduling.domain;

import java.time.LocalDate;
import java.time.LocalTime;

/**
 * A part of a day, used either as an unavailability (for example a morning off)
 * or as a soft preference window (for example an undesired afternoon).
 */
public class DayPeriod {

    private LocalDate date;
    private LocalTime from;
    private LocalTime to;

    public DayPeriod() {
    }

    public DayPeriod(LocalDate date, LocalTime from, LocalTime to) {
        this.date = date;
        this.from = from;
        this.to = to;
    }

    public LocalDate getDate() {
        return date;
    }

    public void setDate(LocalDate date) {
        this.date = date;
    }

    public LocalTime getFrom() {
        return from;
    }

    public void setFrom(LocalTime from) {
        this.from = from;
    }

    public LocalTime getTo() {
        return to;
    }

    public void setTo(LocalTime to) {
        this.to = to;
    }
}
