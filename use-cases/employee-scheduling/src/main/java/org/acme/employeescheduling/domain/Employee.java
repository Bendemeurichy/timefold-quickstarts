package org.acme.employeescheduling.domain;

import java.time.LocalDate;
import java.util.List;
import java.util.Objects;
import java.util.Set;

import ai.timefold.solver.core.api.domain.common.PlanningId;

public class Employee {
    @PlanningId
    private String name;
    private Set<String> skills;

    /**
     * The classroom this teacher is attached to. The teacher only matches shifts that supervise this classroom.
     */
    private String classroom;

    private Set<LocalDate> unavailableDates;
    /**
     * Parts of days during which this teacher is not available (for example a morning off).
     */
    private List<UnavailablePeriod> unavailablePeriods;
    private Set<LocalDate> undesiredDates;
    private Set<LocalDate> desiredDates;

    public Employee() {

    }

    public Employee(String name, Set<String> skills,
        Set<LocalDate> unavailableDates, Set<LocalDate> undesiredDates, Set<LocalDate> desiredDates) {
        this(name, skills, null, unavailableDates, undesiredDates, desiredDates);
    }

    public Employee(String name, Set<String> skills, String classroom,
        Set<LocalDate> unavailableDates, Set<LocalDate> undesiredDates, Set<LocalDate> desiredDates) {
        this(name, skills, classroom, unavailableDates, List.of(), undesiredDates, desiredDates);
    }

    public Employee(String name, Set<String> skills, String classroom,
        Set<LocalDate> unavailableDates, List<UnavailablePeriod> unavailablePeriods,
        Set<LocalDate> undesiredDates, Set<LocalDate> desiredDates) {
        this.name = name;
        this.skills = skills;
        this.classroom = classroom;
        this.unavailableDates = unavailableDates;
        this.unavailablePeriods = unavailablePeriods;
        this.undesiredDates = undesiredDates;
        this.desiredDates = desiredDates;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Set<String> getSkills() {
        return skills;
    }

    public void setSkills(Set<String> skills) {
        this.skills = skills;
    }

    public String getClassroom() {
        return classroom;
    }

    public void setClassroom(String classroom) {
        this.classroom = classroom;
    }

    public Set<LocalDate> getUnavailableDates() {
        return unavailableDates;
    }

    public void setUnavailableDates(Set<LocalDate> unavailableDates) {
        this.unavailableDates = unavailableDates;
    }

    public List<UnavailablePeriod> getUnavailablePeriods() {
        // Null-safe: constraint streams flatten this list.
        return unavailablePeriods == null ? List.of() : unavailablePeriods;
    }

    public void setUnavailablePeriods(List<UnavailablePeriod> unavailablePeriods) {
        this.unavailablePeriods = unavailablePeriods;
    }

    public Set<LocalDate> getUndesiredDates() {
        return undesiredDates;
    }

    public void setUndesiredDates(Set<LocalDate> undesiredDates) {
        this.undesiredDates = undesiredDates;
    }

    public Set<LocalDate> getDesiredDates() {
        return desiredDates;
    }

    public void setDesiredDates(Set<LocalDate> desiredDates) {
        this.desiredDates = desiredDates;
    }

    @Override
    public String toString() {
        return name;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof Employee employee)) {
            return false;
        }
        return Objects.equals(getName(), employee.getName());
    }

    @Override
    public int hashCode() {
        return getName().hashCode();
    }
}
