package org.acme.employeescheduling.domain;

import java.time.LocalDate;
import java.time.LocalTime;

/**
 * A part of a day during which a teacher can also be planned in another classroom
 * (for example "on Monday mornings Amy also covers 2B"), on top of their own classroom.
 */
public class ClassroomPeriod extends DayPeriod {

    private String classroom;

    public ClassroomPeriod() {
    }

    public ClassroomPeriod(String classroom, LocalDate date, LocalTime from, LocalTime to) {
        super(date, from, to);
        this.classroom = classroom;
    }

    public String getClassroom() {
        return classroom;
    }

    public void setClassroom(String classroom) {
        this.classroom = classroom;
    }
}
