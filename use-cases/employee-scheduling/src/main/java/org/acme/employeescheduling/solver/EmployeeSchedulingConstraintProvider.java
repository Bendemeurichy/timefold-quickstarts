package org.acme.employeescheduling.solver;

import static ai.timefold.solver.core.api.score.stream.Joiners.equal;
import static ai.timefold.solver.core.api.score.stream.Joiners.overlapping;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.Objects;

import ai.timefold.solver.core.api.score.HardSoftBigDecimalScore;
import ai.timefold.solver.core.api.score.stream.Constraint;
import ai.timefold.solver.core.api.score.stream.ConstraintCollectors;
import ai.timefold.solver.core.api.score.stream.ConstraintFactory;
import ai.timefold.solver.core.api.score.stream.ConstraintProvider;
import ai.timefold.solver.core.api.score.stream.common.LoadBalance;

import org.acme.employeescheduling.domain.DayPeriod;
import org.acme.employeescheduling.domain.Employee;
import org.acme.employeescheduling.domain.Shift;

public class EmployeeSchedulingConstraintProvider implements ConstraintProvider {

    // The lunch window: shifts overlapping 12:00-13:30 count as lunch duties.
    private static final LocalTime LUNCH_WINDOW_START = LocalTime.of(12, 0);
    private static final LocalTime LUNCH_WINDOW_END = LocalTime.of(13, 30);

    @Override
    public Constraint[] defineConstraints(ConstraintFactory constraintFactory) {
        return new Constraint[] {
                // Hard constraints
                requiredSkill(constraintFactory),
                classroomMatch(constraintFactory),
                unassignedShift(constraintFactory),
                noOverlappingShifts(constraintFactory),
                unavailableEmployee(constraintFactory),
                unavailableEmployeePartOfDay(constraintFactory),
                maxWorkingMinutes(constraintFactory),
                maxLunchDutiesPerWeek(constraintFactory),
                oneClassAtATime(constraintFactory),

                // Soft constraints
                undesiredDayForEmployee(constraintFactory),
                desiredDayForEmployee(constraintFactory),
                undesiredPeriodForEmployee(constraintFactory),
                desiredPeriodForEmployee(constraintFactory),
                alternativeClassroomPriority(constraintFactory),
                maxTwoDutiesPerDay(constraintFactory),
                noSimultaneousDutiesForSameClassroom(constraintFactory),
                balanceEmployeeShiftAssignments(constraintFactory)
        };
    }

    private static boolean overlapsPeriod(Shift shift, DayPeriod period) {
        return Objects.equals(period.getDate(), shift.getStart().toLocalDate())
                && shift.getStart().toLocalTime().isBefore(period.getTo())
                && shift.getEnd().toLocalTime().isAfter(period.getFrom());
    }

    Constraint requiredSkill(ConstraintFactory constraintFactory) {
        return constraintFactory.forEach(Shift.class)
                .filter(shift -> shift.getEmployee() != null
                        && shift.getRequiredSkill() != null
                        && (shift.getEmployee().getSkills() == null
                                || !shift.getEmployee().getSkills().contains(shift.getRequiredSkill())))
                .penalize(HardSoftBigDecimalScore.ONE_HARD)
                .asConstraint("Missing required skill");
    }

    Constraint classroomMatch(ConstraintFactory constraintFactory) {
        return constraintFactory.forEach(Shift.class)
                .filter(shift -> shift.getEmployee() != null
                        && shift.getClassrooms() != null && !shift.getClassrooms().isEmpty()
                        // Teachers without a classroom can be scheduled for every shift.
                        && shift.getEmployee().getClassroom() != null
                        && !shift.getClassrooms().contains(shift.getEmployee().getClassroom())
                        // An alternative classroom also matches, but only on its day and time.
                        && shift.getEmployee().getAlternativeClassroomPeriods().stream()
                                .noneMatch(period -> shift.getClassrooms().contains(period.getClassroom())
                                        && overlapsPeriod(shift, period)))
                .penalize(HardSoftBigDecimalScore.ONE_HARD)
                .asConstraint("Wrong classroom");
    }

