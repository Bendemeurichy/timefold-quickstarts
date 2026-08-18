package org.acme.employeescheduling.solver;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import jakarta.inject.Inject;

import ai.timefold.solver.core.api.solver.Solver;
import ai.timefold.solver.core.api.solver.SolverFactory;
import ai.timefold.solver.core.config.solver.SolverConfig;

import org.acme.employeescheduling.domain.Employee;
import org.acme.employeescheduling.domain.EmployeeSchedule;
import org.acme.employeescheduling.domain.Shift;
import org.acme.employeescheduling.domain.UnavailablePeriod;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import io.quarkus.test.junit.QuarkusTest;

@QuarkusTest
class LunchScheduleTest {

    private static final LocalDate MONDAY = LocalDate.of(2026, 8, 24);
    private static final List<LocalDate> SCHOOL_DAYS = List.of(
            MONDAY, MONDAY.plusDays(1), MONDAY.plusDays(2), MONDAY.plusDays(3), MONDAY.plusDays(4));

    private static final LocalTime LUNCH_START = LocalTime.of(12, 0);
    private static final LocalTime LUNCH_END = LocalTime.of(13, 0);

    private static final String TEACHER_SKILL = "Teacher";

    // Lunch shifts per day: a location with the classrooms it supervises. There is no lunch on Wednesday.
    private static final Map<String, Set<String>> LUNCH_SHIFTS = Map.of(
            "Refter", Set.of("1A", "1B"),
            "Speelplaats", Set.of("2A", "2B"));

    @Inject
    SolverConfig solverConfig;

    @Test
    @Timeout(120)
    void solveLunchSchedule() {
        // 5 teachers, each attached to their own classroom, with different working days;
        // weekdays they do not work are unavailable.
        Employee beth = teacher("Beth", "1B",
                Set.of(DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.THURSDAY, DayOfWeek.FRIDAY));
        // Beth has a doctor's appointment on Monday and only misses part of the day.
        beth.setUnavailablePeriods(List.of(new UnavailablePeriod(MONDAY, LocalTime.of(11, 30), LocalTime.of(12, 30))));
        List<Employee> teachers = List.of(
                teacher("Amy", "1A", Set.of(DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY,
                        DayOfWeek.FRIDAY)),
                beth,
                teacher("Carl", "2A", Set.of(DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY)),
                teacher("Dan", "2B", Set.of(DayOfWeek.TUESDAY, DayOfWeek.THURSDAY)),
                teacher("Elsa", "1A", Set.of(DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY,
                        DayOfWeek.FRIDAY), MONDAY.plusDays(3))); // doctor's appointment on Thursday

        // Lunch shifts from 12:00 to 13:00; there is no lunch on Wednesday.
        List<Shift> shifts = new ArrayList<>();
        int id = 0;
        for (LocalDate schoolDay : SCHOOL_DAYS) {
            if (schoolDay.getDayOfWeek() == DayOfWeek.WEDNESDAY) {
                continue;
            }
            for (Map.Entry<String, Set<String>> lunchShift : LUNCH_SHIFTS.entrySet()) {
                Shift shift = new Shift(Integer.toString(id++), schoolDay.atTime(LUNCH_START), schoolDay.atTime(LUNCH_END),
                        lunchShift.getKey(), TEACHER_SKILL, null);
                shift.setClassrooms(lunchShift.getValue());
                shifts.add(shift);
            }
        }
        assertEquals(8, shifts.size());

        EmployeeSchedule problem = new EmployeeSchedule(teachers, shifts);

        SolverFactory<EmployeeSchedule> solverFactory = SolverFactory.create(solverConfig);
        Solver<EmployeeSchedule> solver = solverFactory.buildSolver();
        EmployeeSchedule solution = solver.solve(problem);

        assertTrue(solution.getScore().isFeasible());
        for (Shift shift : solution.getShifts()) {
            // Every lunch shift is assigned to a teacher...
            assertNotNull(shift.getEmployee());
            // ... who works that day and has no unavailability...
            assertFalse(shift.getEmployee().getUnavailableDates().contains(shift.getStart().toLocalDate()),
                    shift.getEmployee() + " is unavailable on " + shift.getStart().toLocalDate());
            // ... who is attached to one of the classrooms the shift supervises...
            assertTrue(shift.getClassrooms().contains(shift.getEmployee().getClassroom()),
                    shift.getEmployee() + " of classroom " + shift.getEmployee().getClassroom()
                            + " does not match " + shift.getClassrooms());
            // ... and who has no part-day unavailability overlapping the shift.
            for (UnavailablePeriod period : shift.getEmployee().getUnavailablePeriods()) {
                if (period.getDate().equals(shift.getStart().toLocalDate())) {
                    assertTrue(!shift.getStart().toLocalTime().isBefore(period.getTo())
                                    || !shift.getEnd().toLocalTime().isAfter(period.getFrom()),
                            shift.getEmployee() + " is unavailable from " + period.getFrom() + " to " + period.getTo()
                                    + " on " + period.getDate());
                }
            }
            // ... and there is never a lunch shift on Wednesday.
            assertNotEquals(DayOfWeek.WEDNESDAY, shift.getStart().getDayOfWeek());
        }
    }

    private Employee teacher(String name, String classroom, Set<DayOfWeek> workingDays,
            LocalDate... extraUnavailableDates) {
        Set<LocalDate> unavailableDates = new LinkedHashSet<>();
        for (LocalDate schoolDay : SCHOOL_DAYS) {
            if (!workingDays.contains(schoolDay.getDayOfWeek())) {
                unavailableDates.add(schoolDay);
            }
        }
        unavailableDates.addAll(Set.of(extraUnavailableDates));
        return new Employee(name, Set.of(TEACHER_SKILL), classroom, unavailableDates, new LinkedHashSet<>(),
                new LinkedHashSet<>());
    }
}
