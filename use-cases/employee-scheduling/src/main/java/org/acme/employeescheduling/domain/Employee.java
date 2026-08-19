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
    /**
     * Extra classrooms this teacher also matches, each limited to a part of a specific day
     * (for example "2B on Monday mornings"). This lets a teacher be planned in multiple
     * classrooms across the week.
     */
    private List<ClassroomPeriod> alternativeClassroomPeriods;

    private Set<LocalDate> unavailableDates;
    /**
     * Parts of days during which this teacher is not available (for example a morning off).
     */
    private List<DayPeriod> unavailablePeriods;
    private Set<LocalDate> undesiredDates;
    private Set<LocalDate> desiredDates;
    /**
     * Parts of days during which this teacher preferably does not work (for example an undesired morning).
     */
    private List<DayPeriod> undesiredPeriods;
    /**
     * Parts of days during which this teacher preferably works.
     */
    private List<DayPeriod> desiredPeriods;

    /**
     * The teacher's contract as a fraction of a full-time contract (for example 0.8 for a 4/5 contract).
     * Null for a custom contract, which uses an explicit {@link #maxWorkingMinutes} instead.
     */
    private Double workRatio;
    /**
     * The maximum number of minutes this teacher may be assigned per week.
     * Null means no limit.
     */
    private Integer maxWorkingMinutes;

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
        Set<LocalDate> unavailableDates, List<DayPeriod> unavailablePeriods,
        Set<LocalDate> undesiredDates, Set<LocalDate> desiredDates) {
        this(name, skills, classroom, unavailableDates, unavailablePeriods, undesiredDates, desiredDates,
            List.of(), List.of());
    }

    public Employee(String name, Set<String> skills, String classroom,
        Set<LocalDate> unavailableDates, List<DayPeriod> unavailablePeriods,
        Set<LocalDate> undesiredDates, Set<LocalDate> desiredDates,
        List<DayPeriod> undesiredPeriods, List<DayPeriod> desiredPeriods) {
        this.name = name;
        this.skills = skills;
        this.classroom = classroom;
        this.unavailableDates = unavailableDates;
        this.unavailablePeriods = unavailablePeriods;
        this.undesiredDates = undesiredDates;
        this.desiredDates = desiredDates;
        this.undesiredPeriods = undesiredPeriods;
        this.desiredPeriods = desiredPeriods;
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

    public List<ClassroomPeriod> getAlternativeClassroomPeriods() {
        // Null-safe: constraint streams flatten this list.
        return alternativeClassroomPeriods == null ? List.of() : alternativeClassroomPeriods;
    }

    public void setAlternativeClassroomPeriods(List<ClassroomPeriod> alternativeClassroomPeriods) {
        this.alternativeClassroomPeriods = alternativeClassroomPeriods;
    }

    public Set<LocalDate> getUnavailableDates() {
        return unavailableDates;
    }

    public void setUnavailableDates(Set<LocalDate> unavailableDates) {
        this.unavailableDates = unavailableDates;
    }

    public List<DayPeriod> getUnavailablePeriods() {
        // Null-safe: constraint streams flatten this list.
        return unavailablePeriods == null ? List.of() : unavailablePeriods;
    }

    public void setUnavailablePeriods(List<DayPeriod> unavailablePeriods) {
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

    public List<DayPeriod> getUndesiredPeriods() {
        // Null-safe: constraint streams flatten this list.
        return undesiredPeriods == null ? List.of() : undesiredPeriods;
    }

    public void setUndesiredPeriods(List<DayPeriod> undesiredPeriods) {
        this.undesiredPeriods = undesiredPeriods;
    }

    public List<DayPeriod> getDesiredPeriods() {
        // Null-safe: constraint streams flatten this list.
        return desiredPeriods == null ? List.of() : desiredPeriods;
    }

    public void setDesiredPeriods(List<DayPeriod> desiredPeriods) {
        this.desiredPeriods = desiredPeriods;
    }

    public Double getWorkRatio() {
        return workRatio;
    }

    public void setWorkRatio(Double workRatio) {
        this.workRatio = workRatio;
    }

    public Integer getMaxWorkingMinutes() {
        return maxWorkingMinutes;
    }

    public void setMaxWorkingMinutes(Integer maxWorkingMinutes) {
        this.maxWorkingMinutes = maxWorkingMinutes;
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