    Constraint unassignedShift(ConstraintFactory constraintFactory) {
        // Leaving a shift unassigned is a hard penalty, but cheaper than any impossible assignment:
        // the solver prefers it over double-booking a teacher or breaking any other hard constraint.
        // Unassigned entities are excluded from forEach, hence forEachIncludingUnassigned.
        return constraintFactory.forEachIncludingUnassigned(Shift.class)
                .filter(shift -> shift.getEmployee() == null)
                .penalize(HardSoftBigDecimalScore.ONE_HARD)
                .asConstraint("Unassigned shift");
    }

    Constraint noOverlappingShifts(ConstraintFactory constraintFactory) {
        return constraintFactory.forEachUniquePair(Shift.class, equal(Shift::getEmployee),
                overlapping(Shift::getStart, Shift::getEnd))
                .penalize(HardSoftBigDecimalScore.ONE_HARD)
                .asConstraint("Overlapping shift");
    }

    Constraint unavailableEmployee(ConstraintFactory constraintFactory) {
        return constraintFactory.forEach(Shift.class)
                .filter(shift -> shift.getEmployee() != null
                        && shift.getEmployee().getUnavailableDates() != null
                        && shift.getEmployee().getUnavailableDates().contains(shift.getStart().toLocalDate()))
                .penalize(HardSoftBigDecimalScore.ONE_HARD)
                .asConstraint("Unavailable employee");
    }

    Constraint unavailableEmployeePartOfDay(ConstraintFactory constraintFactory) {
        return constraintFactory.forEach(Shift.class)
                .filter(shift -> shift.getEmployee() != null
                        && shift.getEmployee().getUnavailablePeriods().stream()
                                .anyMatch(period -> overlapsPeriod(shift, period)))
                .penalize(HardSoftBigDecimalScore.ONE_HARD)
                .asConstraint("Unavailable employee (part of day)");
    }

    Constraint oneClassAtATime(ConstraintFactory constraintFactory) {
        // PE mode: one PE teacher guides one class at a time, so two different classes
        // may never be planned in overlapping shifts (like a teacher conflict in school
        // timetabling). In break duty mode many teachers work simultaneously, so this
        // constraint only applies when the schedule's peMode problem fact is on.
        return constraintFactory.forEachUniquePair(Shift.class, overlapping(Shift::getStart, Shift::getEnd))
                .filter((shift1, shift2) -> shift1.getEmployee() != null
                        && shift2.getEmployee() != null
                        && shift1.getEmployee() != shift2.getEmployee())
                .join(Boolean.class)
                .filter((shift1, shift2, peMode) -> peMode)
                .penalize(HardSoftBigDecimalScore.ONE_HARD)
                .asConstraint("One class at a time (PE)");
    }

    Constraint maxWorkingMinutes(ConstraintFactory constraintFactory) {
        // A teacher's contract caps the minutes they may be assigned per week (Monday to Sunday):
        // the weekly shift time, minus the custom teachers' maxima, is divided over the other
        // teachers, weighted by each teacher's work ratio.
        // Teachers without a cap (null) can take any amount of minutes.
        return constraintFactory.forEach(Shift.class)
                .filter(shift -> shift.getEmployee() != null && shift.getEmployee().getMaxWorkingMinutes() != null)
                .groupBy(Shift::getEmployee,
                        shift -> shift.getStart().toLocalDate().with(DayOfWeek.MONDAY),
                        ConstraintCollectors.sum(Shift::getDurationInMinutes))
                .filter((employee, weekStart, totalMinutes) -> totalMinutes > employee.getMaxWorkingMinutes())
                .penalize(HardSoftBigDecimalScore.ONE_HARD,
                        (employee, weekStart, totalMinutes) -> totalMinutes - employee.getMaxWorkingMinutes())
                .asConstraint("Max working minutes per week");
    }

