package org.acme.employeescheduling.solver;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import jakarta.inject.Inject;

import ai.timefold.solver.core.api.solver.Solver;
import ai.timefold.solver.core.api.solver.SolverFactory;

import org.acme.employeescheduling.domain.Employee;
import org.acme.employeescheduling.domain.EmployeeSchedule;
import org.acme.employeescheduling.domain.Shift;
import org.junit.jupiter.api.Test;

import io.quarkus.test.junit.QuarkusTest;

/**
 * Replicates what the UI sends when a teacher marks days as "Liever niet" (undesired)
 * or "Voorkeur" (desired) through the exception interface: whole-day exceptions become
 * entries in undesiredDates/desiredDates.
 */
@QuarkusTest
class ExceptionPreferenceSolveTest {

    @Inject
    SolverFactory<EmployeeSchedule> solverFactory;

    @Test
    void undesiredDateFromExceptionIsAvoided() {
        LocalDate monday = LocalDate.now().with(TemporalAdjusters.nextOrSame(DayOfWeek.MONDAY));

        // Two full-time teachers, Amy does not want to work on Monday (whole-day exception).
        Employee amy = new Employee("Amy", Set.of("Teacher"), null, Set.of(), Set.of(monday), Set.of());
        amy.setWorkRatio(1.0);
        Employee beth = new Employee("Beth", Set.of("Teacher"), null, Set.of(), Set.of(), Set.of());
        beth.setWorkRatio(1.0);

        // One shift per day, Monday to Friday.
        List<Shift> shifts = new ArrayList<>();
        for (int day = 0; day < 5; day++) {
            LocalDateTime start = monday.plusDays(day).atTime(LocalTime.of(12, 0));
            Shift shift = new Shift(String.valueOf(day), start, start.plusHours(1), "Refter", "Teacher", null);
            shift.setClassrooms(Set.of());
            shifts.add(shift);
        }

        EmployeeSchedule problem = new EmployeeSchedule(List.of(amy, beth), shifts);
        Solver<EmployeeSchedule> solver = solverFactory.buildSolver();
        EmployeeSchedule solution = solver.solve(problem);

        Shift mondayShift = solution.getShifts().get(0);
        // The undesired day must be avoidable: Beth can take the Monday shift.
        assertThat(mondayShift.getEmployee()).isNotNull();
        assertThat(mondayShift.getEmployee().getName()).isEqualTo("Beth");
    }

    @Test
    void preferencesBeatFairness() {
        LocalDate monday = LocalDate.now().with(TemporalAdjusters.nextOrSame(DayOfWeek.MONDAY));

        // Amy prefers not to work Monday to Thursday; Beth prefers to work exactly those days.
        // Honoring both preferences forces an unbalanced 2/8 shift split (Amy can only take
        // the 2 Friday shifts); a perfectly balanced 5/5 split violates 3 of Amy's undesired
        // days and misses 3 of Beth's desired days. The preferences must outweigh fairness.
        Set<LocalDate> mondayToThursday = Set.of(monday, monday.plusDays(1), monday.plusDays(2),
                monday.plusDays(3));
        Employee amy = new Employee("Amy", Set.of("Teacher"), null, Set.of(), mondayToThursday, Set.of());
        amy.setWorkRatio(1.0);
        Employee beth = new Employee("Beth", Set.of("Teacher"), null, Set.of(), Set.of(), mondayToThursday);
        beth.setWorkRatio(1.0);

        // Two shifts per school day, outside the lunch window, no classroom restrictions.
        List<Shift> shifts = new ArrayList<>();
        int id = 0;
        for (int day = 0; day < 5; day++) {
            for (int hour = 9; hour <= 10; hour++) {
                LocalDateTime start = monday.plusDays(day).atTime(LocalTime.of(hour, 0));
                Shift shift = new Shift(String.valueOf(id++), start, start.plusMinutes(30), "Speelplaats",
                        "Teacher", null);
                shift.setClassrooms(Set.of());
                shifts.add(shift);
            }
        }

        EmployeeSchedule problem = new EmployeeSchedule(List.of(amy, beth), shifts);
        Solver<EmployeeSchedule> solver = solverFactory.buildSolver();
        EmployeeSchedule solution = solver.solve(problem);

        long amyShiftsOnUndesiredDays = solution.getShifts().stream()
                .filter(shift -> amy.equals(shift.getEmployee())
                        && mondayToThursday.contains(shift.getStart().toLocalDate()))
                .count();
        long bethShiftsOnDesiredDays = solution.getShifts().stream()
                .filter(shift -> beth.equals(shift.getEmployee())
                        && mondayToThursday.contains(shift.getStart().toLocalDate()))
                .count();
        System.out.println("Score: " + solution.getScore()
                + ", Amy on her undesired days: " + amyShiftsOnUndesiredDays
                + ", Beth on her desired days: " + bethShiftsOnDesiredDays);

        assertThat(amyShiftsOnUndesiredDays).isZero();
        assertThat(bethShiftsOnDesiredDays).isEqualTo(8);
    }
}
