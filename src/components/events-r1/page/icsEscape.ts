/** One text value for an .ics line: backslash, semicolon and comma are escaped and every kind of line break becomes \n. */
export const icsEscape = (s: string): string => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