    Constraint maxLunchDutiesPerWeek(ConstraintFactory constraintFactory) {
        // A teacher's contract caps how often they can be scheduled during the lunch window
        // (12:00-13:30) per week (Monday to Sunday): full-time teachers at most twice,
        // part-time and 4/5 teachers at most once. Teachers with a custom contract
        // (null work ratio, explicit max working minutes) have no lunch duty limit.
        return constraintFactory.forEach(Shift.class)
                .filter(shift -> shift.getEmployee() != null
                        && shift.getEmployee().getWorkRatio() != null
                        && overlapsLunchWindow(shift))
                .groupBy(Shift::getEmployee,
                        shift -> shift.getStart().toLocalDate().with(DayOfWeek.MONDAY),
                        ConstraintCollectors.count())
                .filter((employee, weekStart, lunchDutyCount) -> lunchDutyCount > maxLunchDutiesPerWeek(employee))
                .penalize(HardSoftBigDecimalScore.ONE_HARD,
                        (employee, weekStart, lunchDutyCount) -> lunchDutyCount - maxLunchDutiesPerWeek(employee))
                .asConstraint("Max lunch duties per week");
    }

    private static boolean overlapsLunchWindow(Shift shift) {
        return shift.getStart().toLocalTime().isBefore(LUNCH_WINDOW_END)
                && shift.getEnd().toLocalTime().isAfter(LUNCH_WINDOW_START);
    }

    private static int maxLunchDutiesPerWeek(Employee employee) {
        // Full-time teachers may do lunch duty twice a week; part-time and 4/5 contracts only once.
        return employee.getWorkRatio() >= 1.0 ? 2 : 1;
    }

    Constraint undesiredDayForEmployee(ConstraintFactory constraintFactory) {
        return constraintFactory.forEach(Shift.class)
                .filter(shift -> shift.getEmployee() != null
                        && shift.getEmployee().getUndesiredDates() != null
                        && shift.getEmployee().getUndesiredDates().contains(shift.getStart().toLocalDate()))
                .penalize(HardSoftBigDecimalScore.ONE_SOFT)
                .asConstraint("Undesired day for employee");
    }

    Constraint desiredDayForEmployee(ConstraintFactory constraintFactory) {
        return constraintFactory.forEach(Shift.class)
                .filter(shift -> shift.getEmployee() != null
                        && shift.getEmployee().getDesiredDates() != null
                        && shift.getEmployee().getDesiredDates().contains(shift.getStart().toLocalDate()))
                .reward(HardSoftBigDecimalScore.ONE_SOFT)
                .asConstraint("Desired day for employee");
    }

    Constraint undesiredPeriodForEmployee(ConstraintFactory constraintFactory) {
        return constraintFactory.forEach(Shift.class)
                .filter(shift -> shift.getEmployee() != null
                        && shift.getEmployee().getUndesiredPeriods().stream()
                                .anyMatch(period -> overlapsPeriod(shift, period)))
                .penalize(HardSoftBigDecimalScore.ONE_SOFT)
                .asConstraint("Undesired period for employee");
    }

    Constraint desiredPeriodForEmployee(ConstraintFactory constraintFactory) {
        return constraintFactory.forEach(Shift.class)
                .filter(shift -> shift.getEmployee() != null
                        && shift.getEmployee().getDesiredPeriods().stream()
                                .anyMatch(period -> overlapsPeriod(shift, period)))
                .reward(HardSoftBigDecimalScore.ONE_SOFT)
                .asConstraint("Desired period for employee");
    }

