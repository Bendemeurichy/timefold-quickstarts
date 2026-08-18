package org.acme.employeescheduling.rest;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.LinkedList;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import jakarta.enterprise.context.ApplicationScoped;

import org.acme.employeescheduling.domain.Employee;
import org.acme.employeescheduling.domain.EmployeeSchedule;
import org.acme.employeescheduling.domain.Shift;
import org.acme.employeescheduling.domain.UnavailablePeriod;

@ApplicationScoped
public class DemoDataGenerator {
    // Wednesday afternoon is off: lunch and afternoon duty are excluded on Wednesday,
    // but the morning break still happens.
    private static final Set<DayOfWeek> NO_WEDNESDAY = Set.of(DayOfWeek.WEDNESDAY);

    public enum DemoData {
        SMALL(new DemoDataParameters(
                List.of(new ShiftDemand("Speelplaats", LocalTime.of(10, 0), LocalTime.of(10, 30), Set.of("1A", "1B"),
                                Set.of()),
                        new ShiftDemand("Speelplaats", LocalTime.of(10, 0), LocalTime.of(10, 30), Set.of("2A", "2B"),
                                Set.of()),
                        new ShiftDemand("Refter", LocalTime.of(12, 0), LocalTime.of(13, 0), Set.of("1A", "1B"),
                                NO_WEDNESDAY),
                        new ShiftDemand("Refter", LocalTime.of(12, 0), LocalTime.of(13, 0), Set.of("2A", "2B"),
                                NO_WEDNESDAY),
                        new ShiftDemand("Speelplaats", LocalTime.of(12, 0), LocalTime.of(13, 0), Set.of("1A", "2A"),
                                NO_WEDNESDAY),
                        new ShiftDemand("Speelplaats", LocalTime.of(12, 0), LocalTime.of(13, 0), Set.of("1B", "2B"),
                                NO_WEDNESDAY),
                        new ShiftDemand("Speelplaats", LocalTime.of(14, 45), LocalTime.of(15, 15), Set.of("1A", "1B"),
                                NO_WEDNESDAY),
                        new ShiftDemand("Speelplaats", LocalTime.of(14, 45), LocalTime.of(15, 15), Set.of("2A", "2B"),
                                NO_WEDNESDAY)),
                List.of("1A", "1B", "2A", "2B"),
                10, // school days (2 weeks)
                15, // teachers
                0
        )),
        LARGE(new DemoDataParameters(
                List.of(new ShiftDemand("Speelplaats", LocalTime.of(10, 0), LocalTime.of(10, 30), Set.of("1A", "1B"),
                                Set.of()),
                        new ShiftDemand("Speelplaats", LocalTime.of(10, 0), LocalTime.of(10, 30), Set.of("2A", "2B"),
                                Set.of()),
                        new ShiftDemand("Speelplaats", LocalTime.of(10, 0), LocalTime.of(10, 30), Set.of("3A", "3B"),
                                Set.of()),
                        new ShiftDemand("Refter", LocalTime.of(12, 0), LocalTime.of(13, 0), Set.of("1A", "1B"),
                                NO_WEDNESDAY),
                        new ShiftDemand("Refter", LocalTime.of(12, 0), LocalTime.of(13, 0), Set.of("2A", "2B"),
                                NO_WEDNESDAY),
                        new ShiftDemand("Refter", LocalTime.of(12, 0), LocalTime.of(13, 0), Set.of("3A", "3B"),
                                NO_WEDNESDAY),
                        new ShiftDemand("Speelplaats", LocalTime.of(12, 0), LocalTime.of(13, 0), Set.of("1A", "2A"),
                                NO_WEDNESDAY),
                        new ShiftDemand("Speelplaats", LocalTime.of(12, 0), LocalTime.of(13, 0), Set.of("1B", "2B"),
                                NO_WEDNESDAY),
                        new ShiftDemand("Speelplaats", LocalTime.of(12, 0), LocalTime.of(13, 0), Set.of("3A", "3B"),
                                NO_WEDNESDAY),
                        new ShiftDemand("Speelplaats", LocalTime.of(14, 45), LocalTime.of(15, 15), Set.of("1A", "1B"),
                                NO_WEDNESDAY),
                        new ShiftDemand("Speelplaats", LocalTime.of(14, 45), LocalTime.of(15, 15), Set.of("2A", "2B"),
                                NO_WEDNESDAY),
                        new ShiftDemand("Speelplaats", LocalTime.of(14, 45), LocalTime.of(15, 15), Set.of("3A", "3B"),
                                NO_WEDNESDAY)),
                List.of("1A", "1B", "2A", "2B", "3A", "3B"),
                20, // school days (4 weeks)
                40, // teachers
                0
        ));

