package org.acme.employeescheduling.solver;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.Collections;
import java.util.List;
import java.util.Set;

import jakarta.inject.Inject;

import ai.timefold.solver.core.api.score.stream.test.ConstraintVerifier;

import org.acme.employeescheduling.domain.ClassroomPeriod;
import org.acme.employeescheduling.domain.DayPeriod;
import org.acme.employeescheduling.domain.Employee;
import org.acme.employeescheduling.domain.EmployeeSchedule;
import org.acme.employeescheduling.domain.Shift;
import org.junit.jupiter.api.Test;

import io.quarkus.test.junit.QuarkusTest;

@QuarkusTest
class EmployeeSchedulingConstraintProviderTest {
    private static final LocalDate DAY_1 = LocalDate.of(2021, 2, 1);
    private static final LocalDate DAY_3 = LocalDate.of(2021, 2, 3);

    private static final LocalDateTime DAY_START_TIME = DAY_1.atTime(LocalTime.of(9, 0));
    private static final LocalDateTime DAY_END_TIME = DAY_1.atTime(LocalTime.of(17, 0));
    private static final LocalDateTime AFTERNOON_START_TIME = DAY_1.atTime(LocalTime.of(13, 0));
    private static final LocalDateTime AFTERNOON_END_TIME = DAY_1.atTime(LocalTime.of(21, 0));

    @Inject
    ConstraintVerifier<EmployeeSchedulingConstraintProvider, EmployeeSchedule> constraintVerifier;

    @Test
    void requiredSkill() {
        Employee employee = new Employee("Amy", Set.of(), null, null, null);
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::requiredSkill)
                .given(employee,
                        new Shift("1", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", employee))
                .penalizes(1);

        employee = new Employee("Beth", Set.of("Skill"), null, null, null);
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::requiredSkill)
                .given(employee,
                        new Shift("2", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", employee))
                .penalizes(0);

        // An unassigned shift can not miss a required skill.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::requiredSkill)
                .given(new Shift("3", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", null))
                .penalizes(0);
    }

    @Test
    void classroomMatch() {
        Employee teacher = new Employee("Amy", Set.of("Teacher"), "1A", null, null, null);
        Shift shift = new Shift("1", DAY_START_TIME, DAY_END_TIME, "Refter", "Teacher", teacher);

        // The shift supervises the teacher's own classroom.
        shift.setClassrooms(Set.of("1A", "1B"));
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::classroomMatch)
                .given(teacher, shift)
                .penalizes(0);

        // The shift only supervises another classroom.
        shift.setClassrooms(Set.of("2A"));
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::classroomMatch)
                .given(teacher, shift)
                .penalizes(1);

        // A teacher without a classroom can be scheduled for every shift.
        Employee teacherWithoutClassroom = new Employee("Beth", Set.of("Teacher"), null, null, null, null);
        Shift shiftWithoutClassroomTeacher = new Shift("2", DAY_START_TIME, DAY_END_TIME, "Refter", "Teacher",
                teacherWithoutClassroom);
        shiftWithoutClassroomTeacher.setClassrooms(Set.of("2A"));
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::classroomMatch)
                .given(teacherWithoutClassroom, shiftWithoutClassroomTeacher)
                .penalizes(0);

        // A shift without classrooms matches any teacher.
        shift.setClassrooms(null);
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::classroomMatch)
                .given(teacher, shift)
                .penalizes(0);
        shift.setClassrooms(Collections.emptySet());
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::classroomMatch)
                .given(teacher, shift)
                .penalizes(0);