    Constraint alternativeClassroomPriority(ConstraintFactory constraintFactory) {
        // On the day halves where a teacher can also cover another classroom, that classroom
        // takes priority over their own classroom: assigning the teacher to a break that
        // does not cover the alternative classroom is penalized, so the solver plans them
        // in the alternative classroom during its valid timeslots whenever there is a break for it.
        // A break without classrooms supervises all classrooms, including the alternative one.
        return constraintFactory.forEach(Shift.class)
                .filter(shift -> shift.getEmployee() != null
                        && shift.getClassrooms() != null && !shift.getClassrooms().isEmpty()
                        && shift.getEmployee().getAlternativeClassroomPeriods().stream()
                                .anyMatch(period -> overlapsPeriod(shift, period)
                                        && !shift.getClassrooms().contains(period.getClassroom())))
                .penalize(HardSoftBigDecimalScore.ONE_SOFT)
                .asConstraint("Alternative classroom takes priority");
    }

    Constraint maxTwoDutiesPerDay(ConstraintFactory constraintFactory) {
        return constraintFactory.forEach(Shift.class)
                .filter(shift -> shift.getEmployee() != null)
                .groupBy(Shift::getEmployee, shift -> shift.getStart().toLocalDate(), ConstraintCollectors.count())
                .filter((employee, date, count) -> count > 2)
                .penalize(HardSoftBigDecimalScore.ONE_SOFT, (employee, date, count) -> count - 2)
                .asConstraint("Max two duties per day");
    }

    Constraint noSimultaneousDutiesForSameClassroom(ConstraintFactory constraintFactory) {
        return constraintFactory.forEachUniquePair(Shift.class,
                overlapping(Shift::getStart, Shift::getEnd))
                .filter((shift1, shift2) -> shift1.getEmployee() != null
                        && shift2.getEmployee() != null
                        && !shift1.getEmployee().equals(shift2.getEmployee())
                        && shift1.getEmployee().getClassroom() != null
                        && shift1.getEmployee().getClassroom().equals(shift2.getEmployee().getClassroom()))
                .penalize(HardSoftBigDecimalScore.ONE_SOFT)
                .asConstraint("No simultaneous duties for same classroom");
    }

    // The load balance works on whole numbers, so the shift count divided by the contract weight
    // is scaled to keep a few decimals of precision. The unfairness grows with that same scale,
    // so the penalty is divided by it again: fairness must stay weaker than the other soft
    // constraints (such as (un)desired days), not a thousand times stronger.
    private static final long FAIRNESS_SCALE = 1000L;
    private static final BigDecimal FAIRNESS_SCALE_DECIMAL = BigDecimal.valueOf(FAIRNESS_SCALE);

    Constraint balanceEmployeeShiftAssignments(ConstraintFactory constraintFactory) {
        // Fair share weighted by contract: a 4/5 teacher is due 0.8 times the shifts of a
        // full-time teacher, a part-time teacher 0.5 times. Balancing the shift count divided
        // by the contract weight makes the distribution proportional to how much they work.
        return constraintFactory.forEach(Shift.class)
                .filter(shift -> shift.getEmployee() != null) // Unassigned shifts do not distort the balance.
                .groupBy(Shift::getEmployee, ConstraintCollectors.count())
                .complement(Employee.class, e -> 0L) // Include all employees which are not assigned to any shift.
                .groupBy(ConstraintCollectors.loadBalance((employee, shiftCount) -> employee,
                        (employee, shiftCount) -> Math.round(shiftCount * FAIRNESS_SCALE / contractWeight(employee))))
                .penalizeBigDecimal(HardSoftBigDecimalScore.ONE_SOFT,
                        balance -> balance.unfairness().divide(FAIRNESS_SCALE_DECIMAL))
                .asConstraint("Balance employee shift assignments");
    }

    private static double contractWeight(Employee employee) {
        // The teacher's share of the shifts, relative to a full-time teacher. Teachers without
        // a contract ratio (custom contract or none at all) count as a full share.
        // Clamped to a small positive value so a 0% contract cannot cause a division by zero.
        return employee.getWorkRatio() != null ? Math.max(employee.getWorkRatio(), 0.01) : 1.0;
    }

}