        private final DemoDataParameters parameters;

        DemoData(DemoDataParameters parameters) {
            this.parameters = parameters;
        }

        public DemoDataParameters getParameters() {
            return parameters;
        }
    }

    /**
     * One break duty shift per school day at a location, during the given time slot, supervising the given classrooms.
     * Only teachers attached to one of these classrooms match the shift.
     * On the excluded days of the week the shift does not occur (for example no lunch duty on Wednesday).
     */
    public record ShiftDemand(String location, LocalTime start, LocalTime end, Set<String> classrooms,
                              Set<DayOfWeek> excludedDays) {}

    public record DemoDataParameters(List<ShiftDemand> shiftDemands,
                                     List<String> classrooms,
                                     int schoolDays,
                                     int teacherCount,
                                     int randomSeed) {}

    private static final String TEACHER_SKILL = "Teacher";

    private static final String[] FIRST_NAMES = { "Amy", "Beth", "Carl", "Dan", "Elsa", "Flo", "Gus", "Hugo", "Ivy", "Jay" };
    private static final String[] LAST_NAMES = { "Cole", "Fox", "Green", "Jones", "King", "Li", "Poe", "Rye", "Smith", "Watt" };

    // There is no break duty on Wednesday afternoon (Wednesday afternoon is off):
    // each ShiftDemand declares its own excluded days.

    // The weekdays on which teachers work, from full-time to part-time contracts.
    // The cycle guarantees enough teachers work every weekday to cover the lunch shifts.
    private static final List<Set<DayOfWeek>> WORK_PATTERN_CYCLE = List.of(
            Set.of(DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY,
                    DayOfWeek.FRIDAY), // full-time
            Set.of(DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY,
                    DayOfWeek.FRIDAY), // full-time
            Set.of(DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY,
                    DayOfWeek.FRIDAY), // full-time
            Set.of(DayOfWeek.MONDAY, DayOfWeek.WEDNESDAY, DayOfWeek.FRIDAY), // part-time Mon/Wed/Fri
            Set.of(DayOfWeek.TUESDAY, DayOfWeek.THURSDAY) // part-time Tue/Thu
    );

    public EmployeeSchedule generateDemoData(DemoData demoData) {
        return generateDemoData(demoData.getParameters());
    }

    public EmployeeSchedule generateDemoData(DemoDataParameters parameters) {
        EmployeeSchedule employeeSchedule = new EmployeeSchedule();

        Random random = new Random(parameters.randomSeed);

        List<LocalDate> schoolDays = generateSchoolDays(parameters.schoolDays);

        List<String> namePermutations = joinAllCombinations(FIRST_NAMES, LAST_NAMES);
        Collections.shuffle(namePermutations, random);

        List<Employee> teachers = new ArrayList<>(parameters.teacherCount);
        for (int i = 0; i < parameters.teacherCount; i++) {
            Set<DayOfWeek> workingDays = WORK_PATTERN_CYCLE.get(i % WORK_PATTERN_CYCLE.size());
            String classroom = parameters.classrooms.get(i % parameters.classrooms.size());
            teachers.add(createTeacher(namePermutations.get(i), workingDays, classroom, schoolDays, random));
        }
        // Showcase part-day unavailability: one teacher cannot do lunch duty on the first Thursday,
        // another misses the morning break on the first Tuesday.
        addPartDayUnavailability(teachers.get(0), schoolDays, DayOfWeek.THURSDAY,
                LocalTime.of(12, 15), LocalTime.of(13, 15));
        addPartDayUnavailability(teachers.get(1), schoolDays, DayOfWeek.TUESDAY,
                LocalTime.of(9, 45), LocalTime.of(10, 15));
        employeeSchedule.setEmployees(teachers);

        List<Shift> shifts = new LinkedList<>();
        for (LocalDate schoolDay : schoolDays) {
            for (ShiftDemand shiftDemand : parameters.shiftDemands) {
                if (shiftDemand.excludedDays().contains(schoolDay.getDayOfWeek())) {
                    continue;
                }
                Shift shift = new Shift(schoolDay.atTime(shiftDemand.start()), schoolDay.atTime(shiftDemand.end()),
                        shiftDemand.location(), TEACHER_SKILL);
                shift.setClassrooms(shiftDemand.classrooms());
                shifts.add(shift);
            }
        }
        AtomicInteger countShift = new AtomicInteger();
        shifts.forEach(s -> s.setId(Integer.toString(countShift.getAndIncrement())));
        employeeSchedule.setShifts(shifts);

        return employeeSchedule;
    }