        // An unassigned shift can not be in the wrong classroom.
        shift.setClassrooms(Set.of("2A"));
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::classroomMatch)
                .given(new Shift("3", DAY_START_TIME, DAY_END_TIME, "Refter", "Teacher", null))
                .penalizes(0);
    }

    @Test
    void classroomMatchWithAlternativeClassroom() {
        // Carl (classroom 1A) also covers classroom 2A, but only on Monday mornings.
        Employee teacher = new Employee("Carl", Set.of("Teacher"), "1A", null, null, null);
        teacher.setAlternativeClassroomPeriods(List.of(
                new ClassroomPeriod("2A", DAY_1, LocalTime.of(8, 0), LocalTime.of(12, 0))));

        // A shift for 2A inside the alternative classroom period matches: no penalty.
        Shift morningShift = new Shift("1", DAY_1.atTime(10, 0), DAY_1.atTime(10, 30), "Speelplaats", "Teacher",
                teacher);
        morningShift.setClassrooms(Set.of("2A"));
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::classroomMatch)
                .given(teacher, morningShift)
                .penalizes(0);

        // The alternative classroom only applies in the morning: an afternoon shift is penalized.
        Shift afternoonShift = new Shift("2", DAY_1.atTime(14, 45), DAY_1.atTime(15, 15), "Speelplaats", "Teacher",
                teacher);
        afternoonShift.setClassrooms(Set.of("2A"));
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::classroomMatch)
                .given(teacher, afternoonShift)
                .penalizes(1);

        // The alternative classroom does not apply on another day.
        Shift otherDayShift = new Shift("3", DAY_3.atTime(10, 0), DAY_3.atTime(10, 30), "Speelplaats", "Teacher",
                teacher);
        otherDayShift.setClassrooms(Set.of("2A"));
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::classroomMatch)
                .given(teacher, otherDayShift)
                .penalizes(1);

        // A shift supervising another classroom than the alternative one is penalized.
        Shift otherClassroomShift = new Shift("4", DAY_1.atTime(10, 0), DAY_1.atTime(10, 30), "Speelplaats", "Teacher",
                teacher);
        otherClassroomShift.setClassrooms(Set.of("3A"));
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::classroomMatch)
                .given(teacher, otherClassroomShift)
                .penalizes(1);
    }

    @Test
    void alternativeClassroomPriority() {
        // Carl (classroom 1A) also covers classroom 2A, but only on Monday mornings.
        Employee teacher = new Employee("Carl", Set.of("Teacher"), "1A", null, null, null);
        teacher.setAlternativeClassroomPeriods(List.of(
                new ClassroomPeriod("2A", DAY_1, LocalTime.of(8, 0), LocalTime.of(12, 0))));

        // During the alternative classroom period a break for his own classroom is penalized:
        // the alternative classroom takes priority over his own classroom.
        Shift ownClassroomShift = new Shift("1", DAY_1.atTime(10, 0), DAY_1.atTime(10, 30), "Speelplaats",
                "Teacher", teacher);
        ownClassroomShift.setClassrooms(Set.of("1A", "1B"));
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::alternativeClassroomPriority)
                .given(teacher, ownClassroomShift)
                .penalizes(1);

        // A break covering the alternative classroom during its period is not penalized.
        Shift alternativeShift = new Shift("2", DAY_1.atTime(10, 0), DAY_1.atTime(10, 30), "Speelplaats",
                "Teacher", teacher);
        alternativeShift.setClassrooms(Set.of("2A", "2B"));
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::alternativeClassroomPriority)
                .given(teacher, alternativeShift)
                .penalizes(0);

        // Outside the alternative classroom period a break for his own classroom is not penalized.
        Shift afternoonShift = new Shift("3", DAY_1.atTime(14, 45), DAY_1.atTime(15, 15), "Speelplaats",
                "Teacher", teacher);
        afternoonShift.setClassrooms(Set.of("1A", "1B"));
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::alternativeClassroomPriority)
                .given(teacher, afternoonShift)
                .penalizes(0);

        // The alternative classroom does not apply on another day.
        Shift otherDayShift = new Shift("4", DAY_3.atTime(10, 0), DAY_3.atTime(10, 30), "Speelplaats",
                "Teacher", teacher);
        otherDayShift.setClassrooms(Set.of("1A", "1B"));
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::alternativeClassroomPriority)
                .given(teacher, otherDayShift)
                .penalizes(0);

        // A break without classrooms supervises all classrooms, including the alternative one.
        Shift allClassroomsShift = new Shift("5", DAY_1.atTime(10, 0), DAY_1.atTime(10, 30), "Speelplaats",
                "Teacher", teacher);
        allClassroomsShift.setClassrooms(Collections.emptySet());
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::alternativeClassroomPriority)
                .given(teacher, allClassroomsShift)
                .penalizes(0);

        // An unassigned shift is not penalized.
        Shift unassignedShift = new Shift("6", DAY_1.atTime(10, 0), DAY_1.atTime(10, 30), "Speelplaats",
                "Teacher", null);
        unassignedShift.setClassrooms(Set.of("1A", "1B"));
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::alternativeClassroomPriority)
                .given(teacher, unassignedShift)
                .penalizes(0);
    }

    @Test
    void unassignedShift() {
        Employee employee = new Employee("Amy", null, null, null, null);
        // A shift without a teacher is penalized, so the solver only leaves shifts
        // unassigned when every possible assignment breaks a hard constraint.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::unassignedShift)
                .given(new Shift("1", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", null))
                .penalizes(1);
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::unassignedShift)
                .given(employee,
                        new Shift("2", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", employee))
                .penalizes(0);
    }

    @Test
    void overlappingShifts() {
        Employee employee1 = new Employee("Amy", null, null, null, null);
        Employee employee2 = new Employee("Beth", null, null, null, null);
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::noOverlappingShifts)
                .given(employee1, employee2,
                        new Shift("1", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", employee1),
                        new Shift("2", DAY_START_TIME, DAY_END_TIME, "Location 2", "Skill", employee1))
                .penalizes(1);

        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::noOverlappingShifts)
                .given(employee1, employee2,
                        new Shift("1", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", employee1),
                        new Shift("2", DAY_START_TIME, DAY_END_TIME, "Location 2", "Skill", employee2))
                .penalizes(0);

        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::noOverlappingShifts)
                .given(employee1, employee2,
                        new Shift("1", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", employee1),
                        new Shift("2", AFTERNOON_START_TIME, AFTERNOON_END_TIME, "Location 2", "Skill", employee1))
                .penalizes(1);

        // Consecutive shifts directly after one another (end == start) do not overlap and can be assigned to the same teacher.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::noOverlappingShifts)
                .given(employee1,
                        new Shift("1", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", employee1),
                        new Shift("2", DAY_END_TIME, DAY_END_TIME.plusHours(1), "Location 2", "Skill", employee1))
                .penalizes(0);

        // Two unassigned shifts at the same time do not overlap: unassigned employees (null) never join.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::noOverlappingShifts)
                .given(new Shift("1", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", null),
                        new Shift("2", DAY_START_TIME, DAY_END_TIME, "Location 2", "Skill", null))
                .penalizes(0);

        // An assigned and an unassigned shift at the same time do not overlap either.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::noOverlappingShifts)
                .given(employee1,
                        new Shift("1", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", employee1),
                        new Shift("2", DAY_START_TIME, DAY_END_TIME, "Location 2", "Skill", null))
                .penalizes(0);
    }

    @Test
    void unavailableEmployee() {
        Employee employee1 = new Employee("Amy", null, Set.of(DAY_1, DAY_3), null, null);
        Employee employee2 = new Employee("Beth", null, Set.of(), null, null);
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::unavailableEmployee)
                .given(employee1, employee2,
                        new Shift("1", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", employee1))
                .penalizes(1);
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::unavailableEmployee)
                .given(employee1, employee2,
                        new Shift("1", DAY_START_TIME.plusDays(1), DAY_END_TIME.plusDays(1), "Location", "Skill", employee1))
                .penalizes(0);
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::unavailableEmployee)
                .given(employee1, employee2,
                        new Shift("1", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", employee2))
                .penalizes(0);
    }

    @Test
    void unavailableEmployeePartOfDay() {
        // Not available on Monday morning, for example a weekly doctor's appointment.
        Employee employee = new Employee("Amy", Set.of("Teacher"), "1A", Set.of(),
                List.of(new DayPeriod(DAY_1, LocalTime.of(8, 0), LocalTime.of(12, 30))),
                Set.of(), Set.of());

        // A shift overlapping the unavailable period is penalized.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::unavailableEmployeePartOfDay)
                .given(employee,
                        new Shift("1", DAY_1.atTime(12, 0), DAY_1.atTime(13, 0), "Refter", "Teacher", employee))
                .penalizes(1);
        // A shift not overlapping the unavailable period is not penalized.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::unavailableEmployeePartOfDay)
                .given(employee,
                        new Shift("2", DAY_1.atTime(14, 0), DAY_1.atTime(15, 0), "Refter", "Teacher", employee))
                .penalizes(0);
        // A shift on another day is not penalized.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::unavailableEmployeePartOfDay)
                .given(employee,
                        new Shift("3", DAY_3.atTime(9, 0), DAY_3.atTime(10, 0), "Refter", "Teacher", employee))
                .penalizes(0);
    }

    @Test
    void undesiredDayForEmployee() {
        Employee employee1 = new Employee("Amy", null, null, Set.of(DAY_1, DAY_3), null);
        Employee employee2 = new Employee("Beth", null, null, Set.of(), null);
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::undesiredDayForEmployee)
                .given(employee1, employee2,
                        new Shift("1", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", employee1))
                .penalizes(1);
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::undesiredDayForEmployee)
                .given(employee1, employee2,
                        new Shift("1", DAY_START_TIME.plusDays(1), DAY_END_TIME.plusDays(1), "Location", "Skill", employee1))
                .penalizes(0);
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::undesiredDayForEmployee)
                .given(employee1, employee2,
                        new Shift("1", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", employee2))
                .penalizes(0);
    }

    @Test
    void desiredDayForEmployee() {
        Employee employee1 = new Employee("Amy", null, null, null, Set.of(DAY_1, DAY_3));
        Employee employee2 = new Employee("Beth", null, null, null, Set.of());
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::desiredDayForEmployee)
                .given(employee1, employee2,
                        new Shift("1", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", employee1))
                .rewardsWith(1);
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::desiredDayForEmployee)
                .given(employee1, employee2,
                        new Shift("1", DAY_START_TIME.plusDays(1), DAY_END_TIME.plusDays(1), "Location", "Skill", employee1))
                .rewards(0);
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::desiredDayForEmployee)
                .given(employee1, employee2,
                        new Shift("1", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", employee2))
                .rewards(0);
    }

    @Test
    void undesiredPeriodForEmployee() {
        // Amy prefers not to work on Monday afternoon.
        Employee employee = new Employee("Amy", Set.of("Teacher"), "1A", Set.of(), List.of(), Set.of(), Set.of());
        employee.setUndesiredPeriods(List.of(new DayPeriod(DAY_1, LocalTime.of(12, 0), LocalTime.of(17, 0))));

        // A shift overlapping the undesired period is penalized.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::undesiredPeriodForEmployee)
                .given(employee,
                        new Shift("1", DAY_1.atTime(12, 0), DAY_1.atTime(13, 0), "Refter", "Teacher", employee))
                .penalizes(1);
        // A shift before the undesired period is not penalized.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::undesiredPeriodForEmployee)
                .given(employee,
                        new Shift("2", DAY_1.atTime(10, 0), DAY_1.atTime(10, 30), "Speelplaats", "Teacher", employee))
                .penalizes(0);
        // A shift on another day is not penalized.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::undesiredPeriodForEmployee)
                .given(employee,
                        new Shift("3", DAY_3.atTime(12, 0), DAY_3.atTime(13, 0), "Refter", "Teacher", employee))
                .penalizes(0);
    }

    @Test
    void desiredPeriodForEmployee() {
        // Amy prefers to work on Monday morning.
        Employee employee = new Employee("Amy", Set.of("Teacher"), "1A", Set.of(), List.of(), Set.of(), Set.of());
        employee.setDesiredPeriods(List.of(new DayPeriod(DAY_1, LocalTime.of(8, 0), LocalTime.of(12, 0))));

        // A shift overlapping the desired period is rewarded.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::desiredPeriodForEmployee)
                .given(employee,
                        new Shift("1", DAY_1.atTime(10, 0), DAY_1.atTime(10, 30), "Speelplaats", "Teacher", employee))
                .rewardsWith(1);
        // A shift after the desired period is not rewarded.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::desiredPeriodForEmployee)
                .given(employee,
                        new Shift("2", DAY_1.atTime(12, 0), DAY_1.atTime(13, 0), "Refter", "Teacher", employee))
                .rewards(0);
    }

    @Test
    void maxWorkingMinutes() {
        // Amy's contract caps her at 60 minutes per week; Beth has no cap.
        Employee cappedEmployee = new Employee("Amy", null, null, null, null);
        cappedEmployee.setMaxWorkingMinutes(60);
        Employee uncappedEmployee = new Employee("Beth", null, null, null, null);
        // DAY_1 (2021-02-01) is a Monday; 2021-02-08 is the Monday of the next week.
        LocalDate nextWeek = DAY_1.plusWeeks(1);

        // 90 minutes of shifts in the same week exceeds the 60 minute weekly cap by 30.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::maxWorkingMinutes)
                .given(cappedEmployee,
                        new Shift("1", DAY_1.atTime(10, 0), DAY_1.atTime(11, 0), "Location", "Skill", cappedEmployee),
                        new Shift("2", DAY_1.atTime(12, 0), DAY_1.atTime(12, 30), "Location", "Skill", cappedEmployee))
                .penalizesBy(30);

        // Every week has its own cap: 90 minutes in each of two weeks penalizes 30 twice.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::maxWorkingMinutes)
                .given(cappedEmployee,
                        new Shift("1", DAY_1.atTime(10, 0), DAY_1.atTime(11, 0), "Location", "Skill", cappedEmployee),
                        new Shift("2", DAY_1.atTime(12, 0), DAY_1.atTime(12, 30), "Location", "Skill", cappedEmployee),
                        new Shift("3", nextWeek.atTime(10, 0), nextWeek.atTime(11, 0), "Location", "Skill",
                                cappedEmployee),
                        new Shift("4", nextWeek.atTime(12, 0), nextWeek.atTime(12, 30), "Location", "Skill",
                                cappedEmployee))
                .penalizesBy(60);

        // 60 minutes in each of two weeks stays within the weekly cap.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::maxWorkingMinutes)
                .given(cappedEmployee,
                        new Shift("1", DAY_1.atTime(10, 0), DAY_1.atTime(11, 0), "Location", "Skill", cappedEmployee),
                        new Shift("3", nextWeek.atTime(10, 0), nextWeek.atTime(11, 0), "Location", "Skill",
                                cappedEmployee))
                .penalizes(0);

        // Exactly at the weekly cap is allowed.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::maxWorkingMinutes)
                .given(cappedEmployee,
                        new Shift("1", DAY_1.atTime(10, 0), DAY_1.atTime(11, 0), "Location", "Skill", cappedEmployee))
                .penalizes(0);

        // A teacher without a cap can take any amount of minutes.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::maxWorkingMinutes)
                .given(uncappedEmployee,
                        new Shift("1", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", uncappedEmployee))
                .penalizes(0);

        // An unassigned shift does not count towards anyone's cap.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::maxWorkingMinutes)
                .given(new Shift("2", DAY_START_TIME, DAY_END_TIME, "Location", "Skill", null))
                .penalizes(0);
    }

    @Test
    void maxTwoDutiesPerDay() {
        Employee employee = new Employee("Amy", null, null, null, null);
        LocalDateTime shift1Start = DAY_1.atTime(10, 0);
        LocalDateTime shift1End = DAY_1.atTime(10, 30);
        LocalDateTime shift2Start = DAY_1.atTime(12, 0);
        LocalDateTime shift2End = DAY_1.atTime(13, 0);
        LocalDateTime shift3Start = DAY_1.atTime(14, 45);
        LocalDateTime shift3End = DAY_1.atTime(15, 15);

        // 2 shifts on the same day is within the soft limit (0 penalty).
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::maxTwoDutiesPerDay)
                .given(employee,
                        new Shift("1", shift1Start, shift1End, "Location", "Skill", employee),
                        new Shift("2", shift2Start, shift2End, "Location", "Skill", employee))
                .penalizes(0);

        // 3 shifts on the same day exceeds the limit by 1 (1 soft penalty).
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::maxTwoDutiesPerDay)
                .given(employee,
                        new Shift("1", shift1Start, shift1End, "Location", "Skill", employee),
                        new Shift("2", shift2Start, shift2End, "Location", "Skill", employee),
                        new Shift("3", shift3Start, shift3End, "Location", "Skill", employee))
                .penalizes(1);
    }

    @Test
    void noSimultaneousDutiesForSameClassroom() {
        // Amy and Beth both teach classroom 1A (duo-job).
        Employee amy = new Employee("Amy", Set.of("Teacher"), "1A", null, null, null);
        Employee beth = new Employee("Beth", Set.of("Teacher"), "1A", null, null, null);
        Employee carl = new Employee("Carl", Set.of("Teacher"), "2A", null, null, null);

        // Amy and Beth simultaneously on duty at the same break time -> penalized.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::noSimultaneousDutiesForSameClassroom)
                .given(amy, beth,
                        new Shift("1", DAY_START_TIME, DAY_END_TIME, "Refter", "Teacher", amy),
                        new Shift("2", DAY_START_TIME, DAY_END_TIME, "Speelplaats", "Teacher", beth))
                .penalizes(1);

        // Amy and Carl (different classrooms) simultaneously on duty -> not penalized.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::noSimultaneousDutiesForSameClassroom)
                .given(amy, carl,
                        new Shift("1", DAY_START_TIME, DAY_END_TIME, "Refter", "Teacher", amy),
                        new Shift("2", DAY_START_TIME, DAY_END_TIME, "Speelplaats", "Teacher", carl))
                .penalizes(0);
    }

    @Test
    void balanceEmployeeShiftAssignments() {
        Employee employee1 = new Employee("Amy", null, null, null, Collections.emptySet());
        Employee employee2 = new Employee("Beth", null, null, null, Collections.emptySet());
        // No employees have shifts assigned; the schedule is perfectly balanced.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::balanceEmployeeShiftAssignments)
                .given(employee1, employee2)
                .penalizesBy(0);
        // Only one employee has shifts assigned; the schedule is less balanced.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::balanceEmployeeShiftAssignments)
                .given(employee1, employee2,
                        new Shift("1", DAY_START_TIME.minusDays(1), DAY_END_TIME, "Location", "Skill", employee1))
                .penalizesByMoreThan(0);
        // Every employee has a shift assigned; the schedule is once again perfectly balanced.
        constraintVerifier.verifyThat(EmployeeSchedulingConstraintProvider::balanceEmployeeShiftAssignments)
                .given(employee1, employee2,
                        new Shift("1", DAY_START_TIME.minusDays(1), DAY_END_TIME, "Location", "Skill", employee1),
                        new Shift("2", DAY_START_TIME.minusDays(1), DAY_END_TIME, "Location", "Skill", employee2))
                .penalizesBy(0);

    }
}
