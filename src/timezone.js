const OFFSET_PATTERN = /^GMT(?:(?<sign>[+-])(?<hours>\d{1,2})(?::(?<minutes>\d{2}))?)?$/;

function getTimeZoneFormatter(timeZone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "long",
    hourCycle: "h23",
    timeZoneName: "longOffset"
  });
}

function getTimeZoneParts(date, timeZone) {
  const formatter = getTimeZoneFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: values.weekday.toLowerCase(),
    offsetName: values.timeZoneName
  };
}

function getTimeZoneOffsetMinutes(date, timeZone) {
  const { offsetName } = getTimeZoneParts(date, timeZone);
  const match = offsetName.match(OFFSET_PATTERN);

  if (!match || !match.groups || !match.groups.sign) {
    console.warn(
      `[TIMEZONE_PARSE_WARN] Failed to parse offset from Intl formatter output: "${offsetName}"`,
      `| date: ${date instanceof Date ? date.toISOString() : date}`,
      `| timezone: ${timeZone}`
    );
    return 0;
  }

  const sign = match.groups.sign === "+" ? 1 : -1;
  const hours = Number(match.groups.hours || 0);
  const minutes = Number(match.groups.minutes || 0);

  return sign * ((hours * 60) + minutes);
}

function makeDateInTimeZone({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const firstOffset = getTimeZoneOffsetMinutes(utcGuess, timeZone);
  const resolvedDate = new Date(utcGuess.getTime() - (firstOffset * 60 * 1000));
  const secondOffset = getTimeZoneOffsetMinutes(resolvedDate, timeZone);

  if (firstOffset !== secondOffset) {
    return new Date(utcGuess.getTime() - (secondOffset * 60 * 1000));
  }

  return resolvedDate;
}

function formatDateOnlyInTimeZone(date, timeZone) {
  const parts = getTimeZoneParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function formatDateTimeInTimeZone(date, timeZone) {
  const parts = getTimeZoneParts(date, timeZone);
  const offsetMinutesTotal = getTimeZoneOffsetMinutes(date, timeZone);
  const sign = offsetMinutesTotal >= 0 ? "+" : "-";
  const offsetHours = String(Math.floor(Math.abs(offsetMinutesTotal) / 60)).padStart(2, "0");
  const offsetMinutes = String(Math.abs(offsetMinutesTotal) % 60).padStart(2, "0");

  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}${sign}${offsetHours}:${offsetMinutes}`;
}

function getStartOfDayInTimeZone(date, timeZone) {
  const parts = getTimeZoneParts(date, timeZone);

  return makeDateInTimeZone({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 0,
    minute: 0,
    second: 0
  }, timeZone);
}

function addDaysInTimeZone(date, days, timeZone) {
  const parts = getTimeZoneParts(date, timeZone);

  return makeDateInTimeZone({
    year: parts.year,
    month: parts.month,
    day: parts.day + days,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  }, timeZone);
}

module.exports = {
  addDaysInTimeZone,
  formatDateOnlyInTimeZone,
  formatDateTimeInTimeZone,
  getStartOfDayInTimeZone,
  getTimeZoneOffsetMinutes,
  getTimeZoneParts,
  makeDateInTimeZone
};