    /**
     * Returns the weekdays (no weekends) starting from the next Monday, since lunch shifts only occur on school days.
     */
    private List<LocalDate> generateSchoolDays(int schoolDayCount) {
        List<LocalDate> schoolDays = new ArrayList<>(schoolDayCount);
        LocalDate date = LocalDate.now().with(TemporalAdjusters.nextOrSame(DayOfWeek.MONDAY));
        while (schoolDays.size() < schoolDayCount) {
            if (date.getDayOfWeek() != DayOfWeek.SATURDAY && date.getDayOfWeek() != DayOfWeek.SUNDAY) {
                schoolDays.add(date);
            }
            date = date.plusDays(1);
        }
        return schoolDays;
    }

    private Employee createTeacher(String name, Set<DayOfWeek> workingDays, String classroom, List<LocalDate> schoolDays,
            Random random) {
        Set<LocalDate> unavailableDates = new LinkedHashSet<>();
        Set<LocalDate> undesiredDates = new LinkedHashSet<>();
        Set<LocalDate> desiredDates = new LinkedHashSet<>();

        // Weekdays that are not part of the teacher's contract are unavailable.
        List<LocalDate> workingDates = new ArrayList<>();
        for (LocalDate schoolDay : schoolDays) {
            if (workingDays.contains(schoolDay.getDayOfWeek())) {
                workingDates.add(schoolDay);
            } else {
                unavailableDates.add(schoolDay);
            }
        }

        // Pick distinct working dates for an extra day off, an undesired date and a desired date.
        List<LocalDate> shuffledWorkingDates = new ArrayList<>(workingDates);
        Collections.shuffle(shuffledWorkingDates, random);
        unavailableDates.add(shuffledWorkingDates.get(0)); // for example a training day or a doctor's appointment
        undesiredDates.add(shuffledWorkingDates.get(1));
        desiredDates.add(shuffledWorkingDates.get(2));

        return new Employee(name, Set.of(TEACHER_SKILL), classroom, unavailableDates, new ArrayList<>(), undesiredDates,
                desiredDates);
    }

    private void addPartDayUnavailability(Employee teacher, List<LocalDate> schoolDays, DayOfWeek dayOfWeek,
            LocalTime from, LocalTime to) {
        schoolDays.stream()
                .filter(schoolDay -> schoolDay.getDayOfWeek() == dayOfWeek
                        && !teacher.getUnavailableDates().contains(schoolDay))
                .findFirst()
                .ifPresent(date -> teacher.getUnavailablePeriods().add(new UnavailablePeriod(date, from, to)));
    }

    private List<String> joinAllCombinations(String[]... partArrays) {
        int size = 1;
        for (String[] partArray : partArrays) {
            size *= partArray.length;
        }
        List<String> out = new ArrayList<>(size);
        for (int i = 0; i < size; i++) {
            StringBuilder item = new StringBuilder();
            int sizePerIncrement = 1;
            for (String[] partArray : partArrays) {
                item.append(' ');
                item.append(partArray[(i / sizePerIncrement) % partArray.length]);
                sizePerIncrement *= partArray.length;
            }
            item.delete(0, 1);
            out.add(item.toString());
        }
        return out;
    }
}
